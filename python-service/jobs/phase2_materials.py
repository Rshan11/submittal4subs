"""
Phase 2: AI-powered materials and requirements analysis
Uses Gemini 2.0 Flash to extract structured data from Division text
"""
import json
import os
from typing import Dict, List
import google.generativeai as genai
from db.supabase import SupabaseClient

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

async def run_phase2(job_id: str):
    """
    Phase 2: Analyze extracted text for materials, specs, coordination
    """
    # Get Phase 1 extraction results
    phase1_data = await get_phase1_extraction(job_id)
    
    if not phase1_data:
        raise ValueError(f"No Phase 1 data found for job {job_id}")
    
    extracted_data = phase1_data.get("extracted_data", {})
    extracted_text = extracted_data.get("extracted_text", "")
    trade_type = extracted_data.get("trade_type", "")
    
    if not extracted_text:
        raise ValueError(f"No extracted text found in Phase 1 data for job {job_id}")
    
    # Prepare AI prompt
    prompt = f"""
You are analyzing construction specifications for {trade_type} work.

Extract the following information in JSON format:

1. MATERIALS: List all materials, products, and standards mentioned
   - Material name
   - Specifications/standards (ASTM, etc.)
   - Manufacturer requirements
   - Performance requirements

2. SUBMITTALS: What needs to be submitted before work
   - Shop drawings
   - Product data
   - Samples
   - Test reports

3. COORDINATION: Other trades mentioned that require coordination
   - Trade name
   - What needs coordinating
   - Timing requirements

4. CONTRACT TERMS: Business/administrative requirements
   - Payment terms
   - Insurance requirements
   - Bonding requirements
   - Warranty terms

SPECIFICATION TEXT:
{extracted_text[:8000]}

Return ONLY valid JSON in this exact format:
{{
  "materials": [
    {{"name": "...", "standard": "...", "requirement": "..."}}
  ],
  "submittals": [
    {{"type": "...", "description": "...", "timing": "..."}}
  ],
  "coordination": [
    {{"trade": "...", "item": "...", "timing": "..."}}
  ],
  "contract_terms": [
    {{"category": "...", "requirement": "..."}}
  ]
}}
"""
    
    # Call Gemini
    model = genai.GenerativeModel("gemini-2.0-flash-exp")
    response = model.generate_content(prompt)
    
    # Parse response - handle markdown code blocks
    response_text = response.text.strip()
    
    # Remove markdown code blocks if present
    if response_text.startswith("```json"):
        response_text = response_text[7:]  # Remove ```json
    elif response_text.startswith("```"):
        response_text = response_text[3:]  # Remove ```
    
    if response_text.endswith("```"):
        response_text = response_text[:-3]  # Remove trailing ```
    
    response_text = response_text.strip()
    
    # Parse JSON
    try:
        analysis = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse Gemini response as JSON: {e}")
        print(f"Response text: {response_text[:500]}")
        raise ValueError(f"Gemini returned invalid JSON: {str(e)}")
    
    # Store in database
    await store_phase2_results(job_id, analysis)
    
    return analysis

async def get_phase1_extraction(job_id: str):
    """Get Phase 1 extraction from database"""
    supabase = SupabaseClient()
    client = supabase.get_client()
    
    result = client.table("phase1_extractions").select("*").eq("job_id", job_id).execute()
    
    if not result.data or len(result.data) == 0:
        return None
    
    return result.data[0]

async def store_phase2_results(job_id: str, analysis: Dict):
    """Store Phase 2 analysis in database"""
    supabase = SupabaseClient()
    client = supabase.get_client()
    
    client.table("phase2_materials").insert({
        "job_id": job_id,
        "materials": analysis.get("materials", []),
        "submittals": analysis.get("submittals", []),
        "coordination": analysis.get("coordination", []),
        "contract_terms": analysis.get("contract_terms", [])
    }).execute()
    
    print(f"✅ Phase 2 analysis stored for job {job_id}")
