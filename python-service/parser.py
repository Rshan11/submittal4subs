"""
PDF Parser - Header/Footer Scanning & Tile Generation
Uses pdfplumber for text extraction
"""

import io
import re
from typing import Any, Dict, List, Optional, Tuple

import pdfplumber

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

TILE_SIZE = 4000  # Characters per tile
TILE_OVERLAP = 500  # Overlap between tiles

# Division header patterns
DIVISION_PATTERNS = [
    # "DIVISION 04 - MASONRY" or "DIVISION 4 MASONRY"
    r"DIVISION\s+(\d{1,2})\s*[-–—:]?\s*([A-Z][A-Z\s&/]+)",
    # "SECTION 04 20 00" or "04 20 00 UNIT MASONRY"
    r"SECTION\s+(\d{2})\s*(\d{2})\s*(\d{2})",
    r"^(\d{2})\s+(\d{2})\s+(\d{2})\s+([A-Z][A-Z\s]+)",
]

# Section validation keywords (must appear near division headers)
VALIDATION_KEYWORDS = [
    "PART 1",
    "PART 2",
    "PART 3",
    "GENERAL",
    "PRODUCTS",
    "EXECUTION",
    "SCOPE",
    "SUBMITTALS",
    "QUALITY",
    "MATERIALS",
    "INSTALLATION",
    "RELATED",
]

# Cross-reference pattern: XX XX XX (section numbers)
CROSS_REF_PATTERN = r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b"


# ═══════════════════════════════════════════════════════════════
# PDF TEXT EXTRACTION
# ═══════════════════════════════════════════════════════════════


def clean_text(text: str) -> str:
    """Remove problematic Unicode characters that cause encoding issues"""
    # Remove zero-width characters and other problematic Unicode
    problematic = [
        "\u200b",  # zero-width space
        "\u200c",  # zero-width non-joiner
        "\u200d",  # zero-width joiner
        "\ufeff",  # BOM
        "\u00ad",  # soft hyphen
    ]
    for char in problematic:
        text = text.replace(char, "")
    return text


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
            text = clean_text(text)
            full_text += f"\n--- Page {i} ---\n{text}"

    return full_text, page_count


