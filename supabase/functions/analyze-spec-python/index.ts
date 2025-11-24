import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PYTHON_SERVICE_URL = Deno.env.get("PYTHON_SERVICE_URL") || "https://submittal4subs.onrender.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
console.log("[BOOT] Spec Analyzer Python Orchestrator v1.0");
console.log("[BOOT] Python Service:", PYTHON_SERVICE_URL);
serve(async (req)=>{
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { fileHash, filePath, tradeType = "masonry", projectName, userId } = await req.json();
    if (!fileHash || !filePath) {
      return jsonResp({
        error: "Missing fileHash or filePath"
      }, 400);
    }
    console.log(`\n════════════════════════════════════════`);
    console.log(`PROJECT: ${projectName || "Unnamed"}`);
    console.log(`TRADE: ${tradeType}`);
    console.log(`FILE: ${fileHash}`);
    console.log(`════════════════════════════════════════\n`);
    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Check if we have a cached division map
    console.log("[PHASE 0] Checking for cached division map...");
    const { data: docIndex, error: indexError } = await supabase.from("document_indexes").select("division_map, has_toc").eq("file_hash", fileHash).single();
    let divisionMap = null;
    let extractionStrategy = "full_document"; // Default fallback
    
    if (docIndex && docIndex.division_map) {
      console.log("[PHASE 0] ✓ Found cached division map");
      divisionMap = docIndex.division_map;
      extractionStrategy = "division_targeted";
    } else {
      console.log("[PHASE 0] No cache found - calling document-intelligence...");
      
      try {
        // Call document-intelligence Edge Function
        const intelligenceResp = await fetch(
          `${SUPABASE_URL}/functions/v1/document-intelligence`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              fileHash,
              filePath
            })
          }
        );

        if (intelligenceResp.ok) {
          const intelligenceData = await intelligenceResp.json();
          divisionMap = intelligenceData.division_map;
          extractionStrategy = "division_targeted";
          console.log("[PHASE 0] ✓ Document intelligence completed");
        } else {
          console.log("[PHASE 0] ⚠ Document intelligence failed, will use keyword fallback");
          extractionStrategy = "keyword_search";
        }
      } catch (error) {
        console.log("[PHASE 0] ⚠ Document intelligence error, will use keyword fallback");
        extractionStrategy = "keyword_search";
      }
    }
    
    console.log(`[PHASE 0] Strategy: ${extractionStrategy}`);
    console.log(`[PHASE 0] Division map available: ${divisionMap ? 'Yes' : 'No'}`);
    
    // Create job record - SIMPLE VERSION FOR TESTING
    console.log("[JOB] Creating job record...");
    const { data: job, error: jobError } = await supabase.from("jobs").insert({
      file_hash: fileHash,
      file_path: filePath,
      trade_type: tradeType,
      job_name: "phase1_extract",
      status: "pending",
      user_id: userId,
      created_at: new Date().toISOString()
      // NO payload yet - test basic flow first
    }).select().single();
    if (jobError) {
      console.error("[ERROR] Failed to create job:", jobError);
      throw new Error(`Failed to create job: ${jobError.message}`);
    }
    console.log(`[JOB] ✓ Created job ${job.id}`);
    // Trigger Python service for Phase 1
    console.log("[PHASE 1] Triggering Python extraction service...");
    
    // Download the PDF from Supabase storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('specifications')
      .download(filePath);
    
    if (downloadError || !fileData) {
      console.error("[ERROR] Failed to download file:", downloadError);
      await supabase.from("jobs").update({
        status: "failed",
        result: { error: `Failed to download file: ${downloadError?.message}` }
      }).eq("id", job.id);
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }
    
    // Create FormData with the PDF file
    const formData = new FormData();
    formData.append('file', fileData, filePath.split('/').pop() || 'spec.pdf');
    formData.append('trade', tradeType);
    
    const pythonUrl = `${PYTHON_SERVICE_URL}/analyze`;
    const pythonResp = await fetch(pythonUrl, {
      method: "POST",
      body: formData
    });
    if (!pythonResp.ok) {
      const errorText = await pythonResp.text();
      console.error("[ERROR] Python service failed:", errorText);
      // Update job status to failed
      await supabase.from("jobs").update({
        status: "failed",
        result: {
          error: errorText
        }
      }).eq("id", job.id);
      throw new Error(`Python service failed: ${errorText}`);
    }
    const pythonResult = await pythonResp.json();
    console.log("[PHASE 1] ✓ Python service completed analysis");
    
    // Update job with results
    await supabase.from("jobs").update({
      status: "completed",
      result: pythonResult,
      completed_at: new Date().toISOString()
    }).eq("id", job.id);
    
    console.log(`\n════════════════════════════════════════`);
    console.log(`JOB COMPLETED: ${job.id}`);
    console.log(`STATUS: Success`);
    console.log(`════════════════════════════════════════\n`);
    
    return jsonResp({
      success: true,
      jobId: job.id,
      status: "completed",
      message: "Spec analysis completed successfully.",
      result: pythonResult
    }, 200);
  } catch (err) {
    console.error("[ERROR]", err);
    return jsonResp({
      error: err instanceof Error ? err.message : "Internal error"
    }, 500);
  }
});
function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
