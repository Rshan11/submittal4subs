import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// TILE-BASED SPEC ANALYSIS
// ═══════════════════════════════════════════════════════════════
//
// Strategy:
// 1. Get PDF tiles from Python service (dumb extraction)
// 2. Scan each tile with Gemini: "Is Division X here?"
// 3. Stitch matching tiles together
// 4. ONE final Gemini analysis on clean division text
//
// Cost: ~$0.001-0.004 per tile scan + ~$0.01-0.05 final analysis
// Much cheaper than sending 500K chars in one call
// ═══════════════════════════════════════════════════════════════

const PYTHON_SERVICE_URL = Deno.env.get("PYTHON_SERVICE_URL");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

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

console.log("[BOOT] Tile-based Spec Analyzer v3.0");
console.log("[BOOT] PYTHON_SERVICE:", PYTHON_SERVICE_URL ? "✓" : "✗");
console.log("[BOOT] GEMINI:", GEMINI_API_KEY ? "✓" : "✗");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { filePath, trade, jobId, projectName } = await req.json();

    if (!filePath) return jsonResp({ error: "Missing filePath" }, 400);
    if (!trade) return jsonResp({ error: "Missing trade" }, 400);
    if (!PYTHON_SERVICE_URL) return jsonResp({ error: "PYTHON_SERVICE_URL not configured" }, 500);
    if (!GEMINI_API_KEY) return jsonResp({ error: "GEMINI_API_KEY not configured" }, 500);

    const tradeConfig = DIVISION_PATTERNS[trade.toLowerCase()];
    if (!tradeConfig) {
      return jsonResp({ error: `Unknown trade: ${trade}. Supported: ${Object.keys(DIVISION_PATTERNS).join(", ")}` }, 400);
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`PROJECT: ${projectName || "Unnamed"}`);
    console.log(`TRADE: ${trade} (Division ${tradeConfig.division})`);
    console.log(`FILE: ${filePath}`);
    console.log(`${"═".repeat(50)}\n`);

    // Step 1: Download PDF from Supabase Storage
    console.log("[STEP 1] Downloading PDF from storage...");
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from("specifications")
      .download(filePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download PDF: ${downloadError?.message}`);
    }
    console.log(`[STEP 1] ✓ Downloaded ${(fileData.size / 1024).toFixed(1)} KB`);

    // Step 2: Send to Python service for tiling
    console.log("[STEP 2] Extracting and tiling PDF...");
    const formData = new FormData();
    formData.append("file", fileData, filePath.split("/").pop() || "spec.pdf");

    const tilesResponse = await fetch(`${PYTHON_SERVICE_URL}/extract-tiles`, {
      method: "POST",
      body: formData
    });

    if (!tilesResponse.ok) {
      const errText = await tilesResponse.text();
      throw new Error(`Python service error: ${tilesResponse.status} - ${errText}`);
    }

    const tilesData = await tilesResponse.json();
    console.log(`[STEP 2] ✓ ${tilesData.tile_count} tiles from ${tilesData.total_pages} pages (${tilesData.total_chars.toLocaleString()} chars)`);

    // Step 3: Scan tiles for target division (parallel, batched)
    console.log(`[STEP 3] Scanning tiles for Division ${tradeConfig.division}...`);
    const matchingTiles = await scanTilesForDivision(tilesData.tiles, tradeConfig, trade);
    console.log(`[STEP 3] ✓ Found ${matchingTiles.length} tiles containing Division ${tradeConfig.division}`);

    if (matchingTiles.length === 0) {
      return jsonResp({
        success: false,
        error: `No Division ${tradeConfig.division} (${trade}) content found in specification`,
        metadata: {
          tilesScanned: tilesData.tile_count,
          totalPages: tilesData.total_pages
        }
      }, 404);
    }

    // Step 4: Stitch matching tiles
    console.log("[STEP 4] Stitching matching tiles...");
    const divisionText = stitchTiles(matchingTiles);
    console.log(`[STEP 4] ✓ Stitched ${divisionText.length.toLocaleString()} chars of Division ${tradeConfig.division} content`);

    // Step 5: Final analysis with Gemini
    console.log("[STEP 5] Analyzing division content with Gemini...");
    const analysis = await analyzeDivisionContent(divisionText, trade, tradeConfig.division, projectName);
    console.log("[STEP 5] ✓ Analysis complete");

    // Step 6: Save results if jobId provided
    if (jobId) {
      console.log("[STEP 6] Saving results to database...");
      await saveResults(supabase, jobId, analysis, {
        tilesScanned: tilesData.tile_count,
        tilesMatched: matchingTiles.length,
        totalPages: tilesData.total_pages,
        divisionChars: divisionText.length
      });
      console.log("[STEP 6] ✓ Results saved");
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
        tilesScanned: tilesData.tile_count,
        tilesMatched: matchingTiles.length,
        totalPages: tilesData.total_pages,
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

async function scanTilesForDivision(
  tiles: Array<{ index: number; start: number; end: number; text: string }>,
  tradeConfig: { division: string; keywords: string[] },
  trade: string
): Promise<Array<{ index: number; start: number; end: number; text: string; divisionStart?: number; divisionEnd?: number }>> {

  const BATCH_SIZE = 5; // Process 5 tiles concurrently
  const matchingTiles: Array<{ index: number; start: number; end: number; text: string; divisionStart?: number; divisionEnd?: number }> = [];

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
  }

  // Sort by index to maintain order
  matchingTiles.sort((a, b) => a.index - b.index);
  return matchingTiles;
}

async function scanSingleTile(
  tile: { index: number; start: number; end: number; text: string },
  tradeConfig: { division: string; keywords: string[] },
  trade: string
): Promise<{ hasContent: boolean; tile: typeof tile & { divisionStart?: number; divisionEnd?: number } }> {

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

function stitchTiles(
  tiles: Array<{ index: number; start: number; end: number; text: string; divisionStart?: number; divisionEnd?: number }>
): string {
  if (tiles.length === 0) return "";
  if (tiles.length === 1) return tiles[0].text;

  // For consecutive tiles, we need to handle overlap
  // The overlap region exists in both tiles, so we skip it in the second tile

  const OVERLAP = 5000; // Must match Python service
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

  // Limit text size for final analysis (Gemini can handle ~1M tokens but let's be reasonable)
  const maxChars = 200000;
  const textToAnalyze = divisionText.length > maxChars
    ? divisionText.substring(0, maxChars) + "\n\n[TRUNCATED - additional content not shown]"
    : divisionText;

  const prompt = `You are a ${trade} contractor analyzing Division ${division} specifications for bidding.

PROJECT: ${projectName || "Construction Project"}

SPECIFICATION TEXT:
${textToAnalyze}

Extract ALL relevant information for bidding. Return ONLY valid JSON:

{
  "materials": [
    {
      "category": "Category name (e.g., Masonry Units, Mortar, Accessories)",
      "items": [
        {
          "name": "Material name",
          "specification": "Full spec (ASTM, size, type, grade, etc.)",
          "manufacturer": "If specified, or null",
          "notes": "Any special requirements"
        }
      ]
    }
  ],
  "submittals": [
    {
      "type": "Product Data / Shop Drawings / Samples / Test Reports / etc.",
      "description": "What must be submitted",
      "timing": "Before/during/after installation",
      "copies": "Number if specified"
    }
  ],
  "execution": [
    {
      "activity": "Installation/preparation activity",
      "requirements": ["Specific requirements"],
      "quality_standards": "Tolerances, standards to meet"
    }
  ],
  "quality_assurance": [
    {
      "requirement": "QA/QC requirement",
      "standard": "ASTM, code reference",
      "documentation": "What records needed"
    }
  ],
  "coordination": [
    {
      "with_trade": "Other trade/division",
      "item": "What needs coordination",
      "responsibility": "Who does what"
    }
  ],
  "exclusions": [
    {
      "item": "Work excluded or by others",
      "responsible_party": "Who is responsible"
    }
  ],
  "alternates": [
    {
      "number": "Alt number if given",
      "description": "What the alternate is",
      "impact": "Add/deduct/substitution"
    }
  ],
  "summary": {
    "scope_overview": "2-3 sentence scope summary",
    "key_materials": ["Top 3-5 major materials"],
    "critical_requirements": ["Most important requirements to note"],
    "estimated_complexity": "LOW/MEDIUM/HIGH",
    "bid_considerations": ["Key things to consider when bidding"]
  }
}`;

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

  return parseJSON(resultText);
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
