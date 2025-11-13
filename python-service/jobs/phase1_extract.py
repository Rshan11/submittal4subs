"""
Phase 1: Targeted Extraction
- Pull PDF from storage
- Extract only relevant divisions based on trade mapping
- Clean and normalize text
- Store in spec_materials table
"""
import json
from typing import Dict, List
from db.supabase import (
    get_job,
    update_job_status,
    get_document_from_storage,
    get_division_map,
    SupabaseClient
)
from pdf.reader import extract_pages_from_pdf, extract_text_from_pages
from pdf.clean import clean_text, normalize_text

async def run_phase1(job_id: str) -> Dict:
    """
    Phase 1: Extract targeted content from PDF based on division map
    
    Steps:
    1. Get job details and division map
    2. Download PDF from storage
    3. Extract only relevant pages
    4. Clean and normalize text
    5. Store results
    """
    try:
        # Update job status to processing
        await update_job_status(job_id, "processing")
        
        # Get job details
        job = await get_job(job_id)
        file_hash = job.get("file_hash")
        trade_type = job.get("trade_type", "masonry")
        
        # Get division map from cache
        division_map = await get_division_map(file_hash)
        if not division_map:
            raise ValueError(f"No division map found for file_hash: {file_hash}")
        
        # Load trade mappings to know which divisions to extract
        with open("trade_mappings.json", "r") as f:
            trade_mappings = json.load(f)
        
        trade_config = trade_mappings.get(trade_type)
        if not trade_config:
            raise ValueError(f"Unknown trade type: {trade_type}")
        
        target_divisions = trade_config["primary_divisions"]
        
        # Download PDF from storage
        file_path = job.get("file_path")
        pdf_bytes = await get_document_from_storage(file_path)
        
        # Extract pages for target divisions only
        pages_to_extract = []
        for division in target_divisions:
            if division in division_map:
                div_info = division_map[division]
                pages_to_extract.extend(div_info.get("pages", []))
        
        # Remove duplicates and sort
        pages_to_extract = sorted(list(set(pages_to_extract)))
        
        print(f"Extracting {len(pages_to_extract)} pages for trade {trade_type}")
        
        # Extract text from selected pages
        extracted_text = await extract_text_from_pages(pdf_bytes, pages_to_extract)
        
        # Clean and normalize
        cleaned_text = clean_text(extracted_text)
        normalized_text = normalize_text(cleaned_text)
        
        # Store extracted content
        client = SupabaseClient.get_client()
        result = {
            "file_hash": file_hash,
            "trade_type": trade_type,
            "divisions_extracted": target_divisions,
            "pages_extracted": pages_to_extract,
            "total_pages": len(pages_to_extract),
            "text_length": len(normalized_text),
            "extracted_text": normalized_text
        }
        
        # Store in phase1_extractions table (or similar)
        client.table("phase1_extractions").insert({
            "job_id": job_id,
            "file_hash": file_hash,
            "extracted_data": result
        }).execute()
        
        # Update job status
        await update_job_status(job_id, "completed", result)
        
        return {
            "status": "success",
            "job_id": job_id,
            "pages_processed": len(pages_to_extract),
            "divisions": target_divisions
        }
        
    except Exception as e:
        print(f"Error in Phase 1: {str(e)}")
        await update_job_status(job_id, "failed", {"error": str(e)})
        raise
