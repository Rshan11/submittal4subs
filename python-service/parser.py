"""
PDF Parser - Header/Footer Scanning & Tile Generation
Uses pdfplumber for text extraction
"""
import re
import io
from typing import List, Dict, Any, Optional, Tuple
import pdfplumber

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

TILE_SIZE = 4000        # Characters per tile
TILE_OVERLAP = 500      # Overlap between tiles

# Division header patterns
DIVISION_PATTERNS = [
    # "DIVISION 04 - MASONRY" or "DIVISION 4 MASONRY"
    r'DIVISION\s+(\d{1,2})\s*[-–—:]?\s*([A-Z][A-Z\s&/]+)',
    # "SECTION 04 20 00" or "04 20 00 UNIT MASONRY"
    r'SECTION\s+(\d{2})\s*(\d{2})\s*(\d{2})',
    r'^(\d{2})\s+(\d{2})\s+(\d{2})\s+([A-Z][A-Z\s]+)',
]

# Section validation keywords (must appear near division headers)
VALIDATION_KEYWORDS = [
    'PART 1', 'PART 2', 'PART 3',
    'GENERAL', 'PRODUCTS', 'EXECUTION',
    'SCOPE', 'SUBMITTALS', 'QUALITY',
    'MATERIALS', 'INSTALLATION', 'RELATED'
]

# Cross-reference pattern: XX XX XX (section numbers)
CROSS_REF_PATTERN = r'\b(\d{2})\s+(\d{2})\s+(\d{2})\b'


# ═══════════════════════════════════════════════════════════════
# PDF TEXT EXTRACTION
# ═══════════════════════════════════════════════════════════════

def extract_text_from_pdf(pdf_bytes: bytes) -> Tuple[str, int]:
    """
    Extract all text from PDF with page markers
    Returns (full_text, page_count)
    """
    full_text = ""
    page_count = 0

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)
        for i, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            full_text += f"\n--- Page {i} ---\n{text}"

    return full_text, page_count


def extract_pages(pdf_bytes: bytes, start_page: int, end_page: int) -> str:
    """Extract text from specific page range"""
    text = ""

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i in range(start_page - 1, min(end_page, len(pdf.pages))):
            page = pdf.pages[i]
            page_text = page.extract_text() or ""
            text += f"\n--- Page {i + 1} ---\n{page_text}"

    return text


# ═══════════════════════════════════════════════════════════════
# DIVISION SCANNING (Header/Footer Pattern Matching)
# ═══════════════════════════════════════════════════════════════

