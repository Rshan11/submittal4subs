"""
HYBRID PARSER - Four-Tier Page Classification

Four-tier approach to page classification:
0. PDF Outline/Bookmarks (most accurate - built into PDF)
1. TOC Text Parsing (when PDF has no outline but has text TOC with page numbers)
2. Footer Pattern Matching (section - page number format)
3. AI Header Scan (Gemini classifies page headers when tiers 0-2 fail)

Each page is processed and tagged with its section number.
The classification_method field tracks which tier was used:
- 'outline' = PDF built-in bookmarks/outline
- 'toc' = Text-based TOC parsing
- 'footer' = Header/footer pattern matching
- 'ai' = AI header classification (Gemini)
"""

import gc
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
import httpx

# Gemini API for AI fallback classification
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

# Valid CSI MasterFormat division codes
VALID_DIVISIONS = {
    "00",
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12",
    "13",
    "14",
    "21",
    "22",
    "23",
    "25",
    "26",
    "27",
    "28",
    "31",
    "32",
    "33",
    "34",
    "35",
    "40",
    "41",
    "42",
    "43",
    "44",
    "45",
    "46",
    "47",
    "48",
}

# Trade keywords for Tier 3 fallback classification
TRADE_KEYWORDS = {
    "03": ["CONCRETE", "CAST-IN-PLACE", "FORMWORK", "REINFORCEMENT", "REBAR"],
    "04": ["MASONRY", "CMU", "BRICK", "MORTAR", "GROUT", "UNIT MASONRY", "VENEER"],
    "05": ["STRUCTURAL STEEL", "METAL FABRICATIONS", "STEEL DECK"],
    "06": ["CARPENTRY", "ROUGH CARPENTRY", "FINISH CARPENTRY", "MILLWORK"],
    "07": ["WATERPROOFING", "INSULATION", "ROOFING", "SIDING", "FLASHING"],
    "08": ["DOORS", "WINDOWS", "HARDWARE", "GLAZING"],
    "09": ["FINISHES", "GYPSUM", "DRYWALL", "TILE", "FLOORING", "PAINT"],
    "21": ["FIRE SUPPRESSION", "SPRINKLER"],
    "22": ["PLUMBING", "PIPING", "FIXTURES"],
    "23": ["HVAC", "MECHANICAL", "DUCTWORK", "AIR CONDITIONING"],
    "26": ["ELECTRICAL", "WIRING", "CONDUIT", "PANELS", "LIGHTING"],
    "27": ["COMMUNICATIONS", "DATA", "TELECOM"],
    "28": ["FIRE ALARM", "SECURITY", "DETECTION"],
    "31": ["EARTHWORK", "EXCAVATION", "GRADING", "SITE CLEARING"],
    "32": ["EXTERIOR IMPROVEMENTS", "PAVING", "LANDSCAPE"],
    "33": ["UTILITIES", "STORM DRAINAGE", "SANITARY SEWER"],
}


# ═══════════════════════════════════════════════════════════════
# TEXT UTILITIES
# ═══════════════════════════════════════════════════════════════


def clean_text(text: str) -> str:
    """Remove problematic Unicode characters that cause encoding issues"""
    if not text:
        return ""

    # Remove null bytes first - PostgreSQL can't handle these
    text = text.replace("\x00", "")
    text = text.replace("\u0000", "")

    # Remove other problematic characters
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
# TIER 0: PDF OUTLINE/BOOKMARKS (Built-in TOC)
# ═══════════════════════════════════════════════════════════════


def extract_pdf_outline(pdf: fitz.Document) -> Dict[str, int]:
    """
    Extract section -> page mapping from PDF's built-in outline/bookmarks.

    This is the most reliable method when available - the PDF author has
    already defined the exact page for each section.

    Returns: {"03 30 00": 70, "04 22 00": 95, ...}

    NOTE: Returns empty dict if outline only contains generic sections
    (Division 00/01) - these are "outline specs" that need content scanning.
    """
    toc = pdf.get_toc()
    if not toc:
        return {}

    section_to_page = {}

    # Pattern to extract section number from bookmark title
    # Matches: "031000", "03 10 00", "033000 RIB - Cast-in-Place Concrete"
    section_pattern = re.compile(r"(\d{2})\s*(\d{2})\s*(\d{2})(?:\.(\d+))?")

    for entry in toc:
        level, title, page = entry

        # Try to extract section number from title
        match = section_pattern.search(title)
        if match:
            div = match.group(1)

            # Validate it's a real CSI division
            if div not in VALID_DIVISIONS:
                continue

            section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
            if match.group(4):
                section += f".{match.group(4)}"

            # Only store if we don't have this section yet (first occurrence wins)
            if section not in section_to_page:
                section_to_page[section] = page

    # VALIDATION: Check if outline has any real trade divisions
    # If it's all Division 00/01, this is an "outline spec" - reject the outline
    trade_divisions = [s for s in section_to_page.keys() if s[:2] not in ("00", "01")]
    if not trade_divisions:
        print(
            "[PARSE] PDF outline only contains Division 00/01 - skipping outline, will use content scan"
        )
        return {}

    print(f"[PARSE] PDF outline has {len(trade_divisions)} trade divisions")
    return section_to_page


