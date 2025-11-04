// Main application logic for Spec Analyzer
import * as pdfjsLib from 'pdfjs-dist';
import { generateAndDownloadPDF } from './pdf-generator.js';

// Configure PDF.js worker - use local file for reliability with large PDFs
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

let currentFile = null;
let analysisResult = null;
let selectedTrade = null;
let specIndex = null; // Store the index globally
let analysisStartTime = null;

// Progress update helper function
function updateProgress(message, percentage, detail = '') {
    console.log(`[PROGRESS ${percentage}%] ${message}${detail ? ' - ' + detail : ''}`);
    updateLoadingStatus(message, percentage);
}

/**
 * Normalize division keys to simple integers without padding or prefix
 * @param {Object} divisions - Object with division keys
 * @returns {Object} - Normalized divisions with integer string keys
 */
function normalizeIndexKeys(divisions) {
    if (!divisions || typeof divisions !== 'object') {
        return {};
    }
    
    const normalized = {};
    
    for (const [key, value] of Object.entries(divisions)) {
        // Extract number from various formats:
        // 'div04' → '4'
        // 'div4' → '4'
        // '04' → '4'
        // '4' → '4'
        const numMatch = key.match(/\d+/);
        
        if (numMatch) {
            // Remove leading zeros by parsing and converting back to string
            const divNum = parseInt(numMatch[0], 10).toString();
            normalized[divNum] = value;
        }
    }
    
    console.log('[NORMALIZE] Converted', Object.keys(divisions).length, 'keys:', 
        Object.keys(divisions).slice(0, 5).join(', '), '→', 
        Object.keys(normalized).slice(0, 5).join(', '));
    
    return normalized;
}

/**
 * Find a division in the index, trying multiple key formats (safety net)
 * @param {Object} specIndex - The spec index object
 * @param {number|string} divNum - Division number to find
 * @returns {Object|null} - Division range or null
 */
function findDivision(specIndex, divNum) {
    if (!specIndex || !specIndex.sections) {
        console.warn('[LOOKUP] No specIndex.sections available');
        return null;
    }
    
    const sections = specIndex.sections;
    const divStr = divNum.toString();
    
    // Try multiple formats (in case normalization missed something)
    const formats = [
        divStr,                              // '4'
        divStr.padStart(2, '0'),            // '04'
        'div' + divStr,                      // 'div4'
        'div' + divStr.padStart(2, '0')     // 'div04'
    ];
    
    for (const format of formats) {
        if (sections[format]) {
            if (format !== divStr) {
                console.warn(`[LOOKUP] Found division ${divNum} using alternate key: ${format} (normalization may have failed)`);
            }
            return sections[format];
        }
    }
    
    console.error('[LOOKUP] Division', divNum, 'not found. Available:', Object.keys(sections).slice(0, 10));
    return null;
}

/**
 * Intelligently chunk text into sections, preferring PART boundaries
 * @param {string} text - Full division text
 * @param {number} maxChars - Maximum characters per chunk (default 80000)
 * @returns {Array} Array of chunk objects with name and text
 */
function smartChunkText(text, maxChars = 80000) {
    const chunks = [];
    
    // Try to find CSI PART boundaries (PART 1, PART 2, PART 3)
    const partMatches = [];
    const partRegex = /PART\s*(\d+)\s*[-–—]\s*([A-Z\s]+)/gi;
    let match;
    
    while ((match = partRegex.exec(text)) !== null) {
        partMatches.push({
            index: match.index,
            partNum: match[1],
            partName: match[2].trim(),
            fullMatch: match[0]
        });
    }
    
    console.log(`[CHUNKING] Found ${partMatches.length} PART boundaries`);
    
    // If we found PART boundaries, split on them
    if (partMatches.length > 0) {
        for (let i = 0; i < partMatches.length; i++) {
            const currentPart = partMatches[i];
            const nextPart = partMatches[i + 1];
            
            const startIdx = currentPart.index;
            const endIdx = nextPart ? nextPart.index : text.length;
            const partText = text.substring(startIdx, endIdx);
            
            // If this part is too large, split it further
            if (partText.length > maxChars) {
                console.log(`[CHUNKING] Part ${currentPart.partNum} too large (${partText.length} chars), splitting...`);
                
                // Split into subsections
                for (let j = 0; j < partText.length; j += maxChars) {
                    const subChunk = partText.substring(j, j + maxChars);
                    const subNum = Math.floor(j / maxChars) + 1;
                    
                    chunks.push({
                        name: `Part ${currentPart.partNum} - ${currentPart.partName} (${subNum})`,
                        text: subChunk,
                        size: subChunk.length
                    });
                }
            } else {
                chunks.push({
                    name: `Part ${currentPart.partNum} - ${currentPart.partName}`,
                    text: partText,
                    size: partText.length
                });
            }
        }
    } else {
        // No PART boundaries found, split by size
        console.log(`[CHUNKING] No PART boundaries found, splitting by size`);
        
        for (let i = 0; i < text.length; i += maxChars) {
            const chunkNum = Math.floor(i / maxChars) + 1;
            const chunkText = text.substring(i, Math.min(i + maxChars, text.length));
            
            chunks.push({
                name: `Section ${chunkNum}`,
                text: chunkText,
                size: chunkText.length
            });
        }
    }
    
    console.log(`[CHUNKING] Created ${chunks.length} chunks:`, 
        chunks.map(c => `${c.name} (${c.size} chars)`).join(', '));
    
    return chunks;
}

/**
 * Combine multiple chunk analysis results into single comprehensive result
 * @param {Array} chunkResults - Array of {chunkName, analysis} objects
 * @returns {Object} Combined analysis result
 */
function combineTradeChunkResults(chunkResults) {
    console.log(`[COMBINE] Merging ${chunkResults.length} chunk results`);
    
    if (chunkResults.length === 0) {
        return { error: 'No chunk results to combine' };
    }
    
    if (chunkResults.length === 1) {
        return chunkResults[0].analysis;
    }
    
    // Combine all chunks into one comprehensive analysis
    const combined = {
        requirements: [],
        materials: [],
        standards: [],
        risks: [],
        submittals: [],
        testing: [],
        _metadata: {
            chunked: true,
            totalChunks: chunkResults.length,
            chunks: chunkResults.map(c => c.chunkName)
        }
    };
    
    // Merge each chunk's results
    chunkResults.forEach((chunk, idx) => {
        const analysis = chunk.analysis;
        
        // Add section header
        const sectionHeader = `\n## ${chunk.chunkName}\n`;
        
        // Combine requirements
        if (analysis.requirements) {
            combined.requirements.push(sectionHeader + analysis.requirements);
        }
        
        // Combine materials
        if (analysis.materials) {
            combined.materials.push(analysis.materials);
        }
        
        // Combine standards
        if (analysis.standards) {
            combined.standards.push(analysis.standards);
        }
        
        // Combine risks
        if (analysis.risks) {
            combined.risks.push(analysis.risks);
        }
        
        // Combine submittals
        if (analysis.submittals) {
            combined.submittals.push(analysis.submittals);
        }
        
        // Combine testing
        if (analysis.testing) {
            combined.testing.push(analysis.testing);
        }
    });
    
    // Join arrays into strings with proper formatting
    const result = {
        requirements: combined.requirements.join('\n\n'),
        materials: combined.materials.join('\n\n'),
        standards: combined.standards.join('\n\n'),
        risks: combined.risks.join('\n\n'),
        submittals: combined.submittals.join('\n\n'),
        testing: combined.testing.join('\n\n'),
        _metadata: combined._metadata
    };
    
    console.log('[COMBINE] Merge complete');
    
    return result;
}

// DOM Elements
const tradeSelect = document.getElementById('tradeSelect');
const tradeDescription = document.getElementById('tradeDescription');
const uploadSection = document.getElementById('uploadSection');
const uploadBox = document.getElementById('uploadBox');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const analyzeBtn = document.getElementById('analyzeBtn');
const clearBtn = document.getElementById('clearBtn');
const userEmailInput = document.getElementById('userEmail');

const loadingSection = document.getElementById('loadingSection');
const loadingStatus = document.getElementById('loadingStatus');
const resultsSection = document.getElementById('resultsSection');
const resultsContent = document.getElementById('resultsContent');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');

