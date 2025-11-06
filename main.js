// Main application logic for Spec Analyzer - CLEAN VERSION
import * as pdfjsLib from 'pdfjs-dist';
import { generateAndDownloadPDF } from './pdf-generator.js';
import { supabase } from './lib/supabase.js';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Get URL parameters for job context
const urlParams = new URLSearchParams(window.location.search);
const jobId = urlParams.get('job_id');
const analysisType = urlParams.get('analysis_type');

// Get current user
let currentUser = null;
(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    currentUser = user;
    console.log('Upload context:', { jobId, analysisType, user: user?.email });
    
    // Auto-fill email if user is logged in
    if (user && userEmailInput) {
        userEmailInput.value = user.email;
        userEmailInput.readOnly = true;
        userEmailInput.style.background = '#f3f4f6';
    }
    
    // Show user email in navigation
    const navEmailEl = document.getElementById('navUserEmail');
    if (navEmailEl && user) {
        navEmailEl.textContent = user.email;
    }
})();

// Navigation logout button handler
const navLogoutBtn = document.getElementById('navLogoutBtn');
if (navLogoutBtn) {
    navLogoutBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to sign out?')) {
            const { error } = await supabase.auth.signOut();
            if (!error) {
                window.location.href = '/login.html';
            }
        }
    });
}