def detect_spec_format(pages_sample: List[str]) -> str:
    """
    Scan first ~50 pages to detect the footer/header format used in this spec.

    Returns the dominant format found:
    - "compact_page": "04220 - 1" or "042200 - 1" (5 or 6 digit, no spaces)
    - "spaced_page": "04 22 00 - 1" (with spaces)
    - "section_compact": "SECTION 04220" or "SECTION 042200"
    - "section_spaced": "SECTION 04 22 00"
    - "none": No clear format detected
    """
    formats_found = {
        "compact_page": 0,  # "04220 - 1" or "042200 - 1" (no spaces)
        "spaced_page": 0,  # "04 22 00 - 1" (with spaces)
        "section_compact": 0,  # "SECTION 04220" or "SECTION 042200"
        "section_spaced": 0,  # "SECTION 04 22 00"
    }

    # Patterns to detect each format - more flexible
    # Compact: 5 or 6 digits with no spaces before the dash
    # Spaced: digits separated by spaces
    patterns = {
        "compact_page": re.compile(r"(0[1-9]|[1-4]\d)(\d{3,4})\s*[-–—]\s*\d{1,3}"),
        "spaced_page": re.compile(
            r"(0[1-9]|[1-4]\d)\s+(\d{2})\s*(\d{2})?\s*[-–—]\s*\d{1,3}"
        ),
        "section_compact": re.compile(
            r"SECTION\s+(0[1-9]|[1-4]\d)(\d{3,4})\b", re.IGNORECASE
        ),
        "section_spaced": re.compile(
            r"SECTION\s+(0[1-9]|[1-4]\d)\s+(\d{2})\s+(\d{2})", re.IGNORECASE
        ),
    }

    for text in pages_sample:
        if not text:
            continue
        # Check both header and footer regions
        header = text[:600].upper() if len(text) > 600 else text.upper()
        footer = text[-600:].upper() if len(text) > 600 else text.upper()
        search_text = header + "\n" + footer

        for fmt, pattern in patterns.items():
            if pattern.search(search_text):
                formats_found[fmt] += 1

    # Find the dominant format
    if not any(formats_found.values()):
        return "none"

    best_format = max(formats_found, key=lambda k: formats_found[k])

    print(f"[PARSE] Format detection: {formats_found}")
    print(f"[PARSE] Using format: {best_format}")

    return best_format if formats_found[best_format] > 0 else "none"


def detect_division_from_content(
    text: str, spec_format: str = "auto"
) -> Tuple[Optional[str], Optional[str]]:
    """
    Detect section from page header/footer ONLY - not from body content.

    Uses the pre-detected spec_format to apply only the matching pattern,
    avoiding false positives from cross-references.

    spec_format options:
    - "compact_page": "04220 - 1" or "042200 - 1" (no spaces)
    - "spaced_page": "04 22 00 - 1" (with spaces)
    - "section_compact": "SECTION 04220" or "SECTION 042200"
    - "section_spaced": "SECTION 04 22 00"
    - "auto": Try all patterns (legacy behavior)
    - "none": No pattern detected, skip

    Returns: (section_number, division_code) or (None, None)
    """
    if not text or len(text) < 100:
        return None, None

    if spec_format == "none":
        return None, None

    # Check BOTH header (first 600 chars) and footer (last 600 chars)
    # PDF text extraction sometimes puts page footers at the START of text
    header = text[:600].upper() if len(text) > 600 else text.upper()
    footer = text[-600:].upper() if len(text) > 600 else text.upper()
    search_regions = [header, footer]

    # Define patterns - flexible to handle various real-world formats
    # Compact: 5-6 digits no spaces (04220, 042200)
    # Spaced: digits with spaces (04 22 00, 04 22 0)
    patterns = {
        "compact_page": re.compile(r"(0[1-9]|[1-4]\d)(\d{3,4})\s*[-–—]\s*\d{1,3}"),
        "spaced_page": re.compile(
            r"(0[1-9]|[1-4]\d)\s+(\d{2})\s*(\d{2})?(?:\.(\d+))?\s*[-–—]\s*\d{1,3}"
        ),
        "section_compact": re.compile(r"SECTION\s+(0[1-9]|[1-4]\d)(\d{3,4})\b"),
        "section_spaced": re.compile(
            r"SECTION\s+(0[1-9]|[1-4]\d)\s+(\d{2})\s+(\d{2})(?:\.(\d+))?"
        ),
    }

    def extract_section(match, fmt):
        """Extract section number from match based on format type."""
        div = match.group(1)
        if div not in VALID_DIVISIONS or div in ("00", "01"):
            return None, None

        if fmt in ("compact_page", "section_compact"):
            # Compact format: div + remaining digits (e.g., "04" + "220" or "04" + "2200")
            rest = match.group(2)
            # Normalize to 6-digit format with spaces for consistency
            if len(rest) == 3:
                # 5-digit: 04220 -> 04 22 0 (but store as 04 22 00 padded)
                section = f"{div} {rest[:2]} {rest[2:]}0"
            else:
                # 6-digit: 042200 -> 04 22 00
                section = f"{div} {rest[:2]} {rest[2:]}"
            return section, div
        else:
            # Spaced format: already has spaces
            g2 = match.group(2) or "00"
            g3 = match.group(3) or "00"
            section = f"{div} {g2} {g3}"
            if len(match.groups()) > 3 and match.group(4):
                section += f".{match.group(4)}"
            return section, div

    # If specific format detected, use only that pattern
    if spec_format in patterns:
        pattern = patterns[spec_format]
        for region in search_regions:
            match = pattern.search(region)
            if match:
                section, div = extract_section(match, spec_format)
                if section:
                    return section, div
        return None, None

    # "auto" mode - try all patterns (legacy behavior)
    for fmt in ["spaced_page", "compact_page", "section_spaced", "section_compact"]:
        pattern = patterns[fmt]
        for region in search_regions:
            match = pattern.search(region)
            if match:
                section, div = extract_section(match, fmt)
                if section:
                    return section, div

    # Pattern 3: "DIVISION XX" header (fallback for division start pages)
    pattern_division = re.compile(r"DIVISION\s+(0?[1-9]|[1-4]\d)\b")

    for region in search_regions:
        match = pattern_division.search(region)
        if match:
            div = match.group(1).zfill(2)
            if div in VALID_DIVISIONS and div not in ("00", "01"):
                return f"{div} 00 00", div

    return None, None


