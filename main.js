// Main application logic for Spec Analyzer
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker - use local file for reliability with large PDFs
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

let currentFile = null;
let analysisResult = null;
let selectedTrade = null;

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
    updateLoadingStatus('Extracting table of contents...');

    try {
        // Step 1: Extract TOC only
        const { tocText, totalPages, pdfData } = await extractPDFText(currentFile);
        
        updateLoadingStatus('Identifying relevant sections with AI...');
        
        // Step 2: Send TOC to Edge Function to identify relevant pages
        const pageRanges = await identifyRelevantSections(tocText, totalPages, selectedTrade);
        
        updateLoadingStatus(`Extracting ${pageRanges.length} relevant sections...`);
        
        // Step 3: Extract only the relevant pages
        const relevantText = await extractSpecificPages(pdfData, pageRanges);
        
        updateLoadingStatus('Analyzing specifications...');
        
        // Step 4: Analyze the relevant sections
        const analysis = await analyzeWithMultiPass(relevantText, selectedTrade, userEmail, currentFile.name);
        
        analysisResult = analysis;
        displayResults(analysis);
    } catch (error) {
        console.error('Analysis error:', error);
        showError(error.message || 'Failed to analyze document. Please try again.');
    }
}

async function extractPDFText(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        // Create a copy to prevent ArrayBuffer detachment
        const arrayBufferCopy = arrayBuffer.slice(0);
        
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        // Extract first 30 pages for TOC analysis
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
            // Store cloned arrayBuffer for later extraction (prevents detachment)
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

async function identifyRelevantSections(tocText, totalPages, trade) {
    // Call Edge Function to identify relevant page ranges
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
                trade
            })
        }
    );

    if (!response.ok) {
        // Fallback: if new endpoint doesn't exist yet, return default ranges
        console.warn('Section identification endpoint not available, using fallback');
        return ['1-50']; // Extract first 50 pages as fallback
    }

    const data = await response.json();
    return data.pageRanges; // Array like ["45-67", "234-256"]
}


async function analyzeWithMultiPass(text, trade, userEmail, filename) {
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
            break;
        case 'error':
            errorSection.style.display = 'block';
            break;
    }
}

function updateLoadingStatus(status) {
    loadingStatus.textContent = status;
}

function showError(message) {
    errorMessage.textContent = message;
    showSection('error');
}