const downloadBtn = document.getElementById('downloadBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const newAnalysisBtn = document.getElementById('newAnalysisBtn');
const tryAgainBtn = document.getElementById('tryAgainBtn');

// Trade information
const tradeInfo = {
    masonry: {
        division: '04',
        description: 'Analyzes masonry requirements including materials, standards (ASTM C90, etc.), installation specs, and coordination with concrete, steel, and openings.'
    },
    concrete: {
        division: '03',
        description: 'Analyzes concrete requirements including mix designs, placement, curing, finishing, and coordination with reinforcement and formwork.'
    },
    steel: {
        division: '05',
        description: 'Analyzes structural steel requirements including connections, erection, welding specs, and coordination with concrete and masonry.'
    },
    carpentry: {
        division: '06',
        description: 'Analyzes rough and finish carpentry requirements including framing, blocking, trim, and coordination with other trades.'
    },
    waterproofing: {
        division: '07',
        description: 'Analyzes waterproofing and dampproofing requirements including membranes, sealants, flashing, and substrate coordination.'
    },
    'doors-windows': {
        division: '08',
        description: 'Analyzes door, window, and glazing requirements including hardware, installation, and wall opening coordination.'
    },
    drywall: {
        division: '09',
        description: 'Analyzes gypsum board requirements including framing, finishes, fire ratings, and coordination with MEP penetrations.'
    },
    roofing: {
        division: '07',
        description: 'Analyzes roofing requirements including membranes, insulation, drainage, and deck coordination.'
    },
    hvac: {
        division: '23',
        description: 'Analyzes HVAC requirements including equipment, ductwork, controls, and coordination with structure and other systems.'
    },
    plumbing: {
        division: '22',
        description: 'Analyzes plumbing requirements including fixtures, piping, drainage, and coordination with structure and fire protection.'
    },
    electrical: {
        division: '26',
        description: 'Analyzes electrical requirements including panels, conduit, wiring, devices, and coordination with structure and other systems.'
    },
    sitework: {
        division: '31',
        description: 'Analyzes sitework requirements including earthwork, utilities, paving, and coordination with building foundation.'
    },
    other: {
        division: 'XX',
        description: 'General spec analysis for miscellaneous or specialty trades.'
    }
};

// Initialize
init();

function init() {
    // Trade selection
    tradeSelect.addEventListener('change', handleTradeSelection);
    
    // Upload box click
    uploadBox.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop
    uploadBox.addEventListener('dragover', handleDragOver);
    uploadBox.addEventListener('dragleave', handleDragLeave);
    uploadBox.addEventListener('drop', handleDrop);

    // Buttons
    analyzeBtn.addEventListener('click', analyzeDocument);
    clearBtn.addEventListener('click', clearFile);
    downloadBtn.addEventListener('click', downloadReport);
    if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', () => downloadPDF());
    newAnalysisBtn.addEventListener('click', startNewAnalysis);
    tryAgainBtn.addEventListener('click', startNewAnalysis);
}

function handleTradeSelection(e) {
    const trade = e.target.value;
    selectedTrade = trade;
    
    if (trade && tradeInfo[trade]) {
        // Show description
        tradeDescription.textContent = tradeInfo[trade].description;
        tradeDescription.style.display = 'block';
        
        // Enable file upload
        uploadSection.style.opacity = '1';
        uploadSection.style.pointerEvents = 'auto';
    } else {
        // Hide description
        tradeDescription.textContent = '';
        tradeDescription.style.display = 'none';
        
        // Disable file upload
        uploadSection.style.opacity = '0.5';
        uploadSection.style.pointerEvents = 'none';
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
        displayFileInfo(file);
    } else {
        showError('Please select a valid PDF file');
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.classList.remove('dragover');

    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        displayFileInfo(file);
    } else {
        showError('Please drop a valid PDF file');
    }
}

function displayFileInfo(file) {
    currentFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileInfo.style.display = 'block';
    uploadBox.style.display = 'none';
}

function clearFile() {
    currentFile = null;
    fileInput.value = '';
    fileInfo.style.display = 'none';
    uploadBox.style.display = 'block';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function analyzeDocument() {
    if (!currentFile) {
        showError('No file selected');
        return;
    }
    
    if (!selectedTrade) {
        showError('Please select a trade first');
        return;
    }

    const userEmail = userEmailInput.value.trim();
    if (!userEmail || !userEmail.includes('@')) {
        showError('Please enter a valid email address');
        return;
    }

    showSection('loading');
    analysisStartTime = Date.now();
    updateLoadingStatus('Step 1/4: Checking for PDF bookmarks...', 5);

    // Declare variables at function scope so they're available to all steps
    let contractAnalysis = null;
    let tradeText = '';
    let tradeAnalysis = null;
    let referencedDivisions = [];
    let coordText = null;
    let coordAnalysis = null;

    try {
        // STEP 1: Create/load index
        const bookmarkIndex = await extractPDFBookmarks(currentFile);
        console.log('[BOOKMARK DEBUG] Extracted:', JSON.stringify(bookmarkIndex, null, 2));
        console.log('[DEBUG INDEX] bookmarkIndex:', bookmarkIndex);
        console.log('[DEBUG INDEX] bookmarkIndex.sections:', bookmarkIndex?.sections);
        
        // Check if bookmarks found any divisions
        const bookmarkDivisions = bookmarkIndex?.sections ? Object.keys(bookmarkIndex.sections).length : 0;
        console.log('[INDEX] Bookmark divisions found:', bookmarkDivisions);
        
        if (bookmarkIndex && bookmarkDivisions > 0) {
            updateLoadingStatus('Step 1/4: Using PDF bookmarks...', 10);
            console.log('[INDEX] Using bookmarks:', bookmarkDivisions, 'divisions found');
            
            const indexResult = await indexWithBookmarks(
                bookmarkIndex.sections,
                bookmarkIndex.totalPages,
                userEmail,
                currentFile.name,
                selectedTrade
            );
            
            console.log('[DEBUG INDEX] indexWithBookmarks returned:', indexResult);
            console.log('[DEBUG INDEX] indexResult type:', typeof indexResult);
            console.log('[DEBUG INDEX] indexResult keys:', Object.keys(indexResult || {}));
            
            // Extract divisions from bookmark result (same logic as fallback)
            let divisions = null;
            
            if (indexResult && indexResult.sections && (indexResult.sections['1'] || indexResult.sections['2'] || indexResult.sections['3'] || indexResult.sections['4'])) {
                console.log('[BOOKMARK] Found divisions in indexResult.sections');
                divisions = indexResult.sections;
            } else if (indexResult && indexResult.sections && indexResult.sections.sections) {
                console.log('[BOOKMARK] Found divisions in indexResult.sections.sections');
                divisions = indexResult.sections.sections;
            } else if (indexResult && (indexResult['1'] || indexResult['2'] || indexResult['3'] || indexResult['4'])) {
                console.log('[BOOKMARK] indexResult IS the divisions object');
                divisions = indexResult;
            }
            
            if (divisions && Object.keys(divisions).length > 0) {
                // NORMALIZE KEYS
                const normalizedSections = normalizeIndexKeys(divisions);
                specIndex = { sections: normalizedSections };
                console.log('[BOOKMARK] ✓ Successfully extracted', Object.keys(divisions).length, 'divisions:', Object.keys(divisions).join(', '));
            } else {
                console.error('[BOOKMARK] ✗ Could not find divisions in indexResult');
                throw new Error('Bookmark indexing returned no divisions');
            }
            
            console.log('[DEBUG INDEX] specIndex after assignment:', specIndex);
            console.log('[DEBUG INDEX] specIndex.sections keys:', Object.keys(specIndex?.sections || {}));
        } else {
            console.log('[INDEX] Bookmarks empty or failed, falling back to text-based TOC parsing');
            updateLoadingStatus('Step 1/4: Scanning document for sections...', 8);
            const { tocText, totalPages } = await extractPDFForIndexing(currentFile);
            
            updateLoadingStatus('Step 1/4: Building index with AI...', 12);
            const indexResult = await identifyRelevantSections(tocText, totalPages, selectedTrade, userEmail, currentFile.name);
            
            console.log('[FALLBACK DEBUG] ========== FULL STRUCTURE ==========');
            console.log('[FALLBACK DEBUG] Full indexResult:', JSON.stringify(indexResult, null, 2));
            console.log('[FALLBACK DEBUG] indexResult type:', typeof indexResult);
            console.log('[FALLBACK DEBUG] All indexResult properties:', Object.keys(indexResult));
            
            console.log('[FALLBACK DEBUG] ========== INDEX PROPERTY ==========');
            console.log('[FALLBACK DEBUG] indexResult.index type:', typeof indexResult.index);
            console.log('[FALLBACK DEBUG] indexResult.index:', indexResult.index);
            console.log('[FALLBACK DEBUG] indexResult.index properties:', Object.keys(indexResult.index || {}));
            
            console.log('[FALLBACK DEBUG] ========== SECTIONS PROPERTY ==========');
            console.log('[FALLBACK DEBUG] indexResult.sections type:', typeof indexResult.sections);
            console.log('[FALLBACK DEBUG] indexResult.sections:', indexResult.sections);
            console.log('[FALLBACK DEBUG] indexResult.sections properties:', Object.keys(indexResult.sections || {}));
            
            console.log('[FALLBACK DEBUG] ========== CHECKING NESTED ==========');
            if (indexResult.index && indexResult.index.sections) {
                console.log('[FALLBACK DEBUG] indexResult.index.sections type:', typeof indexResult.index.sections);
                console.log('[FALLBACK DEBUG] indexResult.index.sections properties:', Object.keys(indexResult.index.sections));
                console.log('[FALLBACK DEBUG] First few keys:', Object.keys(indexResult.index.sections).slice(0, 5));
            }
            
            // Extract divisions - try ALL possible locations
            let divisions = null;
            
            // Location 1: indexResult.index.sections (most common)
            if (indexResult.index?.sections && typeof indexResult.index.sections === 'object') {
                console.log('[FALLBACK] Found divisions at indexResult.index.sections');
                divisions = indexResult.index.sections;
            }
            
            // Location 2: indexResult.sections (sometimes)
            if (!divisions && indexResult.sections && typeof indexResult.sections === 'object') {
                console.log('[FALLBACK] Found divisions at indexResult.sections');
                divisions = indexResult.sections;
            }
            
            // Location 3: indexResult.index itself (if sections is missing)
            if (!divisions && indexResult.index && typeof indexResult.index === 'object') {
                // Check if index itself has division keys like '2', '3', '4' or 'div04'
                const hasNumberKeys = Object.keys(indexResult.index).some(key => /^\d+$/.test(key) || /^div\d+$/.test(key));
                if (hasNumberKeys) {
                    console.log('[FALLBACK] Found divisions at indexResult.index (direct)');
                    divisions = indexResult.index;
                }
            }
            
            console.log('[FALLBACK DEBUG] Extracted divisions:', divisions ? Object.keys(divisions).slice(0, 10) : 'null');
            
            if (!divisions || Object.keys(divisions).length === 0) {
                console.error('[FALLBACK] ✗ Could not find divisions in indexResult:', indexResult);
                throw new Error('Text parsing found no divisions - check Edge Function response');
            }
            
            console.log('[FALLBACK] ✓ Successfully extracted', Object.keys(divisions).length, 'divisions:', Object.keys(divisions).slice(0, 10).join(', '));
            
            // NOW normalize the keys
            const normalizedSections = normalizeIndexKeys(divisions);
            
            console.log('[FALLBACK] ✓ Normalized to', Object.keys(normalizedSections).length, 'divisions');
            
            specIndex = { sections: normalizedSections };
        }
        
        
        console.log('[ANALYSIS] Index ready, starting multi-pass extraction');
        console.log('[INDEX] Final index has', Object.keys(specIndex?.sections || {}).length, 'divisions');
        console.log('[ANALYSIS] Index ready, starting multi-pass extraction');
        console.log('[ANALYSIS] Index sections:', Object.keys(specIndex?.sections || {}));
        
        const arrayBuffer = await currentFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        console.log('[ANALYSIS] PDF loaded:', pdf.numPages, 'pages');
        
        // STEP 2: Extract and analyze Division 00-01 (contract/security)
        try {
            console.log('[STEP 2] Extracting contract requirements using index...');
            updateLoadingStatus('Step 2/4: Analyzing contract requirements...', 25);
            
            // Extract using actual index ranges
            const div00Range = findDivision(specIndex, '0') || findDivision(specIndex, '00');
            const div01Range = findDivision(specIndex, '1') || findDivision(specIndex, '01');
            
            let div00Text = '';
            let div01Text = '';
            
            if (div00Range) {
                console.log('[STEP 2] Extracting Division 00 (pages', `${div00Range.start}-${div00Range.end})`);
                div00Text = await extractSingleRange(pdf, `${div00Range.start}-${div00Range.end}`);
                console.log('[STEP 2] ✓ Division 00 extracted:', div00Text.length, 'characters');
            } else {
                console.warn('[STEP 2] ⚠️  Division 00 not found - this is unusual!');
            }
            
            // Extract Division 01 (General Requirements) - if it exists separately
            if (div01Range) {
                console.log('[STEP 2] Extracting Division 01 (pages', `${div01Range.start}-${div01Range.end})`);
                div01Text = await extractSingleRange(pdf, `${div01Range.start}-${div01Range.end}`);
                console.log('[STEP 2] ✓ Division 01 extracted:', div01Text.length, 'characters');
            } else {
                console.log('[STEP 2] ℹ️  No separate Division 01 found (often combined with Division 00)');
                // DO NOT use fallback! Many specs don't have separate Division 01
                div01Text = '';
            }
            
            // Call Edge Function with both divisions
            console.log('[STEP 2] Calling analyze-contract Edge Function...');
            contractAnalysis = await analyzeContractRequirements(div00Text, div01Text, selectedTrade, userEmail, currentFile.name);
            console.log('[STEP 2] Contract analysis complete');
        } catch (error) {
            console.error('[STEP 2 ERROR]', error);
            throw new Error('Contract analysis failed: ' + error.message);
        }
        
        console.log('[DEBUG] About to start Step 3');
        
        // STEP 3: Extract and analyze trade division
        try {
            console.log('[STEP 3] Starting trade division extraction');
            console.log('[STEP 3] Extracting trade division:', selectedTrade);
            
            // DEBUG: Check specIndex before using it
            console.log('[DEBUG STEP 3] specIndex type:', typeof specIndex);
            console.log('[DEBUG STEP 3] specIndex keys:', Object.keys(specIndex || {}));
            console.log('[DEBUG STEP 3] specIndex.sections keys:', Object.keys(specIndex?.sections || {}));
            console.log('[DEBUG STEP 3] specIndex has Division 4?:', !!specIndex?.sections?.['4']);
            console.log('[DEBUG STEP 3] specIndex.sections[4]:', specIndex?.sections?.['4']);
            
            const tradeRange = getTradeRange(specIndex, selectedTrade);
            console.log('[STEP 3] Trade range:', tradeRange);
            
            tradeText = await extractSingleRange(pdf, tradeRange);
            console.log(`[STEP 3] Extracted ${tradeText.length} characters from trade division`);
            
            // Determine if we need chunking
            const CHUNK_THRESHOLD = 80000; // 80k chars per chunk
            
            if (tradeText.length <= CHUNK_THRESHOLD) {
                // Small enough to analyze in one call
                console.log('[STEP 3] Single-pass analysis');
                updateLoadingStatus('Step 3/4: Analyzing trade requirements...', 50);
                
                // DEBUG: Check if we're passing the right content
                console.log('[DEBUG TRADE] About to call analyzeTradeRequirements');
                console.log('[DEBUG TRADE] tradeText length:', tradeText.length);
                console.log('[DEBUG TRADE] First 500 chars:', tradeText.substring(0, 500));
                console.log('[DEBUG TRADE] Contains MASONRY:', tradeText.toUpperCase().includes('MASONRY'));
                console.log('[DEBUG TRADE] Contains INSURANCE:', tradeText.toUpperCase().includes('INSURANCE'));
                
                tradeAnalysis = await analyzeTradeRequirements(
                    tradeText, 
                    selectedTrade, 
                    userEmail, 
                    currentFile.name
                );
            } else {
                // Too large, use chunking
                console.log(`[STEP 3] Large division (${tradeText.length} chars), using chunked analysis`);
                
                updateLoadingStatus('Analyzing trade requirements', 60, 
                    `Processing ${Math.ceil(tradeText.length / CHUNK_THRESHOLD)} sections...`);
                
                const chunks = smartChunkText(tradeText, CHUNK_THRESHOLD);
                const chunkResults = [];
                
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    console.log(`[STEP 3] Analyzing chunk ${i+1}/${chunks.length}: ${chunk.name}`);
                    
                    updateLoadingStatus('Analyzing trade requirements', 
                        60 + (i / chunks.length) * 15, 
                        `Processing ${chunk.name}...`);
                    
                    try {
                        const result = await analyzeTradeRequirements(
                            chunk.text, 
                            selectedTrade, 
                            userEmail, 
                            currentFile.name,
                            { 
                                chunkInfo: `${chunk.name} (Part ${i+1} of ${chunks.length})`,
                                isChunked: true 
                            }
                        );
                        
                        chunkResults.push({
                            chunkName: chunk.name,
                            analysis: result
                        });
                        
                        console.log(`[STEP 3] Chunk ${i+1}/${chunks.length} complete`);
                        
                    } catch (error) {
                        console.error(`[STEP 3] Error analyzing chunk ${i+1}:`, error);
                        // Continue with other chunks even if one fails
                    }
                    
                    // Wait 60 seconds between chunks to avoid rate limits
                    if (i < chunks.length - 1) {
                        const waitTime = 60;
                        console.log(`[STEP 3] Waiting ${waitTime} seconds for rate limit...`);
                        
                        // Countdown for user
                        for (let sec = waitTime; sec > 0; sec -= 5) {
                            updateLoadingStatus('Analyzing trade requirements',
                                60 + (i / chunks.length) * 15,
                                `Waiting ${sec}s before next section...`);
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                }
                
                // Combine chunk results
                console.log('[STEP 3] Combining chunk results...');
                tradeAnalysis = combineTradeChunkResults(chunkResults);
            }
            
            // Find what sections this trade references
            referencedDivisions = findReferencedSections(tradeText);
            console.log('[STEP 3] Referenced divisions:', referencedDivisions);
            
            console.log('[STEP 3] Trade analysis complete');
            
        } catch (error) {
            console.error('[STEP 3 ERROR]', error);
            throw new Error('Trade analysis failed: ' + error.message);
        }
        
        console.log('[DEBUG] About to start Step 4');
        console.log('[DEBUG] tradeText length:', tradeText.length);
        console.log('[DEBUG] referencedDivisions:', referencedDivisions);
        
        // STEP 4: Smart coordination discovery with AI
        console.log('[STEP 4] Starting intelligent coordination discovery');
        
        try {
            updateProgress('Discovering coordination requirements', 75, 'Identifying critical dependencies...');
            
            // Extract division references from trade analysis
            const divisionRefs = referencedDivisions;
            console.log('[STEP 4] Found division references:', divisionRefs);
            
            if (divisionRefs.length === 0) {
                console.log('[STEP 4] No coordination sections referenced');
                coordAnalysis = { coordination: 'No coordination sections found in referenced divisions.' };
            } else {
                // Use AI to filter which divisions are CRITICAL for coordination
                console.log('[STEP 4] Asking AI to identify critical coordination needs...');
                
                const criticalDivisions = await identifyCriticalCoordination(
                    divisionRefs,
                    selectedTrade,
                    tradeAnalysis?.requirements || tradeText.substring(0, 10000),
                    userEmail,
                    currentFile.name
                );
                
                console.log('[STEP 4] AI identified critical divisions:', criticalDivisions);
                
                if (criticalDivisions.length === 0) {
                    coordAnalysis = { coordination: 'References found but no critical coordination requirements identified.' };
                } else {
                    // Extract only the critical divisions
                    const coordSections = [];
                    
                    for (const divNum of criticalDivisions) {
                        console.log(`[STEP 4] Extracting Division ${divNum} for coordination...`);
                        
                        // Use smart lookup helper
                        const divRange = findDivision(specIndex, divNum);
                        
                        if (divRange) {
                            const start = divRange.start;
                            const end = Math.min(divRange.end, start + 30); // Limit to 30 pages per division
                            const divText = await extractSingleRange(pdf, `${start}-${end}`);
                            coordSections.push({
                                division: divNum,
                                text: divText.substring(0, 40000) // Limit per division
                            });
                        } else {
                            console.warn(`[STEP 4] Division ${divNum} not found in index`);
                        }
                    }
                    
                    if (coordSections.length > 0) {
                        updateProgress('Analyzing coordination requirements', 80, 
                            `Analyzing ${coordSections.length} critical dependencies...`);
                        
                        // Analyze each critical division
                        const coordAnalyses = [];
                        for (const section of coordSections) {
                            console.log(`[STEP 4] Analyzing Division ${section.division}...`);
                            
                            const divAnalysis = await analyzeCoordination(
                                section.text,
                                selectedTrade,
                                userEmail,
                                currentFile.name
                            );
                            
                            if (divAnalysis?.coordination) {
                                coordAnalyses.push(`## DIVISION ${section.division}\n\n${divAnalysis.coordination}`);
                            }
                        }
                        
                        coordAnalysis = {
                            coordination: coordAnalyses.length > 0 
                                ? coordAnalyses.join('\n\n---\n\n')
                                : 'No coordination analysis generated.'
                        };
                    } else {
                        coordAnalysis = { coordination: 'Referenced divisions not found in spec index.' };
                    }
                }
            }
            
            console.log('[STEP 4] Coordination analysis complete');
            
        } catch (error) {
            console.error('[STEP 4 ERROR]', error);
            coordAnalysis = { coordination: 'Error analyzing coordination requirements.' };
        }
        
        console.log('[DEBUG] STEP 4 complete, coordAnalysis:', coordAnalysis);
        
        // Combine all results
        updateLoadingStatus('Complete!', 100);
        
        console.log('[FINAL] Creating analysisResult...');
        console.log('[FINAL] contractAnalysis:', !!contractAnalysis);
        console.log('[FINAL] tradeAnalysis:', !!tradeAnalysis);
        console.log('[FINAL] coordAnalysis:', !!coordAnalysis);
        console.log('[FINAL] coordAnalysis.coordination:', coordAnalysis?.coordination?.substring(0, 100) || 'MISSING');
        
        // DEBUG LOGGING FOR analysisResult CREATION
        console.log('[PDF DEBUG] === BUILDING analysisResult ===');
        
        analysisResult = {
            contract: contractAnalysis?.division00 || contractAnalysis?.contract || 'Contract analysis unavailable',
            security: contractAnalysis?.division01 || contractAnalysis?.security || 'Security analysis unavailable',
            tradeRequirements: tradeAnalysis?.requirements || 'Trade requirements unavailable',
            submittals: tradeAnalysis?.submittals || [],
            coordination: coordAnalysis?.coordination || `Coordination extraction completed (${coordText?.length || 0} chars) but analysis failed. This may indicate an Edge Function timeout or API error.`,
            changeOrders: tradeAnalysis?.changeOrders || 'Change order analysis unavailable',
            metadata: {
                trade: selectedTrade,
                division: getTradeDiv(selectedTrade),
                confidence: 'high',
                extractedSubmittals: tradeAnalysis?.submittals?.length || 0,
                referencedDivisions: referencedDivisions,
                coordinationCharsExtracted: coordText?.length || 0,
                usedIndex: true,
                multiPass: true,
                aiModel: contractAnalysis?.metadata?.model || 'unknown'
            }
        };
        
        console.log('[FINAL] analysisResult.coordination length:', analysisResult.coordination?.length || 0);
        console.log('[FINAL] analysisResult.coordination preview:', analysisResult.coordination?.substring(0, 150));
        
        // MORE DEBUG LOGGING
        console.log('[PDF DEBUG] analysisResult.coordination:', analysisResult.coordination);
        console.log('[PDF DEBUG] analysisResult.coordination length:', analysisResult.coordination?.length || 0);
        
        displayResults(analysisResult);
        
    } catch (error) {
        console.error('Analysis error:', error);
        showError(error.message || 'Failed to analyze document. Please try again.');
    }
}

// NEW: Extract PDF bookmarks/outline
async function extractPDFBookmarks(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        // Get outline (bookmarks)
        const outline = await pdf.getOutline();
        
        if (!outline || outline.length === 0) {
            console.log('[BOOKMARKS] No bookmarks found, falling back to text scan');
            return null;
        }
        
        console.log(`[BOOKMARKS] Found ${outline.length} top-level bookmarks`);
        
        // Parse bookmarks into sections
        const sections = {};
        const divisionSections = {}; // Track multiple sections per division
        
        async function processBookmark(item, depth = 0) {
            if (!item.title) return;
            
            // Get page number for this bookmark
            let pageNum = null;
            if (item.dest) {
                try {
                    const dest = typeof item.dest === 'string' 
                        ? await pdf.getDestination(item.dest)
                        : item.dest;
                    if (dest && dest[0]) {
                        const pageRef = dest[0];
                        pageNum = await pdf.getPageIndex(pageRef) + 1; // +1 because index is 0-based
                    }
                } catch (e) {
                    console.warn('[BOOKMARKS] Could not get page for:', item.title);
                }
            }
            
            // Parse section code from title
            const title = item.title.trim();
            
            // Match division-level bookmarks (e.g., "DIVISION 04")
            const divMatch = title.match(/DIVISION\s+(\d{2})/i);
            
            // Also check for section number format (e.g., "044313", "055000", "071113")
            const sectionMatch = title.match(/^0*(\d{1,2})(\d{4})/);
            
            if (divMatch && pageNum) {
                const divNum = divMatch[1];
                const key = divNum === '00' || divNum === '01' ? `div${divNum}` : divNum.replace(/^0/, '');
                sections[key] = {
                    start: pageNum,
                    title: title.replace(/^DIVISION\s+\d{2}\s*-?\s*/i, '').trim()
                };
                console.log(`[BOOKMARKS] Found ${key} at page ${pageNum}: ${title}`);
            } else if (sectionMatch && pageNum) {
                // Handle section number format (044313 -> Division 4)
                const divNum = parseInt(sectionMatch[1]);
                const sectionNum = sectionMatch[2];
                
                // Initialize division tracking if needed
                if (!divisionSections[divNum]) {
                    divisionSections[divNum] = {
                        startPage: pageNum,
                        sections: []
                    };
                }
                
                // Add section to division
                divisionSections[divNum].sections.push({
                    number: title,
                    page: pageNum
                });
                
                console.log(`[BOOKMARKS] Found section ${title} (Div ${divNum}) at page ${pageNum}`);
            }
            
            // Process children recursively
            if (item.items && item.items.length > 0) {
                for (const child of item.items) {
                    await processBookmark(child, depth + 1);
                }
            }
        }
        
        // Process all bookmarks
        for (const item of outline) {
            await processBookmark(item);
        }
        
        // If we found section numbers, convert them to division ranges
        if (Object.keys(divisionSections).length > 0) {
            console.log('[BOOKMARKS] Processing section-based divisions...');
            
            // Sort divisions numerically
            const sortedDivisions = Object.keys(divisionSections)
                .map(d => parseInt(d))
                .sort((a, b) => a - b);
            
            // Calculate page ranges for each division
            for (let i = 0; i < sortedDivisions.length; i++) {
                const divNum = sortedDivisions[i];
                const divData = divisionSections[divNum];
                const startPage = divData.startPage;
                
                // End page is where next division starts (minus 1), or total pages for last division
                const endPage = i < sortedDivisions.length - 1 
                    ? divisionSections[sortedDivisions[i + 1]].startPage - 1
                    : pdf.numPages;
                
                // Add to sections using standard format
                const key = divNum < 10 ? `${divNum}` : divNum.toString();
                sections[key] = {
                    start: startPage,
                    end: endPage,
                    title: `Division ${divNum} (${divData.sections.length} sections)`
                };
                
                console.log(`[BOOKMARKS] Division ${key}: pages ${startPage}-${endPage} (${divData.sections.length} sections)`);
            }
        }
        
        // Sort sections by page number for standard divisions
        const sortedKeys = Object.keys(sections).sort((a, b) => {
            const pageOrder = sections[a].start - sections[b].start;
            if (pageOrder !== 0) return pageOrder;
            
            // If same page, divisions (shorter keys) come first
            return a.length - b.length;
        });
        
        console.log('[BOOKMARKS] Sorted sections:', sortedKeys.map(k => `${k} (p${sections[k].start})`).join(', '));
        
        // Calculate end pages for standard division bookmarks
        for (let i = 0; i < sortedKeys.length - 1; i++) {
            if (!sections[sortedKeys[i]].end) {
                sections[sortedKeys[i]].end = sections[sortedKeys[i + 1]].start - 1;
            }
        }
        
        // Last section goes to end of document if not already set
        if (sortedKeys.length > 0 && !sections[sortedKeys[sortedKeys.length - 1]].end) {
            sections[sortedKeys[sortedKeys.length - 1]].end = pdf.numPages;
        }
        
        console.log(`[BOOKMARKS] Extracted ${Object.keys(sections).length} sections`);
        return {
            sections,
            totalPages: pdf.numPages,
            method: 'bookmarks'
        };
        
    } catch (error) {
        console.error('[BOOKMARKS] Error:', error);
        return null;
    }
}

// Smart probe extraction for indexing
async function extractPDFForIndexing(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const arrayBufferCopy = arrayBuffer.slice(0);
        
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        
        // INCREASED: Extract more pages to get complete TOC
        const maxProbe = Math.min(300, Math.ceil(totalPages * 0.3)); // Was 200/0.25
        const probeRanges = [
            [1, 30],      // Was [1, 20]
            [40, 70],     // Was [40, 60]
            [80, 110],    // Was [80, 100]
            [120, 150],   // Was [120, 140]
            [160, 190],   // Was [160, 180]
            [220, 250],   // NEW
            [280, Math.min(310, maxProbe)] // NEW
        ];
        
        let tocText = '';
        console.log(`[INDEX] Probing ${totalPages} page doc (max ${maxProbe} pages)`);
        
        for (const [start, end] of probeRanges) {
            if (start > totalPages) break;
            
            for (let i = start; i <= Math.min(end, totalPages); i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                tocText += `\n--- PAGE ${i} ---\n${pageText}`;
            }
        }
        
        console.log(`[INDEX] Extracted ${tocText.length} chars`);
        
        return { tocText, totalPages, pdfData: arrayBufferCopy };
    } catch (error) {
        console.error('PDF extraction error:', error);
        throw new Error('Failed to extract text from PDF');
    }
}

// Legacy extraction function (kept for backwards compatibility)
async function extractPDFText(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const arrayBufferCopy = arrayBuffer.slice(0);
        
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const tocPages = Math.min(30, pdf.numPages);
        let tocText = '';
        
        console.log(`Extracting TOC (first ${tocPages} pages of ${pdf.numPages} total)`);
        
        for (let i = 1; i <= tocPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            tocText += `\n--- PAGE ${i} ---\n${pageText}`;
        }
        
        return {
            tocText,
            totalPages: pdf.numPages,
            pdfData: arrayBufferCopy
        };
    } catch (error) {
        console.error('PDF extraction error:', error);
        throw new Error('Failed to extract text from PDF. Please ensure it\'s a valid PDF file.');
    }
}

