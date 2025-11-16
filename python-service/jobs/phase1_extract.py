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
        
        # If no division map, use keyword fallback
        if not division_map:
            print(f"⚠️  No division map cached for {file_hash} - using keyword fallback")
            return await extract_full_document_fallback(job_id, job, file_hash, trade_type)
        
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


async def extract_full_document_fallback(job_id: str, job: Dict, file_hash: str, trade_type: str) -> Dict:
    """
    Fallback: Extract full document when no division map available
    Uses keyword-based division detection
    """
    import re
    
    try:
        print(f"🔄 Using keyword fallback for {trade_type}")
        
        # Download PDF from storage
        file_path = job.get("file_path")
        pdf_bytes = await get_document_from_storage(file_path)
        
        # Extract ALL text from PDF
        from pdf.reader import extract_text_from_pdf
        full_text = extract_text_from_pdf(pdf_bytes)
        
        # Determine target divisions based on trade
        division_map_simple = {
            'masonry': ['00', '01', '04'],
            'electrical': ['00', '01', '26'],
            'plumbing': ['00', '01', '22'],
            'hvac': ['00', '01', '23'],
            'concrete': ['00', '01', '03'],
            'steel': ['00', '01', '05']
        }
        
        target_divisions = division_map_simple.get(trade_type, ['00', '01'])
        
        # Extract divisions using keyword patterns
        extracted_sections = extract_divisions_by_keyword(full_text, target_divisions)
        
        # Combine all extracted text
        combined_text = "\n\n".join(extracted_sections.values())
        
        # Clean and normalize
        cleaned_text = clean_text(combined_text)
        normalized_text = normalize_text(cleaned_text)
        
        print(f"✓ Extracted {len(extracted_sections)} divisions, {len(normalized_text)} characters")
        
        # Store result
        client = SupabaseClient.get_client()
        result = {
            "file_hash": file_hash,
            "trade_type": trade_type,
            "extraction_strategy": "keyword_fallback",
            "divisions_found": list(extracted_sections.keys()),
            "text_length": len(normalized_text),
            "extracted_text": normalized_text
        }
        
        client.table("phase1_extractions").insert({
            "job_id": job_id,
            "file_hash": file_hash,
            "extracted_data": result
        }).execute()
        
        await update_job_status(job_id, "completed", result)
        
        return {
            "status": "success",
            "job_id": job_id,
            "extraction_strategy": "keyword_fallback",
            "divisions_found": list(extracted_sections.keys())
        }
        
    except Exception as e:
        print(f"Error in fallback extraction: {str(e)}")
        await update_job_status(job_id, "failed", {"error": str(e)})
        raise


def extract_divisions_by_keyword(text: str, target_divisions: List[str]) -> Dict[str, str]:
    """Extract divisions using regex patterns when no TOC available"""
    import re
    
    results = {}
    
    division_patterns = {
        '00': r'DIVISION\s*0*0\s*[-–—]\s*PROCUREMENT',
        '01': r'DIVISION\s*0*1\s*[-–—]\s*GENERAL\s*REQUIREMENTS',
        '03': r'DIVISION\s*0*3\s*[-–—]\s*CONCRETE',
        '04': r'DIVISION\s*0*4\s*[-–—]\s*MASONRY',
        '05': r'DIVISION\s*0*5\s*[-–—]\s*METALS',
        '06': r'DIVISION\s*0*6\s*[-–—]\s*WOOD',
        '07': r'DIVISION\s*0*7\s*[-–—]\s*THERMAL',
        '08': r'DIVISION\s*0*8\s*[-–—]\s*OPENINGS',
        '09': r'DIVISION\s*0*9\s*[-–—]\s*FINISHES',
        '22': r'DIVISION\s*0*22\s*[-–—]\s*PLUMBING',
        '23': r'DIVISION\s*0*23\s*[-–—]\s*HVAC',
        '26': r'DIVISION\s*0*26\s*[-–—]\s*ELECTRICAL',
    }
    
    for div in target_divisions:
        if div in division_patterns:
            pattern = division_patterns[div]
            matches = list(re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE))
            
            if matches:
                # Found the division header
                start_pos = matches[0].start()
                
                # Find next division or end of document
                next_div_pattern = r'DIVISION\s*\d+\s*[-–—]'
                next_matches = list(re.finditer(next_div_pattern, text[start_pos+100:], re.IGNORECASE))
                
                if next_matches:
                    end_pos = start_pos + 100 + next_matches[0].start()
                else:
                    end_pos = len(text)
                
                results[div] = text[start_pos:end_pos]
                print(f"  ✓ Found Division {div}: {len(results[div])} chars")
            else:
                print(f"  ⚠️  Division {div} not found in document")
    
    # If no divisions found, return the entire document
    if not results:
        print(f"  ⚠️  No divisions detected - returning full document")
        results['full'] = text
    
    return results
