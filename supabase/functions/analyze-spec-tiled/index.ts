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
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Division keywords for different trades
const DIVISION_PATTERNS: Record<
  string,
  { division: string; keywords: string[] }
> = {
  masonry: {
    division: "04",
    keywords: [
      "DIVISION 04",
      "DIVISION 4",
      "04 ",
      "MASONRY",
      "UNIT MASONRY",
      "BRICK",
      "CMU",
      "CONCRETE MASONRY",
    ],
  },
  concrete: {
    division: "03",
    keywords: [
      "DIVISION 03",
      "DIVISION 3",
      "03 ",
      "CONCRETE",
      "CAST-IN-PLACE",
      "FORMWORK",
    ],
  },
  steel: {
    division: "05",
    keywords: [
      "DIVISION 05",
      "DIVISION 5",
      "05 ",
      "STRUCTURAL STEEL",
      "METAL FABRICATIONS",
    ],
  },
  electrical: {
    division: "26",
    keywords: ["DIVISION 26", "26 ", "ELECTRICAL", "WIRING", "CONDUCTORS"],
  },
  plumbing: {
    division: "22",
    keywords: ["DIVISION 22", "22 ", "PLUMBING", "PIPING", "FIXTURES"],
  },
  mechanical: {
    division: "23",
    keywords: ["DIVISION 23", "23 ", "HVAC", "MECHANICAL", "DUCTWORK"],
  },
};