async function extractSpecificPages(pdfData, pageRanges) {
    try {
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        let extractedText = '';
        
        console.log('Extracting specific page ranges:', pageRanges);
        
        for (const range of pageRanges) {
            const [start, end] = range.split('-').map(n => parseInt(n.trim()));
            
            console.log(`Extracting pages ${start}-${end}`);
            
            for (let i = start; i <= Math.min(end, pdf.numPages); i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                extractedText += `\n--- PAGE ${i} ---\n${pageText}\n`;
            }
        }
        
        console.log(`Extracted ${extractedText.length} characters from specific pages`);
        return extractedText;
    } catch (error) {
        console.error('Page extraction error:', error);
        throw new Error('Failed to extract specific pages from PDF');
    }
}

// Helper to extract pages from loaded PDF
async function extractSpecificPagesFromPDF(pdf, pageRanges) {
    let extractedText = '';
    
    for (const range of pageRanges) {
        const [start, end] = range.split('-').map(n => parseInt(n.trim()));
        
        console.log(`Extracting pages ${start}-${end}`);
        
        for (let i = start; i <= Math.min(end, pdf.numPages); i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            extractedText += `\n--- PAGE ${i} ---\n${pageText}\n`;
        }
    }
    
    console.log(`Extracted ${extractedText.length} characters`);
    return extractedText;
}

