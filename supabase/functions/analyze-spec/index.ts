import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// COST SAFETY: Lock to Haiku 3.5 (faster & better than Haiku 3)
const REQUIRED_MODEL = 'claude-3-5-haiku-20241022';
const MAX_COST_PER_CALL = 0.05; // 5 cents max

function validateModel(model: string) {
  if (model !== REQUIRED_MODEL) {
    throw new Error(`COST ALERT: Wrong model ${model}! Expected ${REQUIRED_MODEL}`);
  }
}

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
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { pdfText, trade, userEmail, filename } = await req.json();
    console.log(`[${new Date().toISOString()}] Analysis request: ${trade}, user: ${userEmail}`);
    
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    
    // Load index if available
    const index = await loadIndex(supabase, userEmail, filename);
    
    // Analyze spec with batched parallel calls and optional index
    const result = await analyzeSpec(pdfText, trade, index);
    
    // Save analysis
    const pageCount = Math.ceil(pdfText.length / 3000);
    const { data: analysis, error: saveError } = await supabase.from('spec_analyses').insert({
      user_email: userEmail,
      filename: filename,
      trade: trade,
      page_count: pageCount,
      analysis_result: result
    }).select().single();
    if (saveError) {
      console.error('Error saving analysis:', saveError);
      throw saveError;
    }
    console.log(`[${new Date().toISOString()}] Analysis complete, saved with ID: ${analysis.id}`);
    return new Response(JSON.stringify({
      ...result,
      analysisId: analysis.id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[ERROR]', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
// ============================================================================
// Core Analysis - BATCHED PARALLEL for SPEED
// ============================================================================
async function analyzeSpec(pdfText, trade, index) {
  console.log('Starting batched analysis, text length:', pdfText.length);

  try {
    let div00Text, div01Text, tradeDivText;

    if (index && index.sections) {
      console.log('[FAST PATH] Using index');
      const sections = index.sections;
      
      div00Text = sections.div00 
        ? extractPageRange(pdfText, sections.div00.start, sections.div00.end)
        : extractDivision00(pdfText.substring(Math.floor(pdfText.length * 0.05)), pdfText);
      
      div01Text = sections.div01
        ? extractPageRange(pdfText, sections.div01.start, sections.div01.end)
        : extractDivision01(pdfText.substring(Math.floor(pdfText.length * 0.05)), pdfText);
      
      const tradeDiv = getTradeDiv(trade);
      tradeDivText = sections[tradeDiv]
        ? extractPageRange(pdfText, sections[tradeDiv].start, sections[tradeDiv].end)
        : extractTradeDivision(pdfText.substring(Math.floor(pdfText.length * 0.05)), pdfText, tradeDiv, trade);
        
    } else {
      console.log('[SLOW PATH] No index, using regex');
      const skipAmount = Math.floor(pdfText.length * 0.05);
      const content = pdfText.substring(skipAmount);
      
      div00Text = extractDivision00(content, pdfText);
      div01Text = extractDivision01(content, pdfText);
      tradeDivText = extractTradeDivision(content, pdfText, getTradeDiv(trade), trade);
    }

    console.log('Division 00:', div00Text.length, 'chars');
    console.log('Division 01:', div01Text.length, 'chars');
    console.log('Trade division:', tradeDivText.length, 'chars');

    const coordDivisions = getCoordinationDivisions(trade);
    const coordText = extractCoordinationSections(pdfText, coordDivisions);
    // ===== BATCH 1: Contract + Security (both quick) =====
    console.log('Batch 1/3: Analyzing contract and security (parallel)...');
    const [contract, security] = await Promise.all([
      callClaudeWithRetry(getContractPrompt(div00Text)),
      callClaudeWithRetry(getSecurityPrompt(div01Text))
    ]);
    console.log('Batch 1/3 complete');
    // ===== BATCH 2: Trade Analysis (heaviest, solo) =====
    console.log('Batch 2/3: Analyzing trade requirements...');
    const tradeAnalysis = await callClaudeWithRetry(getTradePrompt(trade, tradeDivText));
    console.log('Batch 2/3 complete');
    // ===== BATCH 3: Coordination + Change Orders (parallel) =====
    console.log('Batch 3/3: Analyzing coordination and change orders (parallel)...');
    const [coordination, changeOrders] = await Promise.all([
      coordText ? callClaudeWithRetry(getCoordinationPrompt(trade, coordText)) : Promise.resolve('No coordination sections found in specification.'),
      callClaudeWithRetry(getChangeOrderPrompt(trade, tradeDivText))
    ]);
    console.log('Batch 3/3 complete');
    console.log('All analyses complete successfully');
    // Extract submittals from trade analysis
    const submittals = extractSubmittals(tradeAnalysis);
    console.log(`Extracted ${submittals.length} submittals`);
    return {
      contract,
      security,
      tradeRequirements: tradeAnalysis,
      coordination,
      changeOrders,
      submittals,
      metadata: {
        trade,
        division: getTradeDiv(trade),
        confidence: index ? 'high' : 'medium',
        extractedSubmittals: submittals.length,
        coordinationDivisions: coordDivisions,
        textLength: pdfText.length,
        usedIndex: !!index
      }
    };
  } catch (error) {
    console.error('Analysis failed:', error);
    throw error;
  }
}
// ============================================================================
// ROBUST DIVISION EXTRACTION
// ============================================================================
function extractDivision00(content, fullText) {
  let match = content.match(/DIVISION\s+0?0\s*[-–—:]?\s*(BIDDING|PROCUREMENT|CONTRACT|GENERAL\s+CONDITIONS)[\s\S]{1000,40000}(?=DIVISION\s+0?1|$)/i);
  if (match) {
    console.log('Found Division 00: Standard format');
    return match[0];
  }
  match = content.match(/SECTION\s+0?0\s*\d+\s+\d+[\s\S]{1000,40000}(?=SECTION|DIVISION|$)/i);
  if (match) {
    console.log('Found Division 00: Section format');
    return match[0];
  }
  const contractKeywords = /(insurance|bonding|payment|warranty|contract\s+requirements|bidding\s+requirements)/i;
  const chunks = chunkText(content, 50000);
  for(let i = 0; i < Math.min(3, chunks.length); i++){
    if (contractKeywords.test(chunks[i])) {
      console.log(`Found Division 00: Keyword match in chunk ${i}`);
      return chunks[i].substring(0, 30000);
    }
  }
  console.log('Division 00: Using fallback (first 25% of document)');
  return fullText.substring(0, Math.floor(fullText.length * 0.25));
}
function extractDivision01(content, fullText) {
  let match = content.match(/DIVISION\s+0?1\s*[-–—:]?\s*GENERAL\s+REQUIREMENTS[\s\S]{1000,50000}(?=DIVISION\s+0?[2-9]|$)/i);
  if (match) {
    console.log('Found Division 01: Standard format');
    return match[0];
  }
  match = content.match(/DIV\s*0?1|DIVISION\s+ONE|PART\s+1\s*[-–—:]?\s*GENERAL[\s\S]{1000,50000}(?=DIVISION|PART|$)/i);
  if (match) {
    console.log('Found Division 01: Alternate format');
    return match[0];
  }
  match = content.match(/SECTION\s+0?1\s*\d+\s+\d+[\s\S]{1000,40000}(?=SECTION|DIVISION|$)/i);
  if (match) {
    console.log('Found Division 01: Section format');
    return match[0];
  }
  const div01Keywords = /(security|background\s+check|site\s+access|badge|clearance|drug\s+test|safety\s+requirements)/i;
  const chunks = chunkText(content, 50000);
  for(let i = 0; i < Math.min(4, chunks.length); i++){
    if (div01Keywords.test(chunks[i])) {
      console.log(`Found Division 01: Keyword match in chunk ${i}`);
      return chunks[i].substring(0, 35000);
    }
  }
  console.log('Division 01: Using fallback (second quarter)');
  const start = Math.floor(fullText.length * 0.25);
  const end = Math.floor(fullText.length * 0.4);
  return fullText.substring(start, end);
}
function extractTradeDivision(content, fullText, divNumber, trade) {
  const divInt = parseInt(divNumber);
  let pattern = new RegExp(`DIVISION\\s+0?${divNumber}\\s*[-–—:]?[\\s\\S]{1000,80000}(?=DIVISION\\s+0?${divInt + 1}|$)`, 'i');
  let match = content.match(pattern);
  if (match) {
    console.log(`Found Division ${divNumber}: Standard format`);
    return match[0];
  }
  pattern = new RegExp(`SECTION\\s+${divNumber}\\s*\\d+\\s*\\d+[\\s\\S]{1000,60000}(?=SECTION|DIVISION|$)`, 'i');
  match = content.match(pattern);
  if (match) {
    console.log(`Found Division ${divNumber}: Section format`);
    return match[0];
  }
  const tradeKeywords = getTradeKeywords(trade);
  const chunks = chunkText(content, 60000);
  let bestChunk = '';
  let bestScore = 0;
  for(let i = 0; i < chunks.length; i++){
    let score = 0;
    tradeKeywords.forEach((keyword)=>{
      const regex = new RegExp(keyword, 'gi');
      const matches = chunks[i].match(regex);
      if (matches) score += matches.length;
    });
    if (score > bestScore) {
      bestScore = score;
      bestChunk = chunks[i];
    }
  }
  if (bestScore > 5) {
    console.log(`Found trade section: Keyword match (score: ${bestScore})`);
    return bestChunk;
  }
  console.log(`Trade division: Using entire extracted text (${fullText.length} chars)`);
  return fullText.substring(0, 100000);
}
function extractCoordinationSections(content, divisions) {
  let coordText = '';
  let foundCount = 0;
  for (const div of divisions){
    const patterns = [
      new RegExp(`DIVISION\\s+0?${div}[\\s\\S]{500,40000}(?=DIVISION\\s+0?${parseInt(div) + 1}|$)`, 'i'),
      new RegExp(`SECTION\\s+${div}\\s*\\d+[\\s\\S]{500,30000}(?=SECTION|DIVISION|$)`, 'i')
    ];
    for (const pattern of patterns){
      const match = content.match(pattern);
      if (match && foundCount < 3) {
        coordText += `\n\n=== DIVISION ${div} ===\n${match[0].substring(0, 15000)}`;
        foundCount++;
        break;
      }
    }
  }
  console.log(`Found ${foundCount} coordination divisions`);
  return coordText;
}
// ============================================================================
// Helper Functions
// ============================================================================
function chunkText(text, chunkSize) {
  const chunks = [];
  for(let i = 0; i < text.length; i += chunkSize){
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}
function getTradeKeywords(trade) {
  const keywords = {
    'masonry': [
      'masonry',
      'brick',
      'block',
      'CMU',
      'mortar',
      'grout',
      'veneer',
      'unit masonry'
    ],
    'concrete': [
      'concrete',
      'formwork',
      'reinforcing',
      'rebar',
      'cast-in-place',
      'precast'
    ],
    'steel': [
      'structural steel',
      'steel erection',
      'steel frame',
      'welding',
      'bolting'
    ],
    'carpentry': [
      'carpentry',
      'framing',
      'rough carpentry',
      'finish carpentry',
      'millwork'
    ],
    'waterproofing': [
      'waterproofing',
      'dampproofing',
      'membrane',
      'flashing',
      'sealant'
    ],
    'doors-windows': [
      'doors',
      'windows',
      'glazing',
      'storefront',
      'curtain wall',
      'hardware'
    ],
    'drywall': [
      'gypsum',
      'drywall',
      'gypsum board',
      'metal studs',
      'taping',
      'finishing'
    ],
    'roofing': [
      'roofing',
      'roof membrane',
      'shingles',
      'roof insulation',
      'roof drain'
    ],
    'hvac': [
      'HVAC',
      'mechanical',
      'ductwork',
      'air conditioning',
      'heating',
      'ventilation'
    ],
    'plumbing': [
      'plumbing',
      'piping',
      'fixtures',
      'drainage',
      'water supply'
    ],
    'electrical': [
      'electrical',
      'wiring',
      'conduit',
      'panels',
      'lighting',
      'power'
    ],
    'sitework': [
      'sitework',
      'earthwork',
      'excavation',
      'grading',
      'paving',
      'utilities'
    ]
  };
  return keywords[trade] || [
    trade
  ];
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
function getCoordinationDivisions(trade) {
  const coordMap = {
    'masonry': [
      '3',
      '5',
      '7',
      '8'
    ],
    'concrete': [
      '3',
      '4',
      '5'
    ],
    'steel': [
      '3',
      '4',
      '9'
    ],
    'carpentry': [
      '6',
      '8',
      '9'
    ],
    'waterproofing': [
      '3',
      '4',
      '7'
    ],
    'doors-windows': [
      '4',
      '6',
      '8'
    ],
    'drywall': [
      '5',
      '6',
      '8'
    ],
    'roofing': [
      '6',
      '7'
    ],
    'hvac': [
      '22',
      '26'
    ],
    'plumbing': [
      '23',
      '26'
    ],
    'electrical': [
      '22',
      '23'
    ],
    'sitework': [
      '2',
      '31'
    ]
  };
  return coordMap[trade] || [];
}
// ============================================================================
// Submittal Extraction
// ============================================================================
function extractSubmittals(analysisText) {
  const submittals = [];
  const submittalPattern = /\*\*SUBMITTAL\s+(\d+):\s*([^\*]+)\*\*\s*([\s\S]*?)(?=\*\*SUBMITTAL|\*\*RED FLAGS|##|$)/gi;
  let match;
  let counter = 1;
  while((match = submittalPattern.exec(analysisText)) !== null){
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
function extractField(text, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*(.+?)(?=\\n|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}
function extractList(text, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*\\n([\\s\\S]+?)(?=\\n\\*\\*|$)`, 'i');
  const match = text.match(regex);
  if (!match) return [];
  return match[1].split('\n').map((line)=>line.trim()).filter((line)=>line.startsWith('-')).map((line)=>line.substring(1).trim()).filter((line)=>line.length > 0);
}
// ============================================================================
// Claude API with Retry Logic
// ============================================================================
async function callClaudeWithRetry(prompt, retries = 3) {
  for(let attempt = 1; attempt <= retries + 1; attempt++){
    try {
      return await callClaude(prompt);
    } catch (error) {
      console.error(`Claude API attempt ${attempt} failed:`, error.message);
      if (attempt === retries + 1) {
        throw error;
      }
      // Exponential backoff: 2s, 4s, 6s
      await new Promise((resolve)=>setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error('All retry attempts failed');
}
async function callClaude(prompt) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: REQUIRED_MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });
  if (!response.ok) {
    const data = await response.json();
    console.error('Claude API error:', data);
    throw new Error(data.error?.message || `Claude API error: ${response.status}`);
  }
  const data = await response.json();
  return data.content[0].text;
}
// ============================================================================
// Prompt Templates (Shortened for speed)
// ============================================================================
function getContractPrompt(text) {
  return `Analyze construction specifications for contract and bidding requirements.

TEXT:
${text.substring(0, 25000)}

Extract:
- Insurance (GL, WC, amounts, additional insureds)
- Bonding (performance, payment, percentages)
- Payment terms (retainage %, schedule)
- Warranties (duration, coverage)
- Bidding (bid security, pre-bid meetings)

Format as clear markdown. If none found, state "NO CONTRACT REQUIREMENTS SPECIFIED"`;
}
function getSecurityPrompt(text) {
  return `Analyze construction specifications for security and access requirements.

TEXT:
${text.substring(0, 25000)}

Extract:
- Background checks (type, time, cost)
- Security clearances (level, timeline)
- Badging (how to obtain, escort needs)
- Drug testing (pre-employment, random)
- Lead time for workers to start

Format as clear markdown. If none found, state "NO SECURITY REQUIREMENTS SPECIFIED"`;
}
function getTradePrompt(trade, text) {
  return `You are a ${trade} estimator analyzing specifications for bidding.

TEXT:
${text.substring(0, 40000)}

Extract ALL critical requirements:

## MATERIALS
- Standards (ASTM numbers), grades, sizes, strengths
- Colors, finishes, manufacturers

## INSTALLATION
- Weather limits (exact temperatures)
- Workmanship standards, tolerances

## TESTING
- Required tests (standards, frequency, who performs)

## SUBMITTALS
List each with: type, timing, contents, approval authority

## RED FLAGS
Identify expensive or risky requirements

Format as markdown with exact numbers and standards.`;
}
function getCoordinationPrompt(trade, text) {
  return `Analyze coordination requirements for ${trade} work.

TEXT:
${text.substring(0, 30000)}

Extract:
- Work sequence (what comes before/after)
- Interface details (connections, attachments)
- Material compatibility
- Schedule coordination

Format as markdown.`;
}
function getChangeOrderPrompt(trade, text) {
  return `Identify legitimate change order opportunities in ${trade} specifications.

TEXT:
${text.substring(0, 30000)}

Find:
1. Ambiguous requirements
2. Missing information
3. Conflicting requirements
4. Scope gaps

For each: Issue, Impact, Strategy to clarify

Use ethically for fair scope clarification only.

Format as markdown.`;
}
