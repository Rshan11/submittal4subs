// Professional PDF Generator for PM4Subs - UPDATED VERSION
import { jsPDF } from 'jspdf';

/**
 * Generate and download a professional PDF report
 * @param {Object} analysisData - The unified analysis data
 */
export async function generateAndDownloadPDF(analysisData) {
    const doc = new jsPDF();
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (margin * 2);
    let yPos = margin;

    // Page counter
    let pageNumber = 1;

    // Helper: Add page footer
    function addFooter() {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(
            `PM4Subs Specification Analysis - Page ${pageNumber}`,
            pageWidth / 2,
            pageHeight - 10,
            { align: 'center' }
        );
        pageNumber++;
    }

    // Helper: Check if we need a new page
    function checkNewPage(requiredSpace = 20) {
        const pageHeight = doc.internal.pageSize.getHeight();
        if (yPos + requiredSpace > pageHeight - 20) {
            addFooter();
            doc.addPage();
            yPos = margin;
            return true;
        }
        return false;
    }

    // Helper: Add section header
    function addSectionHeader(title, icon = '') {
        checkNewPage(30);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(41, 128, 185); // Blue
        doc.text(`${icon} ${title}`, margin, yPos);
        yPos += 10;
        
        // Underline
        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 8;
        
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
    }

    // Helper: Add subsection header
    function addSubsectionHeader(title) {
        checkNewPage(15);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(52, 73, 94);
        doc.text(title, margin, yPos);
        yPos += 7;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
    }

    // Helper: Add paragraph text
    function addParagraph(text, indent = 0) {
        if (!text || text === 'Not specified in provided text.' || text === 'Not explicitly defined in provided text.') {
            doc.setFontSize(10);
            doc.setTextColor(150, 150, 150);
            doc.text('Not specified in available text', margin + indent, yPos);
            yPos += 6;
            doc.setTextColor(0, 0, 0);
            return;
        }

        doc.setFontSize(10);
        const lines = doc.splitTextToSize(text, contentWidth - indent);
        
        lines.forEach((line) => {
            checkNewPage(6);
            doc.text(line, margin + indent, yPos);
            yPos += 5;
        });
        yPos += 2;
    }

    // Helper: Add bullet point
    function addBullet(text) {
        checkNewPage(10);
        doc.setFontSize(10);
        doc.circle(margin + 2, yPos - 2, 1, 'F');
        
        const lines = doc.splitTextToSize(text, contentWidth - 8);
        lines.forEach((line, index) => {
            if (index > 0) checkNewPage(5);
            doc.text(line, margin + 6, yPos);
            yPos += 5;
        });
        yPos += 1;
    }

    // Helper: Add colored risk indicator circle
    function addRiskCircle(riskLevel, x, y) {
        const colors = {
            'green': [46, 204, 113],
            'yellow': [241, 196, 15],
            'red': [231, 76, 60]
        };
        
        const color = colors[riskLevel] || [128, 128, 128];
        doc.setFillColor(...color);
        doc.circle(x, y, 2, 'F');
    }

    // Helper: Determine risk level from text
    function getRiskLevel(text) {
        if (!text) return 'yellow';
        const upper = text.toUpperCase();
        
        if (upper.includes('COMPLETE SPECIFICATION') || 
            upper.includes('MANUFACTURER AND MODEL') ||
            text.includes('🟢')) {
            return 'green';
        } else if (upper.includes('NO PRODUCT SPECIFIED') ||
                   upper.includes('MISSING') ||
                   upper.includes('TBD') ||
                   text.includes('🔴')) {
            return 'red';
        }
        return 'yellow';
    }

    // ========================================
    // COVER PAGE
    // ========================================
    doc.setFillColor(41, 128, 185);
    doc.rect(0, 0, pageWidth, 80, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text('PM4Subs', pageWidth / 2, 35, { align: 'center' });
    
    doc.setFontSize(20);
    doc.text('Specification Analysis Report', pageWidth / 2, 50, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    yPos = 100;
    
    doc.setFont('helvetica', 'bold');
    doc.text('Project:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(analysisData.projectName || 'Unknown Project', margin + 25, yPos);
    yPos += 10;
    
    doc.setFont('helvetica', 'bold');
    doc.text('Trade:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(analysisData.trade?.toUpperCase() || 'UNKNOWN', margin + 25, yPos);
    yPos += 10;
    
    doc.setFont('helvetica', 'bold');
    doc.text('Analyzed:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleDateString(), margin + 25, yPos);
    yPos += 30;

    // Risk Summary Box - Count from materials
    const materials = analysisData.tradeAnalysis?.requirements || '';
    
    // Count by risk assessment text (more reliable than emoji)
    const redCount = (materials.match(/Risk Assessment:.*?(missing|TBD|No product specified)/gi) || []).length;
    const greenCount = (materials.match(/Risk Assessment:.*?(Complete specification|manufacturer and model)/gi) || []).length;
    const yellowCount = (materials.match(/Risk Assessment:.*?Generic specification/gi) || []).length;
    
    doc.setFillColor(231, 76, 60);
    doc.roundedRect(margin, yPos, 50, 40, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text(redCount.toString(), margin + 25, yPos + 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text('High Risk', margin + 25, yPos + 30, { align: 'center' });
    
    doc.setFillColor(241, 196, 15);
    doc.roundedRect(margin + 60, yPos, 50, 40, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text(yellowCount.toString(), margin + 85, yPos + 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Medium Risk', margin + 85, yPos + 30, { align: 'center' });
    
    doc.setFillColor(46, 204, 113);
    doc.roundedRect(margin + 120, yPos, 50, 40, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text(greenCount.toString(), margin + 145, yPos + 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Clear', margin + 145, yPos + 30, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    yPos += 50;
    
    // Quick summary
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Executive Summary:', margin, yPos);
    yPos += 7;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const totalItems = redCount + yellowCount + greenCount;
    const summaryText = `${totalItems} items analyzed. ${redCount} items require immediate clarification (RFI). ${yellowCount} items need manufacturer verification. ${greenCount} items have complete specifications.`;
    const summaryLines = doc.splitTextToSize(summaryText, contentWidth);
    summaryLines.forEach(line => {
        doc.text(line, margin, yPos);
        yPos += 5;
    });
    
    addFooter();

    // ========================================
    // CONTRACT TERMS PAGE (Division 00)
    // ========================================
    doc.addPage();
    yPos = margin;
    
    addSectionHeader('Contract & Payment Terms', '📄');

    const contract = analysisData.contractAnalysis?.division00 || {};

    if (contract.payment) {
        addSubsectionHeader('💰 Payment Terms');
        addParagraph(contract.payment);
        yPos += 5;
    }

    if (contract.retainage) {
        addSubsectionHeader('📊 Retainage');
        addParagraph(contract.retainage);
        yPos += 5;
    }

    if (contract.bonding) {
        addSubsectionHeader('🏛️ Bonding Requirements');
        addParagraph(contract.bonding);
        yPos += 5;
    }

    if (contract.insurance) {
        addSubsectionHeader('🛡️ Insurance Requirements');
        addParagraph(contract.insurance);
        yPos += 5;
    }

    if (contract.damages) {
        addSubsectionHeader('⚠️ Liquidated Damages');
        addParagraph(contract.damages);
        yPos += 5;
    }

    if (contract.changeOrders) {
        addSubsectionHeader('📝 Change Order Process');
        addParagraph(contract.changeOrders);
    }

    addFooter();

    // ========================================
    // GENERAL REQUIREMENTS PAGE (Division 01)
    // ========================================
    doc.addPage();
    yPos = margin;
    
    addSectionHeader('General Requirements', '📋');

    const div01 = analysisData.contractAnalysis?.division01 || {};

    if (div01.submittals) {
        addSubsectionHeader('📤 Submittal Procedures');
        addParagraph(div01.submittals);
        yPos += 5;
    }

    if (div01.testing) {
        addSubsectionHeader('🔬 Testing & Inspection');
        addParagraph(div01.testing);
        yPos += 5;
    }

    if (div01.qualityControl) {
        addSubsectionHeader('✅ Quality Control');
        addParagraph(div01.qualityControl);
        yPos += 5;
    }

    if (div01.siteLogistics) {
        addSubsectionHeader('🚧 Site Logistics');
        addParagraph(div01.siteLogistics);
        yPos += 5;
    }

    if (div01.closeout) {
        addSubsectionHeader('📁 Closeout Requirements');
        addParagraph(div01.closeout);
    }

    // If Division 01 is empty, show note
    if (!div01.submittals && !div01.testing && !div01.qualityControl && !div01.siteLogistics && !div01.closeout) {
        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text('Division 01 requirements not separately identified in analysis.', margin, yPos);
        doc.text('Check contract documents for general requirements.', margin, yPos + 6);
        doc.setTextColor(0, 0, 0);
    }

    addFooter();

    // ========================================
    // MATERIALS / TRADE REQUIREMENTS
    // ========================================
    doc.addPage();
    yPos = margin;
    
    addSectionHeader('Material Requirements', '🔨');

    // Parse materials from the formatted text
    const materialSections = materials.split('---').filter(s => s.trim());
    
    materialSections.forEach((section, index) => {
        if (index > 0) yPos += 3;
        
        // Extract item name
        const nameMatch = section.match(/##\s*(.+?)(?:\s*[🟢🟡🔴]|\n)/);
        
        if (nameMatch) {
            checkNewPage(25);
            
            // Determine risk level from content
            const riskLevel = getRiskLevel(section);
            
            // Item name with colored risk indicator
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            
            addRiskCircle(riskLevel, margin + 2, yPos - 2);
            doc.setTextColor(0, 0, 0);
            doc.text(nameMatch[1].trim(), margin + 8, yPos);
            yPos += 7;
            
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            
            // Extract and display fields
            const specs = section.match(/\*\*Specifications:\*\*\s*(.+?)(?=\n\n|\*\*|$)/s);
            const risk = section.match(/\*\*Risk Assessment:\*\*\s*(.+?)(?=\n\n|\*\*|$)/s);
            const submittal = section.match(/\*\*Submittal Required:\*\*\s*(.+?)(?=\n\n|\*\*|$)/s);
            const notes = section.match(/\*\*Notes:\*\*\s*(.+?)(?=\n\n|---|$)/s);
            
            if (specs) {
                doc.setTextColor(52, 73, 94);
                doc.text('Spec:', margin + 5, yPos);
                doc.setTextColor(0, 0, 0);
                addParagraph(specs[1].trim(), 20);
            }
            
            if (risk) {
                doc.setTextColor(52, 73, 94);
                doc.text('Risk:', margin + 5, yPos);
                doc.setTextColor(0, 0, 0);
                addParagraph(risk[1].trim(), 20);
            }
            
            if (submittal) {
                doc.setTextColor(52, 73, 94);
                doc.text('Submittal:', margin + 5, yPos);
                doc.setTextColor(0, 0, 0);
                addParagraph(submittal[1].trim(), 30);
            }
            
            if (notes) {
                doc.setTextColor(52, 73, 94);
                doc.text('Notes:', margin + 5, yPos);
                doc.setTextColor(0, 0, 0);
                addParagraph(notes[1].trim(), 20);
            }
            
            // Separator line
            doc.setDrawColor(220, 220, 220);
            doc.setLineWidth(0.3);
            doc.line(margin, yPos, pageWidth - margin, yPos);
            yPos += 5;
        }
    });

    addFooter();

    // ========================================
    // COORDINATION REQUIREMENTS
    // ========================================
    doc.addPage();
    yPos = margin;
    
    addSectionHeader('Coordination Requirements', '🤝');

    const coordination = analysisData.coordinationAnalysis?.coordination || [];
    
    if (coordination.length === 0) {
        addParagraph('No coordination requirements identified.');
    } else {
        coordination.forEach((item) => {
            checkNewPage(12);
            
            // Handle both string and object formats
            let text = '';
            if (typeof item === 'string') {
                text = item;
            } else if (item && typeof item === 'object') {
                const section = item.section || '';
                const title = item.title || '';
                const requirement = item.requirement || '';
                text = `Section ${section}${title ? ' - ' + title : ''}: ${requirement}`;
            }
            
            if (text) {
                addBullet(text);
            }
        });
    }

    addFooter();

    // ========================================
    // RFI QUESTIONS (Auto-generated from red items)
    // ========================================
    doc.addPage();
    yPos = margin;
    
    addSectionHeader('Request for Information', '❓');

    // Extract RFI questions from red-flagged items
    const rfiQuestions = [];
    let questionNumber = 1;
    
    materialSections.forEach(section => {
        const nameMatch = section.match(/##\s*(.+?)(?:\s*[🟢🟡🔴]|\n)/);
        const riskMatch = section.match(/\*\*Risk Assessment:\*\*\s*(.+?)(?=\n\n|\*\*|$)/s);
        
        if (nameMatch && riskMatch) {
            const riskText = riskMatch[1].trim().toLowerCase();
            
            // If it's high risk (missing, TBD, no product specified)
            if (riskText.includes('missing') || 
                riskText.includes('tbd') || 
                riskText.includes('no product specified') ||
                riskText.includes('not specified')) {
                
                const itemName = nameMatch[1].trim();
                rfiQuestions.push({
                    number: questionNumber++,
                    item: itemName,
                    question: `Please provide complete specifications for ${itemName}, including manufacturer, model number, and all technical requirements.`
                });
            }
        }
    });

    if (rfiQuestions.length === 0) {
        doc.setFontSize(11);
        doc.setTextColor(46, 204, 113);
        doc.text('✓ No critical RFI questions identified', margin, yPos);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        yPos += 8;
        doc.text('All specifications appear to have sufficient detail for accurate bidding.', margin, yPos);
    } else {
        doc.setFontSize(10);
        doc.setTextColor(231, 76, 60);
        doc.text(`🔴 ${rfiQuestions.length} Critical Questions Requiring Clarification`, margin, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 10;
        
        rfiQuestions.forEach((rfi, index) => {
            checkNewPage(20);
            
            // RFI number box
            doc.setFillColor(231, 76, 60);
            doc.roundedRect(margin, yPos - 4, 18, 8, 2, 2, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(9);
            doc.text(`RFI-${rfi.number.toString().padStart(3, '0')}`, margin + 9, yPos + 1, { align: 'center' });
            
            // Question text
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(rfi.item, margin + 22, yPos);
            yPos += 6;
            
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            const questionLines = doc.splitTextToSize(rfi.question, contentWidth - 10);
            questionLines.forEach(line => {
                checkNewPage(5);
                doc.text(line, margin + 5, yPos);
                yPos += 5;
            });
            
            yPos += 5;
            
            // Separator
            if (index < rfiQuestions.length - 1) {
                doc.setDrawColor(220, 220, 220);
                doc.setLineWidth(0.2);
                doc.line(margin, yPos, pageWidth - margin, yPos);
                yPos += 5;
            }
        });
    }

    addFooter();

    // ========================================
    // SAVE PDF
    // ========================================
    const trade = analysisData.trade || 'Unknown';
    const date = new Date().toISOString().split('T')[0];
    const projectName = analysisData.projectName.replace(/[^a-z0-9]/gi, '-');
    const filename = `${projectName}-${trade}-Analysis-${date}.pdf`;
    
    doc.save(filename);
    
    console.log(`[PDF] Generated: ${filename}`);
}
