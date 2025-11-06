import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Use Gemini 2.0 Flash for 1M token context window
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-2.0-flash-exp';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ============================================================================
// CORS Configuration
// ============================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// ============================================================================
// Index Loading Helper
// ============================================================================
async function loadIndex(supabase, userEmail, filename) {
  try {
    const { data: index } = await supabase
      .from('spec_indices')
      .select('*')
      .eq('user_email', userEmail)
      .eq('filename', filename)
      .single();

    if (index) {
      console.log('[ANALYZE] Using cached index with', Object.keys(index.sections || {}).length, 'sections');
      return index;
    }
    return null;
  } catch (error) {
    console.error('[ANALYZE] Error loading index:', error.message);
    return null;
  }
}

function extractPageRange(pdfText: string, startPage: number, endPage: number): string {
  const lines = pdfText.split('\n');
  let capturing = false;
  let result = '';
  
  for (const line of lines) {
    const pageMatch = line.match(/^--- PAGE (\d+) ---$/);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1]);
      if (pageNum >= startPage && pageNum <= endPage) {
        capturing = true;
      } else if (pageNum > endPage) {
        break;
      }
    }
    if (capturing) {
      result += line + '\n';
    }
  }
  
  if (result.length > 0) {
    console.log(`Extracted pages ${startPage}-${endPage}: ${result.length} chars`);
    return result;
  }
  
  // Fallback
  const totalPages = (pdfText.match(/--- PAGE \d+ ---/g) || []).length;
  const avgCharsPerPage = pdfText.length / Math.max(totalPages, 1);
  const startPos = Math.floor((startPage - 1) * avgCharsPerPage);
  const endPos = Math.floor(endPage * avgCharsPerPage);
  
  return pdfText.substring(startPos, Math.min(endPos, pdfText.length));
}

