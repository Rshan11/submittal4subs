import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// TILE-BASED SPEC ANALYSIS v4.0 - CLIENT-SIDE EXTRACTION
// ═══════════════════════════════════════════════════════════════
//
// New flow (no Python service needed!):
// 1. Client extracts PDF text with pdf.js (in browser)
// 2. Client tiles the text into 50K chunks
// 3. Client sends tiles to this Edge Function
// 4. We scan each tile with Gemini: "Is Division X here?"
// 5. Stitch matching tiles together
// 6. ONE final Gemini analysis on clean division text
//
// Benefits:
// - No server memory issues (browser does extraction)
// - No Render costs
// - Scales infinitely
// ═══════════════════════════════════════════════════════════════

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

// Division keywords for different trades
const DIVISION_PATTERNS: Record<string, { division: string; keywords: string[] }> = {
  masonry: {
    division: "04",
    keywords: ["DIVISION 04", "DIVISION 4", "04 ", "MASONRY", "UNIT MASONRY", "BRICK", "CMU", "CONCRETE MASONRY"]
  },
  concrete: {
    division: "03",
    keywords: ["DIVISION 03", "DIVISION 3", "03 ", "CONCRETE", "CAST-IN-PLACE", "FORMWORK"]
  },
  steel: {
    division: "05",
    keywords: ["DIVISION 05", "DIVISION 5", "05 ", "STRUCTURAL STEEL", "METAL FABRICATIONS"]
  },
  electrical: {
    division: "26",
    keywords: ["DIVISION 26", "26 ", "ELECTRICAL", "WIRING", "CONDUCTORS"]
  },
  plumbing: {
    division: "22",
    keywords: ["DIVISION 22", "22 ", "PLUMBING", "PIPING", "FIXTURES"]
  },
  mechanical: {
    division: "23",
    keywords: ["DIVISION 23", "23 ", "HVAC", "MECHANICAL", "DUCTWORK"]
  }
};