console.log("[BOOT] Tile-based Spec Analyzer v5.1 (Parallel API calls)");
console.log("[BOOT] GEMINI:", GEMINI_API_KEY ? "✓" : "✗");
console.log("[BOOT] OPENAI:", OPENAI_API_KEY ? "✓" : "✗");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      tiles,
      div01Tiles,
      trade,
      jobId,
      projectName,
      totalPages,
      totalChars,
      preFiltered,
    } = body;

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
      return jsonResp(
        {
          error: `Unknown trade: ${trade}. Supported: ${Object.keys(DIVISION_PATTERNS).join(", ")}`,
        },
        400,
      );
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`PROJECT: ${projectName || "Unnamed"}`);
    console.log(`TRADE: ${trade} (Division ${tradeConfig.division})`);
    console.log(
      `TILES: ${tiles.length} (${totalChars?.toLocaleString() || "?"} chars from ${totalPages || "?"} pages)`,
    );
    console.log(
      `MODE: ${preFiltered ? "FAST (pre-filtered, skip scanning)" : "FULL (Gemini scanning)"}`,
    );
    console.log(`${"═".repeat(50)}\n`);

    let matchingTiles: MatchedTile[];

    // FAST MODE: Skip Gemini scanning if tiles are already pre-filtered by client
    // This reduces processing from ~3 minutes to ~20 seconds for large documents
    if (preFiltered) {
      console.log(
        `[STEP 1] FAST MODE: Using all ${tiles.length} pre-filtered tiles (skipping Gemini scan)`,
      );
      matchingTiles = tiles.map((t) => ({ ...t }) as MatchedTile);
      console.log(`[STEP 1] ✓ Using ${matchingTiles.length} tiles`);
    } else {
      // FULL MODE: Scan tiles for target division (parallel, batched)
      console.log(
        `[STEP 1] Scanning ${tiles.length} tiles for Division ${tradeConfig.division}...`,
      );
      matchingTiles = await scanTilesForDivision(tiles, tradeConfig, trade);
      console.log(
        `[STEP 1] ✓ Found ${matchingTiles.length} tiles containing Division ${tradeConfig.division}`,
      );
    }

    if (matchingTiles.length === 0) {
      return jsonResp(
        {
          success: false,
          error: `No Division ${tradeConfig.division} (${trade}) content found in specification`,
          metadata: {
            tilesScanned: tiles.length,
            totalPages: totalPages,
          },
        },
        404,
      );
    }

    // Step 2: Stitch matching tiles
    console.log("[STEP 2] Stitching matching tiles...");
    const divisionText = stitchTiles(matchingTiles);
    console.log(
      `[STEP 2] ✓ Stitched ${divisionText.length.toLocaleString()} chars of Division ${tradeConfig.division} content`,
    );

    // Step 3 & 4: Run trade analysis and contract analysis IN PARALLEL
    // This reduces total time from ~60s to ~30s, avoiding Edge Function timeout
    console.log("[STEP 3-4] Starting parallel analysis...");

    const analysisPromises: Promise<Record<string, unknown>>[] = [];

    // Always analyze trade division
    console.log("[STEP 3] Starting trade analysis with Gemini...");
    analysisPromises.push(
      analyzeDivisionContent(
        divisionText,
        trade,
        tradeConfig.division,
        projectName,
      ),
    );

    // Prepare contract analysis if div01Tiles provided
    let div01Text = "";
    if (div01Tiles && Array.isArray(div01Tiles) && div01Tiles.length > 0) {
      console.log(
        `[STEP 4] Starting contract analysis (${div01Tiles.length} Div 00-01 tiles)...`,
      );
      div01Text = stitchTiles(div01Tiles as MatchedTile[]);
      console.log(
        `[STEP 4] Stitched ${div01Text.length.toLocaleString()} chars of Div 00-01 content`,
      );
      analysisPromises.push(analyzeContractTerms(div01Text, projectName));
    }

    // Wait for both analyses to complete in parallel
    const results = await Promise.all(analysisPromises);
    const tradeAnalysis = results[0];
    const contractAnalysis = results.length > 1 ? results[1] : null;

    console.log("[STEP 3] ✓ Trade analysis complete");
    if (contractAnalysis) {
      console.log("[STEP 4] ✓ Contract analysis complete");
    }

    // Step 5: Final summary with OpenAI (combines trade + contract)
    // Skip if timing is tight - this is optional
    let finalSummary = null;
    const elapsedMs = Date.now() - startTime;
    if (OPENAI_API_KEY && contractAnalysis && elapsedMs < 45000) {
      console.log("[STEP 5] Creating final summary with OpenAI...");
      finalSummary = await createFinalSummary(
        tradeAnalysis.summary as string,
        contractAnalysis.summary as string,
        trade,
        projectName,
      );
      console.log("[STEP 5] ✓ Final summary complete");
    } else if (elapsedMs >= 45000) {
      console.log("[STEP 5] Skipping OpenAI summary - low on time");
    }

    // Combine all analysis results
    const analysis = {
      ...tradeAnalysis,
      contractTerms: contractAnalysis,
      finalSummary: finalSummary,
    };

    // Step 6: Save results if jobId provided
    if (jobId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      console.log("[STEP 4] Saving results to database...");
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await saveResults(supabase, jobId, analysis, {
        tilesScanned: tiles.length,
        tilesMatched: matchingTiles.length,
        totalPages: totalPages,
        divisionChars: divisionText.length,
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
        divisionChars: divisionText.length,
      },
    });
  } catch (err) {
    console.error("[ERROR]", err);
    return jsonResp(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal error",
        processingTimeMs: Date.now() - startTime,
      },
      500,
    );
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
  trade: string,
): Promise<MatchedTile[]> {
  const BATCH_SIZE = 2; // Process 2 tiles concurrently
  const BATCH_DELAY_MS = 10000; // Wait 10 seconds between batches (~12 req/min, under 15 limit)
  const matchingTiles: MatchedTile[] = [];

  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    const batch = tiles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(tiles.length / BATCH_SIZE);

    console.log(
      `[SCAN] Batch ${batchNum}/${totalBatches} (tiles ${i + 1}-${Math.min(i + BATCH_SIZE, tiles.length)})`,
    );

    const batchResults = await Promise.all(
      batch.map((tile) => scanSingleTile(tile, tradeConfig, trade)),
    );

    for (const result of batchResults) {
      if (result.hasContent) {
        matchingTiles.push(result.tile);
      }
    }

    // Rate limit: wait between batches (except for the last one)
    if (i + BATCH_SIZE < tiles.length) {
      console.log(`[SCAN] Waiting ${BATCH_DELAY_MS / 1000}s for rate limit...`);
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Sort by index to maintain order
  matchingTiles.sort((a, b) => a.index - b.index);
  return matchingTiles;
}

async function scanSingleTile(
  tile: Tile,
  tradeConfig: { division: string; keywords: string[] },
  trade: string,
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
          maxOutputTokens: 500,
        },
      }),
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
      console.log(
        `[SCAN] ✓ Tile ${tile.index}: Found ${result.section_numbers_found?.join(", ") || "division content"}`,
      );
      return {
        hasContent: true,
        tile: {
          ...tile,
          divisionStart: result.approximate_start_position,
          divisionEnd: result.approximate_end_position,
        },
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
  projectName?: string,
): Promise<Record<string, unknown>> {
  // Limit text size for final analysis
  const maxChars = 200000;
  const textToAnalyze =
    divisionText.length > maxChars
      ? divisionText.substring(0, maxChars) +
        "\n\n[TRUNCATED - additional content not shown]"
      : divisionText;

  const tradeName = trade.charAt(0).toUpperCase() + trade.slice(1);

  const prompt = `Extract ${trade} specs for bidding. Be EXHAUSTIVE on products/manufacturers but CONCISE on format.

PROJECT: ${projectName || "Construction Project"}

SPEC TEXT:
${textToAnalyze}

OUTPUT FORMAT:

## 🎯 CRITICAL BID ITEMS

**Basis of Design Products** (price these or submit substitution):
| Product | Manufacturer | Model/Series | Or Equal? |
|---------|--------------|--------------|-----------|
(ONLY items with a named manufacturer. "Or Equal?" = Yes if spec allows substitutes, No if sole source)

**Color & Finish Selections**:
- (Material): "(Color)" — Manufacturer: (name)
(Example: CMU Split Face: "Burnt Orange" — Mutual Materials, Westblock)

**Premium/Cost Adders**:
- (Item): (what makes it premium)

---

## 1. Primary Materials
(Put the MAIN material for this trade FIRST: CMU for masonry, panels for electrical, pipe for plumbing)

| Material | Manufacturer(s) | Standard | Size/Type | Color/Finish |
|----------|-----------------|----------|-----------|--------------|

---

## 2. Accessories & Components

| Item | Manufacturer | Spec | Size | Material |
|------|--------------|------|------|----------|

---

## 3. Submittals Required
- [ ] (type): (description)

---

## 4. Coordination

| Item | Section | Provides | Installs |
|------|---------|----------|----------|

---

## 5. Execution

**Testing/QC**: (requirements)
**Environmental**: (temp limits, curing)
**Prohibited**: (what's not allowed)

---

RULES:
1. "Basis of Design" = ONLY items with a NAMED manufacturer in the spec
2. ALWAYS include manufacturer name with colors/finishes
3. Each item appears ONCE in its best location
4. Be EXHAUSTIVE extracting products — don't summarize, list each one
5. Be CONCISE on formatting — bullets not paragraphs
6. Skip empty sections`;

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 16000,
      },
    }),
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
    division: division,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT TERMS ANALYSIS (Division 00-01)