// ============================================================================
// Main Handler
// ============================================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pdfText, trade, userEmail, filename } = await req.json();
    console.log(`[${new Date().toISOString()}] Analysis request: ${trade}, user: ${userEmail}`);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Load index if available
    const index = await loadIndex(supabase, userEmail, filename);
    
    // Analyze spec with simplified single-call approach
    const result = await analyzeSpec(pdfText, trade, index);
    
    // Save analysis
    const pageCount = Math.ceil(pdfText.length / 3000);
    const { data: analysis, error: saveError } = await supabase
      .from('spec_analyses')
      .insert({
        user_email: userEmail,
        filename: filename,
        trade: trade,
        page_count: pageCount,
        analysis_result: result
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving analysis:', saveError);
      throw saveError;
    }

    console.log(`[${new Date().toISOString()}] Analysis complete, saved with ID: ${analysis.id}`);
    
    return new Response(
      JSON.stringify({ ...result, analysisId: analysis.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[ERROR]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// SIMPLIFIED Core Analysis - Single API call per division
// ============================================================================
async function analyzeSpec(pdfText: string, trade: string, index: any) {
  console.log('[ANALYZE] Starting simplified analysis, text length:', pdfText.length);

  try {
    // Extract full divisions (no chunking!)
    let div00Text, div01Text, tradeDivText;

    if (index && index.sections) {
      console.log('[ANALYZE] Using index for division extraction');
      const sections = index.sections;
      
      div00Text = sections.div00 
        ? extractPageRange(pdfText, sections.div00.start, sections.div00.end)
        : extractDivision00Fallback(pdfText);
      
      div01Text = sections.div01
        ? extractPageRange(pdfText, sections.div01.start, sections.div01.end)
        : extractDivision01Fallback(pdfText);
      
      const tradeDiv = getTradeDiv(trade);
      tradeDivText = sections[tradeDiv]
        ? extractPageRange(pdfText, sections[tradeDiv].start, sections[tradeDiv].end)
        : extractTradeDivisionFallback(pdfText, tradeDiv, trade);
    } else {
      console.log('[ANALYZE] No index, using fallback extraction');
      div00Text = extractDivision00Fallback(pdfText);
      div01Text = extractDivision01Fallback(pdfText);
      tradeDivText = extractTradeDivisionFallback(pdfText, getTradeDiv(trade), trade);
    }

    console.log('[ANALYZE] Division sizes:');
    console.log('  Division 00:', div00Text.length, 'chars');
    console.log('  Division 01:', div01Text.length, 'chars');
    console.log('  Trade division:', tradeDivText.length, 'chars');

    // Single API calls - no batching, no chunking
    console.log('[ANALYZE] Step 1/3: Analyzing contract terms...');
    const contract = await callGemini(getContractPrompt(div00Text));
    
    console.log('[ANALYZE] Step 2/3: Analyzing general requirements...');
    const security = await callGemini(getSecurityPrompt(div01Text));
    
    console.log('[ANALYZE] Step 3/3: Analyzing trade requirements...');
    const tradeAnalysis = await callGemini(getTradePrompt(trade, tradeDivText));

    console.log('[ANALYZE] All analyses complete');

    // Extract submittals from trade analysis
    const submittals = extractSubmittals(tradeAnalysis);
    console.log(`[ANALYZE] Extracted ${submittals.length} submittals`);

    return {
      contract,
      security,
      tradeRequirements: tradeAnalysis,
      coordination: 'See trade requirements section for coordination details',
      changeOrders: 'See trade requirements section for scope clarification opportunities',
      submittals,
      metadata: {
        trade,
        division: getTradeDiv(trade),
        confidence: index ? 'high' : 'medium',
        extractedSubmittals: submittals.length,
        textLength: pdfText.length,
        usedIndex: !!index,
        model: GEMINI_MODEL
      }
    };
  } catch (error) {
    console.error('[ANALYZE] Analysis failed:', error);
    throw error;
  }
}

// ============================================================================
// Gemini API Call with Retry
// ============================================================================
async function callGemini(prompt: string, retries = 2): Promise<string> {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error(`[GEMINI] Attempt ${attempt} failed:`, error.message);
      if (attempt === retries + 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error('All retry attempts failed');
}

// ============================================================================
// Fallback Division Extraction (when no index)
// ============================================================================
function extractDivision00Fallback(pdfText: string): string {
  const content = pdfText.substring(Math.floor(pdfText.length * 0.05));
  
  let match = content.match(/DIVISION\s+0?0\s*[-–—:]?\s*(BIDDING|PROCUREMENT|CONTRACT|GENERAL\s+CONDITIONS)[\s\S]{1000,40000}(?=DIVISION\s+0?1|$)/i);
  if (match) return match[0];
  
  console.log('[EXTRACT] Using Division 00 fallback (first 25%)');
  return pdfText.substring(0, Math.floor(pdfText.length * 0.25));
}

function extractDivision01Fallback(pdfText: string): string {
  const content = pdfText.substring(Math.floor(pdfText.length * 0.05));
  
  let match = content.match(/DIVISION\s+0?1\s*[-–—:]?\s*GENERAL\s+REQUIREMENTS[\s\S]{1000,50000}(?=DIVISION\s+0?[2-9]|$)/i);
  if (match) return match[0];
  
  console.log('[EXTRACT] Using Division 01 fallback (25%-40%)');
  const start = Math.floor(pdfText.length * 0.25);
  const end = Math.floor(pdfText.length * 0.4);
  return pdfText.substring(start, end);
}

function extractTradeDivisionFallback(pdfText: string, divNumber: string, trade: string): string {
  const content = pdfText.substring(Math.floor(pdfText.length * 0.05));
  const divInt = parseInt(divNumber);
  
  const pattern = new RegExp(`DIVISION\\s+0?${divNumber}\\s*[-–—:]?[\\s\\S]{1000,100000}(?=DIVISION\\s+0?${divInt + 1}|$)`, 'i');
  const match = content.match(pattern);
  
  if (match) return match[0];
  
  console.log(`[EXTRACT] Using trade division fallback (entire doc)`);
  return pdfText.substring(0, 150000); // Use first ~150K chars
}

// ============================================================================
// Helper Functions
// ============================================================================
function getTradeDiv(trade: string): string {
  const map: Record<string, string> = {
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

// ============================================================================
// Submittal Extraction
// ============================================================================
function extractSubmittals(analysisText: string) {
  const submittals = [];
  const submittalPattern = /\*\*SUBMITTAL\s+(\d+):\s*([^\*]+)\*\*\s*([\s\S]*?)(?=\*\*SUBMITTAL|\*\*RED FLAGS|##|$)/gi;
  
  let match;
  let counter = 1;
  
  while ((match = submittalPattern.exec(analysisText)) !== null) {
    const name = match[2].trim();
    const content = match[3];
    
    submittals.push({
      id: `submittal-${counter}`,
      number: match[1],
      name: name,
      type: extractField(content, 'Type:') || 'not_specified',
      timing: extractField(content, 'Timing:') || 'not_specified',
      required_backup: extractList(content, 'Contents:'),
      approval_authority: extractField(content, 'Approval Authority:') || 'Architect',
      section: '',
      status: 'pending'
    });
    counter++;
  }
  
  return submittals;
}

function extractField(text: string, fieldName: string): string {
  const regex = new RegExp(`${fieldName}\\s*(.+?)(?=\\n|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

function extractList(text: string, fieldName: string): string[] {
  const regex = new RegExp(`${fieldName}\\s*\\n([\\s\\S]+?)(?=\\n\\*\\*|$)`, 'i');
  const match = text.match(regex);
  if (!match) return [];
  
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('-'))
    .map(line => line.substring(1).trim())
    .filter(line => line.length > 0);
}

// ============================================================================
// Enhanced Prompts for Gemini 2.0 Flash (with full context)
// ============================================================================
function getContractPrompt(text: string): string {
  return `You are a construction contract specialist analyzing specification documents for bidding.

ANALYZE THIS DIVISION 00 TEXT FOR CONTRACT AND BIDDING REQUIREMENTS:

${text}

EXTRACT AND STRUCTURE:

## INSURANCE REQUIREMENTS
- General Liability (coverage amounts, additional insureds, per-occurrence/aggregate limits)
- Workers Compensation (statutory requirements, waiver of subrogation)
- Auto Liability (if required)
- Umbrella/Excess (if required)
- Professional Liability (if required, amounts)
- Builder's Risk (if required, who provides)
- Certificate requirements and timing

## BONDING REQUIREMENTS
- Bid Bond (percentage, form, when required)
- Performance Bond (percentage, form, duration)
- Payment Bond (percentage, form, beneficiaries)
- Warranty Bond (if required)
- Bond form requirements (AIA, specific forms)

## PAYMENT TERMS
- Retainage percentage (standard and reduced rates if applicable)
- Payment schedule (monthly, progress-based)
- Application for Payment requirements (forms, certifications)
- Final payment conditions
- Stored materials provisions

## WARRANTY REQUIREMENTS
- General warranty period (typically 1 year)
- Extended warranties by system/trade
- Warranty commencement date (substantial completion, final completion)
- Warranty bond requirements

## BIDDING REQUIREMENTS
- Bid security requirements (amount, form)
- Pre-bid meeting (mandatory/optional, date, location)
- Site visit requirements
- Bid form format
- Addenda acknowledgment requirements
- Bid opening date and process

## CRITICAL DATES AND DEADLINES
- Bid submission deadline
- Pre-bid meeting date
- Substantial completion date
- Final completion date

## SPECIAL CONDITIONS
- Prevailing wage requirements
- DBE/MBE requirements
- Buy American provisions
- Local hiring requirements
- Drug testing requirements
- Background check requirements

Use exact dollar amounts, percentages, and dates from the text. Format as clear markdown with headers and bullet points. If any section is not found, state "Not specified in Division 00".`;
}

function getSecurityPrompt(text: string): string {
  return `You are a construction project manager analyzing specification documents for site access and security requirements.

ANALYZE THIS DIVISION 01 TEXT FOR GENERAL REQUIREMENTS:

${text}

EXTRACT AND STRUCTURE:

## SECURITY AND ACCESS REQUIREMENTS
- Background check requirements (type, timeframe, cost responsibility)
- Drug testing (pre-employment, random, frequency, standards)
- Security clearance levels (if applicable)
- Badging requirements (how to obtain, escort requirements, daily sign-in)
- Site access procedures (hours, gates, check-in process)
- Lead time to get workers approved and on-site

## PROJECT MEETINGS
- Pre-construction meeting requirements
- Progress meeting schedule (frequency, participants, agenda)
- Coordination meeting requirements
- Special meeting requirements

## SUBMITTALS
- General submittal requirements (timing, format, copies)
- Shop drawing requirements
- Product data requirements
- Sample requirements
- Closeout documentation requirements

## QUALITY CONTROL
- Testing requirements overview
- Inspection requirements
- Quality control plan requirements
- Mock-up requirements

## PROJECT CLOSEOUT
- Punch list procedures
- As-built drawing requirements
- O&M manual requirements
- Warranties and guarantees compilation
- Final cleaning requirements

## SCHEDULE REQUIREMENTS
- Schedule format (CPM, bar chart)
- Schedule updates (frequency, level of detail)
- Critical path identification
- Long lead item identification

Use exact requirements, timeframes, and procedures from the text. Format as clear markdown. If any section is not found, state "Not specified in Division 01".`;
}

function getTradePrompt(trade: string, text: string): string {
  const tradeUpper = trade.charAt(0).toUpperCase() + trade.slice(1);
  
  return `You are a ${tradeUpper} estimator preparing a comprehensive bid. Analyze this specification text for ALL critical requirements.

SPECIFICATION TEXT:

${text}

PROVIDE A COMPLETE ANALYSIS WITH THESE SECTIONS:

## MATERIALS REQUIREMENTS

### Specified Products
- Manufacturer names and model numbers
- Approved equals process
- Material standards (ASTM, ANSI, etc.) with full numbers
- Grades, strengths, sizes
- Colors, finishes, textures
- Performance criteria

### Material Testing
- Required mill tests and certifications
- Field testing requirements (frequency, standards, who pays)
- Sample requirements (quantity, timing, approval process)

## INSTALLATION REQUIREMENTS

### Workmanship Standards
- Reference standards (ACI, ASTM, trade association standards)
- Tolerances (exact measurements)
- Surface preparation requirements
- Installation methods and procedures
- Sequencing requirements

### Environmental Limitations
- Temperature ranges (min/max for installation)
- Humidity requirements
- Weather protection requirements
- Seasonal restrictions
- Hot/cold weather procedures

### Quality Control
- Inspection requirements (frequency, third-party vs. self-perform)
- Testing during installation (types, frequency, standards)
- Documentation requirements
- Defective work provisions

## SUBMITTALS (List each separately)

For each submittal, provide:

**SUBMITTAL 1: [Name]**
- Type: (Shop drawings, Product data, Samples, etc.)
- Timing: (Days before fabrication/installation)
- Contents: (Specific items to include)
- Approval Authority: (Architect, Engineer, Owner)

**SUBMITTAL 2: [Name]**
[Continue for all submittals...]

## COORDINATION REQUIREMENTS
- Interface with other trades (specific connections, sequencing)
- Required measurements or field verification
- Access requirements or restrictions
- Utility shutdowns or tie-ins
- Protection of other work

## WARRANTY AND MAINTENANCE
- Warranty period and coverage
- Manufacturer warranty requirements
- Special maintenance requirements
- Training requirements for owner's personnel

## RED FLAGS - SCOPE CLARIFICATION OPPORTUNITIES

Identify items that may need clarification (use ethically for fair bidding):

1. **Ambiguous Specifications**
   - Issue: [Describe unclear requirement]
   - Impact: [Potential cost/schedule impact]
   - Clarification Needed: [Question to ask]

2. **Missing Information**
   - Issue: [What's not specified]
   - Impact: [How this affects bid]
   - Assumption or Clarification: [What to assume or ask]

3. **Conflicting Requirements**
   - Issue: [Describe conflict]
   - Impact: [Cost or schedule issue]
   - Resolution Needed: [How to resolve]

Be thorough and specific. Include actual specification section numbers, exact standards, precise measurements, and all details an estimator needs for accurate bidding. Format as clear markdown with headers.`;
}
