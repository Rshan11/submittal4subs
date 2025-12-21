"""
AI Analysis - Gemini + OpenAI Two-Stage Pipeline

Stage 1 (Gemini): Extract ALL product data with CRITICAL BID ITEMS first
Stage 2 (OpenAI): Create SHORT executive summary focused on action items

The key insight: Gemini extracts everything, OpenAI summarizes what to DO.
"""

import asyncio
import json
import os
import time
from typing import Any, Callable, Dict, List, Optional

import httpx
from prompts import (
    get_section_combine_prompt,
    get_section_extract_prompt,
    get_summarize_prompt,
)

# API Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"

# Trade configurations
TRADE_CONFIGS = {
    "masonry": {
        "division": "04",
        "name": "Masonry",
        "keywords": ["MASONRY", "BRICK", "CMU", "MORTAR", "GROUT", "UNIT MASONRY"],
    },
    "concrete": {
        "division": "03",
        "name": "Concrete",
        "keywords": ["CONCRETE", "CAST-IN-PLACE", "FORMWORK", "REINFORCEMENT"],
    },
    "steel": {
        "division": "05",
        "name": "Structural Steel",
        "keywords": ["STRUCTURAL STEEL", "METAL FABRICATIONS", "STEEL JOISTS"],
    },
    "wood": {
        "division": "06",
        "name": "Wood/Plastics/Composites",
        "keywords": ["ROUGH CARPENTRY", "FINISH CARPENTRY", "MILLWORK", "LUMBER"],
    },
    "thermal": {
        "division": "07",
        "name": "Thermal & Moisture Protection",
        "keywords": ["WATERPROOFING", "INSULATION", "ROOFING", "SEALANTS", "FLASHING"],
    },
    "openings": {
        "division": "08",
        "name": "Openings",
        "keywords": ["DOORS", "WINDOWS", "HARDWARE", "GLAZING", "FRAMES"],
    },
    "finishes": {
        "division": "09",
        "name": "Finishes",
        "keywords": ["DRYWALL", "GYPSUM", "PAINTING", "FLOORING", "TILE", "CEILING"],
    },
    "electrical": {
        "division": "26",
        "name": "Electrical",
        "keywords": ["ELECTRICAL", "WIRING", "CONDUCTORS", "PANELBOARDS"],
    },
    "plumbing": {
        "division": "22",
        "name": "Plumbing",
        "keywords": ["PLUMBING", "PIPING", "FIXTURES", "PUMPS"],
    },
    "mechanical": {
        "division": "23",
        "name": "Mechanical/HVAC",
        "keywords": ["HVAC", "MECHANICAL", "DUCTWORK", "AIR HANDLING"],
    },
    "sitework": {
        "division": "31",
        "name": "Earthwork",
        "keywords": ["EARTHWORK", "GRADING", "EXCAVATION", "SITE"],
    },
    "general": {
        "division": "XX",
        "name": "General",
        "keywords": [],
    },
}


# ═══════════════════════════════════════════════════════════════
# GEMINI ANALYSIS - Stage 1
# ═══════════════════════════════════════════════════════════════


