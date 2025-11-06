import { supabase } from './lib/supabase.js';
import { generateAndDownloadPDF } from './pdf-generator.js';

const urlParams = new URLSearchParams(window.location.search);
const analysisId = urlParams.get('id');

let currentAnalysis = null;
let currentUser = null;

// Initialize
(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;
    
    document.getElementById('navUserEmail').textContent = user.email;
    
    await loadAnalysis();
})();

// Logout
document.getElementById('navLogoutBtn')?.addEventListener('click', async () => {
    if (confirm('Sign out?')) {
        await supabase.auth.signOut();
        window.location.href = '/login.html';
    }
});

window.goBack = function() {
    if (currentAnalysis?.job_id) {
        window.location.href = `/job-analyses.html?job_id=${currentAnalysis.job_id}`;
    } else {
        window.location.href = '/dashboard.html';
    }
}

document.getElementById('newAnalysisBtn')?.addEventListener('click', () => {
    if (currentAnalysis?.job_id) {
        window.location.href = `/upload.html?job_id=${currentAnalysis.job_id}`;
    }
});

document.getElementById('downloadMarkdownBtn')?.addEventListener('click', downloadMarkdown);
document.getElementById('downloadPdfBtn')?.addEventListener('click', downloadPDF);

async function loadAnalysis() {
    try {
        const { data, error } = await supabase
            .from('spec_analyses')
            .select('*')
            .eq('id', analysisId)
            .single();
        
        if (error) throw error;
        
        currentAnalysis = data;
        displayResults(data.results);
        
    } catch (error) {
        console.error('Error loading analysis:', error);
        alert('Failed to load analysis');
    }
}

function displayResults(results) {
    let html = '';
    
    html += '<div class="results-tabs">';
    html += '<button class="tab active" onclick="showTab(\'contract\')">📄 Contract Terms</button>';
    html += '<button class="tab" onclick="showTab(\'trade\')">🔨 Trade Requirements</button>';
    html += '<button class="tab" onclick="showTab(\'coordination\')">🤝 Coordination</button>';
    html += '</div>';
    
    const contractText = formatContractForDisplay(results.contract);
    const tradeText = formatMaterialsForDisplay(results.materials);
    const coordHTML = formatCoordinationForDisplay(results.coordination);
    
    html += '<div id="tab-contract" class="tab-content active">';
    html += convertMarkdownToHTML(contractText);
    html += '</div>';
    
    html += '<div id="tab-trade" class="tab-content">';
    html += convertMarkdownToHTML(tradeText);
    html += '</div>';
    
    html += '<div id="tab-coordination" class="tab-content">';
    html += coordHTML;
    html += '</div>';
    
    document.getElementById('resultsContent').innerHTML = html;
}

// Formatting functions (copied from main.js)
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

window.showTab = function(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[onclick="showTab('${tabName}')"]`)?.classList.add('active');
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
}

function downloadMarkdown() {
    if (!currentAnalysis) return;

    const results = currentAnalysis.results;
    let markdown = '# PM4Subs Spec Analysis Report\n\n';
    markdown += `**File:** ${currentAnalysis.file_name}\n`;
    markdown += `**Trade:** ${currentAnalysis.analysis_type}\n`;
    markdown += `**Generated:** ${new Date(currentAnalysis.created_at).toLocaleString()}\n\n`;
    markdown += '---\n\n';
    
    markdown += '## Contract & Payment Terms\n\n';
    const contractText = formatContractForDisplay(results.contract);
    markdown += contractText.replace(/[#💰📊🏛️🛡️⚠️🔒👷🏢📝✅]/g, '');
    
    markdown += '\n\n---\n\n';
    markdown += '## Trade Requirements\n\n';
    markdown += formatMaterialsForDisplay(results.materials);
    
    markdown += '\n\n---\n\n';
    markdown += '## Coordination Requirements\n\n';
    if (Array.isArray(results.coordination)) {
        results.coordination.forEach(item => {
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
    if (!currentAnalysis) return;
    
    try {
        const results = currentAnalysis.results;
        
        const analysisData = {
            projectName: currentAnalysis.file_name.replace('.pdf', ''),
            companyName: 'Company Name',
            trade: currentAnalysis.analysis_type,
            filename: currentAnalysis.file_name,
            analyzedDate: currentAnalysis.created_at,
            contractAnalysis: {
                division00: results.contract,
                division01: results.division01
            },
            tradeAnalysis: {
                requirements: formatMaterialsForDisplay(results.materials)
            },
            coordinationAnalysis: {
                coordination: results.coordination
            },
            userEmail: currentUser.email
        };
        
        console.log('[PDF] Starting PDF generation...');
        await generateAndDownloadPDF(analysisData);
        console.log('[PDF] Generation complete!');
        
    } catch (error) {
        console.error('[PDF] Export error:', error);
        alert('Failed to generate PDF: ' + error.message);
    }
}
