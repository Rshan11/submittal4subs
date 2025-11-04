/**
 * Frontend PDF Generation using jsPDF + html2canvas
 * Professional PDF reports with cover page, RFI questions, and color-coded analysis
 * 
 * Dependencies:
 * - jsPDF: https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
 * - html2canvas: https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
 */

export async function generateAndDownloadPDF(analysisData) {
  const {
    projectName,
    companyName,
    trade,
    filename,
    analyzedDate,
    contractAnalysis,
    tradeAnalysis,
    coordinationAnalysis,
    userEmail
  } = analysisData;

  console.log('[PDF] Starting generation...');

  // Create hidden container for rendering
  const container = document.createElement('div');
  container.id = 'pdf-render-container';
  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: 8.5in;
    background: white;
    padding: 0.5in;
    font-family: 'Segoe UI', sans-serif;
  `;
  
  // Generate HTML content
  container.innerHTML = generatePDFHTML(analysisData);
  document.body.appendChild(container);

  try {
    // Initialize jsPDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'in', 'letter');
    
    // Get all pages
    const pages = container.querySelectorAll('.pdf-page');
    
    for (let i = 0; i < pages.length; i++) {
      console.log(`[PDF] Rendering page ${i + 1} of ${pages.length}...`);
      
      if (i > 0) {
        pdf.addPage();
      }
      
      // Render page to canvas
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      // Add to PDF
      const imgData = canvas.toDataURL('image/png');
      const imgWidth = 8.5;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    }
    
    // Generate filename
    const safeProjectName = (projectName || 'Project').replace(/[^a-z0-9]/gi, '_');
    const pdfFilename = `${safeProjectName}_${trade}_Analysis_${new Date().toISOString().split('T')[0]}.pdf`;
    
    // Save PDF
    pdf.save(pdfFilename);
    
    console.log('[PDF] Generated successfully:', pdfFilename);
    
    // Clean up
    document.body.removeChild(container);
    
    return {
      success: true,
      filename: pdfFilename
    };
    
  } catch (error) {
    console.error('[PDF ERROR]', error);
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
    throw error;
  }
}

function generatePDFHTML(analysisData) {
  const {
    projectName,
    companyName,
    trade,
    filename,
    analyzedDate,
    contractAnalysis,
    tradeAnalysis,
    coordinationAnalysis,
    userEmail
  } = analysisData;

  const rfiQuestions = extractRFIQuestions(contractAnalysis, tradeAnalysis, coordinationAnalysis);

  return `
    <style>
      .pdf-page {
        width: 8.5in;
        min-height: 11in;
        background: white;
        padding: 0.5in;
        box-sizing: border-box;
        page-break-after: always;
        font-family: 'Segoe UI', Tahoma, sans-serif;
        font-size: 11pt;
        line-height: 1.6;
        color: #333;
      }
      
      .pdf-header {
        display: flex;
        justify-content: space-between;
        border-bottom: 3px solid #2563eb;
        padding-bottom: 10px;
        margin-bottom: 20px;
      }
      
      .pdf-logo {
        font-size: 20pt;
        font-weight: bold;
        color: #2563eb;
      }
      
      .pdf-header-right {
        text-align: right;
        font-size: 9pt;
        color: #666;
      }
      
      .pdf-cover {
        text-align: center;
        padding-top: 1.5in;
      }
      
      .pdf-cover h1 {
        font-size: 28pt;
        color: #1e40af;
        margin-bottom: 0.5in;
      }
      
      .pdf-risk-summary {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 15px;
        margin: 30px 0;
      }
      
      .pdf-risk-box {
        padding: 20px;
        border-radius: 8px;
        text-align: center;
      }
      
      .pdf-risk-box.high {
        background: #fee2e2;
        border: 2px solid #dc2626;
      }
      
      .pdf-risk-box.medium {
        background: #fef3c7;
        border: 2px solid #f59e0b;
      }
      
      .pdf-risk-box.low {
        background: #d1fae5;
        border: 2px solid #10b981;
      }
      
      .pdf-risk-count {
        font-size: 32pt;
        font-weight: bold;
        margin: 10px 0;
      }
      
      .pdf-risk-box.high .pdf-risk-count { color: #dc2626; }
      .pdf-risk-box.medium .pdf-risk-count { color: #f59e0b; }
      .pdf-risk-box.low .pdf-risk-count { color: #10b981; }
      
      .pdf-h2 {
        font-size: 18pt;
        color: #1e40af;
        margin: 20px 0 15px 0;
        padding-bottom: 8px;
        border-bottom: 2px solid #2563eb;
      }
      
      .pdf-h3 {
        font-size: 14pt;
        color: #1e40af;
        margin: 15px 0 10px 0;
      }
      
      .pdf-rfi-box {
        background: #f0f9ff;
        border-left: 4px solid #2563eb;
        padding: 15px;
        margin: 15px 0;
      }
      
      .pdf-rfi-question {
        margin: 10px 0;
        padding: 10px;
        border-left: 3px solid #ccc;
      }
      
      .pdf-content {
        white-space: pre-wrap;
        word-wrap: break-word;
        font-size: 10pt;
      }
      
      .risk-high { color: #dc2626; font-weight: bold; }
      .risk-medium { color: #f59e0b; font-weight: bold; }
      .risk-low { color: #10b981; }
    </style>

    <!-- COVER PAGE -->
    <div class="pdf-page">
      <div class="pdf-cover">
        <div class="pdf-logo">PM4Subs</div>
        <h1>Specification Analysis Report</h1>
        
        <div style="font-size: 14pt; margin: 20px 0; color: #666;">
          <div style="margin: 15px 0;"><strong>Project:</strong> ${projectName || 'Unnamed Project'}</div>
          <div style="margin: 15px 0;"><strong>Company:</strong> ${companyName || 'N/A'}</div>
          <div style="margin: 15px 0;"><strong>Trade:</strong> ${trade.toUpperCase()}</div>
        </div>
        
        <div class="pdf-risk-summary">
          <div class="pdf-risk-box high">
            <div>🔴 High Risk</div>
            <div class="pdf-risk-count">${rfiQuestions.filter(q => q.priority === 'high').length}</div>
            <div>Critical items</div>
          </div>
          <div class="pdf-risk-box medium">
            <div>🟡 Medium Risk</div>
            <div class="pdf-risk-count">${rfiQuestions.filter(q => q.priority === 'medium').length}</div>
            <div>To clarify</div>
          </div>
          <div class="pdf-risk-box low">
            <div>🟢 Clear</div>
            <div class="pdf-risk-count">${Math.max(0, 20 - rfiQuestions.length)}</div>
            <div>Well-specified</div>
          </div>
        </div>
        
        <div style="margin-top: 1in; font-size: 10pt; color: #999;">
          <div>Analyzed: ${new Date(analyzedDate).toLocaleDateString()}</div>
          <div>Specification: ${filename}</div>
          <div>Generated by PM4Subs</div>
        </div>
      </div>
    </div>

    <!-- RFI QUESTIONS PAGE -->
    <div class="pdf-page">
      <div class="pdf-header">
        <div class="pdf-logo">PM4Subs</div>
        <div class="pdf-header-right">
          <div>${projectName}</div>
          <div>RFI Questions</div>
        </div>
      </div>
      
      <div class="pdf-h2">🔍 RFI Questions & Clarifications</div>
      
      <div class="pdf-rfi-box">
        <strong>Auto-generated questions from spec analysis.</strong> Review before submitting.
      </div>
      
      ${generateRFIHTML(rfiQuestions)}
    </div>

    <!-- CONTRACT PAGE -->
    <div class="pdf-page">
      <div class="pdf-header">
        <div class="pdf-logo">PM4Subs</div>
        <div class="pdf-header-right">
          <div>${projectName}</div>
          <div>Contract Terms</div>
        </div>
      </div>
      
      <div class="pdf-h2">📋 Contract & Payment (Division 00)</div>
      <div class="pdf-content">${formatContent(contractAnalysis?.division00 || contractAnalysis?.contract)}</div>
    </div>

    <!-- REQUIREMENTS PAGE -->
    <div class="pdf-page">
      <div class="pdf-header">
        <div class="pdf-logo">PM4Subs</div>
        <div class="pdf-header-right">
          <div>${projectName}</div>
          <div>General Requirements</div>
        </div>
      </div>
      
      <div class="pdf-h2">📝 General Requirements (Division 01)</div>
      <div class="pdf-content">${formatContent(contractAnalysis?.division01)}</div>
    </div>

    <!-- TRADE PAGE -->
    <div class="pdf-page">
      <div class="pdf-header">
        <div class="pdf-logo">PM4Subs</div>
        <div class="pdf-header-right">
          <div>${projectName}</div>
          <div>${trade.toUpperCase()} Requirements</div>
        </div>
      </div>
      
      <div class="pdf-h2">🔨 ${trade.toUpperCase()} Requirements</div>
      <div class="pdf-content">${formatContent(tradeAnalysis?.requirements)}</div>
    </div>

    <!-- COORDINATION PAGE -->
    <div class="pdf-page">
      <div class="pdf-header">
        <div class="pdf-logo">PM4Subs</div>
        <div class="pdf-header-right">
          <div>${projectName}</div>
          <div>Coordination</div>
        </div>
      </div>
      
      <div class="pdf-h2">🔗 Coordination Requirements</div>
      <div class="pdf-content">${formatContent(coordinationAnalysis?.coordination)}</div>
      
      <div style="margin-top: 2in; padding-top: 20px; border-top: 1px solid #ccc; text-align: center; font-size: 9pt; color: #999;">
        <p>Generated by PM4Subs • ${new Date().toLocaleDateString()}</p>
        <p>For ${companyName} • ${userEmail}</p>
      </div>
    </div>
  `;
}

function extractRFIQuestions(contractAnalysis, tradeAnalysis, coordinationAnalysis) {
  const questions = [];
  
  // Helper to clean text artifacts
  function cleanQuestionText(text) {
    return text
      .replace(/🔴/g, '')
      .replace(/🟡/g, '')
      .replace(/[^\w\s,.:-]/g, '')           // Remove special chars except punctuation
      .replace(/nn/g, 'n ')                  // Fix double n's
      .replace(/([a-z])([A-Z])/g, '$1 $2')  // Add space between camelCase
      .replace(/\s+/g, ' ')                  // Normalize whitespace
      .trim()
      .substring(0, 150);                    // Limit length
  }
  
  // Extract high-priority (red flag) questions from all analyses
  [contractAnalysis, tradeAnalysis, coordinationAnalysis].forEach((analysis, idx) => {
    if (!analysis) return;
    
    const text = JSON.stringify(analysis);
    const redFlags = text.match(/🔴[^🟡🟢]{15,200}/g) || [];
    
    redFlags.slice(0, 8).forEach((flag) => {
      const cleanText = cleanQuestionText(flag);
      if (cleanText.length > 20) {
        questions.push({
          number: questions.length + 1,
          category: idx === 0 ? 'Contract' : idx === 1 ? 'Technical' : 'Coordination',
          priority: 'high',
          question: cleanText
        });
      }
    });
    
    // Also extract medium-priority (yellow flag) questions
    const yellowFlags = text.match(/🟡[^🔴🟢]{15,200}/g) || [];
    yellowFlags.slice(0, 5).forEach((flag) => {
      const cleanText = cleanQuestionText(flag);
      if (cleanText.length > 20) {
        questions.push({
          number: questions.length + 1,
          category: idx === 0 ? 'Contract' : idx === 1 ? 'Technical' : 'Coordination',
          priority: 'medium',
          question: cleanText
        });
      }
    });
  });
  
  return questions.slice(0, 20); // Limit to top 20 questions
}

function generateRFIHTML(questions) {
  if (questions.length === 0) {
    return '<p>✅ No critical questions identified. All specifications appear complete.</p>';
  }
  
  const high = questions.filter(q => q.priority === 'high');
  const medium = questions.filter(q => q.priority === 'medium');
  
  let html = '';
  
  if (high.length > 0) {
    html += '<div class="pdf-h3" style="color: #dc2626;">🔴 High Priority Questions</div>';
    high.forEach(q => {
      html += `
        <div class="pdf-rfi-question" style="border-left-color: #dc2626;">
          <div style="font-weight: bold; color: #2563eb;">RFI-${q.number.toString().padStart(3, '0')}</div>
          <div><strong>${q.category}:</strong> ${q.question}</div>
        </div>
      `;
    });
  }
  
  if (medium.length > 0) {
    html += '<div class="pdf-h3" style="color: #f59e0b; margin-top: 20px;">🟡 Medium Priority Questions</div>';
    medium.forEach(q => {
      html += `
        <div class="pdf-rfi-question" style="border-left-color: #f59e0b;">
          <div style="font-weight: bold; color: #2563eb;">RFI-${q.number.toString().padStart(3, '0')}</div>
          <div><strong>${q.category}:</strong> ${q.question}</div>
        </div>
      `;
    });
  }
  
  return html;
}

function formatContent(content) {
  if (!content) return 'No analysis available';
  if (typeof content === 'object') {
    content = JSON.stringify(content, null, 2);
  }
  
  let formatted = String(content)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/## (.*?)(<br>|$)/g, '<h3 style="font-size: 12pt; color: #1e40af; margin: 15px 0 8px 0;">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Wrap risk indicator emoji in spans (use string replace to avoid regex emoji parsing issues)
  formatted = formatted.split('🔴').join('<span class="risk-high">🔴</span>');
  formatted = formatted.split('🟡').join('<span class="risk-medium">🟡</span>');
  formatted = formatted.split('🟢').join('<span class="risk-low">🟢</span>');
  
  return formatted.substring(0, 8000); // Limit content per page to prevent rendering issues
}
