import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Trade keywords for fallback search
const tradeKeywords: Record<string, string[]> = {
  masonry: ['masonry', 'brick', 'block', 'CMU', 'mortar', 'grout', 'concrete masonry unit', 'veneer', 'stone masonry'],
  concrete: ['concrete', 'cement', 'reinforcement', 'rebar', 'formwork', 'cast-in-place', 'precast'],
  steel: ['structural steel', 'steel framing', 'steel joists', 'steel deck', 'welding', 'bolting', 'steel column'],
  waterproofing: ['waterproofing', 'dampproofing', 'membrane', 'sealant', 'flashing', 'water barrier'],
  roofing: ['roofing', 'roof membrane', 'roof insulation', 'roof deck', 'shingles', 'roof assembly'],
  carpentry: ['carpentry', 'wood framing', 'lumber', 'rough carpentry', 'finish carpentry', 'blocking'],
  'doors-windows': ['doors', 'windows', 'glazing', 'frames', 'hardware', 'glass'],
  drywall: ['drywall', 'gypsum board', 'metal studs', 'wall framing', 'partition'],
  hvac: ['HVAC', 'heating', 'ventilation', 'air conditioning', 'ductwork', 'mechanical'],
  plumbing: ['plumbing', 'piping', 'fixtures', 'drainage', 'water supply'],
  electrical: ['electrical', 'wiring', 'conduit', 'panels', 'lighting', 'power'],
  sitework: ['sitework', 'excavation', 'grading', 'paving', 'utilities', 'earthwork']
};