let currentFile = null;
let analysisResult = null;
let selectedTrade = null;
let analysisStartTime = null;

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
        tradeDescription.textContent = tradeInfo[trade].description;
        tradeDescription.style.display = 'block';
        
        uploadSection.style.opacity = '1';
        uploadSection.style.pointerEvents = 'auto';
    } else {
        tradeDescription.textContent = '';
        tradeDescription.style.display = 'none';
        
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

// ============================================================================
// MAIN ANALYSIS FUNCTION - The core of the app
// ============================================================================
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
    updateLoadingStatus('Extracting PDF text...', 10);

    try {
        // STEP 1: Extract full PDF text
        console.log('[UNIFIED] Starting complete PDF extraction...');
        const arrayBuffer = await currentFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        
        console.log(`[UNIFIED] Extracting all ${totalPages} pages...`);
        let pdfText = '';
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            pdfText += `\n\f--- PAGE ${pageNum} ---\n${pageText}\n`;
            
            if (pageNum % 10 === 0) {
                const progress = 10 + (pageNum / totalPages) * 30;
                updateLoadingStatus(`Extracting PDF text... (page ${pageNum}/${totalPages})`, progress);
            }
        }
        
        console.log(`[UNIFIED] Extracted ${pdfText.length} characters from ${totalPages} pages`);
        
        // STEP 2: Extract coordination sections - PRIORITIZED
        updateLoadingStatus('Finding coordination requirements...', 45);
        
        console.log('[COORD] Scanning for critical coordination sections...');
        
        // PRIORITY ORDER: Most critical divisions for each trade
        const priorityDivisions = {
            'masonry': ['03', '05', '07', '08'],      // Concrete, Steel, Waterproofing, Openings
            'concrete': ['04', '05', '07'],           // Masonry, Steel, Waterproofing
            'waterproofing': ['03', '04', '07'],      // Concrete, Masonry, Related waterproofing
            'steel': ['03', '04', '07'],              // Concrete, Masonry, Fireproofing
            'roofing': ['06', '07', '08'],            // Framing, Waterproofing, Penetrations
            'default': ['03', '05', '06', '07', '08'] // Generic priorities
        };
        
        const criticalDivs = priorityDivisions[selectedTrade] || priorityDivisions['default'];
        
        // Find all section references
        const sectionRefs = new Set();
        const patterns = [
            /Section\s+(\d{6})/gi,
            /Section\s+(\d{2}\s\d{2}\s\d{2})/gi,
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(pdfText)) !== null) {
                const sectionNum = match[1].replace(/\s/g, '');
                const divNum = sectionNum.substring(0, 2);
                
                // Only extract if it's a critical division for this trade
                if (criticalDivs.includes(divNum)) {
                    sectionRefs.add(sectionNum);
                }
            }
        }
        
        console.log(`[COORD] Found ${sectionRefs.size} critical coordination sections:`, 
                    Array.from(sectionRefs).slice(0, 10).join(', '));
        
        // Extract text for priority sections only (limit to 20 max to avoid overwhelming Gemini)
        let coordinationText = '';
        let extractedCount = 0;
        const maxSections = 20;
        
        for (const sectionNum of sectionRefs) {
            if (extractedCount >= maxSections) {
                console.log(`[COORD] Limiting to ${maxSections} sections to avoid overload`);
                break;
            }
            
            const sectionPattern = new RegExp(
                `(--- PAGE \\d+ ---[\\s\\S]{0,2000}?SECTION\\s+${sectionNum}[\\s\\S]{0,25000}?)(?=--- PAGE \\d+ ---[\\s\\S]{0,1000}?SECTION|$)`,
                'i'
            );
            
            const match = sectionPattern.exec(pdfText);
            
            if (match) {
                console.log(`[COORD] ✓ Section ${sectionNum}: ${match[1].length} chars`);
                coordinationText += `\n\n=== SECTION ${sectionNum} ===\n${match[1]}\n`;
                extractedCount++;
            }
        }
        
        console.log(`[COORD] Total coordination text: ${coordinationText.length} chars from ${extractedCount} sections`);
        
        // STEP 3: Call unified Edge Function
        updateLoadingStatus('Analyzing specification with AI...', 60);
        console.log('[UNIFIED] Calling analyze-spec-unified Edge Function...');
        
        const requestBody = {
            pdfText,
            trade: selectedTrade,
            totalPages,
            projectName: currentFile.name
        };
        
        // Add coordination text if we extracted any
        if (coordinationText && coordinationText.length > 100) {
            requestBody.coordinationText = coordinationText;
            console.log('[UNIFIED] Including coordination text:', coordinationText.length, 'chars');
        }
        
        const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-spec-unified`,
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
            const errorData = await response.json();
            console.error('[UNIFIED] Error response:', errorData);
            throw new Error(errorData.error || 'Analysis failed');
        }

        updateLoadingStatus('Processing results...', 90);
        const result = await response.json();
        console.log('[UNIFIED] Analysis complete:', result.metadata);
        
        // STEP 4: Save analysis to database
        if (jobId && currentUser) {
            try {
                updateLoadingStatus('Saving analysis...', 95);
                const { data: savedAnalysis, error } = await supabase
                    .from('spec_analyses')
                    .insert({
                        user_id: currentUser.id,
                        job_id: jobId,
                        file_name: currentFile.name,
                        analysis_type: selectedTrade,
                        status: 'completed',
                        results: {
                            contract: result.contract,
                            division01: result.division01,
                            materials: result.materials,
                            coordination: result.coordination,
                            metadata: result.metadata
                        }
                    })
                    .select()
                    .single();
                
                if (error) {
                    console.error('Failed to save analysis:', error);
                } else {
                    console.log('Analysis saved:', savedAnalysis.id);
                    window.currentAnalysisId = savedAnalysis.id;
                }
            } catch (err) {
                console.error('Error saving analysis:', err);
            }
        }
        
        // STEP 5: Format and display results
        updateLoadingStatus('Complete!', 100);
        
        analysisResult = {
            contract: result.contract || {},
            division01: result.division01 || {},
            tradeRequirements: formatMaterialsForDisplay(result.materials),
            coordination: result.coordination,
            submittals: extractSubmittalsFromMaterials(result.materials),
            metadata: {
                ...result.metadata,
                trade: selectedTrade,
                processingTime: result.metadata.processingTime
            }
        };
        
        displayResults(analysisResult);
        
    } catch (error) {
        console.error('[UNIFIED] Analysis error:', error);
        showError(error.message || 'Failed to analyze document. Please try again.');
    }
}

// ============================================================================
// DISPLAY & FORMATTING FUNCTIONS
// ============================================================================

function formatMaterialsForDisplay(materials) {
    if (!materials || materials.length === 0) {
        return 'No materials found in specification.';
    }
    
    let text = '# Material Requirements\n\n';
    
    for (const material of materials) {
        text += `## ${material.itemName} ${material.riskLevel}\n\n`;
        text += `**Specifications:** ${material.specifications}\n\n`;
        
        if (material.reasoning) {
            text += `**Risk Assessment:** ${material.reasoning}\n\n`;
        }
        
        if (material.submittalRequired) {
            text += `**Submittal Required:** Yes\n\n`;
        }
        
        if (material.notes) {
            text += `**Notes:** ${material.notes}\n\n`;
        }
        
        text += '---\n\n';
    }
    
    return text;
}