async def analyze_division_with_gemini(
    division_text: str, trade: str, project_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Stage 1: Gemini analyzes division using trade-specific prompt.
    Prompts are loaded from prompts.py based on trade/division.
    """
    config = TRADE_CONFIGS.get(trade.lower(), TRADE_CONFIGS.get("general", {}))
    trade_name = config.get("name", trade.title())
    division = config.get("division", "XX")

    max_chars = 200000
    text_to_analyze = division_text[:max_chars]
    if len(division_text) > max_chars:
        text_to_analyze += "\n\n[TRUNCATED - additional content not shown]"

    # Get trade-specific prompt from prompts.py
    base_prompt = get_summarize_prompt(trade, division)

    prompt = f"""PROJECT: {project_name or "Construction Project"}
DIVISION: {division} - {trade_name}

SPECIFICATION TEXT:
{text_to_analyze}

=======================================================================
INSTRUCTIONS:
=======================================================================

{base_prompt}"""

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 16000},
            },
        )

        if response.status_code != 200:
            raise Exception(
                f"Gemini API error: {response.status_code} - {response.text}"
            )

        data = response.json()
        result_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )

        # Validate output - check for repetition loops
        if result_text:
            lines = result_text.split("\n")
            if len(lines) > 50:
                # Check for repetition
                seen = set()
                unique_lines = []
                for line in lines:
                    line_stripped = line.strip()
                    if line_stripped and len(line_stripped) > 20:
                        if line_stripped in seen:
                            continue  # Skip duplicate
                        seen.add(line_stripped)
                    unique_lines.append(line)
                result_text = "\n".join(unique_lines)

        return {
            "summary": result_text or "No extraction results",
            "format": "markdown",
            "trade": trade,
            "division": division,
        }


# ═══════════════════════════════════════════════════════════════
# CONTRACT TERMS ANALYSIS
# ═══════════════════════════════════════════════════════════════


async def analyze_contract_terms(
    div01_text: str, project_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Analyze Division 00-01 for contract terms
    """
    max_chars = 150000
    text_to_analyze = div01_text[:max_chars]
    if len(div01_text) > max_chars:
        text_to_analyze += "\n\n[TRUNCATED]"

    prompt = f"""You are a construction contract analyst reviewing Division 00 (Procurement) and Division 01 (General Requirements) specifications.

PROJECT: {project_name or "Construction Project"}

SPECIFICATION TEXT:
{text_to_analyze}

Extract and summarize the following CONTRACT and BUSINESS terms in a CONDENSED format for contractors:

## Contract Terms Summary

### Payment Terms
- Payment schedule/frequency
- Retainage percentage
- Payment conditions

### Bonding & Insurance
- Bond requirements (bid, performance, payment)
- Insurance requirements and limits
- Certificate requirements

### Change Orders
- Change order process
- Pricing requirements
- Time limits for claims

### Submittals & Approvals
- Submittal requirements
- Review timelines
- Approval process

### Security & Access
- Background check requirements
- Badge/ID requirements
- Site access restrictions
- Working hours

### Liquidated Damages
- Daily rate if specified
- Milestone penalties

### Schedule Requirements
- Substantial completion requirements
- Milestone dates
- Float ownership

### Warranty
- Warranty periods
- Special warranty requirements

### Key Risk Items
- Unusual or onerous terms
- Items requiring special attention
- Cost impact warnings

RULES:
1. Be CONCISE - use bullet points
2. BOLD key numbers, dates, and percentages
3. Skip sections if not found in spec
4. Flag anything unusual or risky
5. Include specific dollar amounts, percentages, and timeframes"""

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 8000},
            },
        )

        if response.status_code != 200:
            return {"summary": "Contract analysis failed", "error": response.text}

        data = response.json()
        result_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )

        return {
            "summary": result_text or "No contract terms found",
            "format": "markdown",
        }


# ═══════════════════════════════════════════════════════════════
# OPENAI EXECUTIVE SUMMARY - Stage 2
# ═══════════════════════════════════════════════════════════════


async def create_executive_summary(
    trade_summary: str,
    contract_summary: str,
    trade: str,
    project_name: Optional[str] = None,
) -> str:
    """
    Stage 2: OpenAI creates SHORT executive bid summary.
    Focuses on strategy since Gemini already extracted details.
    """
    if not OPENAI_API_KEY:
        return "OpenAI API key not configured - skipping executive summary"

    config = TRADE_CONFIGS.get(trade.lower(), {})
    trade_name = config.get("name", trade.title())

    # Truncate inputs to avoid token limits
    trade_summary_truncated = trade_summary[:15000] if trade_summary else ""
    contract_summary_truncated = contract_summary[:8000] if contract_summary else ""

    prompt = f"""You are a {trade_name} estimator reviewing extracted spec data for {project_name or "a construction project"}.

The detailed extraction is already done. Your job is to create a SHORT executive summary.

=== EXTRACTED SPEC DATA ===
{trade_summary_truncated}

=== CONTRACT TERMS ===
{contract_summary_truncated}

=== YOUR TASK ===

Create a BRIEF executive summary with these sections:

## Executive Bid Summary

### Pricing Impact Items
- List 3-5 items that MOST affect your bid price
- Note if items are premium (stainless, special colors, basis of design)
- Flag anything that needs supplier quotes

### Risk Alerts
- Unusual requirements that could cause problems
- Tight timelines or penalties
- Scope gaps or ambiguities to clarify

### Pre-Bid Actions
- [ ] Quotes needed from: (list specific suppliers)
- [ ] Clarifications to request: (list specific RFI topics)
- [ ] Coordination meetings: (list specific trades)

### Bid Notes
- 2-3 sentences of strategy advice for this specific bid

KEEP IT SHORT AND ACTIONABLE. The detailed specs are already extracted - don't repeat them. Focus on what the estimator needs to DO before bid day."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                OPENAI_API_URL,
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a construction bidding expert. Create concise, actionable bid summaries. Be specific - name actual products and suppliers from the spec data.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 1500,
                },
            )

            if response.status_code != 200:
                return f"Executive summary generation failed: {response.status_code}"

            data = response.json()
            return (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "No summary generated")
            )
    except Exception as e:
        return f"Executive summary error: {str(e)}"


# ═══════════════════════════════════════════════════════════════
# SECTION-BY-SECTION ANALYSIS (For Large Divisions)
# ═══════════════════════════════════════════════════════════════

# Threshold: Use section-by-section for divisions over this many pages
SECTION_ANALYSIS_PAGE_THRESHOLD = 100

# Maximum concurrent section extractions
MAX_CONCURRENT_EXTRACTIONS = 5


async def extract_section(
    section_number: str,
    section_title: str,
    content: str,
    page_count: int,
) -> Dict[str, Any]:
    """
    Phase 1: Extract data from a single section using Gemini.
    Returns structured JSON with equipment, materials, manufacturers, etc.
    """
    prompt = get_section_extract_prompt(section_number, section_title, page_count)

    full_prompt = f"""{prompt}

