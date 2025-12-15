"""
PDF Parser - Header/Footer Scanning & Tile Generation
Uses PyMuPDF (fitz) for memory-efficient text extraction
"""

import gc
import io
import re
from typing import Any, Dict, List, Optional

import fitz  # PyMuPDF

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

TILE_SIZE = 4000  # Characters per tile
TILE_OVERLAP = 500  # Overlap between tiles

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
# DIVISION DETECTION
# ═══════════════════════════════════════════════════════════════


def detect_division_header(text: str, page_num: int) -> Optional[Dict[str, Any]]:
    """
    Detect if a page contains a division/section header.
    Handles many format variations found in real specs including:

    MasterFormat patterns:
    - SECTION 04 22 00, SECTION 04 22 00.13, SECTION042200
    - 04 20 00, 04 22 00.13, 042200, 04-22-00
    - Section 042200 - UNIT MASONRY

    Division patterns:
    - DIVISION 04, DIVISION 4, DIV 04, DIV. 4
    - DIVISION 04 - MASONRY, DIVISION FOUR

    Keyword fallbacks (when no number found):
    - MASONRY, CONCRETE, METALS, WOOD, THERMAL, OPENINGS, FINISHES
    """
    if not text:
        return None

    # Only process if this looks like a section start page
    if not validate_division_context(text):
        return None

    text_upper = text.upper()

    # PATTERN GROUP 1: MasterFormat section numbers (most reliable)
    # Matches: 04 22 00, 04-22-00, 042200, 04 22 00.13, etc.
    section_patterns = [
        # SECTION keyword + 6 digits (with spaces, dashes, or compact)
        r"SECTION\s*(\d{2})[\s\-\.]*(\d{2})[\s\-\.]*(\d{2})(?:[\.\-]\d+)?",
        # 6 digits with various separators at line start
        r"^[\s]*(\d{2})[\s\-\.]+(\d{2})[\s\-\.]+(\d{2})(?:[\.\-]\d+)?",
        # 6 digits followed by dash/space and title text
        r"(\d{2})[\s\-\.]+(\d{2})[\s\-\.]+(\d{2})(?:[\.\-]\d+)?\s*[-–—:]\s*[A-Z]",
        # Compact 6-digit format
        r"\b(\d{2})(\d{2})(\d{2})(?:\.\d+)?\s*[-–—:]?\s*[A-Z]",
    ]

    for pattern in section_patterns:
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

    # PATTERN GROUP 2: DIVISION keyword patterns
    div_patterns = [
        r"DIVISION\s*(\d{1,2})",  # DIVISION 04, DIVISION 4
        r"DIV\.?\s*(\d{1,2})",  # DIV 04, DIV. 4
        r"DIVISION\s+([A-Z]+)",  # DIVISION FOUR (word form)
    ]

    # Word to number mapping
    word_to_num = {
        "ONE": "01",
        "TWO": "02",
        "THREE": "03",
        "FOUR": "04",
        "FIVE": "05",
        "SIX": "06",
        "SEVEN": "07",
        "EIGHT": "08",
        "NINE": "09",
        "TEN": "10",
        "ELEVEN": "11",
        "TWELVE": "12",
        "THIRTEEN": "13",
        "FOURTEEN": "14",
        "FIFTEEN": "15",
        "SIXTEEN": "16",
        "SEVENTEEN": "17",
        "EIGHTEEN": "18",
        "NINETEEN": "19",
        "TWENTY": "20",
    }

    for pattern in div_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            val = match.group(1).upper()
            if val.isdigit():
                div_code = val.zfill(2)
            elif val in word_to_num:
                div_code = word_to_num[val]
            else:
                continue
            return {
                "division_code": div_code,
                "section_number": None,
                "section_title": None,
                "start_page": page_num,
            }

    # PATTERN GROUP 3: Keyword-based detection (fallback)
    # Only use if strong keywords appear prominently (near top of page)
    first_500 = text_upper[:500]

    keyword_divisions = {
        "02": ["EXISTING CONDITIONS", "SITE CONSTRUCTION", "DEMOLITION"],
        "03": ["CONCRETE", "CAST-IN-PLACE", "PRECAST"],
        "04": [
            "MASONRY",
            "UNIT MASONRY",
            "CMU",
            "BRICK",
            "STONE VENEER",
            "CONCRETE UNIT",
        ],
        "05": ["METALS", "STRUCTURAL STEEL", "METAL FABRICATIONS", "STEEL DECK"],
        "06": ["WOOD", "ROUGH CARPENTRY", "FINISH CARPENTRY", "ARCHITECTURAL WOODWORK"],
        "07": [
            "THERMAL",
            "MOISTURE",
            "WATERPROOFING",
            "INSULATION",
            "ROOFING",
            "FIREPROOFING",
            "SEALANTS",
        ],
        "08": ["OPENINGS", "DOORS", "WINDOWS", "GLAZING", "HARDWARE"],
        "09": [
            "FINISHES",
            "DRYWALL",
            "GYPSUM",
            "TILE",
            "FLOORING",
            "PAINTING",
            "ACOUSTICAL",
        ],
        "10": ["SPECIALTIES", "SIGNAGE", "TOILET ACCESSORIES", "LOCKERS"],
        "11": ["EQUIPMENT", "FOOD SERVICE", "RESIDENTIAL EQUIPMENT"],
        "12": ["FURNISHINGS", "FURNITURE", "WINDOW TREATMENTS"],
        "13": ["SPECIAL CONSTRUCTION", "SWIMMING POOL", "CLEAN ROOM"],
        "14": ["CONVEYING", "ELEVATORS", "ESCALATORS"],
        "21": ["FIRE SUPPRESSION", "SPRINKLER"],
        "22": ["PLUMBING", "DOMESTIC WATER", "SANITARY"],
        "23": ["HVAC", "HEATING", "VENTILATING", "AIR CONDITIONING", "DUCTWORK"],
        "26": ["ELECTRICAL", "POWER DISTRIBUTION", "LIGHTING"],
        "27": ["COMMUNICATIONS", "DATA", "VOICE"],
        "28": ["ELECTRONIC SAFETY", "FIRE ALARM", "ACCESS CONTROL"],
        "31": ["EARTHWORK", "SITE CLEARING", "GRADING", "EXCAVATION"],
        "32": ["EXTERIOR IMPROVEMENTS", "PAVING", "LANDSCAPING"],
        "33": ["UTILITIES", "STORM DRAINAGE", "SANITARY SEWER"],
    }

    for div_code, keywords in keyword_divisions.items():
        for keyword in keywords:
            # Must be prominent - appear in header area and be a clear title
            if keyword in first_500:
                # Extra validation: should look like a section header, not just a mention
                # Check for PART 1, GENERAL, or all-caps format nearby
                if "PART 1" in text_upper or "GENERAL" in first_500:
                    return {
                        "division_code": div_code,
                        "section_number": None,
                        "section_title": keyword,
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

    page_pattern = re.compile(r"--- Page (\d+) ---")

    while start < len(text):
        end = min(start + tile_size, len(text))
        tile_content = text[start:end]

        pages_in_tile = page_pattern.findall(tile_content)
        page_from = int(pages_in_tile[0]) if pages_in_tile else 0
        page_to = int(pages_in_tile[-1]) if pages_in_tile else page_from

        cross_refs = find_cross_references(tile_content)
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


def find_cross_references(text: str) -> List[str]:
    """Find all cross-references to other sections."""
    matches = re.findall(CROSS_REF_PATTERN, text)
    refs = [f"{m[0]} {m[1]} {m[2]}" for m in matches]
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
# FULL PARSE PIPELINE - PyMuPDF (memory efficient)
# ═══════════════════════════════════════════════════════════════


def parse_spec(pdf_bytes: bytes, spec_id: str) -> Dict[str, Any]:
    """
    Full parsing pipeline using PyMuPDF for memory efficiency.

    PyMuPDF streams pages instead of loading entire PDF structure,
    making it much better for large documents.
    """
    divisions = []
    current_division = None
    page_count = 0

    print(f"[PARSE] Starting parse for spec {spec_id}")
    print(f"[PARSE] PDF size: {len(pdf_bytes):,} bytes")

    # Open PDF with PyMuPDF
    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = len(pdf)
    print(f"[PARSE] Total pages: {page_count}")

    # PASS 1: Scan for division headers
    print("[PARSE] Pass 1: Scanning for division headers...")

    for page_num in range(page_count):
        page = pdf[page_num]
        text = clean_text(page.get_text())

        # Check for division headers (page_num is 0-indexed, we want 1-indexed)
        division_info = detect_division_header(text, page_num + 1)

        if division_info:
            if current_division:
                current_division["end_page"] = page_num  # previous page (0-indexed)
                divisions.append(current_division)
            current_division = division_info

        # Progress logging every 100 pages
        if (page_num + 1) % 100 == 0:
            print(f"[PARSE] Scanned {page_num + 1}/{page_count} pages...")

    # Close last division
    if current_division:
        current_division["end_page"] = page_count
        divisions.append(current_division)

    # Merge consecutive sections of the same division
    divisions = merge_division_sections(divisions)
    print(f"[PARSE] Found {len(divisions)} divisions")

    # PASS 2: Extract text and generate tiles for each division
    print("[PARSE] Pass 2: Extracting text and generating tiles...")
    all_tiles = []

    for div in divisions:
        start_pg = div["start_page"]
        end_pg = div["end_page"]

        print(
            f"[PARSE] Processing Division {div['division_code']}: pages {start_pg}-{end_pg}"
        )

        # Build text for this division
        div_text = ""
        for pg in range(start_pg - 1, min(end_pg, page_count)):
            page = pdf[pg]
            page_text = clean_text(page.get_text())
            div_text += f"\n--- Page {pg + 1} ---\n{page_text}"

        # Generate tiles
        tiles = tile_text(
            text=div_text,
            spec_id=spec_id,
            division_code=div["division_code"],
            section_number=div.get("section_number"),
            section_title=div.get("section_title"),
        )
        all_tiles.extend(tiles)

        # Free memory
        del div_text
        gc.collect()

    # Close PDF
    pdf.close()

    print(f"[PARSE] Generated {len(all_tiles)} tiles")

    return {
        "page_count": page_count,
        "divisions": divisions,
        "tiles": all_tiles,
        "division_count": len(divisions),
        "tile_count": len(all_tiles),
    }