console.log("[BOOT] Tile-based Spec Analyzer v4.0 (Client-Side Extraction)");
console.log("[BOOT] GEMINI:", GEMINI_API_KEY ? "✓" : "✗");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { tiles, trade, jobId, projectName, totalPages, totalChars, preFiltered } = body;

    // Validate required fields
    if (!tiles || !Array.isArray(tiles) || tiles.length === 0) {
      return jsonResp({ error: "Missing or empty tiles array" }, 400);
    }
    if (!trade) {
      return jsonResp({ error: "Missing trade" }, 400);
    }
    if (!GEMINI_API_KEY) {
      return jsonResp({ error: "GEMINI_API_KEY not configured" }, 500);
    }

    const tradeConfig = DIVISION_PATTERNS[trade.toLowerCase()];
    if (!tradeConfig) {
      return jsonResp({
        error: `Unknown trade: ${trade}. Supported: ${Object.keys(DIVISION_PATTERNS).join(", ")}`
      }, 400);
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`PROJECT: ${projectName || "Unnamed"}`);
    console.log(`TRADE: ${trade} (Division ${tradeConfig.division})`);
    console.log(`TILES: ${tiles.length} (${totalChars?.toLocaleString() || "?"} chars from ${totalPages || "?"} pages)`);
    console.log(`MODE: ${preFiltered ? "FAST (pre-filtered, skip scanning)" : "FULL (Gemini scanning)"}`);
    console.log(`${"═".repeat(50)}\n`);

    let matchingTiles: MatchedTile[];

    // FAST MODE: Skip Gemini scanning if tiles are already pre-filtered by client
    // This reduces processing from ~3 minutes to ~20 seconds for large documents
    if (preFiltered) {
      console.log(`[STEP 1] FAST MODE: Using all ${tiles.length} pre-filtered tiles (skipping Gemini scan)`);
      matchingTiles = tiles.map(t => ({ ...t } as MatchedTile));
      console.log(`[STEP 1] ✓ Using ${matchingTiles.length} tiles`);
    } else {
      // FULL MODE: Scan tiles for target division (parallel, batched)
      console.log(`[STEP 1] Scanning ${tiles.length} tiles for Division ${tradeConfig.division}...`);
      matchingTiles = await scanTilesForDivision(tiles, tradeConfig, trade);
      console.log(`[STEP 1] ✓ Found ${matchingTiles.length} tiles containing Division ${tradeConfig.division}`);
    }

    if (matchingTiles.length === 0) {
      return jsonResp({
        success: false,
        error: `No Division ${tradeConfig.division} (${trade}) content found in specification`,
        metadata: {
          tilesScanned: tiles.length,
          totalPages: totalPages
        }
      }, 404);
    }

    // Step 2: Stitch matching tiles
    console.log("[STEP 2] Stitching matching tiles...");
    const divisionText = stitchTiles(matchingTiles);
    console.log(`[STEP 2] ✓ Stitched ${divisionText.length.toLocaleString()} chars of Division ${tradeConfig.division} content`);

    // Step 3: Final analysis with Gemini
    console.log("[STEP 3] Analyzing division content with Gemini...");
    const analysis = await analyzeDivisionContent(divisionText, trade, tradeConfig.division, projectName);
    console.log("[STEP 3] ✓ Analysis complete");

    // Step 4: Save results if jobId provided
    if (jobId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      console.log("[STEP 4] Saving results to database...");
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await saveResults(supabase, jobId, analysis, {
        tilesScanned: tiles.length,
        tilesMatched: matchingTiles.length,
        totalPages: totalPages,
        divisionChars: divisionText.length
      });
      console.log("[STEP 4] ✓ Results saved");
    }

    const processingTime = Date.now() - startTime;
    console.log(`\n${"═".repeat(50)}`);
    console.log(`COMPLETE: ${processingTime}ms`);
    console.log(`${"═".repeat(50)}\n`);

    return jsonResp({
      success: true,
      project: projectName,
      trade,
      division: tradeConfig.division,
      analysis,
      metadata: {
        processingTimeMs: processingTime,
        tilesScanned: tiles.length,
        tilesMatched: matchingTiles.length,
        totalPages: totalPages,
        totalChars: totalChars,
        divisionChars: divisionText.length
      }
    });

  } catch (err) {
    console.error("[ERROR]", err);
    return jsonResp({
      success: false,
      error: err instanceof Error ? err.message : "Internal error",
      processingTimeMs: Date.now() - startTime
    }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// TILE SCANNING
// ═══════════════════════════════════════════════════════════════

interface Tile {
  index: number;
  start: number;
  end: number;
  text: string;
  char_count?: number;
}

interface MatchedTile extends Tile {
  divisionStart?: number;
  divisionEnd?: number;
}

async function scanTilesForDivision(
  tiles: Tile[],
  tradeConfig: { division: string; keywords: string[] },
  trade: string
): Promise<MatchedTile[]> {

  const BATCH_SIZE = 2; // Process 2 tiles concurrently
  const BATCH_DELAY_MS = 10000; // Wait 10 seconds between batches (~12 req/min, under 15 limit)
  const matchingTiles: MatchedTile[] = [];

  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    const batch = tiles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tiles.length / BATCH_SIZE);

    console.log(`[SCAN] Batch ${batchNum}/${totalBatches} (tiles ${i + 1}-${Math.min(i + BATCH_SIZE, tiles.length)})`);

    const batchResults = await Promise.all(
      batch.map(tile => scanSingleTile(tile, tradeConfig, trade))
    );

    for (const result of batchResults) {
      if (result.hasContent) {
        matchingTiles.push(result.tile);
      }
    }

    // Rate limit: wait between batches (except for the last one)
    if (i + BATCH_SIZE < tiles.length) {
      console.log(`[SCAN] Waiting ${BATCH_DELAY_MS / 1000}s for rate limit...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Sort by index to maintain order
  matchingTiles.sort((a, b) => a.index - b.index);
  return matchingTiles;
}

async function scanSingleTile(
  tile: Tile,
  tradeConfig: { division: string; keywords: string[] },
  trade: string
): Promise<{ hasContent: boolean; tile: MatchedTile }> {

  const prompt = `You are scanning a construction specification document for Division ${tradeConfig.division} (${trade}) content.

TILE TEXT (${tile.text.length} characters):
${tile.text}

TASK: Does this tile contain ANY Division ${tradeConfig.division} (${trade}) specification content?

Look for:
- Section numbers like "${tradeConfig.division} 20 00", "${tradeConfig.division} 21 00", "${tradeConfig.division}2100"
- Headers like "DIVISION ${tradeConfig.division}", "SECTION ${tradeConfig.division}"
- Keywords: ${tradeConfig.keywords.join(", ")}

Return ONLY valid JSON:
{
  "has_division_content": true/false,
  "confidence": "HIGH/MEDIUM/LOW",
  "section_numbers_found": ["${tradeConfig.division} 21 00"],
  "approximate_start_position": 0,
  "approximate_end_position": ${tile.text.length}
}

If no Division ${tradeConfig.division} content, return:
{
  "has_division_content": false,
  "confidence": "HIGH",
  "section_numbers_found": [],
  "approximate_start_position": null,
  "approximate_end_position": null
}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500
        }
      })
    });

    if (!response.ok) {
      console.warn(`[SCAN] Tile ${tile.index} API error: ${response.status}`);
      return { hasContent: false, tile };
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultText) {
      return { hasContent: false, tile };
    }

    const result = parseJSON(resultText);

    if (result.has_division_content && result.confidence !== "LOW") {
      console.log(`[SCAN] ✓ Tile ${tile.index}: Found ${result.section_numbers_found?.join(", ") || "division content"}`);
      return {
        hasContent: true,
        tile: {
          ...tile,
          divisionStart: result.approximate_start_position,
          divisionEnd: result.approximate_end_position
        }
      };
    }

    return { hasContent: false, tile };

  } catch (err) {
    console.warn(`[SCAN] Tile ${tile.index} error:`, err);
    return { hasContent: false, tile };
  }
}

