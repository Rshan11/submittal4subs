"""
Page-Level Tagging Parser

Each page is processed independently and tagged with its section number.
No range calculation, no merging, no end-page detection.

The key insight: every page in a construction spec has a section identifier
in the header or footer, like:
- "03 30 00 - 3" (section 03 30 00, page 3 of that section)
- "04 22 00.13 - 5" (section 04 22 00.13, page 5)
- "SECTION 07 92 00 - JOINT SEALANTS"

One page = one section tag. No ranges. No merging.
"""

import gc
import re
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

# Pattern to find section numbers in headers/footers
# Matches: "03 30 00", "04 22 00.13", "07-92-00", "032000", etc.
SECTION_PATTERN = re.compile(
    r"\b(\d{2})[\s\.\-]*(\d{2})[\s\.\-]*(\d{2})(?:[\.\-](\d+))?\b"
)

# Cross-reference pattern (same format in body text)
CROSS_REF_PATTERN = re.compile(r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b")


# ═══════════════════════════════════════════════════════════════
# TEXT UTILITIES
# ═══════════════════════════════════════════════════════════════


def clean_text(text: str) -> str:
    """Remove problematic Unicode characters that cause encoding issues"""
    if not text:
        return ""
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


# ═══════════════════════════════════════════════════════════════
# SECTION DETECTION
# ═══════════════════════════════════════════════════════════════


def extract_section_from_page(text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract section number from a page's header/footer.

    Returns: (section_number, division_code) or (None, None)

    Strategy:
    1. Check footer (last 300 chars) - most reliable location
    2. Check header (first 300 chars) - backup
    3. Footer format is usually: "03 30 00 - 5" (section - page number)
    """
    if not text or len(text) < 100:
        return None, None

    # Check footer first (more reliable - section numbers usually at bottom)
    footer = text[-300:] if len(text) > 300 else text
    match = SECTION_PATTERN.search(footer)

    if match:
        section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
        if match.group(4):  # Has decimal part like .13
            section += f".{match.group(4)}"
        division = match.group(1)
        return section, division

    # Check header as backup
    header = text[:300]
    match = SECTION_PATTERN.search(header)

    if match:
        section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
        if match.group(4):
            section += f".{match.group(4)}"
        division = match.group(1)
        return section, division

    return None, None


def extract_cross_references(text: str, own_section: Optional[str]) -> List[str]:
    """
    Find all section numbers mentioned in the page text.
    Exclude the page's own section number.
    """
    matches = CROSS_REF_PATTERN.findall(text)
    refs = set()

    for m in matches:
        ref = f"{m[0]} {m[1]} {m[2]}"
        # Don't include self-references
        if (
            own_section and ref == own_section[:11]
        ):  # Compare base section (first 11 chars)
            continue
        refs.add(ref)

    return sorted(list(refs))


# ═══════════════════════════════════════════════════════════════
# MAIN PARSE FUNCTION
# ═══════════════════════════════════════════════════════════════


def parse_spec(pdf_bytes: bytes, spec_id: str) -> Dict[str, Any]:
    """
    Parse PDF into individual page records with section tags.

    Each page is processed independently:
    1. Extract text
    2. Detect section number from header/footer
    3. Find cross-references in body text
    4. Store as single page record

    Returns dict with pages ready for database insert.
    """
    pages = []

    print(f"[PARSE] Starting page-level parse for spec {spec_id}")
    print(f"[PARSE] PDF size: {len(pdf_bytes):,} bytes")

    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(pdf)
    print(f"[PARSE] Total pages: {total_pages}")

    divisions_found = set()
    sections_found = set()

    for page_num in range(total_pages):
        page = pdf[page_num]
        text = clean_text(page.get_text())

        # Skip blank/nearly blank pages
        if not text or len(text.strip()) < 50:
            continue

        # Extract section number from header/footer
        section_number, division_code = extract_section_from_page(text)

        if division_code:
            divisions_found.add(division_code)
        if section_number:
            sections_found.add(section_number)

        # Find cross-references in the text
        cross_refs = extract_cross_references(text, section_number)

        pages.append(
            {
                "spec_id": spec_id,
                "page_number": page_num + 1,  # 1-indexed
                "section_number": section_number,
                "division_code": division_code,
                "content": text,
                "char_count": len(text),
                "cross_refs": cross_refs if cross_refs else None,
            }
        )

        # Progress logging every 100 pages
        if (page_num + 1) % 100 == 0:
            print(f"[PARSE] Processed {page_num + 1}/{total_pages} pages...")
            gc.collect()

    pdf.close()

    # Build division summary
    division_summary = {}
    for p in pages:
        div = p["division_code"]
        if div:
            if div not in division_summary:
                division_summary[div] = {"pages": [], "count": 0, "sections": set()}
            division_summary[div]["pages"].append(p["page_number"])
            division_summary[div]["count"] += 1
            if p["section_number"]:
                division_summary[div]["sections"].add(p["section_number"])

    # Convert sections set to list for JSON serialization
    for div in division_summary:
        division_summary[div]["sections"] = sorted(
            list(division_summary[div]["sections"])
        )

    print(
        f"[PARSE] Complete: {len(pages)} pages with content, {len(divisions_found)} divisions"
    )
    for div in sorted(division_summary.keys()):
        info = division_summary[div]
        print(
            f"[PARSE]   Division {div}: {info['count']} pages, {len(info['sections'])} sections"
        )

    return {
        "page_count": total_pages,
        "pages": pages,
        "divisions": sorted(list(divisions_found)),
        "division_summary": division_summary,
        "sections": sorted(list(sections_found)),
    }


# ═══════════════════════════════════════════════════════════════
# LEGACY COMPATIBILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════

# These functions are kept for backward compatibility with existing code
# that may still use the tile-based approach

TILE_SIZE = 4000  # Characters per tile
TILE_OVERLAP = 500  # Overlap between tiles


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
    Legacy function: Split text into overlapping tiles.
    Kept for backward compatibility.
    """
    tiles = []
    step = tile_size - overlap
    start = 0
    tile_index = 0

    page_pattern = re.compile(r"--- Page (\d+) ---")

    while start < len(text):
        end = min(start + tile_size, len(text))
        tile_content = text[start:end]

        pages_in_tile = page_pattern.findall(tile_content)
        page_from = int(pages_in_tile[0]) if pages_in_tile else 0
        page_to = int(pages_in_tile[-1]) if pages_in_tile else page_from

        cross_refs = find_cross_references_legacy(tile_content)
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

        if len(text) - start < overlap:
            break

    return tiles


def find_cross_references_legacy(text: str) -> List[str]:
    """Legacy cross-reference finder for tiles"""
    matches = CROSS_REF_PATTERN.findall(text)
    refs = [f"{m[0]} {m[1]} {m[2]}" for m in matches]
    seen = set()
    unique_refs = []
    for ref in refs:
        if ref not in seen:
            seen.add(ref)
            unique_refs.append(ref)
    return unique_refs


def detect_part(text: str) -> Optional[str]:
    """Detect which PART this text primarily contains"""
    text_upper = text.upper()

    if "PART 3" in text_upper and "EXECUTION" in text_upper:
        return "PART 3 EXECUTION"
    elif "PART 2" in text_upper and "PRODUCTS" in text_upper:
        return "PART 2 PRODUCTS"
    elif "PART 1" in text_upper and "GENERAL" in text_upper:
        return "PART 1 GENERAL"

    return None