def detect_all_divisions_from_content(text: str) -> List[Tuple[str, str]]:
    """
    Find section identifiers in page header/footer ONLY.
    Used for building division summary from pages that may not be in PDF outline.

    Only looks at header/footer patterns, NOT body content, to avoid
    false positives from cross-references.

    Returns: List of (section_number, division_code) tuples
    """
    if not text or len(text) < 100:
        return []

    # Only check header and footer regions
    header = text[:600].upper() if len(text) > 600 else text.upper()
    footer = text[-600:].upper() if len(text) > 600 else text.upper()
    search_text = header + "\n" + footer

    divisions = []
    seen = set()

    def normalize_section(div: str, rest: str) -> str:
        """Normalize section to spaced 6-digit format."""
        # rest could be 3 digits (220) or 4 digits (2200)
        if len(rest) == 3:
            return f"{div} {rest[:2]} {rest[2:]}0"
        elif len(rest) == 4:
            return f"{div} {rest[:2]} {rest[2:]}"
        else:
            return f"{div} {rest[:2]} {rest[2:4]}"

    # Spaced format: "04 22 00 - 5" or "04 22 0 - 5"
    spaced_pattern = re.compile(
        r"(0[1-9]|[1-4]\d)\s+(\d{2})\s*(\d{1,2})?(?:\.(\d+))?\s*[-–—]\s*\d{1,3}"
    )

    for match in spaced_pattern.finditer(search_text):
        div = match.group(1)
        if div in VALID_DIVISIONS and div not in ("00", "01"):
            g2 = match.group(2) or "00"
            g3 = match.group(3) or "00"
            if len(g3) == 1:
                g3 = g3 + "0"
            section = f"{div} {g2} {g3}"
            if match.group(4):
                section += f".{match.group(4)}"
            if section not in seen:
                seen.add(section)
                divisions.append((section, div))

    # Compact format: "04220 - 5" or "042200 - 5" (5 or 6 digits, no spaces)
    compact_pattern = re.compile(r"(0[1-9]|[1-4]\d)(\d{3,4})\s*[-–—]\s*\d{1,3}")

    for match in compact_pattern.finditer(search_text):
        div = match.group(1)
        if div in VALID_DIVISIONS and div not in ("00", "01"):
            section = normalize_section(div, match.group(2))
            if section not in seen:
                seen.add(section)
                divisions.append((section, div))

    # SECTION header spaced: "SECTION 04 22 00"
    section_spaced = re.compile(
        r"SECTION\s+(0[1-9]|[1-4]\d)\s+(\d{2})\s+(\d{2})(?:\.(\d+))?"
    )

    for match in section_spaced.finditer(search_text):
        div = match.group(1)
        if div in VALID_DIVISIONS and div not in ("00", "01"):
            section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
            if match.group(4):
                section += f".{match.group(4)}"
            if section not in seen:
                seen.add(section)
                divisions.append((section, div))

    # SECTION header compact: "SECTION 04220" or "SECTION 042200"
    section_compact = re.compile(r"SECTION\s+(0[1-9]|[1-4]\d)(\d{3,4})\b")

    for match in section_compact.finditer(search_text):
        div = match.group(1)
        if div in VALID_DIVISIONS and div not in ("00", "01"):
            section = normalize_section(div, match.group(2))
            if section not in seen:
                seen.add(section)
                divisions.append((section, div))

    return divisions


def assign_pages_from_outline(
    pages: List[dict], outline_map: Dict[str, int], spec_format: str = "auto"
) -> List[dict]:
    """
    Use PDF outline mapping to assign section numbers to pages.

    Logic: If outline says section 04 22 00 starts on page 95,
    then pages 95+ are section 04 22 00 until the next section starts.

    IMPORTANT: After outline assignment, we ALWAYS do a content scan.
    If content has a section header (like "04 20 00 UNIT MASONRY") that
    differs from the outline assignment, the content wins. This handles
    "outline specs" where the PDF outline is incomplete.
    """
    if not outline_map:
        return pages

    # Sort sections by starting page
    sorted_sections = sorted(outline_map.items(), key=lambda x: x[1])

    for page in pages:
        page_num = page["page_number"]

        # Find which section this page belongs to based on outline
        assigned_section = None
        for i, (section, start_page) in enumerate(sorted_sections):
            if page_num >= start_page:
                # Check if there's a next section
                if i + 1 < len(sorted_sections):
                    next_start = sorted_sections[i + 1][1]
                    if page_num < next_start:
                        assigned_section = section
                        break
                else:
                    # Last section - assign if page >= start
                    assigned_section = section

        if assigned_section:
            page["section_number"] = assigned_section
            page["division_code"] = assigned_section[:2]
            page["classification_method"] = "outline"

        # ALWAYS scan page content for section headers
        # If content contains a clear section header (like "04 20 00 UNIT MASONRY")
        # that isn't in the outline, override the outline assignment
        content_section, content_div = detect_division_from_content(
            page["content"], spec_format
        )
        if content_div:
            # Check if this division is NOT in the outline
            outline_divisions = set(s[:2] for s in outline_map.keys())
            if content_div not in outline_divisions:
                # This division isn't in the outline - content wins!
                page["section_number"] = content_section
                page["division_code"] = content_div
                page["classification_method"] = "content"
                print(
                    f"[PARSE] Page {page_num}: Content override - found {content_section} (not in outline)"
                )
            elif assigned_section and assigned_section[:2] in ("00", "01"):
                # Outline assigned generic section but content has real trade division
                page["section_number"] = content_section
                page["division_code"] = content_div
                page["classification_method"] = "outline+"

    return pages


# ═══════════════════════════════════════════════════════════════
# TIER 1: TEXT-BASED TABLE OF CONTENTS / INDEX PARSING
# ═══════════════════════════════════════════════════════════════


