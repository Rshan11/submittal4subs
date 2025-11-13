"""
PDF reading and text extraction utilities
Uses pypdf for pure Python PDF handling
"""
from pypdf import PdfReader
from typing import List
import io

async def extract_text_from_pages(pdf_bytes: bytes, page_numbers: List[int]) -> str:
    """
    Extract text from specific pages of a PDF
    
    Args:
        pdf_bytes: PDF file as bytes
        page_numbers: List of page numbers to extract (0-indexed)
    
    Returns:
        Concatenated text from all specified pages
    """
    pdf_stream = io.BytesIO(pdf_bytes)
    reader = PdfReader(pdf_stream)
    
    extracted_text = []
    
    for page_num in page_numbers:
        if page_num < 0 or page_num >= len(reader.pages):
            print(f"Warning: Page {page_num} out of range, skipping")
            continue
        
        page = reader.pages[page_num]
        text = page.extract_text()
        
        # Add page marker for reference
        extracted_text.append(f"\n--- Page {page_num + 1} ---\n")
        extracted_text.append(text)
    
    return "".join(extracted_text)

def extract_pages_from_pdf(pdf_bytes: bytes, start_page: int, end_page: int) -> str:
    """
    Extract text from a range of pages
    
    Args:
        pdf_bytes: PDF file as bytes
        start_page: Starting page number (0-indexed)
        end_page: Ending page number (0-indexed, inclusive)
    
    Returns:
        Concatenated text from page range
    """
    pages = list(range(start_page, end_page + 1))
    return extract_text_from_pages(pdf_bytes, pages)

def get_pdf_page_count(pdf_bytes: bytes) -> int:
    """Get total number of pages in PDF"""
    pdf_stream = io.BytesIO(pdf_bytes)
    reader = PdfReader(pdf_stream)
    return len(reader.pages)

def extract_toc(pdf_bytes: bytes) -> List[dict]:
    """
    Extract table of contents from PDF if available
    
    Returns:
        List of TOC entries with level, title, and page number
    """
    pdf_stream = io.BytesIO(pdf_bytes)
    reader = PdfReader(pdf_stream)
    
    toc_entries = []
    
    # pypdf uses outlines for TOC
    if reader.outline:
        def process_outline(outline, level=1):
            for item in outline:
                if isinstance(item, list):
                    process_outline(item, level + 1)
                else:
                    page_num = reader.get_destination_page_number(item) if hasattr(item, 'page') else 0
                    toc_entries.append({
                        "level": level,
                        "title": item.title if hasattr(item, 'title') else str(item),
                        "page": page_num + 1  # Convert to 1-indexed
                    })
        
        process_outline(reader.outline)
    
    return toc_entries