"""
AI Analysis - Gemini + OpenAI Two-Stage Pipeline

Stage 1 (Gemini): Extract ALL product data with CRITICAL BID ITEMS first
Stage 2 (OpenAI): Create SHORT executive summary focused on action items

The key insight: Gemini extracts everything, OpenAI summarizes what to DO.
"""

import os
from typing import Any, Dict, List, Optional

import httpx

# API Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
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
    Stage 1: Gemini extracts ALL product data with CRITICAL ITEMS first.
    Universal prompt works for any division.
    """
    config = TRADE_CONFIGS.get(trade.lower(), TRADE_CONFIGS.get("general", {}))
    trade_name = config.get("name", trade.title())
    division = config.get("division", "XX")

    max_chars = 200000
    text_to_analyze = division_text[:max_chars]
    if len(division_text) > max_chars:
        text_to_analyze += "\n\n[TRUNCATED - additional content not shown]"

    prompt = f"""You are extracting product specifications from a construction spec document for a contractor preparing a bid.

PROJECT: {project_name or "Construction Project"}
DIVISION: {division} - {trade_name}

SPECIFICATION TEXT:
{text_to_analyze}

=======================================================================
OUTPUT FORMAT - Follow this EXACT structure:
=======================================================================

## CRITICAL BID ITEMS (Read This First)

Identify and list the items that MOST AFFECT BID PRICING:

### Specified Products (Basis of Design)
List ANY item where a specific manufacturer/product is named:
- [Product] - [Manufacturer] - [Model/Series if given]

### Color & Finish Selections
List ALL items with specified colors, textures, or finishes:
- [Item]: [Color/Finish] - [Manufacturer if specified]

### Premium/Unusual Requirements
List items that are MORE EXPENSIVE than standard:
- Stainless steel instead of galvanized
- Special coatings or treatments
- Higher grades than typical (e.g., Type 304 SS vs standard)
- Seismic or special structural requirements

### Quantity-Sensitive Items
List items where the spec defines specific sizes, gauges, or quantities:
- [Item]: [Size/Gauge/Specification]

---

## 1. Manufacturers & Products

| Manufacturer | Product | Model/Part # | Basis of Design? | Or Equal? |
|--------------|---------|--------------|------------------|-----------|
| (list all)   |         |              | Yes/No           | Yes/No    |

---

## 2. Material Specifications

For EACH material, list ALL specified properties:

### [Material Name]
- **Manufacturer**: (if specified)
- **Standard**: ASTM/ANSI reference with Type/Grade/Class
- **Size/Dimensions**:
- **Weight/Gauge/Thickness**:
- **Color/Finish**:
- **Special Requirements**: (seismic, fire rating, etc.)

---

## 3. Accessories & Components

| Item | Specification | Size | Material | Coating/Finish |
|------|---------------|------|----------|----------------|
| (list all anchors, ties, fasteners, supports, etc.) |

---

## 4. Submittals Required

- [ ] Product Data: (list items)
- [ ] Shop Drawings: (list items)
- [ ] Samples: (list items WITH sizes if specified)
- [ ] Certificates: (list items)
- [ ] Test Reports: (list items)

---

## 5. Coordination With Other Trades

| Item | Section | Provided By | Installed By |
|------|---------|-------------|--------------|
| (list all cross-references) |

---

## 6. Execution Requirements

### Quality/Testing
- (list specific tests, inspections, tolerances)

### Environmental Limits
- (temperature, humidity, curing requirements)

### Prohibited Items
- (list anything explicitly NOT allowed)

---

CRITICAL RULES:
1. The "CRITICAL BID ITEMS" section is MOST IMPORTANT - contractors read this first
2. If a specific manufacturer is named, it's critical - note if "or equal" is allowed
3. ANY color, finish, or texture specification is critical
4. Stainless steel, special coatings, seismic requirements = premium cost items
5. DO NOT SUMMARIZE - list every specific product/material
6. Include COMPLETE specification references (full ASTM with type/grade)
7. Leave sections empty if not found - don't make things up
8. DO NOT repeat content - if you've listed something once, don't list it again"""

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