// NEW: Send bookmark data to edge function
async function indexWithBookmarks(sections, totalPages, userEmail, filename, trade) {
    const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/identify-sections`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bookmarks: sections,
                totalPages,
                trade,
                userEmail,
                filename
            })
        }
    );

    if (!response.ok) {
        throw new Error('Bookmark indexing failed');
    }

    const data = await response.json();
    return data.index;
}

function getPageRangesFromIndex(index, trade) {
    if (!index || !index.sections) {
        return ['1-50'];
    }
    
    const sections = index.sections;
    const ranges = [];
    
    // Get contract basics (first 50 pages)
    ranges.push('1-50');
    
    // Get full trade division
    const tradeDiv = getTradeDiv(trade).replace(/^0/, '');
    if (sections[tradeDiv]) {
        ranges.push(`${sections[tradeDiv].start}-${sections[tradeDiv].end}`);
        const pageCount = sections[tradeDiv].end - sections[tradeDiv].start + 1;
        console.log(`[INDEX] Division ${tradeDiv}: ${pageCount} pages`);
    }
    
    // Get critical coordination divisions (commonly referenced)
    const criticalDivs = getCriticalCoordDivisions(trade);
    for (const coordDiv of criticalDivs) {
        const divKey = coordDiv.replace(/^0/, '');
        if (sections[divKey]) {
            // Sample first 20 pages of coordination division
            const start = sections[divKey].start;
            const end = Math.min(sections[divKey].end, start + 20);
            ranges.push(`${start}-${end}`);
            console.log(`[INDEX] Coordination Div ${divKey}: ${end - start + 1} pages sampled`);
        }
    }
    
    console.log(`[INDEX] Total ranges:`, ranges);
    return ranges.length > 1 ? ranges : ['1-50'];
}

function getCriticalCoordDivisions(trade) {
    // Only divisions that are COMMONLY needed (not rare edge cases)
    const criticalMap = {
        'masonry': ['3', '7'], // Concrete (precast), Div 7 (WRB/flashing/caulking)
        'concrete': ['4'], // Masonry
        'waterproofing': ['3', '4'], // Concrete, Masonry
        'roofing': ['7'] // Thermal/waterproofing
        // Other trades: add as you learn what they need
    };
    
    return criticalMap[trade] || [];
}

function getTradeDiv(trade) {
    const map = {
        'masonry': '4',
        'concrete': '3',
        'steel': '5',
        'carpentry': '6',
        'waterproofing': '7',
        'doors-windows': '8',
        'drywall': '9',
        'roofing': '7',
        'hvac': '23',
        'plumbing': '22',
        'electrical': '26',
        'sitework': '31'
    };
    return map[trade] || '4';
}

async function identifyRelevantSections(tocText, totalPages, trade, userEmail, filename) {
    const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/identify-sections`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                tocText,
                totalPages,
                trade,
                userEmail,
                filename
            })
        }
    );

    if (!response.ok) {
        console.warn('Identify sections failed, using fallback');
        return { 
            pageRanges: ['1-50'],
            index: null
        };
    }

    const data = await response.json();
    console.log('[INDEX] Result:', data);
    return data;
}


