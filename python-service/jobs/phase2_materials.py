"""
Phase 2: Materials Extraction (Gemini 2.5 Pro)
- Take cleaned text from Phase 1
- Extract materials, manufacturers, specifications
- Store in spec_materials table
"""
from typing import Dict

async def run_phase2(job_id: str) -> Dict:
    """
    Phase 2: Extract materials using Gemini 2.5 Pro
    
    TODO: Implement
    - Load Phase 1 extracted text
    - Batch prompts to Gemini
    - Parse material responses
    - Store in spec_materials table
    """
    return {"status": "not_implemented", "job_id": job_id}