function formatCoordinationForDisplay(coordination) {
    console.log('[DISPLAY] Coordination data:', coordination);
    
    if (!coordination || coordination.length === 0) {
        return '<p>No coordination requirements identified.</p>';
    }
    
    let html = '<h1>Coordination Requirements</h1>';
    
    for (const item of coordination) {
        if (typeof item === 'string') {
            html += `<p>${item}</p>`;
        } else if (item && typeof item === 'object') {
            const section = item.section || item.sectionNumber || '';
            const title = item.title || item.name || '';
            const requirement = item.requirement || item.description || item.details || '';
            
            if (section && requirement) {
                html += `<h2>Section ${section}${title ? ' - ' + title : ''}</h2>`;
                html += `<p>${requirement}</p>`;
                html += '<hr>';
            } else if (section) {
                html += `<p>Section ${section}${title ? ' - ' + title : ''}</p>`;
            }
        }
    }
    
    return html;
}

function formatContractForDisplay(contractObj) {
    if (!contractObj || typeof contractObj !== 'object') {
        return 'No contract information available.';
    }
    
    let text = '# Contract & Payment Terms\n\n';
    
    if (contractObj.payment) {
        text += '## 💰 Payment Terms\n\n';
        text += `${contractObj.payment}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.retainage) {
        text += '## 📊 Retainage\n\n';
        text += `${contractObj.retainage}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.bonding) {
        text += '## 🏛️ Bonding Requirements\n\n';
        text += `${contractObj.bonding}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.insurance) {
        text += '## 🛡️ Insurance Requirements\n\n';
        text += `${contractObj.insurance}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.damages) {
        text += '## ⚠️ Liquidated Damages\n\n';
        text += `${contractObj.damages}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.security) {
        text += '## 🔒 Security & Access Requirements\n\n';
        text += `${contractObj.security}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.labor) {
        text += '## 👷 Labor Requirements\n\n';
        text += `${contractObj.labor}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.business) {
        text += '## 🏢 Business Requirements\n\n';
        text += `${contractObj.business}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.changeOrders) {
        text += '## 📝 Change Order Process\n\n';
        text += `${contractObj.changeOrders}\n\n`;
        text += '---\n\n';
    }
    
    if (contractObj.closeout) {
        text += '## ✅ Project Closeout\n\n';
        text += `${contractObj.closeout}\n\n`;
    }
    
    return text;
}

function extractSubmittalsFromMaterials(materials) {
    if (!materials) return [];
    
    return materials
        .filter(m => m.submittalRequired)
        .map(m => ({
            item: m.itemName,
            type: 'Product Data',
            notes: m.specifications.substring(0, 100) + '...'
        }));
}

