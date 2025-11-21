import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PYTHON_SERVICE_URL = Deno.env.get("PYTHON_SERVICE_URL")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get form data
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const specId = formData.get("spec_id") as string;
    const trade = formData.get("trade") as string || "masonry";

    if (!file || !specId) {
      return new Response(
        JSON.stringify({ error: "Missing file or spec_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[INFO] Analyzing spec ${specId} for trade: ${trade}`);

    // Forward to Python service
    const pythonFormData = new FormData();
    pythonFormData.append("file", file);
    pythonFormData.append("trade", trade);

    const response = await fetch(`${PYTHON_SERVICE_URL}/analyze`, {
      method: "POST",
      body: pythonFormData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Python service error: ${error}`);
    }

    const analysis = await response.json();

    // Store results in database
    const { error: updateError } = await supabase
      .from("specifications")
      .update({
        analysis_results: analysis,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", specId);

    if (updateError) throw updateError;

    console.log(`[SUCCESS] Analysis complete for spec ${specId}`);

    return new Response(
      JSON.stringify({ success: true, analysis }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[ERROR]", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