// Helper: Extract a single page range
async function extractSingleRange(pdf, range) {
    const [start, end] = range.split('-').map(n => parseInt(n.trim()));
    let text = '';
    
    console.log(`[EXTRACT] Pages ${start}-${end}`);
    
    for (let i = start; i <= Math.min(end, pdf.numPages); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        text += `\n--- PAGE ${i} ---\n${pageText}\n`;
    }
    
    console.log(`[EXTRACT] Extracted ${text.length} characters`);
    return text;
}

// Helper: Get trade division page range
function getTradeRange(index, trade) {
    if (!index || !index.sections) {
        return '1-50';
    }
    
    const divNum = getTradeDiv(trade);
    console.log('[DEBUG TRADE] Looking for division:', divNum);
    console.log('[DEBUG TRADE] specIndex.sections keys:', Object.keys(index.sections));
    
    // Use smart lookup helper
    const divRange = findDivision(index, divNum);
    
    if (!divRange) {
        console.warn('[EXTRACT] Division', divNum, 'not found in index');
        return '1-50';
    }
    
    // Cap at 50 pages for safety
    const start = divRange.start;
    const end = Math.min(divRange.end, start + 50);
    
    console.log(`[EXTRACT] Trade division ${divNum}: pages ${start}-${end}`);
    return `${start}-${end}`;
}

// NEW: Find specific section references like "07 21 13"
function findSpecificSectionReferences(text) {
    const specificSections = new Set();
    
    // Pattern for full section numbers: "Section 07 21 13" or "per 07 21 13"
    const patterns = [
        /Section\s+(\d{2}\s+\d{2}\s+\d{2})/gi,
        /(?:per|see|refer to|as specified in|as detailed in)\s+(?:Section\s+)?(\d{2}\s+\d{2}\s+\d{2})/gi
    ];
    
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            specificSections.add(match[1].trim());
        }
    }
    
    const sections = Array.from(specificSections);
    console.log('[SPECIFIC REFS] Found:', sections.join(', '));
    return sections;
}

// NEW: Find pages containing specific keywords
async function findPagesWithKeywords(pdf, startPage, endPage, keywords) {
    const relevantPages = [];
    
    console.log(`[KEYWORD SEARCH] Scanning pages ${startPage}-${endPage} for: ${keywords.join(', ')}`);
    
    for (let pageNum = startPage; pageNum <= Math.min(endPage, pdf.numPages); pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ').toLowerCase();
        
        // Check if page contains any of the keywords
        const hasKeyword = keywords.some(keyword => pageText.includes(keyword.toLowerCase()));
        
        if (hasKeyword) {
            relevantPages.push(pageNum);
        }
    }
    
    console.log(`[KEYWORD SEARCH] Found ${relevantPages.length} relevant pages`);
    return relevantPages;
}

