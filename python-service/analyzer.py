"""
AI Analysis - Gemini + OpenAI Two-Stage Pipeline
"""
import os
import json
import httpx
from typing import Dict, Any, List, Optional

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
        "emoji": "🧱",
        "keywords": ["MASONRY", "BRICK", "CMU", "MORTAR", "GROUT", "UNIT MASONRY"]
    },
    "concrete": {
        "division": "03",
        "name": "Concrete",
        "emoji": "🏗️",
        "keywords": ["CONCRETE", "CAST-IN-PLACE", "FORMWORK", "REINFORCEMENT"]
    },
    "steel": {
        "division": "05",
        "name": "Structural Steel",
        "emoji": "🔩",
        "keywords": ["STRUCTURAL STEEL", "METAL FABRICATIONS", "STEEL JOISTS"]
    },
    "electrical": {
        "division": "26",
        "name": "Electrical",
        "emoji": "⚡",
        "keywords": ["ELECTRICAL", "WIRING", "CONDUCTORS", "PANELBOARDS"]
    },
    "plumbing": {
        "division": "22",
        "name": "Plumbing",
        "emoji": "🔧",
        "keywords": ["PLUMBING", "PIPING", "FIXTURES", "PUMPS"]
    },
    "mechanical": {
        "division": "23",
        "name": "Mechanical/HVAC",
        "emoji": "❄️",
        "keywords": ["HVAC", "MECHANICAL", "DUCTWORK", "AIR HANDLING"]
    }
}


# ═══════════════════════════════════════════════════════════════
# GEMINI ANALYSIS
# ═══════════════════════════════════════════════════════════════

async def analyze_division_with_gemini(
    division_text: str,
    trade: str,
    project_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Stage 1: Gemini extracts materials, submittals, coordination items
    Returns markdown-formatted analysis
    """
    config = TRADE_CONFIGS.get(trade.lower(), TRADE_CONFIGS["masonry"])
    trade_emoji = config["emoji"]
    trade_name = config["name"]
    division = config["division"]

    # Limit text size
    max_chars = 200000
    text_to_analyze = division_text[:max_chars]
    if len(division_text) > max_chars:
        text_to_analyze += "\n\n[TRUNCATED - additional content not shown]"

    prompt = f"""You are a {trade} contractor analyzing Division {division} specifications. Create a CONDENSED, ACTIONABLE summary for bidding and field use.

PROJECT: {project_name or "Construction Project"}

SPECIFICATION TEXT:
{text_to_analyze}

Format your response EXACTLY like this example (use markdown):

{trade_emoji} {trade_name} Division Summary (Condensed Contractor Format)

## 1. Materials

### Primary Materials
- **Material Name** — ASTM Standard, Grade/Type
- List all materials with their specifications

### Accessories
- **Item** — specification details

## 2. Execution Requirements

### Weather Conditions
- Cold weather procedures
- Hot weather procedures

### Quality Standards
- Tolerances and standards
- Testing requirements

## 3. Related Divisions & Coordination

### Referenced Sections (items spec'd elsewhere)
| Item | See Section | Who Provides | Who Installs |
|------|-------------|--------------|--------------|
| Item name | XX XX XX | Div X | Div X |

### Scope Clarifications
- **BY {trade.upper()}**: Items explicitly assigned to this trade
- **BY OTHERS**: Items provided/installed by other trades
- **COORDINATE WITH**: Items requiring coordination

### Cost Impact Items
- Items that may affect your bid

---

RULES:
1. Be CONCISE - use bullet points, not paragraphs
2. BOLD the key specs (ASTM numbers, dimensions, types)
3. Group related items under clear headers
4. Include ALL ASTM/standard references found
5. Note any special restrictions (no X allowed, requires approval)
6. Skip sections if not found in the spec
7. Use em-dashes (—) to separate item names from specs
8. Extract ALL cross-references to other divisions
9. Note WHO provides vs WHO installs for each referenced item"""

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 16000
                }
            }
        )

        if response.status_code != 200:
            raise Exception(f"Gemini API error: {response.status_code} - {response.text}")

        data = response.json()
        result_text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")

        if not result_text:
            raise Exception("No response from Gemini")

        return {
            "summary": result_text,
            "format": "markdown",
            "trade": trade,
            "division": division
        }


async def analyze_contract_terms(
    div01_text: str,
    project_name: Optional[str] = None
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
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 8000
                }
            }
        )

        if response.status_code != 200:
            return {"summary": "Contract analysis failed", "error": response.text}

        data = response.json()
        result_text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")

        return {
            "summary": result_text or "No contract terms found",
            "format": "markdown"
        }


# ═══════════════════════════════════════════════════════════════
# OPENAI FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════

async def create_executive_summary(
    trade_summary: str,
    contract_summary: str,
    trade: str,
    project_name: Optional[str] = None
) -> str:
    """
    Stage 2: OpenAI creates executive bid summary
    Combines trade analysis + contract terms
    """
    if not OPENAI_API_KEY:
        return "OpenAI API key not configured - skipping executive summary"

    config = TRADE_CONFIGS.get(trade.lower(), TRADE_CONFIGS["masonry"])

    prompt = f"""You are creating an EXECUTIVE SUMMARY for a {trade} contractor bidding on {project_name or "a construction project"}.

Combine and synthesize these two analysis sections into ONE cohesive bid summary:

=== TRADE REQUIREMENTS (Division {config["division"]}) ===
{trade_summary}

=== CONTRACT TERMS (Division 00-01) ===
{contract_summary}

Create a final EXECUTIVE BID SUMMARY with these sections:

## Executive Bid Summary

### Critical Bid Items
- Top 5-7 items that MUST be included in the bid
- Key materials with specific specs
- Major scope items

### Risk & Cost Alerts
- Items that could impact pricing
- Unusual requirements
- Potential exclusions to consider

### Pre-Bid Checklist
- [ ] Key submittals required
- [ ] Bonds/insurance needed
- [ ] Background checks required
- [ ] Special certifications needed

### Bid Strategy Notes
- Suggested clarifications
- Items to verify
- Coordination concerns

Keep it CONCISE and ACTIONABLE. This is a quick-reference for bid day."""

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a construction bidding expert creating concise, actionable bid summaries for contractors."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.3,
                "max_tokens": 2000
            }
        )

        if response.status_code != 200:
            return "Executive summary generation failed"

        data = response.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "No summary generated")


# ═══════════════════════════════════════════════════════════════
# FULL ANALYSIS PIPELINE
# ═══════════════════════════════════════════════════════════════

async def run_full_analysis(
    division_text: str,
    div01_text: Optional[str],
    trade: str,
    project_name: Optional[str] = None
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
    trade_analysis = results[0] if not isinstance(results[0], Exception) else {
        "summary": f"Trade analysis failed: {results[0]}",
        "error": str(results[0])
    }

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
                project_name
            )
        except Exception as e:
            executive_summary = f"Executive summary failed: {e}"

    processing_time_ms = int((time.time() - start_time) * 1000)

    return {
        "trade_analysis": trade_analysis,
        "contract_analysis": contract_analysis,
        "executive_summary": executive_summary,
        "processing_time_ms": processing_time_ms
    }


def stitch_tiles(tiles: List[Dict[str, Any]], overlap: int = 500) -> str:
    """
    Stitch tiles back together, handling overlaps.
    Tiles should be sorted by tile_index.
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
