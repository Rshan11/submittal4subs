import os
from pypdf import PdfReader

# Path to PDF
PDF_PATH = "specifications/c57c2363298d872c228fec68b17ed4c3a2ff7afd4ec4c277e710435f6a2f8910/25-0925_MPES-II_100CD Specs.pdf"

# Patterns to search for in headers/footers
PATTERNS = [
    '04 2000',
    '04 20',
    'Unit Masonry',
    'MASONRY',
    'Division 04',
    '04 05 00',  # Common masonry sections
    '04 20 00',
    'BRICK',
    'CMU',
    'CONCRETE MASONRY UNITS'
]

def scan_pdf_for_division_04():
    """Scan PDF headers/footers to find Division 04 pages."""
    
    if not os.path.exists(PDF_PATH):
        print(f"[ERROR] PDF not found at: {PDF_PATH}")
        return
    
    print(f"[INFO] Loading PDF from: {PDF_PATH}")
    reader = PdfReader(PDF_PATH)
    total_pages = len(reader.pages)
    print(f"[INFO] Total pages in PDF: {total_pages}")
    
    matching_pages = []
    extracted_text = []
    
    print("\n[INFO] Scanning pages for Division 04 patterns...")
    print(f"[INFO] Looking for: {', '.join(PATTERNS)}\n")
    
    for page_num, page in enumerate(reader.pages, start=1):
        try:
            # Extract full text
            text = page.extract_text() or ""
            
            # Check first 200 and last 200 characters for patterns
            header = text[:200].upper()
            footer = text[-200:].upper()
            full_text_upper = text.upper()
            
            # Check if any pattern matches
            found_patterns = []
            for pattern in PATTERNS:
                pattern_upper = pattern.upper()
                if pattern_upper in header or pattern_upper in footer or pattern_upper in full_text_upper:
                    found_patterns.append(pattern)
            
            if found_patterns:
                matching_pages.append(page_num)
                extracted_text.append(f"\n{'='*80}\n")
                extracted_text.append(f"PAGE {page_num} (Found: {', '.join(found_patterns)})\n")
                extracted_text.append(f"{'='*80}\n")
                extracted_text.append(text)
                extracted_text.append("\n")
                
                print(f"✓ Page {page_num}: Found patterns: {', '.join(found_patterns)}")
        
        except Exception as e:
            print(f"[WARN] Failed to process page {page_num}: {e}")
    
    # Generate results
    print("\n" + "="*80)
    print("SCAN RESULTS")
    print("="*80)
    print(f"Total pages scanned: {total_pages}")
    print(f"Pages with Division 04 content: {len(matching_pages)}")
    print(f"Matching page numbers: {matching_pages}")
    
    # Calculate total characters
    full_extracted = "".join(extracted_text)
    total_chars = len(full_extracted)
    print(f"Total characters extracted: {total_chars:,}")
    
    # Save to file
    output_file = "division_04_extracted.txt"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(f"Division 04 - Masonry Content Extraction\n")
        f.write(f"="*80 + "\n")
        f.write(f"Total pages scanned: {total_pages}\n")
        f.write(f"Pages with Division 04 content: {len(matching_pages)}\n")
        f.write(f"Matching page numbers: {matching_pages}\n")
        f.write(f"Total characters extracted: {total_chars:,}\n")
        f.write(f"="*80 + "\n\n")
        f.write(full_extracted)
    
    print(f"\n[SUCCESS] Extracted text saved to: {output_file}")
    print("="*80)
    
    if matching_pages:
        # Show sample from first matching page
        print("\n[SAMPLE] First 500 characters from first matching page:")
        print("-"*80)
        sample = extracted_text[1][:500] if len(extracted_text) > 1 else ""
        print(sample)
        print("-"*80)
    else:
        print("\n[WARNING] No Division 04 content found!")

if __name__ == "__main__":
    scan_pdf_for_division_04()