// NEW: Get coordination keywords based on trade
function getCoordinationKeywords(trade, referencedDiv) {
    const keywordMap = {
        'masonry': {
            '3': ['embed', 'anchor', 'dovetail', 'slot', 'connection', 'attach', 'tie'],
            '7': ['flashing', 'weep', 'through-wall', 'sealant', 'joint', 'waterproof', 'damp'],
            '5': ['embed', 'plate', 'angle', 'connection', 'anchor'],
            '8': ['rough opening', 'head joint', 'jamb', 'sill', 'lintel']
        },
        'concrete': {
            '4': ['embed', 'anchor', 'attachment', 'dovetail', 'slot'],
            '3': ['interface', 'joint', 'construction joint', 'cold joint'],
            '7': ['waterproof', 'membrane', 'vapor barrier']
        },
        'waterproofing': {
            '3': ['substrate', 'surface preparation', 'concrete', 'joint', 'crack'],
            '4': ['substrate', 'masonry', 'surface', 'joint'],
            '7': ['flashing', 'termination', 'transition', 'penetration', 'detail']
        },
        'roofing': {
            '7': ['insulation', 'vapor', 'air barrier', 'substrate', 'deck'],
            '5': ['deck', 'structural', 'support', 'attachment']
        },
        'steel': {
            '3': ['embed', 'plate', 'connection', 'anchor'],
            '4': ['embed', 'plate', 'connection', 'anchor']
        },
        'carpentry': {
            '7': ['blocking', 'nailer', 'substrate', 'attachment'],
            '5': ['connection', 'attachment', 'framing']
        },
        'drywall': {
            '5': ['framing', 'stud', 'track'],
            '6': ['blocking', 'backing', 'substrate'],
            '7': ['insulation', 'vapor barrier', 'air barrier']
        }
    };
    
    return keywordMap[trade]?.[referencedDiv] || ['requirement', 'specification', 'coordinate', 'interface'];
}

/**
 * ROBUST: Find section references in trade text with comprehensive pattern matching
 * Handles multiple formats: 6-digit, spaced, hyphenated, Division mentions, and keywords
 */
function findReferencedSections(tradeText) {
    const divisions = new Set();
    
    console.log('[REFERENCES] Scanning first 8000 chars for division references...');
    const scanText = tradeText.substring(0, 8000);
    
    // ===============================================
    // PATTERN 1: Six-digit section numbers
    // ===============================================
    const sixDigitPatterns = [
        /(?:Section|section|SECTION)\s+(\d{2})\s?(\d{2})\s?(\d{2})/g,
        /(?:See|see|SEE)\s+(?:Section|section)\s+(\d{2})[\s-]?(\d{2})[\s-]?(\d{2})/g,
        /\b(\d{2})[\s-](\d{2})[\s-](\d{2})\b/g
    ];
    
    sixDigitPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(scanText)) !== null) {
            const divNum = match[1];
            const normalized = parseInt(divNum, 10).toString();
            
            if (parseInt(divNum) >= 1 && parseInt(divNum) <= 50) {
                console.log(`[REFERENCES] Found section ${match[1]}${match[2]}${match[3]} → Division ${normalized}`);
                divisions.add(normalized);
            }
        }
    });
    
    // ===============================================
    // PATTERN 2: Division mentions
    // ===============================================
    const divisionPatterns = [
        /(?:Division|division|DIVISION)\s+(\d{1,2})/g,
        /(?:Div\.|div\.|DIV\.)\s*(\d{1,2})/g
    ];
    
    divisionPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(scanText)) !== null) {
            const divNum = match[1];
            const normalized = parseInt(divNum, 10).toString();
            
            if (parseInt(divNum) >= 1 && parseInt(divNum) <= 50) {
                console.log(`[REFERENCES] Found Division ${divNum} → Division ${normalized}`);
                divisions.add(normalized);
            }
        }
    });
    
    // ===============================================
    // PATTERN 3: Keyword fallback (if few found)
    // ===============================================
    if (divisions.size < 2) {
        console.log('[REFERENCES] Few explicit references, adding keyword detection...');
        const keywords = {
            'concrete': '3',
            'formwork': '3',
            'rebar': '3',
            'structural steel': '5',
            'steel': '5',
            'metal': '5',
            'anchor': '5',
            'lintel': '5',
            'insulation': '7',
            'flashing': '7',
            'waterproof': '7',
            'roofing': '7',
            'sealant': '7',
            'weather barrier': '7',
            'air barrier': '7',
            'door': '8',
            'window': '8',
            'frame': '8',
            'hollow metal': '8'
        };
        
        const lowerText = scanText.toLowerCase();
        for (const [keyword, div] of Object.entries(keywords)) {
            if (lowerText.includes(keyword)) {
                console.log(`[REFERENCES] Keyword "${keyword}" → Division ${div}`);
                divisions.add(div);
            }
        }
    }
    
    const result = Array.from(divisions)
        .map(d => parseInt(d))
        .filter(d => d >= 1 && d <= 50)
        .sort((a, b) => a - b)
        .map(d => d.toString());
    
    console.log('[REFERENCES] ===== FINAL RESULTS =====');
    console.log('[REFERENCES] Total unique divisions found:', result.length);
    console.log('[REFERENCES] Divisions:', result.join(', '));
    
    return result;
}

// SIMPLIFIED: Extract referenced sections - first 30 pages per division for actionable checklist
async function extractReferencedSections(pdf, index, referencedDivisions, tradeText) {
    if (!referencedDivisions || referencedDivisions.length === 0) {
        return null;
    }
    
    let coordText = '';
    
    // First, find specific section references (like "07 21 13")
    const specificSections = findSpecificSectionReferences(tradeText);
    
    for (const divNum of referencedDivisions) {
        const divKey = divNum.replace(/^0/, '');
        const section = index.sections?.[divKey];
        
        if (!section) {
            console.warn(`[EXTRACT] Division ${divKey} not found in index`);
            continue;
        }
        
        // Check if we need specific subsections from this division
        const specificInThisDiv = specificSections.filter(s => s.startsWith(divNum));
        
        if (specificInThisDiv.length > 0) {
            console.log(`[EXTRACT] Division ${divKey} has specific sections:`, specificInThisDiv);
            
            // Try to find each specific section in our index
            let foundAny = false;
            
            for (const specificSection of specificInThisDiv) {
                // Try with spaces: "07 21 13"
                let sectionKey = specificSection;
                let specificSectionData = index.sections?.[sectionKey];
                
                // If not found, try without leading zero on division: "7 21 13"
                if (!specificSectionData && sectionKey.startsWith('0')) {
                    sectionKey = sectionKey.substring(1);
                    specificSectionData = index.sections?.[sectionKey];
                }
                
                if (specificSectionData) {
                    // Found it! Extract this specific section
                    foundAny = true;
                    const start = specificSectionData.start;
                    const end = Math.min(specificSectionData.end, start + 10);
                    const text = await extractSingleRange(pdf, `${start}-${end}`);
                    coordText += text;
                    console.log(`[EXTRACT] ✓ Specific section ${specificSection}: pages ${start}-${end}`);
                } else {
                    console.warn(`[EXTRACT] ✗ Section ${specificSection} not found in index`);
                }
            }
            
            // If we didn't find any specific sections, fall back to keyword search or sampling
            if (!foundAny) {
                const divisionLength = section.end - section.start + 1;
                
                if (divisionLength > 30) {
                    console.log(`[EXTRACT] Division ${divKey} is large (${divisionLength} pages), using keyword search`);
                    
                    // Get trade-specific keywords
                    const keywords = getCoordinationKeywords(selectedTrade, divNum);
                    
                    // Find relevant pages
                    const relevantPages = await findPagesWithKeywords(
                        pdf, 
                        section.start, 
                        section.end, 
                        keywords
                    );
                    
                    if (relevantPages.length > 0) {
                        // Extract pages with context (page before and after each match)
                        const pagesToExtract = new Set();
                        relevantPages.forEach(pageNum => {
                            pagesToExtract.add(Math.max(section.start, pageNum - 1));
                            pagesToExtract.add(pageNum);
                            pagesToExtract.add(Math.min(section.end, pageNum + 1));
                        });
                        
                        // Convert to sorted array and create ranges
                        const sortedPages = Array.from(pagesToExtract).sort((a, b) => a - b);
                        
                        // Extract in chunks
                        let i = 0;
                        while (i < sortedPages.length) {
                            const rangeStart = sortedPages[i];
                            let rangeEnd = rangeStart;
                            
                            // Combine consecutive pages into ranges
                            while (i + 1 < sortedPages.length && sortedPages[i + 1] === sortedPages[i] + 1) {
                                i++;
                                rangeEnd = sortedPages[i];
                            }
                            
                            const text = await extractSingleRange(pdf, `${rangeStart}-${rangeEnd}`);
                            coordText += text;
                            console.log(`[EXTRACT] Keyword-targeted: pages ${rangeStart}-${rangeEnd}`);
                            
                            i++;
                        }
                    } else {
                        console.log(`[EXTRACT] No keyword matches, using multi-point sampling`);
                        // Fall back to multi-point sampling
                        const start = section.start;
                        const middleStart = Math.floor((section.start + section.end) / 2) - 3;
                        const text1 = await extractSingleRange(pdf, `${start}-${Math.min(start + 9, section.end)}`);
                        const text2 = await extractSingleRange(pdf, `${middleStart}-${Math.min(middleStart + 6, section.end)}`);
                        const text3 = await extractSingleRange(pdf, `${Math.max(section.end - 6, middleStart + 7)}-${section.end}`);
                        coordText += text1 + text2 + text3;
                    }
                } else {
                    console.log(`[EXTRACT] Falling back to division ${divKey} sample`);
                    const start = section.start;
                    const end = Math.min(section.end, start + 20);
                    const text = await extractSingleRange(pdf, `${start}-${end}`);
                    coordText += text;
                    console.log(`[EXTRACT] Division ${divKey} (fallback): pages ${start}-${end}`);
                }
            }
        } else {
            // No specific section needed - use keyword search or sampling based on size
            const divisionLength = section.end - section.start + 1;
            
            if (divisionLength > 30) {
                console.log(`[EXTRACT] Division ${divKey} is large (${divisionLength} pages), using keyword search`);
                
                // Get trade-specific keywords
                const keywords = getCoordinationKeywords(selectedTrade, divNum);
                
                // Find relevant pages
                const relevantPages = await findPagesWithKeywords(
                    pdf, 
                    section.start, 
                    section.end, 
                    keywords
                );
                
                if (relevantPages.length > 0) {
                    // Extract pages with context
                    const pagesToExtract = new Set();
                    relevantPages.forEach(pageNum => {
                        pagesToExtract.add(Math.max(section.start, pageNum - 1));
                        pagesToExtract.add(pageNum);
                        pagesToExtract.add(Math.min(section.end, pageNum + 1));
                    });
                    
                    const sortedPages = Array.from(pagesToExtract).sort((a, b) => a - b);
                    
                    // Extract in chunks
                    let i = 0;
                    while (i < sortedPages.length) {
                        const rangeStart = sortedPages[i];
                        let rangeEnd = rangeStart;
                        
                        while (i + 1 < sortedPages.length && sortedPages[i + 1] === sortedPages[i] + 1) {
                            i++;
                            rangeEnd = sortedPages[i];
                        }
                        
                        const text = await extractSingleRange(pdf, `${rangeStart}-${rangeEnd}`);
                        coordText += text;
                        console.log(`[EXTRACT] Keyword-targeted: pages ${rangeStart}-${rangeEnd}`);
                        
                        i++;
                    }
                } else {
                    console.log(`[EXTRACT] No keyword matches, using multi-point sampling`);
                    const start = section.start;
                    const middleStart = Math.floor((section.start + section.end) / 2) - 3;
                    const text1 = await extractSingleRange(pdf, `${start}-${Math.min(start + 9, section.end)}`);
                    const text2 = await extractSingleRange(pdf, `${middleStart}-${Math.min(middleStart + 6, section.end)}`);
                    const text3 = await extractSingleRange(pdf, `${Math.max(section.end - 6, middleStart + 7)}-${section.end}`);
                    coordText += text1 + text2 + text3;
                }
            } else {
                // Small division: simple sampling
                const start = section.start;
                const end = Math.min(section.end, start + 15);
                const text = await extractSingleRange(pdf, `${start}-${end}`);
                coordText += text;
                console.log(`[EXTRACT] Division ${divKey} (small): pages ${start}-${end}`);
            }
        }
    }
    
    console.log('[EXTRACT COMPLETE] Returning coordText length:', coordText.length);
    console.log('[EXTRACT COMPLETE] Contains Div 03:', coordText.includes('DIVISION 03') || coordText.match(/PAGE 6[3-7]\d/) !== null);
    console.log('[EXTRACT COMPLETE] Contains Div 07:', coordText.includes('DIVISION 07') || coordText.match(/PAGE (8|9|10|11)\d{2}/) !== null);
    
    return coordText.length > 0 ? coordText : null;
}

