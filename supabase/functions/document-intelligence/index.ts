import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

console.log("[BOOT] Document Intelligence Service");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileHash, filePath } = await req.json();
    
    if (!fileHash || !filePath) {
      return jsonResp({ error: "Missing fileHash or filePath" }, 400);
    }

    console.log(`[DOC-INTEL] Analyzing ${fileHash}...`);
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Download PDF from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('specifications')
      .download(filePath);

    if (downloadError || !fileData) {
      console.error("[ERROR] Failed to download PDF:", downloadError);
      throw new Error("Failed to download PDF from storage");
    }

    console.log("[DOC-INTEL] PDF downloaded, analyzing structure...");

    // TODO: Implement actual PDF analysis
    // For now, return a basic structure that indicates no TOC was found
    // This will trigger the keyword_search fallback in analyze-spec-python
    
    const divisionMap = {
      has_toc: false,
      detected: false,
      message: "PDF analysis not yet fully implemented - use keyword fallback"
    };

    // Cache the result
    const { error: cacheError } = await supabase
      .from("document_indexes")
      .upsert({
        file_hash: fileHash,
        division_map: divisionMap,
        has_toc: false,
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString()
      });

    if (cacheError) {
      console.warn("[WARN] Failed to cache division map:", cacheError.message);
    } else {
      console.log("[DOC-INTEL] ✓ Cached result for future use");
    }

    return jsonResp({
      success: true,
      division_map: divisionMap,
      cached: !cacheError
    }, 200);

  } catch (err) {
    console.error("[ERROR]", err);
    return jsonResp({
      error: err instanceof Error ? err.message : "Document intelligence failed"
    }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
