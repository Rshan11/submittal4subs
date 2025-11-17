"""
Phase 0: Document Intelligence
Analyzes PDF structure to build accurate division map with page ranges
"""
import re
from typing import Dict, List, Tuple
from pypdf import PdfReader
from io import BytesIO
from db.supabase import SupabaseClient

async def run_phase0(file_hash: str, pdf_bytes: bytes) -> Dict:
    """
    Phase 0: Analyze PDF structure to create division map
    
    Returns:
        {
            "has_toc": bool,
            "divisions": {
                "00": {"start_page": 10, "end_page": 25, "title": "PROCUREMENT..."},
                "04": {"start_page": 245, "end_page": 312, "title": "MASONRY"},
                ...
            }
        }
    """
    print(f"🔍 [PHASE 0] Starting document intelligence for {file_hash}")
    
    # Load PDF
    pdf_file = BytesIO(pdf_bytes)
    pdf_reader = PdfReader(pdf_file)
    total_pages = len(pdf_reader.pages)
    
    print(f"   📄 Total pages: {total_pages}")
    
    # Scan pages for division headers
    division_locations = []
    
    # Division patterns to detect
    division_pattern = r'DIVISION\s+(\d+)\s*[-–—:]\s*([A-Z\s]+)'
    
    for page_num in range(total_pages):
        try:
            page =pdf_reader.pages[page_num]
            text = page.extract_text()
            
            # Look for division headers
            matches = re.finditer(division_pattern, text, re.IGNORECASE | re.MULTILINE)
            
            for match in matches:
                div_number = match.group(1).lstrip('0')  # "04" -> "4" or keep "04"
                if len(div_number) == 1:
                    div_number = '0' + div_number  # Ensure 2 digits: "4" -> "04"
                    
                div_title = match.group(2).strip()
                
                # Check if this looks like actual spec content (not TOC)
                # TOC entries are usually short lines
                # Actual division starts have "PART 1" or more content following
                context = text[max(0, match.end()):match.end()+500]
                
                is_toc = False
                # TOC indicators: short line, followed by dots or page numbers
                if re.search(r'\.{3,}|\d{1,3}\s*$', context[:100]):
                    is_toc = True
                
                # Real division start indicators
                has_part1 = 'PART 1' in context or 'PART 2' in context or 'PART 3' in context
                has_section = 'SECTION' in context
                has_general = 'GENERAL' in context
                
                is_actual_division = has_part1 or (has_section and has_general)
                
                if is_actual_division and not is_toc:
                    division_locations.append({
                        'division': div_number,
                        'page': page_num + 1,  # 1-indexed
                        'title': div_title,
                        'type': 'actual_start'
                    })
                    print(f"   ✓ Found Division {div_number} START on page {page_num + 1}: {div_title}")
                    
        except Exception as e:
            # Some pages may fail to extract - continue
            print(f"   ⚠️  Page {page_num + 1} extraction failed: {str(e)}")
            continue
    
    # Build division map from detected locations
    division_map = {}
    
    # Sort by page number
    division_locations.sort(key=lambda x: x['page'])
    
    # Create ranges: each division extends to the next division's start
    for i, div_info in enumerate(division_locations):
        div_num = div_info['division']
        start_page = div_info['page']
        
        # Find end page (next division's start - 1)
        if i + 1 < len(division_locations):
            end_page = division_locations[i + 1]['page'] - 1
        else:
            end_page = total_pages  # Last division goes to end of document
        
        division_map[div_num] = {
            'start_page': start_page,
            'end_page': end_page,
            'title': div_info['title'],
            'pages': list(range(start_page, end_page + 1))
        }
        
        print(f"   📍 Division {div_num}: pages {start_page}-{end_page} ({end_page - start_page + 1} pages)")
    
    # Store in database
    result = {
        'has_toc': len(division_locations) > 0,
        'divisions': division_map,
        'total_pages': total_pages,
        'divisions_detected': len(division_map)
    }
    
    supabase = SupabaseClient()
    client = supabase.get_client()
    
    try:
        client.table("document_indexes").upsert({
            "file_hash": file_hash,
            "division_map": division_map,
            "has_toc": result['has_toc'],
            "metadata": {
                "total_pages": total_pages,
                "divisions_detected": len(division_map)
            }
        }).execute()
        print(f"   ✅ Division map cached for {file_hash}")
    except Exception as e:
        print(f"   ⚠️  Failed to cache division map: {str(e)}")
    
    return result