// ═══════════════════════════════════════════════════════════════
// TILE STITCHING
// ═══════════════════════════════════════════════════════════════

function stitchTiles(tiles: MatchedTile[]): string {
  if (tiles.length === 0) return "";
  if (tiles.length === 1) return tiles[0].text;

  // For consecutive tiles, we need to handle overlap
  // The overlap region exists in both tiles, so we skip it in the second tile

  const OVERLAP = 5000; // Must match client-side TILE_OVERLAP
  let result = tiles[0].text;

  for (let i = 1; i < tiles.length; i++) {
    const prevTile = tiles[i - 1];
    const currTile = tiles[i];

    // Check if tiles are consecutive
    if (currTile.index === prevTile.index + 1) {
      // Skip the overlap region in the current tile
      result += currTile.text.substring(OVERLAP);
    } else {
      // Non-consecutive tiles (gap in the document)
      result += "\n\n--- [GAP IN DOCUMENT] ---\n\n";
      result += currTile.text;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// FINAL ANALYSIS
// ═══════════════════════════════════════════════════════════════

async function analyzeDivisionContent(
  divisionText: string,
  trade: string,
  division: string,
  projectName?: string
): Promise<Record<string, unknown>> {

  // Limit text size for final analysis
  const maxChars = 200000;
  const textToAnalyze = divisionText.length > maxChars
    ? divisionText.substring(0, maxChars) + "\n\n[TRUNCATED - additional content not shown]"
    : divisionText;

  const tradeEmoji = trade === 'masonry' ? '🧱' : trade === 'concrete' ? '🏗️' : '🔧';
  const tradeName = trade.charAt(0).toUpperCase() + trade.slice(1);

  const prompt = `You are a ${trade} contractor analyzing Division ${division} specifications. Create a CONDENSED, ACTIONABLE summary for bidding and field use.

PROJECT: ${projectName || "Construction Project"}

SPECIFICATION TEXT:
${textToAnalyze}

Format your response EXACTLY like this example (use markdown):

${tradeEmoji} ${tradeName} Division Summary (Condensed Contractor Format)

## 1. Materials

### Masonry Units
- **Thin Brick** — ASTM C1088, Grade Exterior
- Provide all special shapes (no mitered corners; no saw-cut exposed faces)

### Mortar
- **Type M**, ASTM C270
- Follow BIA Tech Notes #8
- No cold-weather additives (no accelerators) allowed

### Flashing
**Metal Flashing Options:**
- Stainless Steel (ASTM A240, Type 304, 0.016")
- Copper (ASTM B370, 12–16 oz)
- Galvanized Steel (ASTM A653, 24 ga)

**Flexible Flashings:**
- Rubberized asphalt or elastomeric thermoplastic sheet
- Thickness 0.025"–0.040"

### Accessories
- **Weepholes/Vents**: 3/8" × 1/2" × 4"
- **Expansion Joints**: Neoprene filler (ASTM D1056), backer rod 25% wider than joint
- **Weather Barriers**: Minimum 15# felt (ASTM D226)

## 2. Execution Requirements

### Cold Weather (Below 40°F)
- Follow ACI 530.1 cold-weather procedures
- No antifreeze/salts in mortar
- Requires Purchaser approval

### Hot Weather (Above 100°F or 90°F with wind)
- Follow ACI 530.1 hot-weather procedures
- Wet surfaces before laying
- Fog spray 3× daily for first 3 days

### Mortar Joints
- **3/8" typical**
- Full bed and head joints
- Exposed: concave finish | Non-exposed: cut flush

### Quality Standards
- Tolerances per ACI 530.1
- Repoint all defective work
- Protect adjacent materials from overspray

## 3. Related Divisions & Coordination

### Referenced Sections (items spec'd elsewhere)
| Item | See Section | Who Provides | Who Installs |
|------|-------------|--------------|--------------|
| Through-wall flashing | 07 62 00 | Div 7 | Masonry |
| Joint sealants | 07 92 00 | Div 7 | Div 7 |
| Cavity insulation | 07 21 00 | Div 7 | Masonry |
| Steel lintels | 05 50 00 | Div 5 | Masonry |

### ⚠️ Scope Clarifications
- **BY MASONRY**: List items explicitly assigned to this trade
- **BY OTHERS**: List items to be provided/installed by other trades
- **COORDINATE WITH**: List items requiring coordination (embedded items, openings, etc.)

### 💰 Cost Impact Items
- Items that may affect your bid (special shapes, premium materials, sequencing requirements)

---

RULES:
1. Be CONCISE - use bullet points, not paragraphs
2. BOLD the key specs (ASTM numbers, dimensions, types)
3. Group related items under clear headers
4. Include ALL ASTM/standard references found
5. Note any special restrictions (no X allowed, requires approval, etc.)
6. Skip sections if not found in the spec (don't make up content)
7. Use em-dashes (—) to separate item names from specs
8. CRITICAL: Extract ALL cross-references to other divisions (Section XX XX XX, Division X, etc.)
9. Note WHO provides vs WHO installs for each referenced item`;

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 16000
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini analysis error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!resultText) {
    throw new Error("No response from Gemini analysis");
  }

  // Return markdown summary as the main result
  return {
    summary: resultText,
    format: "markdown",
    trade: trade,
    division: division
  };
}

// ═══════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════

async function saveResults(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  analysis: Record<string, unknown>,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      status: "completed",
      result: analysis,
      metadata: metadata,
      completed_at: new Date().toISOString()
    })
    .eq("id", jobId);

  if (error) {
    console.error("[DB] Failed to save results:", error);
    throw new Error(`Database error: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function parseJSON(text: string): Record<string, unknown> {
  let jsonText = text;

  // Remove markdown code blocks
  if (jsonText.includes("```")) {
    jsonText = jsonText.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  }

  // Find JSON object
  const match = jsonText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON found in response");
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    // Try cleaning up common issues
    const cleaned = match[0]
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    return JSON.parse(cleaned);
  }
}

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