def find_toc_pages(pages: List[dict]) -> List[int]:
    """
    Find pages that are likely Table of Contents.
    Usually in first 50 pages, contains "TABLE OF CONTENTS" or "CONTENTS"
    and multiple section number references.
    """
    toc_pages = []

    for page in pages[:50]:  # Only check first 50 pages
        text = page.get("content", "").upper()

        # Check for TOC indicators
        has_toc_header = any(
            marker in text
            for marker in [
                "TABLE OF CONTENTS",
                "CONTENTS",
                "INDEX OF SPECIFICATIONS",
                "SPECIFICATION INDEX",
            ]
        )

        # Count section number patterns on the page
        section_pattern = re.compile(r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b")
        section_matches = section_pattern.findall(text)

        # If has TOC header AND multiple section numbers, it's likely TOC
        if has_toc_header and len(section_matches) >= 5:
            toc_pages.append(page["page_number"])

    return toc_pages


def find_index_pages(pages: List[dict]) -> List[int]:
    """
    Find pages that are likely an Index (usually at end of document).
    Check last 50 pages for "INDEX" header and multiple section references.
    """
    index_pages = []

    # Check last 50 pages
    last_50 = pages[-50:] if len(pages) > 50 else pages

    for page in last_50:
        text = page.get("content", "").upper()

        # Check for Index indicators
        has_index_header = any(
            marker in text
            for marker in [
                "INDEX",
                "SPECIFICATION INDEX",
                "SECTION INDEX",
                "INDEX OF SECTIONS",
            ]
        )

        # Count section number patterns on the page
        section_pattern = re.compile(r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b")
        section_matches = section_pattern.findall(text)

        # If has Index header AND multiple section numbers, it's likely Index
        if has_index_header and len(section_matches) >= 5:
            index_pages.append(page["page_number"])

    return index_pages


def is_toc_page(text: str) -> bool:
    """
    Detect TOC/index pages to skip during footer detection.

    These pages should be tagged as Division 00 (Procurement/General)
    rather than incorrectly classified based on section numbers listed.
    """
    text_upper = text.upper()

    # Explicit TOC headers
    if "TABLE OF CONTENTS" in text_upper:
        return True
    if "INDEX OF SPECIFICATIONS" in text_upper:
        return True
    if "SPECIFICATION INDEX" in text_upper:
        return True

    # Multiple "Section XX XX XX" listings on same page = TOC page
    # This catches TOC pages without explicit headers
    section_listings = re.findall(
        r"Section\s+\d{2}\s+\d{2}\s+\d{2}", text, re.IGNORECASE
    )
    if len(section_listings) > 3:
        return True

    # Many section numbers on a page (more than 5) = likely TOC/index
    section_pattern = re.compile(r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b")
    section_matches = section_pattern.findall(text)
    if len(section_matches) > 8:
        return True

    return False


def validate_toc_map(toc_map: dict, total_pages: int) -> dict:
    """
    Reject TOC mappings that aren't real page numbers.

    Some specs have TOC entries without real page numbers - they show
    TOC page order (1, 2, 3, 4, 5) instead of actual document pages.
    This causes false classifications where TOC pages get assigned
    to sections instead of falling through to footer detection.
    """
    if not toc_map:
        return {}

    page_numbers = sorted(toc_map.values())
    max_page = max(page_numbers)
    min_page = min(page_numbers)

    print(
        f"[PARSE] TOC validation: {len(toc_map)} sections, pages {min_page}-{max_page}, total_pages={total_pages}"
    )

    # CRITICAL: If all page numbers are small (under 20) and start from 1-ish,
    # it's TOC page order, not real page numbers
    if max_page <= 20 and min_page <= 2:
        print(
            f"[PARSE] TOC pages look like TOC order (1-{max_page}), not real page numbers - rejecting"
        )
        return {}

    # If max page number is less than 10, definitely wrong
    if max_page < 10:
        print(f"[PARSE] TOC max page {max_page} too low, rejecting")
        return {}

    # If we don't span at least 20% of the document, probably wrong
    if max_page < total_pages * 0.2:
        print(f"[PARSE] TOC doesn't span document ({max_page} vs {total_pages} pages)")
        return {}

    return toc_map


def parse_toc(toc_text: str) -> Dict[str, int]:
    """
    Parse TOC to extract section -> starting page mapping.

    TOC formats vary, but common patterns:
    - "04 22 00 CONCRETE UNIT MASONRY............120"
    - "SECTION 04 22 00 - CONCRETE UNIT MASONRY     120"
    - "04 22 00    Concrete Unit Masonry    Page 120"

    Returns: {"04 22 00": 120, "04 21 13.13": 115, ...}
    """
    section_to_page = {}

    # Pattern: section number followed eventually by a page number
    # Handles dots, dashes, spaces between section and page
    pattern = re.compile(
        r"(\d{2})\s+(\d{2})\s+(\d{2})(?:\.(\d+))?"  # Section number
        r"[^\d]*?"  # Non-digit chars (title, dots)
        r"(\d{1,4})\s*$",  # Page number at end of line
        re.MULTILINE,
    )

    for match in pattern.finditer(toc_text):
        div = match.group(1)

        # Validate it's a real CSI division
        if div not in VALID_DIVISIONS:
            continue

        section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
        if match.group(4):  # Has subsection like .13
            section += f".{match.group(4)}"

        page_num = int(match.group(5))

        # Sanity check - page numbers should be reasonable
        if 1 <= page_num <= 5000:
            section_to_page[section] = page_num

    return section_to_page


def find_best_toc_map(
    pages: List[dict], total_pages: int
) -> Tuple[Dict[str, int], str]:
    """
    Find and validate the best section->page mapping from TOC or Index.

    Returns: (section_map, source) where source is "toc", "index", or ""
    """
    # Find TOC and Index pages
    toc_pages = find_toc_pages(pages)
    index_pages = find_index_pages(pages)

    toc_map = {}
    index_map = {}

    # Parse and validate TOC
    if toc_pages:
        print(f"[PARSE] Found text TOC on pages: {toc_pages}")
        toc_text = "\n".join(
            p["content"] for p in pages if p["page_number"] in toc_pages
        )
        raw_map = parse_toc(toc_text)
        if raw_map:
            print(f"[PARSE] TOC parsed {len(raw_map)} sections, validating...")
            toc_map = validate_toc_map(raw_map, total_pages)
            if toc_map:
                print(f"[PARSE] TOC validated with {len(toc_map)} sections")

    # Parse and validate Index
    if index_pages:
        print(f"[PARSE] Found Index on pages: {index_pages}")
        index_text = "\n".join(
            p["content"] for p in pages if p["page_number"] in index_pages
        )
        raw_map = parse_toc(index_text)
        if raw_map:
            print(f"[PARSE] Index parsed {len(raw_map)} sections, validating...")
            index_map = validate_toc_map(raw_map, total_pages)
            if index_map:
                print(f"[PARSE] Index validated with {len(index_map)} sections")

    # Return whichever has more sections
    if len(index_map) > len(toc_map):
        if toc_map:
            print(f"[PARSE] Using Index ({len(index_map)}) over TOC ({len(toc_map)})")
        return index_map, "index"
    elif toc_map:
        if index_map:
            print(f"[PARSE] Using TOC ({len(toc_map)}) over Index ({len(index_map)})")
        return toc_map, "toc"

    if not toc_pages and not index_pages:
        print("[PARSE] No text TOC or Index found")

    return {}, ""


def apply_section_map(
    pages: List[dict], section_map: Dict[str, int], source: str
) -> None:
    """
    Apply section->page mapping to unclassified pages.
    Modifies pages in-place.
    """
    if not section_map:
        return

    sorted_sections = sorted(section_map.items(), key=lambda x: x[1])

    for page in pages:
        # Skip already classified pages (including pre-tagged TOC pages)
        if page["section_number"] is not None or page["division_code"] is not None:
            continue

        page_num = page["page_number"]
        for i, (section, start_page) in enumerate(sorted_sections):
            if page_num >= start_page:
                # Check if before next section starts
                next_start = (
                    sorted_sections[i + 1][1]
                    if i + 1 < len(sorted_sections)
                    else float("inf")
                )
                if page_num < next_start:
                    page["section_number"] = section
                    page["division_code"] = section[:2]
                    page["classification_method"] = source
                    break


# ═══════════════════════════════════════════════════════════════
# TIER 2: FOOTER PATTERN MATCHING
# ═══════════════════════════════════════════════════════════════


def is_valid_division(d1: str, d2: str, d3: str) -> bool:
    """
    Validate that a section number is a real CSI division, not a date.

    CSI Divisions: 00-14, 21-28, 31-35, 40-48
    Date pattern: MM DD YY where DD is 1-31, YY is 20-35
    """
    div = int(d1)
    mid = int(d2)
    last = int(d3)

    # Check if it's a valid CSI division
    if d1 not in VALID_DIVISIONS:
        return False

    # Check for date pattern: if middle number is 1-31 and last is 20-35
    # it's probably a date like 04 20 25 (April 20, 2025)
    if 1 <= mid <= 31 and 20 <= last <= 35:
        # Additional check: real sections have middle numbers like 00, 05, 10, 20, 21, 22...
        # Dates have middle numbers like 01-31
        # If middle looks like a day (1-31 but not common section patterns), it's probably a date
        common_section_mids = {
            0,
            5,
            10,
            15,
            20,
            21,
            22,
            23,
            24,
            25,
            30,
            35,
            40,
            50,
            60,
            70,
            80,
            90,
        }
        if mid not in common_section_mids and 1 <= mid <= 28:
            return False  # Likely a date

    return True


def extract_section_from_footer(text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract section number from footer using strict pattern.

    Key insight: Real section footers have format "XX XX XX - #" where # is page number.
    Cross-references in body text don't have this format.

    Examples of REAL footers:
    - "04 21 13.13 - 5"
    - "03 30 00 - 12"
    - "26 05 00 - 1"

    Examples of FALSE MATCHES to avoid:
    - "see Section 07 15 00" (cross-reference, no page number)
    - "04 20 25" (date: April 20, 2025)
    """
    if not text or len(text) < 100:
        return None, None

    # Check both header (first 600 chars) and footer (last 600 chars)
    header = text[:600] if len(text) > 600 else text
    footer = text[-600:] if len(text) > 600 else text

    # STRICT pattern 1: section number + dash + page number (with optional "/ total")
    # Matches: "03 30 00 - 12", "00 01 10 - 1 / 9"
    strict_pattern = re.compile(
        r"(\d{2})\s+(\d{2})\s+(\d{2})(?:\.(\d+))?\s*[-–—]\s*(\d{1,3})(?:\s*/\s*\d+)?",
        re.MULTILINE,
    )

    # STRICT pattern 2: "SECTION XX XX XX" in header (common format)
    section_header_pattern = re.compile(
        r"SECTION\s+(\d{2})\s+(\d{2})\s+(\d{2})(?:\.(\d+))?", re.IGNORECASE
    )

    # Try footer first (most reliable)
    match = strict_pattern.search(footer)
    if match:
        div = match.group(1)
        if is_valid_division(match.group(1), match.group(2), match.group(3)):
            section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
            if match.group(4):
                section += f".{match.group(4)}"
            return section, div

    # Try header with strict pattern
    match = strict_pattern.search(header)
    if match:
        div = match.group(1)
        if is_valid_division(match.group(1), match.group(2), match.group(3)):
            section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
            if match.group(4):
                section += f".{match.group(4)}"
            return section, div

    # Try "SECTION XX XX XX" pattern in header
    match = section_header_pattern.search(header)
    if match:
        div = match.group(1)
        if is_valid_division(match.group(1), match.group(2), match.group(3)):
            section = f"{match.group(1)} {match.group(2)} {match.group(3)}"
            if match.group(4):
                section += f".{match.group(4)}"
            return section, div

    return None, None


# ═══════════════════════════════════════════════════════════════
# TIER 3: AI HEADER CLASSIFICATION (Replaces keyword fallback)
# ═══════════════════════════════════════════════════════════════

# Batch size for AI classification (to stay within token limits)
AI_BATCH_SIZE = 100


def ai_find_section_boundaries(pages: List[dict]) -> List[Tuple[int, str, str]]:
    """
    Use AI to find section start pages, then use boundaries for classification.

    Two-phase approach:
    1. AI scans page headers to find "SECTION XX YY ZZ" patterns
    2. Use section start pages as boundaries to assign all pages

    Returns: List of (page_number, section_number, division_code) for section starts
    """
    import asyncio

    if not GEMINI_API_KEY:
        print("[PARSE] AI fallback: No GEMINI_API_KEY configured, skipping")
        return []

    if not pages:
        return []

    print(f"[PARSE] AI fallback: Finding section boundaries in {len(pages)} pages...")

    # Run async classification
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    try:
        boundaries = loop.run_until_complete(_ai_find_boundaries_async(pages))
        return boundaries
    except Exception as e:
        print(f"[PARSE] AI fallback failed: {e}")
        return []


async def _ai_find_boundaries_async(
    pages: List[dict],
) -> List[Tuple[int, str, str]]:
    """
    Async implementation: Find section boundaries by scanning page headers.
    Returns list of (page_number, section_number, division_code) tuples.
    """
    all_boundaries = []
    total_pages = len(pages)

    async with httpx.AsyncClient(timeout=60.0) as client:
        for batch_start in range(0, total_pages, AI_BATCH_SIZE):
            batch_end = min(batch_start + AI_BATCH_SIZE, total_pages)
            batch = pages[batch_start:batch_end]

            print(f"[PARSE] AI batch {batch_start + 1}-{batch_end} of {total_pages}...")

            # Build prompt - ask for section headers only
            prompt = """Find SECTION headers in these construction specification page headers.

For each page, if it has a "SECTION XX YY ZZ" header, return: {"page": N, "section": "XX YY ZZ"}
If no SECTION header, skip that page.

Examples of SECTION headers:
- "SECTION 01 30 00" -> {"page": 5, "section": "01 30 00"}
- "SECTION 23 05 15.13" -> {"page": 100, "section": "23 05 15"}
- "SECTION 07 21 13" -> {"page": 50, "section": "07 21 13"}

IGNORE cross-references like "See Section 23 05 00" - only match actual section title headers.

Return JSON array of objects for pages WITH section headers only.
Example: [{"page": 5, "section": "01 30 00"}, {"page": 100, "section": "23 05 15"}]

PAGE HEADERS:
"""
            for page in batch:
                page_num = page.get("page_number", 0)
                content = page.get("content", "")
                # First 300 chars to catch section header
                header = content[:300].replace("\n", " ").strip()
                prompt += f"Page {page_num}: {header}\n"

            # Call Gemini API
            try:
                response = await client.post(
                    f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "temperature": 0,
                            "maxOutputTokens": 4000,
                        },
                    },
                )

                if response.status_code != 200:
                    print(
                        f"[PARSE] AI API error {response.status_code}: {response.text[:200]}"
                    )
                    continue

                data = response.json()
                result_text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "[]")
                )

                # Parse boundaries from response
                batch_boundaries = _parse_boundary_response(result_text)
                all_boundaries.extend(batch_boundaries)

            except Exception as e:
                print(f"[PARSE] AI batch error: {e}")

    # Sort by page number
    all_boundaries.sort(key=lambda x: x[0])
    print(f"[PARSE] AI found {len(all_boundaries)} section boundaries")

    return all_boundaries


def _parse_boundary_response(response_text: str) -> List[Tuple[int, str, str]]:
    """
    Parse AI response for section boundaries.
    Returns list of (page_number, section_number, division_code) tuples.
    """
    boundaries = []

    try:
        # Clean up response - find JSON array
        text = response_text.strip()

        # Find array bounds
        start_idx = text.find("[")
        end_idx = text.rfind("]")

        if start_idx == -1 or end_idx == -1:
            print(f"[PARSE] AI boundary response not JSON array: {text[:100]}")
            return []

        json_str = text[start_idx : end_idx + 1]
        results = json.loads(json_str)

        if not isinstance(results, list):
            return []

        for item in results:
            if not isinstance(item, dict):
                continue

            page_num = item.get("page", 0)
            section = item.get("section", "")

            if not page_num or not section:
                continue

            # Extract division code (first 2 digits)
            section_clean = section.strip()
            if len(section_clean) >= 2:
                div_code = section_clean[:2]
                if div_code in VALID_DIVISIONS:
                    # Normalize section format
                    section_normalized = section_clean.replace("  ", " ")
                    boundaries.append((page_num, section_normalized, div_code))

        return boundaries

    except json.JSONDecodeError as e:
        print(f"[PARSE] AI boundary JSON parse error: {e}")
        return []


def apply_section_boundaries(
    pages: List[dict], boundaries: List[Tuple[int, str, str]]
) -> None:
    """
    Apply section boundaries to classify pages.

    Pages between section start N and section start N+1 belong to section N.
    """
    if not boundaries:
        return

    # Create page lookup
    page_lookup = {p["page_number"]: p for p in pages}

    for i, (start_page, section_num, div_code) in enumerate(boundaries):
        # Find end page (next section start - 1, or last page)
        if i + 1 < len(boundaries):
            end_page = boundaries[i + 1][0] - 1
        else:
            end_page = max(p["page_number"] for p in pages)

        # Assign all pages in range
        for page_num in range(start_page, end_page + 1):
            if page_num in page_lookup:
                page = page_lookup[page_num]
                # Only assign if not already classified
                if page["division_code"] is None:
                    page["section_number"] = section_num
                    page["division_code"] = div_code
                    page["classification_method"] = "ai"

    ai_count = sum(1 for p in pages if p.get("classification_method") == "ai")
    print(f"[PARSE] AI boundaries assigned {ai_count} pages")


# Legacy keyword fallback (disabled - replaced by AI)
def classify_by_keywords(text: str) -> Optional[str]:
    """
    DEPRECATED: Replaced by AI header classification.

    Fallback: classify page by trade-specific keywords.
    Only use when TOC and footer detection fail.

    Returns division code or None.
    """
    text_upper = text.upper()

    keyword_scores = {}

    for division, keywords in TRADE_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text_upper)
        if score > 0:
            keyword_scores[division] = score

    if not keyword_scores:
        return None

    # Return division with highest keyword match
    best_division = max(keyword_scores, key=lambda k: keyword_scores[k])

    # Only return if we have at least 2 keyword matches (confidence threshold)
    if keyword_scores[best_division] >= 2:
        return best_division

    return None


# ═══════════════════════════════════════════════════════════════
# CROSS-REFERENCE EXTRACTION
# ═══════════════════════════════════════════════════════════════


def extract_cross_references(text: str, own_section: Optional[str]) -> List[str]:
    """
    Find all section numbers mentioned in the page text.
    Exclude the page's own section number.
    """
    pattern = re.compile(r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b")
    matches = pattern.findall(text)

    refs = set()
    for m in matches:
        ref = f"{m[0]} {m[1]} {m[2]}"
        # Skip self-references
        if own_section and ref == own_section[:11]:
            continue
        # Validate it's a real section
        if is_valid_division(m[0], m[1], m[2]):
            refs.add(ref)

    return sorted(list(refs))


# ═══════════════════════════════════════════════════════════════
# MAIN HYBRID PARSER
# ═══════════════════════════════════════════════════════════════


def parse_spec(pdf_bytes: bytes, spec_id: str) -> Dict[str, Any]:
    """
    Hybrid parser using 4-tier approach:
    0. Try PDF outline/bookmarks first (most reliable)
    1. Try text-based TOC parsing
    2. Fall back to footer pattern matching
    3. AI header classification (Gemini) when tiers 0-2 fail

    Returns dict with pages ready for database insert.
    """
    pages = []

    print(f"[PARSE] Starting hybrid parse for spec {spec_id}")
    print(f"[PARSE] PDF size: {len(pdf_bytes):,} bytes")

    pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(pdf)
    print(f"[PARSE] Total pages: {total_pages}")

    # TIER 0: Try PDF outline/bookmarks first (before extracting pages)
    outline_map = extract_pdf_outline(pdf)
    if outline_map:
        print(f"[PARSE] Found PDF outline with {len(outline_map)} sections")
    else:
        print("[PARSE] No PDF outline/bookmarks found")

    # Extract all pages
    for page_num in range(total_pages):
        page = pdf[page_num]
        text = clean_text(page.get_text())

        # Skip blank/nearly blank pages
        if not text or len(text.strip()) < 50:
            continue

        pages.append(
            {
                "spec_id": spec_id,
                "page_number": page_num + 1,
                "content": text,
                "char_count": len(text),
                "section_number": None,
                "division_code": None,
                "classification_method": None,
            }
        )

        # Progress logging every 100 pages
        if (page_num + 1) % 100 == 0:
            print(f"[PARSE] Extracted {page_num + 1}/{total_pages} pages...")
            gc.collect()

    pdf.close()

    print(f"[PARSE] Extracted {len(pages)} pages with content")

    # DETECT SPEC FORMAT: Scan first 50 pages to determine footer/header format
    sample_pages = [p["content"] for p in pages[:50]]
    spec_format = detect_spec_format(sample_pages)

    # Apply TIER 0: PDF outline classification
    if outline_map:
        pages = assign_pages_from_outline(pages, outline_map, spec_format)
        outline_classified = sum(
            1 for p in pages if p.get("classification_method") == "outline"
        )
        print(f"[PARSE] Outline classified {outline_classified} pages")

    # Pre-tag TOC/index pages as Division 00 BEFORE any classification
    # This prevents TOC pages from being assigned to sections listed on them
    toc_page_count = 0
    for page in pages:
        if page["section_number"] is not None:
            continue  # Already classified by outline
        if is_toc_page(page["content"]):
            page["division_code"] = "00"
            page["classification_method"] = "toc_page"
            toc_page_count += 1

    if toc_page_count > 0:
        print(f"[PARSE] Pre-tagged {toc_page_count} TOC/index pages as Division 00")

    # TIER 1: Try text-based TOC and Index parsing
    section_map, map_source = find_best_toc_map(pages, total_pages)
    apply_section_map(pages, section_map, map_source)

    # TIER 2: For pages not classified, try footer/header pattern with detected format
    for page in pages:
        if page["section_number"] is not None or page["division_code"] is not None:
            continue  # Already classified

        # Try footer/header pattern using detected spec format
        section, division = detect_division_from_content(page["content"], spec_format)
        if section:
            page["section_number"] = section
            page["division_code"] = division
            page["classification_method"] = "footer"

    # Inheritance pass (section continuity)
    # If a page has no classification but the previous page does,
    # it's likely a continuation of the same section
    prev_section = None
    prev_division = None
    for page in pages:
        if page["division_code"] is not None:
            # This page is classified - remember it for next page
            prev_section = page.get("section_number")
            prev_division = page["division_code"]
        elif prev_division is not None:
            # This page is unclassified but previous was - inherit
            page["section_number"] = prev_section
            page["division_code"] = prev_division
            page["classification_method"] = "inherit"

    # TIER 3: AI Section Boundary Detection
    # If we still have many unclassified pages, use AI to find section headers
    # then assign pages based on boundaries (not per-page classification)
    unclassified_pages = [p for p in pages if p["division_code"] is None]

    if unclassified_pages:
        classified_count = len(pages) - len(unclassified_pages)
        classified_ratio = classified_count / len(pages) if pages else 0

        # Only use AI if less than 50% of pages are classified
        if classified_ratio < 0.5:
            print(
                f"[PARSE] Only {classified_ratio:.0%} classified - triggering AI fallback"
            )

            # Find section boundaries using AI
            boundaries = ai_find_section_boundaries(pages)

            if boundaries:
                # Apply boundaries to assign pages
                apply_section_boundaries(pages, boundaries)
        else:
            print(
                f"[PARSE] {classified_ratio:.0%} already classified - skipping AI fallback"
            )

    # Extract cross-references for all pages
    for page in pages:
        page["cross_refs"] = extract_cross_references(
            page["content"], page.get("section_number")
        )
        # Convert empty list to None for database
        if not page["cross_refs"]:
            page["cross_refs"] = None

    # Build classification stats
    classified = sum(1 for p in pages if p["division_code"])
    outline_classified = sum(
        1 for p in pages if p.get("classification_method") == "outline"
    )
    content_classified = sum(
        1 for p in pages if p.get("classification_method") == "content"
    )
    outline_plus_classified = sum(
        1 for p in pages if p.get("classification_method") == "outline+"
    )
    toc_classified = sum(1 for p in pages if p.get("classification_method") == "toc")
    index_classified = sum(
        1 for p in pages if p.get("classification_method") == "index"
    )
    footer_classified = sum(
        1 for p in pages if p.get("classification_method") == "footer"
    )
    inherit_classified = sum(
        1 for p in pages if p.get("classification_method") == "inherit"
    )
    toc_page_classified = sum(
        1 for p in pages if p.get("classification_method") == "toc_page"
    )
    ai_classified = sum(1 for p in pages if p.get("classification_method") == "ai")
    unclassified = len(pages) - classified

    print("[PARSE] Classification summary:")
    print(f"[PARSE]   Total pages: {len(pages)}")
    print(f"[PARSE]   Classified: {classified}")
    print(f"[PARSE]     - By PDF outline: {outline_classified}")
    print(f"[PARSE]     - By content scan: {content_classified}")
    print(f"[PARSE]     - By outline+content: {outline_plus_classified}")
    print(f"[PARSE]     - By text TOC: {toc_classified}")
    print(f"[PARSE]     - By Index: {index_classified}")
    print(f"[PARSE]     - By footer: {footer_classified}")
    print(f"[PARSE]     - By AI header scan: {ai_classified}")
    print(f"[PARSE]     - By inherit: {inherit_classified}")
    print(f"[PARSE]     - TOC/index pages (Div 00): {toc_page_classified}")
    print(f"[PARSE]   Unclassified: {unclassified}")

    # Build division summary
    divisions_found = set()
    sections_found = set()
    division_summary = {}

    for p in pages:
        div = p["division_code"]
        if div:
            divisions_found.add(div)
            if div not in division_summary:
                division_summary[div] = {"pages": [], "count": 0, "sections": set()}
            division_summary[div]["pages"].append(p["page_number"])
            division_summary[div]["count"] += 1
            if p["section_number"]:
                sections_found.add(p["section_number"])
                division_summary[div]["sections"].add(p["section_number"])

        # ALSO scan page content for all division references
        # This catches outline specs where multiple divisions appear on one page
        content_divisions = detect_all_divisions_from_content(p.get("content", ""))
        for section, content_div in content_divisions:
            divisions_found.add(content_div)
            sections_found.add(section)
            if content_div not in division_summary:
                division_summary[content_div] = {
                    "pages": [],
                    "count": 0,
                    "sections": set(),
                }
            if p["page_number"] not in division_summary[content_div]["pages"]:
                division_summary[content_div]["pages"].append(p["page_number"])
                division_summary[content_div]["count"] += 1
            division_summary[content_div]["sections"].add(section)

    # Convert sections set to list for JSON serialization
    for div in division_summary:
        division_summary[div]["sections"] = sorted(
            list(division_summary[div]["sections"])
        )

    print(f"[PARSE] Found {len(divisions_found)} divisions:")
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
        "outline_found": len(outline_map) > 0,
        "outline_sections_mapped": len(outline_map),
        "toc_found": map_source in ("toc", "index"),
        "toc_sections_mapped": len(section_map),
        "classification_stats": {
            "total": len(pages),
            "classified": classified,
            "outline": outline_classified,
            "content": content_classified,
            "outline+": outline_plus_classified,
            "toc": toc_classified,
            "index": index_classified,
            "footer": footer_classified,
            "ai": ai_classified,
            "inherit": inherit_classified,
            "toc_page": toc_page_classified,
            "unclassified": unclassified,
        },
    }


# ═══════════════════════════════════════════════════════════════
# LEGACY COMPATIBILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════

# These functions are kept for backward compatibility with existing code
# that may still use the tile-based approach

TILE_SIZE = 4000  # Characters per tile
TILE_OVERLAP = 500  # Overlap between tiles

# Cross-reference pattern for legacy functions
CROSS_REF_PATTERN = re.compile(r"\b(\d{2})\s+(\d{2})\s+(\d{2})\b")


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