def scan_divisions(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Scan PDF for division headers using header/footer pattern matching.
    Returns list of divisions found with page ranges.
    """
    divisions = []
    current_division = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)

        for page_num, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""

            # Check for division headers
            division_info = detect_division_header(text, page_num)

            if division_info:
                # Close previous division
                if current_division:
                    current_division["end_page"] = page_num - 1
                    divisions.append(current_division)

                current_division = division_info

        # Close last division
        if current_division:
            current_division["end_page"] = page_count
            divisions.append(current_division)

    # Merge consecutive sections of the same division
    return merge_division_sections(divisions)


def detect_division_header(text: str, page_num: int) -> Optional[Dict[str, Any]]:
    """
    Detect if a page contains a division/section header.
    Uses header/footer area scanning + keyword validation.
    """
    # Focus on top portion of page (headers typically in first 20%)
    lines = text.split('\n')
    header_area = '\n'.join(lines[:min(15, len(lines))])

    # Pattern 1: DIVISION XX - TITLE
    match = re.search(r'DIVISION\s+(\d{1,2})\s*[-–—:]?\s*([A-Z][A-Z\s&/]+)', header_area, re.IGNORECASE)
    if match:
        div_code = match.group(1).zfill(2)
        title = match.group(2).strip()
        if validate_division_context(text):
            return {
                "division_code": div_code,
                "section_number": None,
                "section_title": title,
                "start_page": page_num
            }

    # Pattern 2: SECTION XX XX XX or XX XX XX TITLE
    match = re.search(r'(?:SECTION\s+)?(\d{2})\s+(\d{2})\s+(\d{2})(?:\s+[-–—]\s*)?([A-Z][A-Z\s]+)?', header_area, re.IGNORECASE)
    if match:
        div_code = match.group(1)
        section_number = f"{match.group(1)} {match.group(2)} {match.group(3)}"
        title = match.group(4).strip() if match.group(4) else None
        if validate_division_context(text):
            return {
                "division_code": div_code,
                "section_number": section_number,
                "section_title": title,
                "start_page": page_num
            }

    return None


def validate_division_context(text: str) -> bool:
    """
    Validate that the page contains actual specification content
    (not just a TOC reference or random mention)
    """
    text_upper = text.upper()
    keyword_count = sum(1 for kw in VALIDATION_KEYWORDS if kw in text_upper)
    return keyword_count >= 2


def merge_division_sections(divisions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Merge consecutive sections of the same division code.
    E.g., 04 20 00 and 04 21 00 both become Division 04.
    """
    if not divisions:
        return []

    merged = {}
    for div in divisions:
        code = div["division_code"]
        if code not in merged:
            merged[code] = {
                "division_code": code,
                "section_number": div["section_number"],
                "section_title": div["section_title"],
                "start_page": div["start_page"],
                "end_page": div["end_page"],
                "sections": [div]
            }
        else:
            # Extend existing division
            merged[code]["end_page"] = max(merged[code]["end_page"], div["end_page"])
            merged[code]["sections"].append(div)

    return list(merged.values())


# ═══════════════════════════════════════════════════════════════
# TEXT TILING
# ═══════════════════════════════════════════════════════════════

def tile_text(
    text: str,
    spec_id: str,
    division_code: str,
    section_number: Optional[str] = None,
    section_title: Optional[str] = None,
    tile_size: int = TILE_SIZE,
    overlap: int = TILE_OVERLAP
) -> List[Dict[str, Any]]:
    """
    Split text into overlapping tiles for processing.
    Detects cross-references in each tile.
    """
    tiles = []
    step = tile_size - overlap
    start = 0
    tile_index = 0

    # Track page numbers in the text
    page_pattern = re.compile(r'--- Page (\d+) ---')

    while start < len(text):
        end = min(start + tile_size, len(text))
        tile_content = text[start:end]

        # Find page range for this tile
        pages_in_tile = page_pattern.findall(tile_content)
        page_from = int(pages_in_tile[0]) if pages_in_tile else 0
        page_to = int(pages_in_tile[-1]) if pages_in_tile else page_from

        # Detect cross-references
        cross_refs = find_cross_references(tile_content)

        # Detect PART designation
        part = detect_part(tile_content)

        tiles.append({
            "spec_id": spec_id,
            "division_code": division_code,
            "section_number": section_number,
            "section_title": section_title,
            "part": part,
            "page_from": page_from,
            "page_to": page_to,
            "tile_index": tile_index,
            "content": tile_content,
            "cross_refs": cross_refs
        })

        tile_index += 1
        start += step

        # Stop if remaining text is smaller than overlap
        if len(text) - start < overlap:
            break

    return tiles


def find_cross_references(text: str) -> List[str]:
    """
    Find all cross-references to other sections.
    Pattern: XX XX XX (MasterFormat section numbers)
    """
    matches = re.findall(CROSS_REF_PATTERN, text)
    # Format as "XX XX XX"
    refs = [f"{m[0]} {m[1]} {m[2]}" for m in matches]
    # Deduplicate while preserving order
    seen = set()
    unique_refs = []
    for ref in refs:
        if ref not in seen:
            seen.add(ref)
            unique_refs.append(ref)
    return unique_refs


def detect_part(text: str) -> Optional[str]:
    """Detect which PART this tile primarily contains"""
    text_upper = text.upper()

    if 'PART 3' in text_upper and 'EXECUTION' in text_upper:
        return 'PART 3 EXECUTION'
    elif 'PART 2' in text_upper and 'PRODUCTS' in text_upper:
        return 'PART 2 PRODUCTS'
    elif 'PART 1' in text_upper and 'GENERAL' in text_upper:
        return 'PART 1 GENERAL'

    return None


# ═══════════════════════════════════════════════════════════════
# FULL PARSE PIPELINE
# ═══════════════════════════════════════════════════════════════

def parse_spec(pdf_bytes: bytes, spec_id: str) -> Dict[str, Any]:
    """
    Full parsing pipeline:
    1. Scan for divisions
    2. Extract text per division
    3. Generate tiles
    """
    # Step 1: Scan divisions
    divisions = scan_divisions(pdf_bytes)

    # Step 2: Get total page count
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)

    # Step 3: Generate tiles for each division
    all_tiles = []

    for div in divisions:
        # Extract text for this division's page range
        div_text = extract_pages(pdf_bytes, div["start_page"], div["end_page"])

        # Generate tiles
        tiles = tile_text(
            text=div_text,
            spec_id=spec_id,
            division_code=div["division_code"],
            section_number=div.get("section_number"),
            section_title=div.get("section_title")
        )

        all_tiles.extend(tiles)

    return {
        "page_count": page_count,
        "divisions": divisions,
        "tiles": all_tiles,
        "division_count": len(divisions),
        "tile_count": len(all_tiles)
    }