// ═══════════════════════════════════════════════════════════════

async function analyzeContractTerms(
  div01Text: string,
  projectName?: string,
): Promise<Record<string, unknown>> {
  // Limit text size
  const maxChars = 150000;
  const textToAnalyze =
    div01Text.length > maxChars
      ? div01Text.substring(0, maxChars) + "\n\n[TRUNCATED]"
      : div01Text;

  const prompt = `You are a construction contract analyst reviewing Division 00 (Procurement) and Division 01 (General Requirements) specifications.

PROJECT: ${projectName || "Construction Project"}

SPECIFICATION TEXT:
${textToAnalyze}

Extract and summarize the following CONTRACT and BUSINESS terms in a CONDENSED format for contractors:

## 📋 Contract Terms Summary

### 💰 Payment Terms
- Payment schedule/frequency
- Retainage percentage
- Payment conditions

### 🏛️ Bonding & Insurance
- Bond requirements (bid, performance, payment)
- Insurance requirements and limits
- Certificate requirements

### 📝 Change Orders
- Change order process
- Pricing requirements
- Time limits for claims

### ✅ Submittals & Approvals
- Submittal requirements
- Review timelines
- Approval process

### 🔒 Security & Access
- Background check requirements
- Badge/ID requirements
- Site access restrictions
- Working hours

### ⚠️ Liquidated Damages
- Daily rate if specified
- Milestone penalties

### 📅 Schedule Requirements
- Substantial completion requirements
- Milestone dates
- Float ownership

### 🛡️ Warranty
- Warranty periods
- Special warranty requirements

### 🚨 Key Risk Items
- Unusual or onerous terms
- Items requiring special attention
- Cost impact warnings

RULES:
1. Be CONCISE - use bullet points
2. BOLD key numbers, dates, and percentages
3. Skip sections if not found in spec
4. Flag anything unusual or risky with ⚠️
5. Include specific dollar amounts, percentages, and timeframes`;

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8000,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("[CONTRACT] Gemini error:", errText);
    return { summary: "Contract analysis failed", error: errText };
  }

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  return {
    summary: resultText || "No contract terms found",
    format: "markdown",
  };
}

// ═══════════════════════════════════════════════════════════════
// OPENAI FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════

async function createFinalSummary(
  tradeSummary: string,
  contractSummary: string,
  trade: string,
  projectName?: string,
): Promise<string> {
  const prompt = `Create ${trade} bid summary for ${projectName || "project"}.

=== TRADE SPECS ===
${tradeSummary}

=== CONTRACT TERMS ===
${contractSummary}

OUTPUT:

## 🎯 Executive Bid Summary

### 💰 Pricing Impact
(3-5 bullets. INCLUDE manufacturer names. Example: "CMU — Mutual Materials/Westblock basis of design, Burnt Orange split face — verify pricing")

### ⚠️ Risks
(2-3 bullets: unusual requirements, tight timelines, scope gaps)

### ✅ Pre-Bid Actions
- [ ] Quotes needed: (list suppliers BY NAME)
- [ ] RFIs: (clarification topics)
- [ ] Coordinate: (other trades)

### 📝 Bid Notes
(1-2 sentences of strategy)

BE BRIEF. Don't repeat detailed specs — summarize what matters for bid day.`;

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a construction bidding expert creating concise, actionable bid summaries for contractors.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[OPENAI] Error:", errText);
      return "Executive summary generation failed";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "No summary generated";
  } catch (err) {
    console.error("[OPENAI] Exception:", err);
    return "Executive summary generation failed";
  }
}

// ═══════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════

async function saveResults(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  analysis: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      status: "completed",
      result: analysis,
      metadata: metadata,
      completed_at: new Date().toISOString(),
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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
