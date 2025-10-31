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

    // Validate email
    const userEmail = userEmailInput.value.trim();
    if (!userEmail || !userEmail.includes('@')) {
        showError('Please enter a valid email address');
        return;
    }

    // Show loading
    showSection('loading');
    updateLoadingStatus('Extracting text from PDF...');

    try {
        // Extract text from PDF
        const text = await extractPDFText(currentFile);
        
        updateLoadingStatus('Analyzing spec structure...');
        
        // Use new multi-pass analysis endpoint with Supabase Edge Function
        const analysis = await analyzeWithMultiPass(text, selectedTrade, userEmail, currentFile.name);
        
        analysisResult = analysis;
        displayResults(analysis);
    } catch (error) {
        console.error('Analysis error:', error);
        showError(error.message || 'Failed to analyze document. Please try again.');
    }
}

async function extractPDFText(file) {
    // Extract PDF text client-side using PDF.js
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = '';
        
        // Extract text from each page
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }
        
        console.log(`PDF extracted: ${pdf.numPages} pages`);
        return fullText;
    } catch (error) {
        console.error('PDF extraction error:', error);
        throw new Error('Failed to extract text from PDF. Please ensure it\'s a valid PDF file.');
    }
}


async function analyzeWithMultiPass(text, trade, userEmail, filename) {
    // Call Supabase Edge Function
    const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-spec`,
        {
            method: 'POST',
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
    if (analysis.security && analysis.contract && analysis.tradeRequirements) {
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
    
    // Show structure info
    html += `
        <div class="structure-info">
            <h3>📋 Spec Structure Detected</h3>
            <p><strong>Total Pages:</strong> ${analysis.structure.estimatedPages}</p>
            <p><strong>Divisions Found:</strong> ${analysis.structure.divisionsFound.length}</p>
            <p><strong>Confidence:</strong> ${analysis.confidence === 'high' ? '✅ High' : '⚠️ Low'}</p>
            <details>
                <summary>View Division Map</summary>
                <ul>
                    ${analysis.structure.divisionsFound.map(d => 
                        `<li>Division ${d.number}: ${d.title} (${d.estimatedPages} pages)</li>`
                    ).join('')}
                </ul>
            </details>
        </div>
    `;
    
    // Create tabs for different sections
    html += `
        <div class="results-tabs">
            <button class="tab active" onclick="showTab('security')">🔒 Security & Access</button>
            <button class="tab" onclick="showTab('contract')">📄 Contract Terms</button>
            <button class="tab" onclick="showTab('trade')">🔨 ${analysis.metadata.trade.charAt(0).toUpperCase() + analysis.metadata.trade.slice(1)} (Div ${analysis.metadata.division})</button>
        </div>
        
        <div id="tab-security" class="tab-content active">
            ${convertMarkdownToHTML(analysis.security)}
        </div>
        
        <div id="tab-contract" class="tab-content">
            ${convertMarkdownToHTML(analysis.contract)}
        </div>
        
        <div id="tab-trade" class="tab-content">
            ${convertMarkdownToHTML(analysis.tradeRequirements)}
        </div>
    `;
    
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

    const blob = new Blob([analysisResult], { type: 'text/markdown' });
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