// Legacy: Extract coordination sections (kept for compatibility)
async function extractCoordinationSections(pdf, index, trade) {
    const criticalDivs = getCriticalCoordDivisions(trade);
    let coordText = '';
    
    for (const coordDiv of criticalDivs) {
        const divKey = coordDiv.replace(/^0/, '');
        const section = index.sections?.[divKey];
        
        if (section) {
            // Sample first 10 pages of each coordination division
            const start = section.start;
            const end = Math.min(section.end, start + 10);
            const text = await extractSingleRange(pdf, `${start}-${end}`);
            coordText += text;
            console.log(`[EXTRACT] Coordination Div ${divKey}: ${end - start + 1} pages`);
        }
    }
    
    return coordText.length > 0 ? coordText : null;
}

// API call: Analyze contract requirements
async function analyzeContractRequirements(div00Text, div01Text, trade, userEmail, filename) {
    try {
        console.log('[CONTRACT API] Sending to analyze-contract Edge Function:');
        console.log('[CONTRACT API] - Division 00:', div00Text.length, 'characters');
        console.log('[CONTRACT API] - Division 01:', div01Text.length, 'characters');
        
        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-contract`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                    div00Text: div00Text || '',
                    div01Text: div01Text || '',
                    trade,
                    userEmail,
                    filename
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[CONTRACT API ERROR]', errorData);
            throw new Error(errorData.error || 'Contract analysis failed');
        }

        const data = await response.json();
        console.log('[CONTRACT API] ✓ Response received');
        
        // Handle both old and new response formats
        return {
            division00: data.division00 || data.contract,
            division01: data.division01 || data.security,
            metadata: data.metadata || {}
        };
        
    } catch (error) {
        console.error('[CONTRACT API ERROR]', error);
        throw error;
    }
}

// API call: Analyze trade requirements
async function analyzeTradeRequirements(text, trade, userEmail, filename, chunkContext = null) {
    const requestBody = { text, trade, userEmail, filename };
    
    // Add chunk context if provided
    if (chunkContext) {
        requestBody.chunkInfo = chunkContext.chunkInfo;
        requestBody.isChunked = chunkContext.isChunked;
    }
    
    const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-trade`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        }
    );

    if (!response.ok) {
        throw new Error('Trade analysis failed');
    }
    
    return await response.json();
}

/**
 * Use AI to identify which division references are CRITICAL for coordination
 * @param {Array} divisionRefs - List of division numbers referenced in trade spec
 * @param {string} trade - Selected trade (e.g., "masonry")
 * @param {string} tradeAnalysis - The trade requirements analysis text
 * @param {string} userEmail - User email
 * @param {string} filename - PDF filename
 * @returns {Promise<Array>} Array of critical division numbers to extract
 */
async function identifyCriticalCoordination(divisionRefs, trade, tradeAnalysis, userEmail, filename) {
    console.log('[SMART COORD] Identifying critical divisions from:', divisionRefs);
    
    try {
        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/identify-critical-coordination`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                    divisionRefs,
                    trade,
                    tradeContext: tradeAnalysis.substring(0, 10000), // Send summary for context
                    userEmail,
                    filename
                })
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[SMART COORD] Error:', errorText);
            // Fallback: return top 3 divisions
            return divisionRefs.slice(0, 3);
        }
        
        const result = await response.json();
        console.log('[SMART COORD] AI selected divisions:', result.criticalDivisions);
        
        return result.criticalDivisions || [];
        
    } catch (error) {
        console.error('[SMART COORD] Error:', error);
        // Fallback: return top 3 divisions
        return divisionRefs.slice(0, 3);
    }
}

// API call: Analyze coordination requirements
async function analyzeCoordination(text, trade, userEmail, filename) {
    console.log('[API CALL] analyzeCoordination received text length:', text.length);
    console.log('[API CALL] First 200 chars:', text.substring(0, 200));
    console.log('[API CALL] Last 200 chars:', text.substring(text.length - 200));
    console.log('[API CALL] Contains Division 03:', text.includes('DIVISION 03'));
    console.log('[API CALL] Contains Division 07:', text.includes('DIVISION 07'));
    
    const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-coordination`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text, trade, userEmail, filename })
        }
    );

    if (!response.ok) {
        throw new Error('Coordination analysis failed');
    }
    
    return await response.json();
}