function displayResults(analysis) {
    let html = '';
    
    // SIMPLIFIED TABS - 3 tabs only
    html += '<div class="results-tabs">';
    html += '<button class="tab active" onclick="showTab(\'contract\')">📄 Contract Terms</button>';
    html += '<button class="tab" onclick="showTab(\'trade\')">🔨 Trade Requirements</button>';
    html += '<button class="tab" onclick="showTab(\'coordination\')">🤝 Coordination</button>';
    html += '</div>';
    
    // Format content
    const contractText = formatContractForDisplay(analysis.contract);
    const tradeText = typeof analysis.tradeRequirements === 'string' ? analysis.tradeRequirements : '';
    const coordHTML = formatCoordinationForDisplay(analysis.coordination);
    
    html += '<div id="tab-contract" class="tab-content active">';
    html += convertMarkdownToHTML(contractText);
    html += '</div>';
    
    html += '<div id="tab-trade" class="tab-content">';
    html += convertMarkdownToHTML(tradeText);
    html += '</div>';
    
    html += '<div id="tab-coordination" class="tab-content" style="white-space: normal !important; word-break: normal !important;">';
    html += coordHTML;  // Already HTML, don't convert!
    html += '</div>';
    
    resultsContent.innerHTML = html;
    showSection('results');
}

// Tab switching function (called from HTML)
window.showTab = function(tabName) {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    const selectedTab = document.querySelector(`[onclick="showTab('${tabName}')"]`);
    const selectedContent = document.getElementById(`tab-${tabName}`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedContent) selectedContent.classList.add('active');
}

function convertMarkdownToHTML(markdown) {
    if (!markdown) return '';
    
    let html = markdown;
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    
    // Line breaks and paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    
    // Wrap in paragraph
    html = '<p>' + html + '</p>';
    
    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>\s*<\/p>/g, '');
    
    return html;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function downloadReport() {
    if (!analysisResult) return;

    let markdown = '# PM4Subs Spec Analysis Report\n\n';
    markdown += `**Trade:** ${analysisResult.metadata?.trade || 'Unknown'}\n`;
    markdown += `**Generated:** ${new Date().toLocaleString()}\n\n`;
    markdown += '---\n\n';
    
    markdown += '## Contract & Payment Terms\n\n';
    const contractText = formatContractForDisplay(analysisResult.contract);
    markdown += contractText.replace(/[#💰📊🏛️🛡️⚠️📝]/g, '');
    
    markdown += '\n\n---\n\n';
    markdown += '## Trade Requirements\n\n';
    markdown += analysisResult.tradeRequirements || 'No trade requirements found.\n\n';
    
    markdown += '\n\n---\n\n';
    markdown += '## Coordination Requirements\n\n';
    // Convert HTML back to text for markdown
    const coordText = analysisResult.coordination || [];
    if (Array.isArray(coordText)) {
        coordText.forEach(item => {
            if (typeof item === 'object') {
                markdown += `- Section ${item.section || ''}: ${item.requirement || ''}\n`;
            } else {
                markdown += `- ${item}\n`;
            }
        });
    }

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

async function downloadPDF() {
    if (!analysisResult) return;
    
    try {
        updateLoadingStatus('Generating professional PDF report...', 50);
        showSection('loading');
        
        const analysisData = {
            projectName: currentFile.name.replace('.pdf', ''),
            companyName: 'Company Name',
            trade: selectedTrade,
            filename: currentFile.name,
            analyzedDate: new Date().toISOString(),
            contractAnalysis: {
                division00: analysisResult.contract,
                division01: analysisResult.division01
            },
            tradeAnalysis: {
                requirements: analysisResult.tradeRequirements
            },
            coordinationAnalysis: {
                coordination: analysisResult.coordination
            },
            userEmail: userEmailInput.value || 'user@example.com'
        };
        
        console.log('[PDF] Starting PDF generation...');
        await generateAndDownloadPDF(analysisData);
        console.log('[PDF] Generation complete!');
        
        showSection('results');
        
    } catch (error) {
        console.error('[PDF] Export error:', error);
        showError('Failed to generate PDF: ' + error.message);
    }
}

window.downloadPDF = downloadPDF;

// ============================================================================
// UI HELPER FUNCTIONS
// ============================================================================

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
            break;
        case 'error':
            errorSection.style.display = 'block';
            break;
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
        
        if (analysisStartTime) {
            const elapsed = (Date.now() - analysisStartTime) / 1000;
            const estimatedTotal = 180;
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

function showError(message) {
    errorMessage.textContent = message;
    showSection('error');
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