interface ExtractionResult {
  content: string;
  searchMethod: 'toc' | 'division' | 'keyword' | 'none';
  sectionsFound: number;
  note?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfText, trade, totalPages, projectName, coordinationText } = await req.json();

    if (!pdfText || !trade) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: pdfText and trade" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[ANALYZE] Processing ${projectName} for ${trade} trade (${totalPages} pages)`);
    const startTime = Date.now();
    const tradeDiv = findTradeDivision(trade);

    // ========================================================================
    // CASCADING SEARCH STRATEGY
    // ========================================================================
    
    // STEP 1: Try to find trade content using intelligent cascading search
    const tradeExtraction = await extractTradeContentIntelligent(pdfText, trade, tradeDiv);
    
    if (!tradeExtraction.content) {
      // No trade content found at all
      return new Response(
        JSON.stringify({
          error: `No ${trade}-related content found in this specification`,
          suggestion: `This spec may not include ${trade} work, or may use non-standard formatting.`,
          searchAttempted: tradeExtraction.searchMethod
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SEARCH] ✓ Found ${trade} content using: ${tradeExtraction.searchMethod}`);
    console.log(`[SEARCH] Extracted ${tradeExtraction.content.length} chars, ${tradeExtraction.sectionsFound} sections`);

    // STEP 2: Extract contract sections (Division 00/01)
    const contractExtraction = extractContractSections(pdfText);
    console.log(`[CONTRACT] Extracted ${contractExtraction.length} chars`);

    // STEP 3: Call Gemini for analysis
    const analysisPrompt = buildAnalysisPrompt(trade, contractExtraction, tradeExtraction.content, tradeDiv);
    
    console.log('[GEMINI] Sending to Gemini 2.0 Flash...');
    
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: analysisPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
          topP: 0.95,
          topK: 40
        }
      })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error("No response from Gemini API");
    }

    const result = parseGeminiJSON(responseText);
    console.log("[GEMINI] Analysis complete");

    // STEP 4: Extract coordination if provided
    let coordinationResult: string[] = [];
    if (coordinationText && coordinationText.length > 100) {
      coordinationResult = await analyzeCoordination(trade, tradeExtraction.content, coordinationText);
    } else {
      coordinationResult = extractBasicReferences(tradeExtraction.content, trade);
    }

    const processingTime = Date.now() - startTime;
    console.log(`[COMPLETE] Analysis finished in ${processingTime}ms`);

    // Return results with search metadata
    return new Response(
      JSON.stringify({
        contract: result.contract || {},
        division01: result.division01 || {},
        materials: result.materials || [],
        coordination: coordinationResult,
        metadata: {
          trade,
          division: tradeDiv,
          processingTime,
          searchMethod: tradeExtraction.searchMethod,
          sectionsFound: tradeExtraction.sectionsFound,
          searchNote: tradeExtraction.note,
          hasCoordination: !!coordinationText
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[ERROR]", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// CASCADING SEARCH IMPLEMENTATION
// ============================================================================

async function extractTradeContentIntelligent(
  pdfText: string, 
  trade: string, 
  tradeDiv: string
): Promise<ExtractionResult> {
  
  console.log('[SEARCH] Starting cascading search strategy...');
  
  // STEP 1: Try Table of Contents
  console.log('[SEARCH] Step 1: Looking for Table of Contents...');
  const tocResult = findTableOfContents(pdfText, tradeDiv);
  if (tocResult && tocResult.content) {
    console.log(`[SEARCH] ✓ Found TOC with ${tocResult.sectionsFound} relevant sections`);
    return {
      content: tocResult.content,
      searchMethod: 'toc',
      sectionsFound: tocResult.sectionsFound,
      note: 'Analysis based on Table of Contents structure'
    };
  }
  console.log('[SEARCH] ✗ No useful TOC found');
  
  // STEP 2: Try Division Headers (multiple formats)
  console.log('[SEARCH] Step 2: Scanning for division sections...');
  const divisionResult = findDivisionSections(pdfText, tradeDiv);
  if (divisionResult && divisionResult.content) {
    console.log(`[SEARCH] ✓ Found division content: ${divisionResult.sectionsFound} sections`);
    return {
      content: divisionResult.content,
      searchMethod: 'division',
      sectionsFound: divisionResult.sectionsFound,
      note: 'Analysis based on division structure'
    };
  }
  console.log('[SEARCH] ✗ No division structure found');
  
  // STEP 3: Keyword Search (Fallback)
  console.log('[SEARCH] Step 3: Using keyword search...');
  const keywordResult = keywordSearch(pdfText, trade);
  if (keywordResult && keywordResult.content) {
    console.log(`[SEARCH] ✓ Found ${keywordResult.sectionsFound} keyword matches`);
    return {
      content: keywordResult.content,
      searchMethod: 'keyword',
      sectionsFound: keywordResult.sectionsFound,
      note: 'No formal division structure found. Analysis based on keyword search - spec may use non-standard formatting.'
    };
  }
  console.log('[SEARCH] ✗ No keyword matches found');
  
  // Nothing found
  return {
    content: '',
    searchMethod: 'none',
    sectionsFound: 0,
    note: 'No relevant content found in specification'
  };
}

function findTableOfContents(pdfText: string, tradeDiv: string): ExtractionResult | null {
  const tocPatterns = [
    /TABLE\s+OF\s+CONTENTS/i,
    /INDEX\s+OF\s+DRAWINGS/i,
    /SPECIFICATION\s+INDEX/i,
    /DIVISION\s+INDEX/i,
    /CONTENTS/i
  ];
  
  for (const pattern of tocPatterns) {
    const match = pattern.exec(pdfText);
    if (match) {
      // Extract TOC (next ~5000 chars)
      const tocStart = match.index;
      const tocText = pdfText.substring(tocStart, tocStart + 5000);
      
      // Parse for trade division sections
      const sections = parseTOC(tocText, tradeDiv);
      if (sections.length > 0) {
        // Extract content for these sections
        const content = extractByTOC(pdfText, sections);
        if (content) {
          return {
            content,
            searchMethod: 'toc',
            sectionsFound: sections.length
          };
        }
      }
    }
  }
  
  return null;
}

function parseTOC(tocText: string, tradeDiv: string): Array<{section: string, page: number}> {
  const sections: Array<{section: string, page: number}> = [];
  
  // Match patterns like "SECTION 040100...45" or "04 01 00...45"
  const patterns = [
    new RegExp(`(?:SECTION\\s+)?(${tradeDiv}\\d{4})[^\\d]*?(\\d+)`, 'gi'),
    new RegExp(`(${tradeDiv}\\s\\d{2}\\s\\d{2})[^\\d]*?(\\d+)`, 'gi')
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(tocText)) !== null) {
      sections.push({
        section: match[1].replace(/\s/g, ''),
        page: parseInt(match[2])
      });
    }
  }
  
  return sections;
}

function extractByTOC(pdfText: string, sections: Array<{section: string, page: number}>): string {
  const chunks: string[] = [];
  
  for (const sec of sections) {
    const pagePattern = new RegExp(`--- PAGE ${sec.page} ---[\\s\\S]{0,15000}`, 'i');
    const match = pagePattern.exec(pdfText);
    if (match) {
      chunks.push(match[0]);
    }
  }
  
  return chunks.join('\n\n');
}

function findDivisionSections(pdfText: string, tradeDiv: string): ExtractionResult | null {
  const foundSections = new Set<string>();
  
  // Multiple division format patterns
  const divisionPatterns = [
    // "DIVISION 04" or "DIVISION 4"
    new RegExp(`DIVISION\\s+0?${tradeDiv}[^\\d]`, 'gi'),
    // "DIV 04" or "DIV 4" or "DV 04" or "DV 4"
    new RegExp(`DIV?\\.?\\s+0?${tradeDiv}[^\\d]`, 'gi'),
    // "SECTION 040100" or "SECTION 04 01 00"
    new RegExp(`SECTION\\s+${tradeDiv}\\d{2,4}`, 'gi'),
    new RegExp(`SECTION\\s+${tradeDiv}\\s\\d{2}\\s\\d{2}`, 'gi'),
    // Just the division number at start of line
    new RegExp(`^\\s*0?${tradeDiv}[^\\d]`, 'gim'),
    // Page breaks followed by division
    new RegExp(`--- PAGE \\d+ ---[^\\f]{0,200}(?:DIVISION|DIV|DV|SECTION)\\s+0?${tradeDiv}`, 'gi')
  ];
  
  for (const pattern of divisionPatterns) {
    let match;
    while ((match = pattern.exec(pdfText)) !== null) {
      // Extract context around match (10,000 chars)
      const start = Math.max(0, match.index - 100);
      const end = Math.min(pdfText.length, match.index + 10000);
      foundSections.add(pdfText.substring(start, end));
    }
  }
  
  if (foundSections.size > 0) {
    return {
      content: Array.from(foundSections).join('\n\n'),
      searchMethod: 'division',
      sectionsFound: foundSections.size
    };
  }
  
  return null;
}

function keywordSearch(pdfText: string, trade: string): ExtractionResult | null {
  const keywords = tradeKeywords[trade] || [];
  const relevantChunks = new Set<string>();
  
  for (const keyword of keywords) {
    const pattern = new RegExp(
      `([\\s\\S]{0,500}${keyword}[\\s\\S]{0,1500})`,
      'gi'
    );
    
    let match;
    while ((match = pattern.exec(pdfText)) !== null) {
      relevantChunks.add(match[0]);
    }
  }
  
  if (relevantChunks.size > 0) {
    return {
      content: Array.from(relevantChunks).join('\n\n'),
      searchMethod: 'keyword',
      sectionsFound: relevantChunks.size
    };
  }
  
  return null;
}

// ============================================================================
// CONTRACT EXTRACTION
// ============================================================================

function extractContractSections(pdfText: string): string {
  const relevantSections: string[] = [];
  
  const sectionPatterns = [
    { keywords: ['PAYMENT', 'PROGRESS PAYMENT', 'SCHEDULE OF VALUES'], label: 'PAYMENT' },
    { keywords: ['RETAINAGE', 'RETENTION', 'HOLDBACK'], label: 'RETAINAGE' },
    { keywords: ['PERFORMANCE BOND', 'PAYMENT BOND', 'SURETY'], label: 'BONDING' },
    { keywords: ['INSURANCE', 'LIABILITY', 'WORKERS COMPENSATION'], label: 'INSURANCE' },
    { keywords: ['LIQUIDATED DAMAGE', 'DELAY DAMAGE'], label: 'DAMAGES' },
    { keywords: ['SECURITY CLEARANCE', 'BACKGROUND CHECK', 'DRUG TEST'], label: 'SECURITY' },
    { keywords: ['DAVIS-BACON', 'PREVAILING WAGE', 'CERTIFIED PAYROLL'], label: 'LABOR' },
    { keywords: ['DBE', 'MBE', 'WBE', 'SMALL BUSINESS'], label: 'BUSINESS' },
    { keywords: ['CHANGE ORDER', 'MODIFICATION'], label: 'CHANGE_ORDERS' },
    { keywords: ['AS-BUILT', 'O&M MANUAL', 'WARRANTY', 'CLOSEOUT'], label: 'CLOSEOUT' }
  ];
  
  const paragraphs = pdfText.split(/\n{2,}|--- PAGE \d+ ---/);
  
  for (const pattern of sectionPatterns) {
    const matchedParas: string[] = [];
    
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const upperPara = para.toUpperCase();
      
      if (pattern.keywords.some(kw => upperPara.includes(kw))) {
        const context = paragraphs.slice(Math.max(0, i - 1), Math.min(paragraphs.length, i + 3)).join('\n\n');
        if (context.length > 50) {
          matchedParas.push(context);
        }
      }
    }
    
    if (matchedParas.length > 0) {
      relevantSections.push(`\n=== ${pattern.label} ===\n${matchedParas.join('\n\n').substring(0, 8000)}`);
    }
  }
  
  return relevantSections.length > 0 ? relevantSections.join('\n\n') : pdfText.substring(0, 30000);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function findTradeDivision(trade: string): string {
  const tradeMap: Record<string, string> = {
    masonry: "04",
    concrete: "03",
    steel: "05",
    carpentry: "06",
    waterproofing: "07",
    roofing: "07",
    'doors-windows': "08",
    drywall: "09",
    hvac: "23",
    plumbing: "22",
    electrical: "26",
    sitework: "31"
  };
  return tradeMap[trade.toLowerCase()] || "04";
}

async function analyzeCoordination(trade: string, tradeDivText: string, coordinationText: string): Promise<string[]> {
  // Simplified coordination analysis
  return extractBasicReferences(coordinationText, trade);
}

function extractBasicReferences(text: string, trade: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  
  const patterns = [
    /Section\s+(\d{6})\s*[-:]?\s*([^.\n]{0,50})/gi,
    /Section\s+(\d{2}\s\d{2}\s\d{2})\s*[-:]?\s*([^.\n]{0,50})/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sectionNum = match[1].replace(/\s/g, '');
      const description = match[2] ? match[2].trim() : '';
      
      if (!seen.has(sectionNum)) {
        seen.add(sectionNum);
        references.push(`Section ${sectionNum}${description ? ' - ' + description : ''}`);
      }
    }
  }
  
  return references.slice(0, 50); // Limit to 50 references
}

function parseGeminiJSON(responseText: string): any {
  let jsonText = responseText;
  
  if (jsonText.includes('```')) {
    jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
  }

  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse Gemini response");
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    let cleanedJson = jsonMatch[0]
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\s+/g, ' ');
    
    return JSON.parse(cleanedJson);
  }
}