SPECIFICATION CONTENT:
{content}"""

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 8000,
                    "responseMimeType": "application/json",
                },
            },
        )

        if response.status_code != 200:
            return {
                "section": section_number,
                "error": f"API error: {response.status_code}",
            }

        data = response.json()
        result_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "{}")
        )

        # Parse JSON response
        try:
            return json.loads(result_text)
        except json.JSONDecodeError:
            # Try to extract JSON from response
            return {
                "section": section_number,
                "raw_text": result_text[:2000],
                "parse_error": True,
            }


async def combine_section_results(
    section_results: List[Dict[str, Any]],
    trade: str,
    division: str,
) -> Dict[str, Any]:
    """
    Phase 2: Combine all section extractions into a unified summary.
    """
    config = TRADE_CONFIGS.get(trade.lower(), TRADE_CONFIGS.get("general", {}))
    trade_name = config.get("name", trade.title())

    # Format section results for the prompt
    results_text = json.dumps(section_results, indent=2)

    # Truncate if too long
    max_chars = 150000
    if len(results_text) > max_chars:
        results_text = results_text[:max_chars] + "\n\n[TRUNCATED]"

    prompt = get_section_combine_prompt(
        trade_name=trade_name,
        division=division,
        section_count=len(section_results),
        section_results=results_text,
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 16000,
                    "responseMimeType": "application/json",
                },
            },
        )

        if response.status_code != 200:
            return {"error": f"Combine API error: {response.status_code}"}

        data = response.json()
        result_text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "{}")
        )

        try:
            return json.loads(result_text)
        except json.JSONDecodeError:
            return {"raw_combined": result_text, "parse_error": True}


async def format_combined_for_output(
    combined_data: Dict[str, Any],
    trade: str,
    division: str,
    project_name: Optional[str] = None,
    contract_summary: Optional[str] = None,
) -> str:
    """
    Phase 3: Convert combined JSON into formatted markdown using trade prompt.
    Includes contract summary for federal funding detection.
    """
    config = TRADE_CONFIGS.get(trade.lower(), TRADE_CONFIGS.get("general", {}))
    trade_name = config.get("name", trade.title())
    base_prompt = get_summarize_prompt(trade, division)

    combined_text = json.dumps(combined_data, indent=2)

    # Include contract info if available (for federal funding detection)
    contract_section = ""
    if contract_summary:
        contract_section = f"""
CONTRACT TERMS (Division 00/01):
{contract_summary}

"""

    prompt = f"""PROJECT: {project_name or "Construction Project"}
DIVISION: {division} - {trade_name}

You have already extracted and combined data from all sections. Now format this into the final bid summary.
{contract_section}
COMBINED EXTRACTION DATA:
{combined_text}

=======================================================================
FORMAT THE OUTPUT ACCORDING TO THESE INSTRUCTIONS:
=======================================================================

{base_prompt}

