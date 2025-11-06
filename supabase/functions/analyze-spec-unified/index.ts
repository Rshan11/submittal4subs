import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalyzeRequest {
  pdfText: string;
  trade: string;
  totalPages: number;
  projectName: string;
  coordinationText?: string; // NEW: Optional coordination sections
}

interface DivisionBoundary {
  division: string;
  startPage: number;
  endPage: number;
  startIndex: number;
  endIndex: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfText, trade, totalPages, projectName, coordinationText }: AnalyzeRequest = await req.json();

    if (!pdfText || !trade) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: pdfText and trade" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${projectName} for ${trade} trade (${totalPages} pages)`);
    if (coordinationText) {
      console.log(`Coordination text provided: ${coordinationText.length} chars`);
    }
    const startTime = Date.now();

    // STEP 1: Find Division Boundaries
    const divisions = findDivisionBoundaries(pdfText);
    console.log("Found divisions:", divisions.map(d => `Division ${d.division}: pages ${d.startPage}-${d.endPage}`));

    // STEP 2: Extract divisions
    const div00 = divisions.find(d => d.division === "00");
    const div01 = divisions.find(d => d.division === "01");
    const tradeDiv = findTradeDivision(trade);
    const tradeDivision = divisions.find(d => d.division === tradeDiv);

    if (!tradeDivision) {
      return new Response(
        JSON.stringify({ error: `Division ${tradeDiv} not found for ${trade} trade` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract full division texts
    let fullDiv00Text = "";
    let fullDiv01Text = "";
    
    if (div00) {
      fullDiv00Text = pdfText.substring(div00.startIndex, div00.endIndex);
      console.log(`Division 00: ${fullDiv00Text.length} chars (${div00.endPage - div00.startPage + 1} pages)`);
    }
    
    if (div01) {
      fullDiv01Text = pdfText.substring(div01.startIndex, div01.endIndex);
      console.log(`Division 01: ${fullDiv01Text.length} chars (${div01.endPage - div01.startPage + 1} pages)`);
    }

    const fullContractText = fullDiv00Text + "\n\n=== DIVISION 01 ===\n\n" + fullDiv01Text;
    
    if (fullContractText.length < 100) {
      return new Response(
        JSON.stringify({ error: "Division 00/01 not found or empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contractText = extractContractSections(fullContractText);
    console.log(`Extracted focused contract text: ${contractText.length} chars (from ${fullContractText.length} total)`);

    const tradeDivText = pdfText.substring(tradeDivision.startIndex, tradeDivision.endIndex);

    const contractTokens = Math.round(contractText.length / 4);
    const tradeDivTokens = Math.round(tradeDivText.length / 4);
    const totalTokens = contractTokens + tradeDivTokens;

    console.log(`Contract text (focused): ${contractText.length} chars (~${contractTokens} tokens)`);
    console.log(`Division ${tradeDiv}: ${tradeDivText.length} chars (~${tradeDivTokens} tokens)`);
    console.log(`Total input: ~${totalTokens} tokens`);

    // STEP 3: Main Analysis (Contract + Materials)
    const analysisPrompt = buildAnalysisPrompt(trade, contractText, tradeDivText, tradeDiv);
    
    console.log('Sending to Gemini 2.0 Flash (this may take 60-120 seconds for thorough analysis)...');
    
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: analysisPrompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
          topP: 0.95,
          topK: 40
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error("No response from Gemini API");
    }

    // Parse main result
    let result = parseGeminiJSON(responseText);
    console.log("Main analysis complete - Contract keys:", Object.keys(result.contract || {}));
    console.log("Materials count:", result.materials?.length || 0);

    // STEP 4: Coordination Analysis (if coordination text provided)
    let coordinationResult: string[] = [];
    
    if (coordinationText && coordinationText.length > 100) {
      console.log('Starting coordination analysis...');
      
      const coordPrompt = buildCoordinationPrompt(trade, tradeDivText, coordinationText);
      
      const coordResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: coordPrompt }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            topP: 0.95,
            topK: 40
          }
        })
      });

      if (coordResponse.ok) {
        const coordData = await coordResponse.json();
        const coordText = coordData.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (coordText) {
          const coordParsed = parseGeminiJSON(coordText);
          coordinationResult = coordParsed.coordination || [];
          console.log(`Coordination analysis complete: ${coordinationResult.length} items`);
        }
      } else {
        console.error("Coordination analysis failed, using fallback");
        coordinationResult = extractBasicReferences(tradeDivText, trade);
      }
    } else {
      console.log('No coordination text provided, extracting basic references');
      coordinationResult = extractBasicReferences(tradeDivText, trade);
    }

    const processingTime = Date.now() - startTime;
    console.log(`Analysis complete in ${processingTime}ms (${Math.round(processingTime / 1000)}s)`);

    // Return unified result
    return new Response(
      JSON.stringify({
        contract: result.contract || {},
        division01: result.division01 || {},
        materials: result.materials || [],
        coordination: coordinationResult,
        metadata: {
          divisionsFound: divisions.map(d => d.division),
          contractDivisions: `${div00 ? '00' : ''}${div01 ? '+01' : ''}`,
          div00Pages: div00 ? `${div00.startPage}-${div00.endPage}` : 'N/A',
          div01Pages: div01 ? `${div01.startPage}-${div01.endPage}` : 'N/A',
          tradeDivPages: `${tradeDivision.startPage}-${tradeDivision.endPage}`,
          processingTime,
          inputTokens: totalTokens,
          trade,
          division: tradeDiv,
          hasCoordination: !!coordinationText
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: unknown) {
    console.error("Error in analyze-spec-unified:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    const errorDetails = error instanceof Error ? error.toString() : String(error);
    return new Response(
      JSON.stringify({
        error: errorMessage,
        details: errorDetails
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function parseGeminiJSON(responseText: string): any {
  let jsonText = responseText;
  
  if (jsonText.includes('```')) {
    jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
  }

  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Could not find JSON in response");
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

function extractBasicReferences(tradeDivText: string, trade: string): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  
  const patterns = [
    /Section\s+(\d{6})\s*[-:]?\s*([^.\n]{0,50})/gi,
    /Section\s+(\d{2}\s\d{2}\s\d{2})\s*[-:]?\s*([^.\n]{0,50})/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(tradeDivText)) !== null) {
      const sectionNum = match[1].replace(/\s/g, '');
      const description = match[2] ? match[2].trim() : '';
      
      if (!seen.has(sectionNum)) {
        seen.add(sectionNum);
        references.push(`Section ${sectionNum}${description ? ' - ' + description : ''}: Referenced in ${trade} division`);
      }
    }
  }
  
  return references;
}

function extractContractSections(contractText: string): string {
  const relevantSections: string[] = [];
  
  const sectionPatterns = [
    { keywords: ['PAYMENT', 'PROGRESS PAYMENT', 'SCHEDULE OF VALUES', 'APPLICATION FOR PAYMENT', 'MONTHLY PAYMENT'], label: 'PAYMENT TERMS' },
    { keywords: ['RETAINAGE', 'RETENTION', 'HOLDBACK', 'WITHHELD'], label: 'RETAINAGE' },
    { keywords: ['PERFORMANCE BOND', 'PAYMENT BOND', 'BID BOND', 'SURETY', 'BONDING'], label: 'BONDING' },
    { keywords: ['INSURANCE', 'LIABILITY', 'WORKERS COMPENSATION', 'CERTIFICATE OF INSURANCE', 'COVERAGE'], label: 'INSURANCE' },
    { keywords: ['LIQUIDATED DAMAGE', 'DELAY DAMAGE', 'TIME IS OF THE ESSENCE', 'PER DAY', 'PER DIEM'], label: 'DAMAGES' },
    { keywords: ['CHANGE ORDER', 'CHANGE DIRECTIVE', 'MODIFICATION', 'WRITTEN APPROVAL', 'ARCHITECT APPROVAL', 'OWNER APPROVAL', 'CONSTRUCTION CHANGE', 'CCO', 'PCO', 'PRICE ADJUSTMENT', 'TIME EXTENSION', 'EXTRA WORK'], label: 'CHANGE ORDERS' }
  ];
  
  const paragraphs = contractText.split(/\n{2,}|--- PAGE \d+ ---|(?=\d+\.\d+\s+[A-Z])/);
  
  for (const pattern of sectionPatterns) {
    const matchedParas: string[] = [];
    
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const upperPara = para.toUpperCase();
      
      if (pattern.keywords.some(kw => upperPara.includes(kw))) {
        const startIdx = Math.max(0, i - 1);
        const endIdx = Math.min(paragraphs.length, i + 3);
        const context = paragraphs.slice(startIdx, endIdx).join('\n\n');
        
        if (context.length > 50 && !matchedParas.includes(context)) {
          matchedParas.push(context);
        }
      }
    }
    
    if (matchedParas.length > 0) {
      const combinedText = matchedParas.join('\n\n').substring(0, 8000);
      relevantSections.push(`\n=== ${pattern.label} ===\n${combinedText}`);
      console.log(`Found ${matchedParas.length} paragraphs for ${pattern.label}`);
    }
  }
  
  if (relevantSections.length === 0) {
    console.log('WARNING: No contract sections found, using strategic sampling');
    const length = contractText.length;
    return contractText.substring(0, 15000) + 
           '\n...[middle content]...\n' +
           contractText.substring(length / 2, length / 2 + 15000);
  }
  
  console.log(`Extracted ${relevantSections.length} contract sections`);
  return relevantSections.join('\n\n');
}

function findDivisionBoundaries(pdfText: string): DivisionBoundary[] {
  console.log('[DIVISION] Starting comprehensive division detection...');
  
  const foundDivisions: DivisionBoundary[] = [];
  const divisionSet = new Set<string>();
  
  // STRATEGY 1: Multiple division header formats
  const divisionPatterns = [
    /--- PAGE (\d+) ---[^\f]{0,500}DIVISION\s+(\d{2})\s*[-:]\s*([A-Z\s]+)/gim,
    /--- PAGE (\d+) ---[^\f]{0,500}DIVISION\s+(\d)\s*[-:]\s*([A-Z\s]+)/gim,
    /--- PAGE (\d+) ---[^\f]{0,500}DIV\.?\s+(\d{2})\s*[-:]\s*([A-Z\s]+)/gim,
    /--- PAGE (\d+) ---[^\f]{0,500}DIV\.?\s+(\d)\s*[-:]\s*([A-Z\s]+)/gim,
  ];
  
  for (const pattern of divisionPatterns) {
    let match;
    while ((match = pattern.exec(pdfText)) !== null) {
      const pageNumber = parseInt(match[1]);
      let divNum = match[2].padStart(2, '0');
      const divTitle = match[3].trim();
      
      if (!divisionSet.has(divNum)) {
        console.log(`[DIVISION] Found DIVISION ${divNum} - ${divTitle} at page ${pageNumber}`);
        
        foundDivisions.push({
          division: divNum,
          startPage: pageNumber,
          endPage: 9999,
          startIndex: match.index,
          endIndex: pdfText.length
        });
        
        divisionSet.add(divNum);
      }
    }
  }
  
  // STRATEGY 2: Section-based detection for critical divisions
  const criticalDivisions = ['00', '01', '03', '04', '05', '06', '07', '08', '09'];
  
  for (const divNum of criticalDivisions) {
    if (divisionSet.has(divNum)) continue;
    
    const sectionPatterns = [
      new RegExp(`--- PAGE (\\d+) ---[^\\f]{0,200}SECTION\\s+(${divNum}\\d{2,4})\\b`, 'im'),
      new RegExp(`--- PAGE (\\d+) ---[^\\f]{0,200}SECTION\\s+(${divNum}\\s\\d{2,4})\\b`, 'im'),
    ];
    
    for (const pattern of sectionPatterns) {
      const match = pattern.exec(pdfText);
      
      if (match) {
        const pageNumber = parseInt(match[1]);
        const sectionNum = match[2];
        
        console.log(`[DIVISION] Found Division ${divNum} via section ${sectionNum} at page ${pageNumber}`);
        
        foundDivisions.push({
          division: divNum,
          startPage: pageNumber,
          endPage: 9999,
          startIndex: match.index,
          endIndex: pdfText.length
        });
        
        divisionSet.add(divNum);
        break;
      }
    }
  }
  
  foundDivisions.sort((a, b) => a.startPage - b.startPage);
  
  for (let i = 0; i < foundDivisions.length - 1; i++) {
    foundDivisions[i].endPage = foundDivisions[i + 1].startPage - 1;
    foundDivisions[i].endIndex = foundDivisions[i + 1].startIndex;
  }
  
  console.log('[DIVISION] Final divisions:', foundDivisions.map(d => 
    `Div ${d.division}: pages ${d.startPage}-${d.endPage}`
  ));
  
  if (foundDivisions.length === 0) {
    throw new Error('Could not detect any divisions in specification');
  }
  
  return foundDivisions;
}

function findTradeDivision(trade: string): string {
  const tradeMap: Record<string, string> = {
    masonry: "04",
    concrete: "03",
    steel: "05",
    carpentry: "06",
    roofing: "07",
    doors: "08",
    finishes: "09",
  };

  return tradeMap[trade.toLowerCase()] || "04";
}

function buildAnalysisPrompt(trade: string, contractText: string, tradeDivText: string, tradeDiv: string): string {
  return `Analyze the construction specification and extract ALL contract and payment terms.

CRITICAL: Search the ENTIRE document including Division 00, Division 01, General Conditions, and scattered references throughout.

CONTRACT TEXT (Division 00 + 01):
${contractText}

TRADE DIVISION ${tradeDiv} TEXT:
${tradeDivText}

Extract these sections (quote exact text, include section numbers):

1. PAYMENT TERMS
   - Payment schedule and timing
   - Progress payment process and percentages  
   - Final payment conditions
   - Required documentation and approvals

2. RETAINAGE
   - Percentage withheld
   - Release conditions and timing
   - Reduction provisions after milestones

3. BONDING REQUIREMENTS
   - Performance bond: amount, duration, conditions
   - Payment bond: requirements
   - Warranty bond: if required
   - Surety company qualifications

4. INSURANCE REQUIREMENTS
   - Types required (general liability, workers comp, etc.)
   - Coverage amounts and limits
   - Certificate requirements
   - Additional insured requirements

5. LIQUIDATED DAMAGES
   - Amount per calendar day
   - Conditions triggering damages
   - Substantial completion vs final completion
   - Waiver conditions if any

6. SECURITY & ACCESS REQUIREMENTS ⚠️ CRITICAL
   - Security clearances required (level, type)
   - Background check requirements (FBI, state, etc.)
   - Drug testing requirements and frequency
   - HSPD-12 or PIV card requirements
   - Site access procedures and badging
   - Escort requirements
   - Citizenship or work authorization requirements
   - Facility security officer contact

7. LABOR REQUIREMENTS
   - Prevailing wage requirements (Davis-Bacon Act)
   - Certified payroll submission requirements
   - Apprenticeship requirements
   - Working hours restrictions
   - Overtime provisions

8. BUSINESS REQUIREMENTS
   - DBE/MBE/WBE participation goals (percentages)
   - Small business set-asides
   - Veteran-owned business preferences  
   - Local hiring requirements
   - Reporting and documentation requirements

9. CHANGE ORDER PROCESS
   - How to submit proposed changes
   - Approval authority and timeline
   - Pricing requirements (cost breakdown)
   - Documentation needed

10. PROJECT CLOSEOUT
    - As-built drawing requirements (format, copies)
    - O&M manual requirements
    - Warranty documentation needed
    - Final inspection procedures
    - Punch list process
    - Final acceptance criteria

=== DIVISION 01 REQUIREMENTS ===

Extract from Division 01 text:
1. SUBMITTALS: Procedures, timing (days before installation), approval process
2. TESTING & INSPECTION: Frequency, standards (ASTM numbers), who performs, who pays
3. QUALITY CONTROL: Requirements, third-party inspections, mockups
4. SITE LOGISTICS: Access routes, working hours, staging areas, restrictions

=== MATERIALS ===

Extract ALL materials from trade division with:
- Item name
- Complete specifications (ASTM, manufacturer, model, color)
- Risk level: 🔴 (missing/TBD), 🟡 (generic), 🟢 (complete with manufacturer)
- Submittal requirements  
- Installation notes

IMPORTANT: 
- For each section found: provide quoted text, section numbers, and key requirements
- If section NOT found: state "Not specified in available text"
- Pay special attention to security/access (often in Division 01 01 10, 01 35 00, or General Conditions)
- Look for scattered requirements (security might be in multiple places)

Return as JSON object with these exact keys:
{
  "contract": {
    "payment": "...",
    "retainage": "...",
    "bonding": "...",
    "insurance": "...",
    "damages": "...",
    "security": "...",
    "labor": "...",
    "business": "...",
    "changeOrders": "...",
    "closeout": "..."
  },
  "division01": {
    "submittals": "procedures, timing, approval requirements",
    "testing": "frequency, standards (ASTM), who pays",
    "qualityControl": "inspection requirements and standards",
    "siteLogistics": "access, hours, staging, restrictions"
  },
  "materials": [
    {
      "itemName": "name",
      "specifications": "complete spec",
      "riskLevel": "🔴 or 🟡 or 🟢",
      "reasoning": "why",
      "submittalRequired": true,
      "notes": "requirements"
    }
  ]
}`;
}

function buildCoordinationPrompt(trade: string, tradeDivText: string, coordinationText: string): string {
  return `You are a specification extraction expert. Your job is to find EXACT specifications with NUMBERS.

COORDINATION TEXT TO ANALYZE:
${coordinationText.substring(0, 100000)}

CRITICAL RULES:
1. ❌ NEVER write generic summaries like "Insulation for cavity spaces"
2. ✅ ALWAYS extract actual specifications with numbers like "Type IV XPS, 3 inch thickness, R-5.6"
3. Search the text above for these SPECIFIC patterns:
   - "Type IV", "Type S", "Grade SW", etc.
   - "X inches", "X mm", "X oz/sq ft"
   - "R-value X", "X psi", "X perms"
   - "ASTM XXXX", "ASTM CXXX"
   - Manufacturer names and product codes

EXAMPLE - BAD vs GOOD:

❌ BAD: "Section 072100 - Insulation: Insulation for cavity spaces"

✅ GOOD: "Section 072100 - Insulation: Extruded Polystyrene (XPS) Continuous Insulation Board, Type IV per ASTM C578, 25 psi minimum, thermal resistance R-value of 20 (3.52), 3 inch (76 mm) thickness, board size 48 inch by 96 inch (1220 mm by 2440 mm)"

❌ BAD: "Section 076200 - Flashing: Through-wall masonry flashings"

✅ GOOD: "Section 076200 - Flashing: Copper flashing ASTM B370, 060 soft annealed, 20 oz/sq ft, 0.03 inch (0.7 mm) thick, natural finish. Stainless steel option: ASTM A666 Type 304 soft temper, 26 gauge, 0.0187 inch (0.47 mm) thick"

❌ BAD: "Section 030516 - Vapor Barrier: Sheet vapor barrier under concrete slabs"

✅ GOOD: "Section 030516 - Vapor Barrier: Water vapor permeance not more than 0.010 perms (0.6 ng/(s m2 Pa)) maximum, thickness 15 mils (0.4 mm)"

YOUR TASK: 
Find every specification in the coordination text above and extract ALL details:
- Types, grades, classes
- Dimensions with units
- Weights, thicknesses, gauges
- Standards (ASTM numbers)
- Performance ratings (R-values, psi, perms)
- Material compositions

DO NOT SUMMARIZE. EXTRACT EXACT TEXT WITH NUMBERS.

If a section truly has no specifications, write:
"Section XXXXX - Title: Referenced but no specifications provided in text. RFI required."

Return JSON array with detailed specs:
{
  "coordination": [
    "Section XXXXX - Title: Complete extracted specifications with all numbers"
  ]
}`;
}