function buildAnalysisPrompt(trade: string, contractText: string, tradeDivText: string, tradeDiv: string): string {
  return `Analyze the construction specification and extract ALL contract and payment terms.

CONTRACT TEXT:
${contractText}

TRADE DIVISION ${tradeDiv} TEXT:
${tradeDivText}

Extract these sections (quote exact text, include section numbers):

1. PAYMENT TERMS - Payment schedule, timing, progress payments
2. RETAINAGE - Percentage withheld, release conditions
3. BONDING REQUIREMENTS - Performance bond, payment bond amounts
4. INSURANCE REQUIREMENTS - Types, coverage amounts, certificates
5. LIQUIDATED DAMAGES - Amount per day, conditions
6. SECURITY & ACCESS - Clearances, background checks, drug testing, badging
7. LABOR REQUIREMENTS - Davis-Bacon, certified payroll, prevailing wage
8. BUSINESS REQUIREMENTS - DBE/MBE/WBE goals, small business set-asides
9. CHANGE ORDER PROCESS - Submission, approval, pricing requirements
10. PROJECT CLOSEOUT - As-builts, O&M manuals, warranties, punch list

DIVISION 01 REQUIREMENTS:
1. SUBMITTALS - Procedures, timing, approval process
2. TESTING & INSPECTION - Frequency, standards, who pays
3. QUALITY CONTROL - Requirements, third-party inspections
4. SITE LOGISTICS - Access, hours, staging, restrictions

MATERIALS - Extract ALL materials with:
- Item name
- Complete specifications (ASTM, manufacturer, model)
- Risk level: 🔴 (missing/TBD), 🟡 (generic), 🟢 (complete)
- Submittal requirements
- Installation notes

Return as JSON:
{
  "contract": {
    "payment": "...", "retainage": "...", "bonding": "...", "insurance": "...", 
    "damages": "...", "security": "...", "labor": "...", "business": "...", 
    "changeOrders": "...", "closeout": "..."
  },
  "division01": {
    "submittals": "...", "testing": "...", "qualityControl": "...", "siteLogistics": "..."
  },
  "materials": [
    {"itemName": "...", "specifications": "...", "riskLevel": "🔴/🟡/🟢", "reasoning": "...", "submittalRequired": true, "notes": "..."}
  ]
}`;
}
