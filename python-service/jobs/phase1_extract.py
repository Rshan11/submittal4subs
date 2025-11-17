"""
Phase 1: Targeted Extraction
- Pull PDF from storage
- Extract only relevant divisions based on trade mapping
- Clean and normalize text
- Store in spec_materials table
"""
import json
import re
import traceback
from datetime import datetime
from typing import Dict, List
from db.supabase import (
    get_job,
    update_job_status,
    get_document_from_storage,
    get_division_map,
    SupabaseClient
)
from pdf.reader import (
    extract_pages_from_pdf, 
    extract_text_from_pages,
    extract_text_from_pdf  # Added - used in fallback
)
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
        
        # Automatically trigger Phase 2 analysis
        try:
            from jobs.phase2_materials import run_phase2
            print(f"🚀 Starting Phase 2 analysis for job {job_id}...")
            phase2_result = await run_phase2(job_id)
            print(f"✅ Phase 2 completed for job {job_id}")
        except Exception as e:
            print(f"⚠️  Phase 2 failed (non-critical): {str(e)}")
            # Don't fail Phase 1 if Phase 2 has issues
        
        return {
            "status": "success",
            "job_id": job_id,
            "pages_processed": len(pages_to_extract),
            "divisions": target_divisions
        }
        
    except Exception as e:
        error_details = {
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(f"❌ Error in Phase 1: {str(e)}")
        print(traceback.format_exc())
        await update_job_status(job_id, "failed", error_details)
        raise


async def extract_full_document_fallback(job_id: str, job: Dict, file_hash: str, trade_type: str) -> Dict:
    """
    Fallback: Extract full document when no division map available
    Uses keyword-based division detection
    """
    try:
        print(f"🔄 Using keyword fallback for {trade_type}")
        
        # Validate inputs
        if not file_hash or not trade_type:
            raise ValueError("file_hash and trade_type are required")
        
        # Download PDF from storage
        file_path = job.get("file_path")
        if not file_path:
            raise ValueError("file_path not found in job data")
        
        print(f"  📥 Downloading PDF from: {file_path}")
        pdf_bytes = await get_document_from_storage(file_path)
        
        # Validate PDF bytes
        if not pdf_bytes or len(pdf_bytes) == 0:
            raise ValueError("Downloaded PDF is empty")
        
        print(f"  ✓ Downloaded {len(pdf_bytes)} bytes")
        
        # Extract ALL text from PDF (function imported at top)
        print(f"  📄 Extracting text from entire PDF...")
        full_text = extract_text_from_pdf(pdf_bytes)
        
        if not full_text or len(full_text) < 100:
            raise ValueError(f"Extracted text is too short ({len(full_text)} chars) - PDF may be image-based")
        
        print(f"  ✓ Extracted {len(full_text)} characters")
        
        # Determine target divisions based on trade
        division_map_simple = {
            'masonry': ['00', '01', '04'],
            'electrical': ['00', '01', '26'],
            'plumbing': ['00', '01', '22'],
            'hvac': ['00', '01', '23'],
            'concrete': ['00', '01', '03'],
            'steel': ['00', '01', '05'],
            'drywall': ['00', '01', '09'],
            'roofing': ['00', '01', '07'],
            'carpentry': ['00', '01', '06']
        }
        
        target_divisions = division_map_simple.get(trade_type, ['00', '01'])
        print(f"  🎯 Target divisions for {trade_type}: {target_divisions}")
        
        # Extract divisions using keyword patterns
        print(f"  🔍 Searching for divisions in text...")
        extracted_sections = extract_divisions_by_keyword(full_text, target_divisions)
        
        # Validate extraction results
        if not extracted_sections or all(not v for v in extracted_sections.values()):
            print(f"  ⚠️  No content extracted - PDF may be scanned/image-based")
            error_result = {
                "error": "No text content found in PDF",
                "extracted_sections": {},
                "file_path": file_path,
                "pdf_size": len(pdf_bytes)
            }
            await update_job_status(job_id, "failed", error_result)
            return error_result
        
        if not extracted_sections:
            print(f"  ⚠️  No divisions found - using full document")
            extracted_sections = {'full_document': full_text}
        
        # Combine all extracted text
        combined_text = "\n\n".join(extracted_sections.values())
        print(f"  ✓ Combined {len(extracted_sections)} sections: {len(combined_text)} chars")
        
        # Clean and normalize
        cleaned_text = clean_text(combined_text)
        normalized_text = normalize_text(cleaned_text)
        
        print(f"✅ Fallback extraction complete:")
        print(f"   - Divisions found: {list(extracted_sections.keys())}")
        print(f"   - Total text: {len(normalized_text)} characters")
        print(f"   - Cleaned text: {len(cleaned_text)} chars")
        
        # Store result
        client = SupabaseClient.get_client()
        
        # Get total pages from PDF
        from pypdf import PdfReader
        from io import BytesIO
        pdf_file = BytesIO(pdf_bytes)
        pdf_reader = PdfReader(pdf_file)
        total_pages = len(pdf_reader.pages)
        
        result = {
            "file_hash": file_hash,
            "trade_type": trade_type,
            "text_length": len(normalized_text),
            "extracted_text": normalized_text,
            "divisions_found": list(extracted_sections.keys()),
            "divisions_extracted": list(extracted_sections.keys()),
            "pages_processed": list(range(1, total_pages + 1)),
            "total_pages": total_pages,
            "extraction_strategy": "keyword_fallback",
            "extraction_timestamp": datetime.utcnow().isoformat()
        }
        
        client.table("phase1_extractions").insert({
            "job_id": job_id,
            "file_hash": file_hash,
            "extracted_data": result
        }).execute()
        
        await update_job_status(job_id, "completed", result)
        
        # Automatically trigger Phase 2 analysis
        try:
            from jobs.phase2_materials import run_phase2
            print(f"🚀 Starting Phase 2 analysis for job {job_id}...")
            phase2_result = await run_phase2(job_id)
            print(f"✅ Phase 2 completed for job {job_id}")
        except Exception as e:
            print(f"⚠️  Phase 2 failed (non-critical): {str(e)}")
            # Don't fail Phase 1 if Phase 2 has issues
        
        return {
            "status": "success",
            "job_id": job_id,
            "extraction_strategy": "keyword_fallback",
            "divisions_found": list(extracted_sections.keys())
        }
        
    except Exception as e:
        error_details = {
            "error": str(e),
            "traceback": traceback.format_exc(),
            "extraction_method": "keyword_fallback"
        }
        print(f"❌ Error in fallback extraction: {str(e)}")
        print(traceback.format_exc())
        await update_job_status(job_id, "failed", error_details)
        raise


def extract_divisions_by_keyword(text: str, target_divisions: List[str]) -> Dict[str, str]:
    """
    Extract divisions using regex patterns when no TOC available
    
    Args:
        text: Full PDF text content
        target_divisions: List of division numbers to find (e.g., ['00', '01', '04'])
    
    Returns:
        Dictionary mapping division numbers to extracted text
    """
    if not text or not target_divisions:
        return {}
    
    results = {}
    
    # Comprehensive division patterns - supports multiple formats
    division_patterns = {
        '00': r'DIVISION\s*0*0\s*[-–—:]\s*PROCUREMENT',
        '01': r'DIVISION\s*0*1\s*[-–—:]\s*GENERAL\s*REQUIREMENTS',
        '03': r'DIVISION\s*0*3\s*[-–—:]\s*CONCRETE',
        '04': r'DIVISION\s*0*4\s*[-–—:]\s*MASONRY',
        '05': r'DIVISION\s*0*5\s*[-–—:]\s*METALS',
        '06': r'DIVISION\s*0*6\s*[-–—:]\s*(WOOD|CARPENTRY)',
        '07': r'DIVISION\s*0*7\s*[-–—:]\s*(THERMAL|MOISTURE)',
        '08': r'DIVISION\s*0*8\s*[-–—:]\s*(OPENINGS|DOORS)',
        '09': r'DIVISION\s*0*9\s*[-–—:]\s*FINISHES',
        '22': r'DIVISION\s*0*22\s*[-–—:]\s*PLUMBING',
        '23': r'DIVISION\s*0*23\s*[-–—:]\s*(HVAC|MECHANICAL)',
        '26': r'DIVISION\s*0*26\s*[-–—:]\s*ELECTRICAL',
    }
    
    for div in target_divisions:
        if div in division_patterns:
            pattern = division_patterns[div]
            matches = list(re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE))
            
            if matches:
                # Found the division header
                start_pos = matches[0].start()
                
                # Find next division header - search for ANY division after this one
                # Start searching 1000 chars ahead to avoid matching the current division header
                search_start = start_pos + 1000
                next_div_pattern = r'DIVISION\s*\d+\s*[-–—:]'
                
                # Search for next division in remaining text
                remaining_text = text[search_start:]
                next_matches = list(re.finditer(next_div_pattern, remaining_text, re.IGNORECASE))
                
                if next_matches:
                    # Found next division - extract everything up to it
                    end_pos = search_start + next_matches[0].start()
                    print(f"  📍 Next division found at position {end_pos}")
                else:
                    # No next division found - take rest of document
                    end_pos = len(text)
                    print(f"  📍 No next division - extracting to end of document")
                
                extracted = text[start_pos:end_pos].strip()
                
                # Validate extracted content is substantial
                if len(extracted) > 200:  # At least 200 chars
                    results[div] = extracted
                    print(f"  ✓ Found Division {div}: {len(extracted):,} characters extracted")
                else:
                    print(f"  ⚠️  Division {div} found but too short ({len(extracted)} chars)")
            else:
                print(f"  ⚠️  Division {div} not found in document")
    
    # If no divisions found, return the entire document
    if not results:
        print(f"  ⚠️  No divisions detected - returning full document")
        results['full'] = text
    
    return results
