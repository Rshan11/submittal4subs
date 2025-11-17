import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "Missing jobId parameter" }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json" 
          } 
        }
      );
    }

    console.log(`Fetching job status for jobId: ${jobId}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get job details
    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, status, result, created_at, updated_at, trade_type")
      .eq("id", jobId)
      .single();

    if (error) {
      console.error("Error fetching job:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 500, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json" 
          } 
        }
      );
    }

    if (!job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { 
          status: 404, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json" 
          } 
        }
      );
    }

    console.log(`Job status: ${job.status}`);

    return new Response(
      JSON.stringify(job),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json" 
        } 
      }
    );

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json" 
        } 
      }
    );
  }
});