Note: The data has already been extracted section-by-section and combined.
Your job is to format it into the scannable summary format above.
Include any conflicts or gaps that were identified during extraction.
IMPORTANT: Check the CONTRACT TERMS section for federal funding indicators (Davis-Bacon, Buy American, DOD, etc.) and include in FUNDING & COMPLIANCE section."""

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 16000},
            },
        )

        if response.status_code != 200:
            return f"Formatting failed: {response.status_code}"

        data = response.json()
        return (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "No output generated")
        )


async def analyze_division_by_section(
    sections: List[Dict[str, Any]],
    trade: str,
    division: str,
    project_name: Optional[str] = None,
    progress_callback: Optional[Callable[[str, int, int], None]] = None,
    contract_summary: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Full section-by-section analysis pipeline for large divisions.

    Args:
        sections: List of section dicts with 'section_number', 'title', 'content', 'page_count'
        trade: Trade name for prompt selection
        division: Division code (e.g., "23")
        project_name: Optional project name
        progress_callback: Optional callback(status, current, total) for progress updates
        contract_summary: Optional pre-analyzed contract terms (for federal funding detection)

    Returns:
        Analysis result dict with trade_analysis, section_extractions, etc.
    """
    start_time = time.time()

    total_sections = len(sections)
    section_results = []

    if progress_callback:
        progress_callback("extracting", 0, total_sections)

    # Phase 1: Extract each section (with concurrency limit)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXTRACTIONS)

    async def extract_with_semaphore(section: Dict[str, Any], index: int):
        async with semaphore:
            result = await extract_section(
                section_number=section["section_number"],
                section_title=section.get("title", ""),
                content=section["content"],
                page_count=section.get("page_count", 0),
            )
            if progress_callback:
                progress_callback("extracting", index + 1, total_sections)
            return result

    # Run all extractions with concurrency limit
    tasks = [extract_with_semaphore(section, i) for i, section in enumerate(sections)]
    section_results = await asyncio.gather(*tasks, return_exceptions=True)

    # Filter out exceptions
    valid_results = []
    for i, result in enumerate(section_results):
        if isinstance(result, Exception):
            valid_results.append(
                {
                    "section": sections[i]["section_number"],
                    "error": str(result),
                }
            )
        else:
            valid_results.append(result)

    if progress_callback:
        progress_callback("combining", 0, 1)

    # Phase 2: Combine all results
    combined_data = await combine_section_results(valid_results, trade, division)

    if progress_callback:
        progress_callback("formatting", 0, 1)

    # Phase 3: Format for output (include contract summary for federal funding detection)
    formatted_summary = await format_combined_for_output(
        combined_data, trade, division, project_name, contract_summary
    )

    processing_time_ms = int((time.time() - start_time) * 1000)

    return {
        "trade_analysis": {
            "summary": formatted_summary,
            "format": "markdown",
            "trade": trade,
            "division": division,
            "section_by_section": True,
            "sections_analyzed": total_sections,
        },
        "section_extractions": valid_results,
        "combined_data": combined_data,
        "processing_time_ms": processing_time_ms,
    }


def should_use_section_analysis(page_count: int, section_count: int) -> bool:
    """
    Determine if section-by-section analysis should be used.

    Uses section analysis when:
    - Division has more than SECTION_ANALYSIS_PAGE_THRESHOLD pages (100)
    - AND has multiple sections (at least 2)
    """
    return page_count >= SECTION_ANALYSIS_PAGE_THRESHOLD and section_count >= 2


# ═══════════════════════════════════════════════════════════════
# FULL ANALYSIS PIPELINE
# ═══════════════════════════════════════════════════════════════


async def run_full_analysis(
    division_text: str,
    div01_text: Optional[str],
    trade: str,
    project_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run complete two-stage analysis pipeline:
    1. Gemini analyzes trade division
    2. Gemini analyzes contract terms (if div01 provided)
    3. OpenAI creates executive summary
    """
    import asyncio
    import time

    start_time = time.time()

    # Stage 1: Run trade and contract analysis in parallel
    tasks = [analyze_division_with_gemini(division_text, trade, project_name)]

    if div01_text:
        tasks.append(analyze_contract_terms(div01_text, project_name))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Handle results
    trade_analysis = (
        results[0]
        if not isinstance(results[0], Exception)
        else {
            "summary": f"Trade analysis failed: {results[0]}",
            "error": str(results[0]),
        }
    )

    contract_analysis = None
    if len(results) > 1 and not isinstance(results[1], Exception):
        contract_analysis = results[1]

    # Stage 2: Create executive summary
    executive_summary = None
    if contract_analysis and OPENAI_API_KEY:
        try:
            executive_summary = await create_executive_summary(
                trade_analysis.get("summary", ""),
                contract_analysis.get("summary", ""),
                trade,
                project_name,
            )
        except Exception as e:
            executive_summary = f"Executive summary failed: {e}"

    processing_time_ms = int((time.time() - start_time) * 1000)

    return {
        "trade_analysis": trade_analysis,
        "contract_analysis": contract_analysis,
        "executive_summary": executive_summary,
        "processing_time_ms": processing_time_ms,
    }


# ═══════════════════════════════════════════════════════════════
# LEGACY UTILITY FUNCTIONS
# ═══════════════════════════════════════════════════════════════


def stitch_tiles(tiles: List[Dict[str, Any]], overlap: int = 500) -> str:
    """
    Legacy function: Stitch tiles back together, handling overlaps.
    Kept for backward compatibility with tile-based code.
    """
    if not tiles:
        return ""
    if len(tiles) == 1:
        return tiles[0].get("content", "")

    result = tiles[0].get("content", "")

    for i in range(1, len(tiles)):
        prev_tile = tiles[i - 1]
        curr_tile = tiles[i]

        # Check if tiles are consecutive
        if curr_tile.get("tile_index", 0) == prev_tile.get("tile_index", -1) + 1:
            # Skip overlap region
            content = curr_tile.get("content", "")
            result += content[overlap:] if len(content) > overlap else content
        else:
            # Non-consecutive - add separator
            result += "\n\n--- [GAP] ---\n\n"
            result += curr_tile.get("content", "")

    return result