// Legacy multi-pass function (kept for backwards compatibility)
async function analyzeWithMultiPass(text, trade, userEmail, filename, progressCallback) {
    if (progressCallback) progressCallback('starting', 0);
    
    // Call Supabase Edge Function
    const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-spec`,
        {
            method: 'POST',
            signal: AbortSignal.timeout(180000), // 3 minute timeout
            headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pdfText: text,
                trade: trade,
                userEmail: userEmail,
                filename: filename
            })
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Analysis failed');
    }

    if (progressCallback) progressCallback('complete', 1);
    
    const data = await response.json();
    return data;
}

function displayResults(analysis) {
    // Check if this is new multi-pass format or old format
    if (analysis.contract && analysis.security && analysis.tradeRequirements) {
        displayMultiPassResults(analysis);
    } else {
        // Legacy format
        const html = convertMarkdownToHTML(analysis);
        resultsContent.innerHTML = html;
        showSection('results');
    }
}

function displayMultiPassResults(analysis) {
    let html = '';
    
    // Show warnings first if any
    if (analysis.warnings && analysis.warnings.length > 0) {
        html += '<div class="warnings-section">';
        analysis.warnings.forEach(warning => {
            const icon = warning.type === 'critical' ? '🚨' : '⚠️';
            const className = warning.type === 'critical' ? 'warning-critical' : 'warning';
            html += `<div class="${className}">${icon} ${warning.message}</div>`;
        });
        html += '</div>';
    }
    
    // Structure info section removed - Edge Function returns metadata not structure
    // The following section tried to access analysis.structure which doesn't exist:
    // - analysis.structure.estimatedPages
    // - analysis.structure.divisionsFound
    // - analysis.confidence
    
    // Create tabs for different sections
    html += '<div class="results-tabs">';
    html += '<button class="tab active" onclick="showTab(\'contract\')">📄 Contract</button>';
    html += '<button class="tab" onclick="showTab(\'security\')">🔒 Security</button>';
    html += '<button class="tab" onclick="showTab(\'trade\')">🔨 Trade Requirements</button>';
    html += '<button class="tab" onclick="showTab(\'coordination\')">🤝 Coordination</button>';
    html += '<button class="tab" onclick="showTab(\'changeorders\')">💰 Change Orders</button>';
    html += '</div>';
    
    // Extract text content from response objects before converting to HTML
    const contractText = typeof analysis.contract === 'string' ? analysis.contract : '';
    const securityText = typeof analysis.security === 'string' ? analysis.security : '';
    const tradeText = typeof analysis.tradeRequirements === 'string' ? analysis.tradeRequirements : '';
    const coordText = typeof analysis.coordination === 'string' ? analysis.coordination : '';
    const coText = typeof analysis.changeOrders === 'string' ? analysis.changeOrders : '';
    
    html += '<div id="tab-contract" class="tab-content active">';
    html += convertMarkdownToHTML(contractText);
    html += '</div>';
    
    html += '<div id="tab-security" class="tab-content">';
    html += convertMarkdownToHTML(securityText);
    html += '</div>';
    
    html += '<div id="tab-trade" class="tab-content">';
    html += convertMarkdownToHTML(tradeText);
    html += '</div>';
    
    html += '<div id="tab-coordination" class="tab-content">';
    html += convertMarkdownToHTML(coordText);
    html += '</div>';
    
    html += '<div id="tab-changeorders" class="tab-content">';
    html += '<div style="background: #fff3cd; padding: 10px; margin-bottom: 15px; border-radius: 5px;">⚠️ <strong>Change Order Opportunities</strong> - Use ethically for scope clarification only.</div>';
    html += convertMarkdownToHTML(coText);
    html += '</div>';
    
    resultsContent.innerHTML = html;
    showSection('results');
}

// Tab switching function (called from HTML)
window.showTab = function(tabName) {
    // Hide all tabs
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Show selected tab
    const selectedTab = document.querySelector(`[onclick="showTab('${tabName}')"]`);
    const selectedContent = document.getElementById(`tab-${tabName}`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedContent) selectedContent.classList.add('active');
}

function convertMarkdownToHTML(markdown) {
    // Basic markdown conversion
    let html = markdown;
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    
    // Lists
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // Checkboxes
    html = html.replace(/\[ \]/g, '☐');
    html = html.replace(/\[x\]/gi, '☑');
    
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    return html;
}

function downloadReport() {
    if (!analysisResult) return;

    // Format the analysis as readable markdown
    let markdown = '# PM4Subs Spec Analysis Report\n\n';
    markdown += `**Trade:** ${analysisResult.metadata?.trade || 'Unknown'}\n`;
    markdown += `**Generated:** ${new Date().toLocaleString()}\n\n`;
    markdown += '---\n\n';
    
    markdown += '## Contract & Bidding Requirements\n\n';
    markdown += analysisResult.contract || 'No contract requirements found.\n\n';
    
    markdown += '\n\n---\n\n';
    markdown += '## Security & Access Requirements\n\n';
    markdown += analysisResult.security || 'No security requirements found.\n\n';
    
    markdown += '\n\n---\n\n';
    markdown += '## Trade Requirements\n\n';
    markdown += analysisResult.tradeRequirements || 'No trade requirements found.\n\n';
    
    markdown += '\n\n---\n\n';
    markdown += '## Coordination Requirements\n\n';
    markdown += analysisResult.coordination || 'No coordination requirements found.\n\n';
    
    markdown += '\n\n---\n\n';
    markdown += '## Change Order Opportunities\n\n';
    markdown += analysisResult.changeOrders || 'No change order opportunities identified.\n\n';

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spec-analysis-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function startNewAnalysis() {
    clearFile();
    analysisResult = null;
    showSection('upload');
}

function showSection(section) {
    uploadSection.style.display = 'none';
    loadingSection.style.display = 'none';
    resultsSection.style.display = 'none';
    errorSection.style.display = 'none';

    switch(section) {
        case 'upload':
            uploadSection.style.display = 'block';
            break;
        case 'loading':
            loadingSection.style.display = 'block';
            break;
        case 'results':
            resultsSection.style.display = 'block';
            // Attach export button listeners when results are shown
            attachExportListeners();
            break;
        case 'error':
            errorSection.style.display = 'block';
            break;
    }
}

// Attach export button event listeners
function attachExportListeners() {
    const pdfBtn = document.getElementById('downloadPdfBtn');
    
    if (pdfBtn && !pdfBtn.hasAttribute('data-listener-attached')) {
        pdfBtn.addEventListener('click', downloadPDF);
        pdfBtn.setAttribute('data-listener-attached', 'true');
    }
}

function updateLoadingStatus(message, progress = null) {
    const statusElement = document.getElementById('loadingStatus');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    if (statusElement) {
        statusElement.textContent = message;
    }
    
    if (progress !== null && progressFill) {
        progressFill.style.width = `${progress}%`;
        
        // Calculate estimated time remaining
        if (analysisStartTime) {
            const elapsed = (Date.now() - analysisStartTime) / 1000; // seconds
            const estimatedTotal = 180; // 3 minutes in seconds
            const remaining = Math.max(0, estimatedTotal - elapsed);
            const minutes = Math.floor(remaining / 60);
            const seconds = Math.floor(remaining % 60);
            
            if (remaining > 5) {
                progressText.textContent = `Estimated time remaining: ${minutes}m ${seconds}s`;
            } else {
                progressText.textContent = 'Almost done...';
            }
        }
    }
}

// Prepare text for PDF by replacing emoji with ASCII symbols
function prepareTextForPDF(text) {
    if (!text) return text;
    
    // Replace emoji with ASCII equivalents
    text = text.replace(/🟢/g, '✓');
    text = text.replace(/🟡/g, '!');
    text = text.replace(/🔴/g, '✗');
    text = text.replace(/⚠️/g, '⚠');
    
    // Replace other common emojis
    text = text.replace(/✅/g, '✓');
    text = text.replace(/❌/g, '✗');
    text = text.replace(/📄/g, '');
    text = text.replace(/🔨/g, '');
    text = text.replace(/💰/g, '');
    text = text.replace(/🤝/g, '');
    text = text.replace(/🔒/g, '');
    text = text.replace(/🚨/g, '⚠');
    
    // Handle any garbled versions
    text = text.replace(/Ø=ßâ/g, '✓');
    text = text.replace(/Ø=ßá/g, '!');
    text = text.replace(/Ø=Ý4/g, '✗');
    
    // Clean up remaining emoji unicode characters
    text = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
    text = text.replace(/[\u{2600}-\u{26FF}]/gu, '');
    text = text.replace(/[\u{2700}-\u{27BF}]/gu, '');
    
    return text;
}

// Add color-coded legend to PDF section
function addLegend(doc, yPos, margin) {
    const legendY = yPos;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    
    // Green - Clear
    doc.setTextColor(0, 150, 0);
    doc.text('✓ Clear - Fully specified, ready to price', margin, legendY);
    
    // Orange - Vague
    doc.setTextColor(200, 120, 0);
    doc.text('! Vague - Needs assumptions or verification', margin, legendY + 5);
    
    // Red - Missing
    doc.setTextColor(200, 0, 0);
    doc.text('✗ Missing - RFI required before bidding', margin, legendY + 10);
    
    // Red - Warning
    doc.setTextColor(200, 0, 0);
    doc.text('⚠ Warning - High risk or expensive item', margin, legendY + 15);
    
    // Reset to black
    doc.setTextColor(0, 0, 0);
    
    return legendY + 23; // Return new Y position after legend
}

// Add colored text line to PDF based on risk indicators
function addColoredTextLine(doc, line, x, y, maxWidth) {
    const trimmedLine = line.trim();
    
    // Determine color based on risk indicator
    if (trimmedLine.startsWith('✓') || trimmedLine.includes('[✓]')) {
        doc.setTextColor(0, 150, 0); // Green
    } else if (trimmedLine.startsWith('!') || trimmedLine.includes('[!]')) {
        doc.setTextColor(200, 120, 0); // Orange
    } else if (trimmedLine.startsWith('✗') || trimmedLine.startsWith('⚠') || 
               trimmedLine.includes('[✗]') || trimmedLine.includes('[⚠]')) {
        doc.setTextColor(200, 0, 0); // Red
    } else if (trimmedLine.startsWith('##')) {
        // Section headers should be bold
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
    } else if (trimmedLine.startsWith('#')) {
        // Main headers
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
    } else {
        doc.setTextColor(0, 0, 0); // Black
    }
    
    // Check for indentation
    let actualX = x;
    if (line.startsWith('  -') || line.startsWith('   •') || line.startsWith('    -')) {
        actualX = x + 5; // Indent sub-items
    }
    
    // Split text to fit width
    const lines = doc.splitTextToSize(line, maxWidth);
    
    // Add the text
    lines.forEach((textLine, index) => {
        doc.text(textLine, actualX, y + (index * 5));
    });
    
    // Reset to defaults
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    
    // Return height used
    return lines.length * 5 + 2;
}

// Enhanced PDF Export with RFI Questions
async function downloadPDF() {
    if (!analysisResult) return;
    
    try {
        updateLoadingStatus('Generating professional PDF report...', 50);
        showSection('loading');
        
        // Prepare analysis data for PDF generator
        const analysisData = {
            projectName: currentFile.name.replace('.pdf', ''),
            companyName: 'Company Name', // You can add a company input field or get from user profile
            trade: selectedTrade,
            filename: currentFile.name,
            analyzedDate: new Date().toISOString(),
            contractAnalysis: {
                division00: analysisResult.contract,
                division01: analysisResult.security
            },
            tradeAnalysis: {
                requirements: analysisResult.tradeRequirements
            },
            coordinationAnalysis: {
                coordination: analysisResult.coordination
            },
            userEmail: userEmailInput.value || 'user@example.com'
        };
        
        console.log('[PDF] Starting enhanced PDF generation...');
        
        // Use the new PDF generator
        await generateAndDownloadPDF(analysisData);
        
        console.log('[PDF] Generation complete!');
        showSection('results');
        
    } catch (error) {
        console.error('[PDF] Export error:', error);
        showError('Failed to generate PDF: ' + error.message);
    }
}

// Expose function to window
window.downloadPDF = downloadPDF;

function showError(message) {
    errorMessage.textContent = message;
    showSection('error');
}
