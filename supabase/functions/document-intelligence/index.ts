import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

interface DocumentMetadata {
  documentHash: string;
  fileName: string;
  totalPages: number;
  fileSize: number;
  uploadDate: string;
}

interface TOCEntry {
  sectionNumber: string;
  sectionTitle: string;
  pageNumber: number;
  division?: string;
}

interface DivisionMap {
  division: string;
  title: string;
  sections: Array<{
    number: string;
    title: string;
    pageRange: { start: number; end: number };
  }>;
}

interface DocumentIntelligence {
  hasTOC: boolean;
  tocEntries: TOCEntry[];
  divisionMap: DivisionMap[];
  documentStructure: 'standard' | 'non-standard' | 'unknown';
  confidence: number;
  extractionMethod: 'toc' | 'division-headers' | 'keyword-search';
}

interface CacheResult {
  documentHash: string;
  intelligence: DocumentIntelligence;
  cachedAt: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      pdfText,
      fileName,
      totalPages,
      fileSize,
      skipCache = false
    } = await req.json();

    if (!pdfText || !fileName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: pdfText and fileName" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[DOCUMENT-INTELLIGENCE] Processing: ${fileName} (${totalPages} pages, ${fileSize} bytes)`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate document hash for caching
    const documentHash = await generateHash(pdfText);
    console.log(`[CACHE] Document hash: ${documentHash}`);

    // Check cache unless explicitly skipped
    if (!skipCache) {
      const cached = await checkCache(supabase, documentHash);
      if (cached) {
        console.log(`[CACHE] ✓ Cache hit! Returning cached intelligence`);
        return new Response(
          JSON.stringify({
            ...cached.intelligence,
            cached: true,
            cachedAt: cached.cachedAt,
            documentHash: cached.documentHash
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`[CACHE] ✗ Cache miss. Performing analysis...`);
    }

    const startTime = Date.now();

    // PHASE 0: Document Intelligence
    const intelligence = await analyzeDocumentStructure(pdfText);

    console.log(`[INTELLIGENCE] Structure: ${intelligence.documentStructure}`);
    console.log(`[INTELLIGENCE] Method: ${intelligence.extractionMethod}`);
    console.log(`[INTELLIGENCE] Confidence: ${intelligence.confidence * 100}%`);
    console.log(`[INTELLIGENCE] TOC Entries: ${intelligence.tocEntries.length}`);
    console.log(`[INTELLIGENCE] Division Map: ${intelligence.divisionMap.length} divisions`);

    const processingTime = Date.now() - startTime;

    // Store in cache
    await storeInCache(supabase, {
      documentHash,
      fileName,
      totalPages,
      fileSize,
      uploadDate: new Date().toISOString()
    }, intelligence);

    console.log(`[COMPLETE] Analysis finished in ${processingTime}ms`);

    return new Response(
      JSON.stringify({
        ...intelligence,
        cached: false,
        documentHash,
        metadata: {
          fileName,
          totalPages,
          fileSize,
          processingTime
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
// DOCUMENT STRUCTURE ANALYSIS
// ============================================================================

async function analyzeDocumentStructure(pdfText: string): Promise<DocumentIntelligence> {
  console.log('[ANALYSIS] Starting document structure analysis...');

  // Step 1: Try to extract TOC
  const tocResult = extractTableOfContents(pdfText);

  if (tocResult.found && tocResult.entries.length > 0) {
    console.log(`[TOC] ✓ Found TOC with ${tocResult.entries.length} entries`);

    // Build division map from TOC
    const divisionMap = buildDivisionMapFromTOC(tocResult.entries);

    return {
      hasTOC: true,
      tocEntries: tocResult.entries,
      divisionMap,
      documentStructure: 'standard',
      confidence: tocResult.confidence,
      extractionMethod: 'toc'
    };
  }

  console.log('[TOC] ✗ No TOC found, trying division header detection...');

  // Step 2: Try division header detection
  const divisionResult = extractDivisionHeaders(pdfText);

  if (divisionResult.divisions.length > 0) {
    console.log(`[DIVISIONS] ✓ Found ${divisionResult.divisions.length} divisions`);

    return {
      hasTOC: false,
      tocEntries: [],
      divisionMap: divisionResult.divisions,
      documentStructure: 'standard',
      confidence: divisionResult.confidence,
      extractionMethod: 'division-headers'
    };
  }

  console.log('[DIVISIONS] ✗ No clear division structure found');

  // Step 3: Fallback to keyword-based structure detection
  const keywordResult = detectStructureByKeywords(pdfText);

  return {
    hasTOC: false,
    tocEntries: [],
    divisionMap: keywordResult.divisions,
    documentStructure: 'non-standard',
    confidence: keywordResult.confidence,
    extractionMethod: 'keyword-search'
  };
}

// ============================================================================
// TABLE OF CONTENTS EXTRACTION
// ============================================================================

function extractTableOfContents(pdfText: string): {
  found: boolean;
  entries: TOCEntry[];
  confidence: number
} {
  const tocPatterns = [
    /TABLE\s+OF\s+CONTENTS/i,
    /INDEX\s+OF\s+DRAWINGS/i,
    /SPECIFICATION\s+INDEX/i,
    /DIVISION\s+INDEX/i,
    /(?:^|\n)CONTENTS(?:\n|$)/i
  ];

  let tocStart = -1;
  let tocEnd = -1;

  // Find TOC start
  for (const pattern of tocPatterns) {
    const match = pattern.exec(pdfText);
    if (match) {
      tocStart = match.index;
      console.log(`[TOC] Found TOC marker at position ${tocStart}`);
      break;
    }
  }

  if (tocStart === -1) {
    return { found: false, entries: [], confidence: 0 };
  }

  // Find TOC end (look for common end markers or max length)
  const endMarkers = [
    /(?:^|\n)(?:DIVISION|SECTION|PART)\s+0*1[^\d]/im,
    /(?:^|\n)GENERAL\s+REQUIREMENTS/i,
    /(?:^|\n)END\s+OF\s+(?:TABLE|INDEX|CONTENTS)/i
  ];

  tocEnd = tocStart + 15000; // Default max TOC length

  for (const marker of endMarkers) {
    const match = marker.exec(pdfText.substring(tocStart));
    if (match && match.index < 15000) {
      tocEnd = tocStart + match.index;
      console.log(`[TOC] Found TOC end marker at position ${tocEnd}`);
      break;
    }
  }

  const tocText = pdfText.substring(tocStart, tocEnd);

  // Extract TOC entries
  const entries: TOCEntry[] = [];

  // Pattern 1: "SECTION 040100 - TITLE ... 45"
  const pattern1 = /(?:SECTION\s+)?(\d{6})\s*[-–—]?\s*([^\n.]{5,80}?)[\s.]*?(\d{1,4})(?:\s|$)/gi;
  let match;

  while ((match = pattern1.exec(tocText)) !== null) {
    const sectionNumber = match[1];
    const sectionTitle = match[2].trim();
    const pageNumber = parseInt(match[3]);

    if (pageNumber > 0 && pageNumber < 10000 && sectionTitle.length > 2) {
      entries.push({
        sectionNumber,
        sectionTitle,
        pageNumber,
        division: sectionNumber.substring(0, 2)
      });
    }
  }

  // Pattern 2: "04 01 00 - TITLE ... 45"
  const pattern2 = /(\d{2})\s+(\d{2})\s+(\d{2})\s*[-–—]?\s*([^\n.]{5,80}?)[\s.]*?(\d{1,4})(?:\s|$)/gi;

  while ((match = pattern2.exec(tocText)) !== null) {
    const sectionNumber = match[1] + match[2] + match[3];
    const sectionTitle = match[4].trim();
    const pageNumber = parseInt(match[5]);

    // Avoid duplicates
    if (pageNumber > 0 && pageNumber < 10000 &&
        !entries.some(e => e.sectionNumber === sectionNumber)) {
      entries.push({
        sectionNumber,
        sectionTitle,
        pageNumber,
        division: match[1]
      });
    }
  }

  // Calculate confidence based on entries found and their validity
  let confidence = 0;
  if (entries.length > 5) confidence = 0.9;
  else if (entries.length > 2) confidence = 0.7;
  else if (entries.length > 0) confidence = 0.5;

  console.log(`[TOC] Extracted ${entries.length} entries (confidence: ${confidence})`);

  return {
    found: entries.length > 0,
    entries: entries.sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber)),
    confidence
  };
}

// ============================================================================
// DIVISION HEADER EXTRACTION
// ============================================================================

function extractDivisionHeaders(pdfText: string): {
  divisions: DivisionMap[];
  confidence: number;
} {
  const divisions: DivisionMap[] = [];
  const divisionNumbers = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09',
                           '10', '11', '12', '13', '14', '21', '22', '23', '26', '31', '32', '33'];

  for (const divNum of divisionNumbers) {
    const divisionPattern = new RegExp(
      `(?:^|\\n)(?:DIVISION|DIV)\\.?\\s+0*${parseInt(divNum)}[^\\d]([^\\n]{0,100})`,
      'gi'
    );

    let match;
    const divisionSections: Array<{
      number: string;
      title: string;
      pageRange: { start: number; end: number };
    }> = [];

    while ((match = divisionPattern.exec(pdfText)) !== null) {
      const divisionTitle = match[1].trim();
      const startPos = match.index;

      // Find sections within this division
      const sectionPattern = new RegExp(
        `(?:SECTION|PART)\\s+(${divNum}\\d{4}|${divNum}\\s\\d{2}\\s\\d{2})\\s*[-–—]?\\s*([^\\n]{5,80})`,
        'gi'
      );

      const divisionText = pdfText.substring(startPos, startPos + 50000);
      let sectionMatch;

      while ((sectionMatch = sectionPattern.exec(divisionText)) !== null) {
        const sectionNumber = sectionMatch[1].replace(/\s/g, '');
        const sectionTitle = sectionMatch[2].trim();

        // Estimate page range (rough calculation)
        const pageMatch = /---\s*PAGE\s+(\d+)\s*---/gi.exec(
          divisionText.substring(Math.max(0, sectionMatch.index - 500), sectionMatch.index)
        );
        const startPage = pageMatch ? parseInt(pageMatch[1]) : 0;

        divisionSections.push({
          number: sectionNumber,
          title: sectionTitle,
          pageRange: { start: startPage, end: startPage + 20 } // Estimate
        });
      }

      if (divisionSections.length > 0) {
        divisions.push({
          division: divNum,
          title: divisionTitle || `Division ${divNum}`,
          sections: divisionSections
        });
        break; // Found this division, move to next
      }
    }
  }

  const confidence = divisions.length > 3 ? 0.85 : divisions.length > 0 ? 0.6 : 0;

  console.log(`[DIVISIONS] Found ${divisions.length} divisions (confidence: ${confidence})`);

  return { divisions, confidence };
}

// ============================================================================
// KEYWORD-BASED STRUCTURE DETECTION
// ============================================================================

function detectStructureByKeywords(pdfText: string): {
  divisions: DivisionMap[];
  confidence: number;
} {
  const keywordMap: Record<string, { keywords: string[]; title: string }> = {
    '00': { keywords: ['PROCUREMENT', 'BIDDING', 'CONTRACTING'], title: 'Procurement and Contracting' },
    '01': { keywords: ['GENERAL REQUIREMENTS', 'SUBMITTALS', 'QUALITY'], title: 'General Requirements' },
    '03': { keywords: ['CONCRETE', 'FORMWORK', 'REINFORCEMENT'], title: 'Concrete' },
    '04': { keywords: ['MASONRY', 'BRICK', 'BLOCK', 'CMU'], title: 'Masonry' },
    '05': { keywords: ['STRUCTURAL STEEL', 'METAL', 'JOISTS'], title: 'Metals' },
    '06': { keywords: ['WOOD', 'CARPENTRY', 'LUMBER'], title: 'Wood, Plastics, and Composites' },
    '07': { keywords: ['THERMAL', 'MOISTURE', 'WATERPROOFING', 'ROOFING'], title: 'Thermal and Moisture Protection' },
    '08': { keywords: ['DOORS', 'WINDOWS', 'GLAZING'], title: 'Openings' },
    '09': { keywords: ['FINISHES', 'DRYWALL', 'FLOORING', 'PAINT'], title: 'Finishes' },
    '22': { keywords: ['PLUMBING', 'PIPING', 'FIXTURES'], title: 'Plumbing' },
    '23': { keywords: ['HVAC', 'MECHANICAL', 'DUCTWORK'], title: 'HVAC' },
    '26': { keywords: ['ELECTRICAL', 'LIGHTING', 'POWER'], title: 'Electrical' },
    '31': { keywords: ['EARTHWORK', 'EXCAVATION', 'GRADING'], title: 'Earthwork' }
  };

  const divisions: DivisionMap[] = [];

  for (const [divNum, { keywords, title }] of Object.entries(keywordMap)) {
    let matchCount = 0;

    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      const matches = pdfText.match(regex);
      if (matches) {
        matchCount += matches.length;
      }
    }

    if (matchCount > 2) {
      divisions.push({
        division: divNum,
        title,
        sections: [{
          number: `${divNum}0000`,
          title: `${title} (detected by keywords)`,
          pageRange: { start: 0, end: 0 }
        }]
      });
    }
  }

  const confidence = divisions.length > 5 ? 0.5 : divisions.length > 2 ? 0.3 : 0.1;

  console.log(`[KEYWORDS] Detected ${divisions.length} divisions (confidence: ${confidence})`);

  return { divisions, confidence };
}

// ============================================================================
// DIVISION MAP BUILDER
// ============================================================================

function buildDivisionMapFromTOC(tocEntries: TOCEntry[]): DivisionMap[] {
  const divisionMap = new Map<string, DivisionMap>();

  for (const entry of tocEntries) {
    const division = entry.division || entry.sectionNumber.substring(0, 2);

    if (!divisionMap.has(division)) {
      divisionMap.set(division, {
        division,
        title: getDivisionTitle(division),
        sections: []
      });
    }

    const divMap = divisionMap.get(division)!;

    // Find if section already exists
    const existingSection = divMap.sections.find(s => s.number === entry.sectionNumber);

    if (!existingSection) {
      divMap.sections.push({
        number: entry.sectionNumber,
        title: entry.sectionTitle,
        pageRange: { start: entry.pageNumber, end: entry.pageNumber + 10 } // Estimate
      });
    }
  }

  return Array.from(divisionMap.values()).sort((a, b) =>
    a.division.localeCompare(b.division)
  );
}

function getDivisionTitle(divNum: string): string {
  const titles: Record<string, string> = {
    '00': 'Procurement and Contracting Requirements',
    '01': 'General Requirements',
    '02': 'Existing Conditions',
    '03': 'Concrete',
    '04': 'Masonry',
    '05': 'Metals',
    '06': 'Wood, Plastics, and Composites',
    '07': 'Thermal and Moisture Protection',
    '08': 'Openings',
    '09': 'Finishes',
    '10': 'Specialties',
    '11': 'Equipment',
    '12': 'Furnishings',
    '13': 'Special Construction',
    '14': 'Conveying Equipment',
    '21': 'Fire Suppression',
    '22': 'Plumbing',
    '23': 'HVAC',
    '26': 'Electrical',
    '31': 'Earthwork',
    '32': 'Exterior Improvements',
    '33': 'Utilities'
  };

  return titles[divNum] || `Division ${divNum}`;
}

// ============================================================================
// CACHING FUNCTIONS
// ============================================================================

async function generateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.substring(0, 10000)); // Hash first 10k chars for speed
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkCache(
  supabase: any,
  documentHash: string
): Promise<CacheResult | null> {
  try {
    const { data, error } = await supabase
      .from('document_intelligence_cache')
      .select('*')
      .eq('document_hash', documentHash)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      documentHash: data.document_hash,
      intelligence: data.intelligence_data,
      cachedAt: data.cached_at
    };
  } catch (err) {
    console.error('[CACHE] Error checking cache:', err);
    return null;
  }
}

async function storeInCache(
  supabase: any,
  metadata: DocumentMetadata,
  intelligence: DocumentIntelligence
): Promise<void> {
  try {
    const { error } = await supabase
      .from('document_intelligence_cache')
      .upsert({
        document_hash: metadata.documentHash,
        file_name: metadata.fileName,
        total_pages: metadata.totalPages,
        file_size: metadata.fileSize,
        intelligence_data: intelligence,
        cached_at: new Date().toISOString()
      });

    if (error) {
      console.error('[CACHE] Error storing in cache:', error);
    } else {
      console.log('[CACHE] ✓ Cached successfully');
    }
  } catch (err) {
    console.error('[CACHE] Error storing in cache:', err);
  }
}