def extract_pages(pdf_bytes: bytes, start_page: int, end_page: int) -> str:
    """Extract text from specific page range"""
    text = ""

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i in range(start_page - 1, min(end_page, len(pdf.pages))):
            page = pdf.pages[i]
            page_text = clean_text(page.extract_text() or "")
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
            text = clean_text(page.extract_text() or "")

            # Debug: print first 200 chars of pages around 100
            if 98 <= page_num <= 105:
                preview = text[:300].replace("\n", " | ")
                print(f"[DEBUG] Page {page_num}: {preview}")

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
    Handles many format variations found in real specs.
    """
    text_upper = text.upper()

    # Only process if this looks like a section start page
    if not validate_division_context(text):
        return None

    # PATTERN GROUP 1: SECTION with 6-digit code (most reliable)
    # Handles: SECTION042900, SECTION 04 29 00, SECTION04 29 00, etc.
    patterns = [
        # SECTION followed by 6 digits (with or without spaces)
        r"SECTION\s*(\d{2})\s*(\d{2})\s*(\d{2})",
        # Just 6 digits at start of line
        r"^(\d{2})\s*(\d{2})\s*(\d{2})\b",
        # 6 digits followed by dash and title
        r"(\d{2})\s*(\d{2})\s*(\d{2})\s*[-–—]",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            div_code = match.group(1)
            section_number = f"{match.group(1)} {match.group(2)} {match.group(3)}"
            return {
                "division_code": div_code,
                "section_number": section_number,
                "section_title": None,
                "start_page": page_num,
            }

    # PATTERN GROUP 2: DIVISION XX format
    match = re.search(r"DIVISION\s*(\d{1,2})", text, re.IGNORECASE)
    if match:
        div_code = match.group(1).zfill(2)
        return {
            "division_code": div_code,
            "section_number": None,
            "section_title": None,
            "start_page": page_num,
        }

    return None


def validate_division_context(text: str) -> bool:
    """
    Validate that the page contains actual specification content
    (not just a TOC reference or random mention)
    """
    text_upper = text.upper()
    keyword_count = sum(1 for kw in VALIDATION_KEYWORDS if kw in text_upper)
    # More lenient - just need 1 keyword, or if it has significant text length
    return keyword_count >= 1 or len(text) > 500


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
                "sections": [div],
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
    overlap: int = TILE_OVERLAP,
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
    page_pattern = re.compile(r"--- Page (\d+) ---")

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

        tiles.append(
            {
                "spec_id": spec_id,
                "division_code": division_code,
                "section_number": section_number,
                "section_title": section_title,
                "part": part,
                "page_from": page_from,
                "page_to": page_to,
                "tile_index": tile_index,
                "content": tile_content,
                "cross_refs": cross_refs,
            }
        )

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

    if "PART 3" in text_upper and "EXECUTION" in text_upper:
        return "PART 3 EXECUTION"
    elif "PART 2" in text_upper and "PRODUCTS" in text_upper:
        return "PART 2 PRODUCTS"
    elif "PART 1" in text_upper and "GENERAL" in text_upper:
        return "PART 1 GENERAL"

    return None


# ═══════════════════════════════════════════════════════════════
# FULL PARSE PIPELINE
# ═══════════════════════════════════════════════════════════════


def parse_spec(pdf_bytes: bytes, spec_id: str) -> Dict[str, Any]:
    """
    Full parsing pipeline - memory optimized for large PDFs:
    1. First pass: scan for divisions (lightweight, no text caching)
    2. Second pass: extract text only for pages in detected divisions
    3. Generate tiles incrementally
    """
    import gc

    divisions = []
    current_division = None
    page_count = 0

    print(f"[PARSE] Starting parse for spec {spec_id}")
    print(f"[PARSE] PDF size: {len(pdf_bytes):,} bytes")

    # PASS 1: Quick scan for division headers (don't cache full text)
    print("[PARSE] Pass 1: Scanning for division headers...")
    pdf_stream = io.BytesIO(pdf_bytes)

    with pdfplumber.open(pdf_stream) as pdf:
        page_count = len(pdf.pages)
        print(f"[PARSE] Total pages: {page_count}")

        for page_num, page in enumerate(pdf.pages, 1):
            # Extract text for this page only
            text = clean_text(page.extract_text() or "")

            # Check for division headers
            division_info = detect_division_header(text, page_num)

            if division_info:
                if current_division:
                    current_division["end_page"] = page_num - 1
                    divisions.append(current_division)
                current_division = division_info

            # Progress logging every 100 pages
            if page_num % 100 == 0:
                print(f"[PARSE] Scanned {page_num}/{page_count} pages...")
                gc.collect()  # Force garbage collection

        if current_division:
            current_division["end_page"] = page_count
            divisions.append(current_division)

    # Merge consecutive sections of the same division
    divisions = merge_division_sections(divisions)
    print(f"[PARSE] Found {len(divisions)} divisions")

    # Force cleanup before pass 2
    gc.collect()

    # PASS 2: Extract text and generate tiles for each division
    print("[PARSE] Pass 2: Extracting text and generating tiles...")
    all_tiles = []

    pdf_stream = io.BytesIO(pdf_bytes)
    with pdfplumber.open(pdf_stream) as pdf:
        for div_idx, div in enumerate(divisions):
            div_text = ""
            start_pg = div["start_page"]
            end_pg = div["end_page"]

            print(
                f"[PARSE] Processing Division {div['division_code']}: pages {start_pg}-{end_pg}"
            )

            # Extract only pages for this division
            for pg in range(start_pg - 1, min(end_pg, len(pdf.pages))):
                page = pdf.pages[pg]
                page_text = clean_text(page.extract_text() or "")
                div_text += f"\n--- Page {pg + 1} ---\n{page_text}"

            # Generate tiles for this division
            tiles = tile_text(
                text=div_text,
                spec_id=spec_id,
                division_code=div["division_code"],
                section_number=div.get("section_number"),
                section_title=div.get("section_title"),
            )
            all_tiles.extend(tiles)

            # Clear div_text to free memory
            del div_text
            gc.collect()

    print(f"[PARSE] Generated {len(all_tiles)} tiles")

    return {
        "page_count": page_count,
        "divisions": divisions,
        "tiles": all_tiles,
        "division_count": len(divisions),
        "tile_count": len(all_tiles),
    }
