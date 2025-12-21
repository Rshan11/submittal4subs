"""
Supabase Database Client

Supports both:
- Page-level architecture (spec_pages table) - NEW
- Tile-based architecture (spec_tiles table) - LEGACY
"""

import os
from typing import Any, Dict, List, Optional

from supabase import Client, create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")


def get_supabase() -> Client:
    """Get Supabase client with service role key"""
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ═══════════════════════════════════════════════════════════════
# SPECS TABLE
# ═══════════════════════════════════════════════════════════════


def create_spec(
    user_id: str,
    job_id: str,
    r2_key: str,
    original_name: str,
    page_count: Optional[int] = None,
) -> Dict[str, Any]:
    """Insert a new spec record"""
    client = get_supabase()

    data = {
        "user_id": user_id,
        "job_id": job_id,
        "r2_key": r2_key,
        "original_name": original_name,
        "page_count": page_count,
        "status": "uploaded",
    }

    result = client.table("specs").insert(data).execute()
    return result.data[0] if result.data else None


def get_spec(spec_id: str) -> Optional[Dict[str, Any]]:
    """Get a spec by ID"""
    client = get_supabase()
    result = client.table("specs").select("*").eq("id", spec_id).single().execute()
    return result.data


def update_spec_status(
    spec_id: str, status: str, page_count: Optional[int] = None
) -> None:
    """Update spec status"""
    client = get_supabase()
    data = {"status": status}
    if page_count is not None:
        data["page_count"] = page_count
    client.table("specs").update(data).eq("id", spec_id).execute()


# ═══════════════════════════════════════════════════════════════
# SPEC_PAGES TABLE (NEW - Page-Level Architecture)
# ═══════════════════════════════════════════════════════════════


def insert_pages_batch(pages: List[Dict[str, Any]], batch_size: int = 100) -> None:
    """Insert pages in batches for efficiency"""
    if not pages:
        return

    client = get_supabase()

    for i in range(0, len(pages), batch_size):
        batch = pages[i : i + batch_size]
        client.table("spec_pages").insert(batch).execute()
        print(f"[DB] Inserted batch {i // batch_size + 1} ({len(batch)} pages)")


def delete_pages(spec_id: str) -> None:
    """Delete all pages for a spec (for re-parsing)"""
    client = get_supabase()
    client.table("spec_pages").delete().eq("spec_id", spec_id).execute()


def get_pages_by_division(spec_id: str, division_code: str) -> List[Dict[str, Any]]:
    """Get all pages for a specific division"""
    client = get_supabase()
    result = (
        client.table("spec_pages")
        .select("*")
        .eq("spec_id", spec_id)
        .eq("division_code", division_code)
        .order("page_number")
        .execute()
    )
    return result.data or []


def get_pages_by_section(spec_id: str, section_number: str) -> List[Dict[str, Any]]:
    """
    Get all pages for a specific section (e.g., '07 92 00')
    Uses LIKE to match section prefixes (07 92 00 matches 07 92 00.13)
    """
    client = get_supabase()
    result = (
        client.table("spec_pages")
        .select("*")
        .eq("spec_id", spec_id)
        .like("section_number", f"{section_number}%")
        .order("page_number")
        .execute()
    )
    return result.data or []


def get_all_pages(spec_id: str) -> List[Dict[str, Any]]:
    """Get all pages for a spec, ordered by page number"""
    client = get_supabase()
    result = (
        client.table("spec_pages")
        .select("*")
        .eq("spec_id", spec_id)
        .order("page_number")
        .execute()
    )
    return result.data or []


def get_division_summary(spec_id: str) -> List[Dict[str, Any]]:
    """
    Get summary of divisions in a spec.
    Returns list of {division_code, page_count, sections}
    """
    client = get_supabase()

    # Get all pages grouped by division
    result = (
        client.table("spec_pages")
        .select("division_code, section_number, page_number")
        .eq("spec_id", spec_id)
        .not_.is_("division_code", "null")
        .order("division_code")
        .execute()
    )

    if not result.data:
        return []

    # Aggregate by division
    divisions = {}
    for row in result.data:
        div = row["division_code"]
        if div not in divisions:
            divisions[div] = {
                "division_code": div,
                "page_count": 0,
                "sections": set(),
                "pages": [],
            }
        divisions[div]["page_count"] += 1
        divisions[div]["pages"].append(row["page_number"])
        if row.get("section_number"):
            divisions[div]["sections"].add(row["section_number"])

    # Convert to list format
    result_list = []
    for div in sorted(divisions.keys()):
        info = divisions[div]
        result_list.append(
            {
                "division_code": div,
                "page_count": info["page_count"],
                "sections": sorted(list(info["sections"])),
                "page_range": f"{min(info['pages'])}-{max(info['pages'])}"
                if info["pages"]
                else None,
            }
        )

    return result_list


def get_sections_for_division(spec_id: str, division_code: str) -> List[Dict[str, Any]]:
    """
    Get all sections within a division, with page counts and content.
    Used for section-by-section analysis of large divisions.

    Returns list of dicts with:
    - section_number: e.g., "23 05 15"
    - page_count: number of pages in this section
    - pages: list of page numbers
    - content: concatenated text content from all pages
    """
    client = get_supabase()

    # Get all pages for this division, grouped by section
    result = (
        client.table("spec_pages")
        .select("section_number, page_number, content")
        .eq("spec_id", spec_id)
        .eq("division_code", division_code)
        .not_.is_("section_number", "null")
        .order("section_number")
        .order("page_number")
        .execute()
    )

    if not result.data:
        return []

    # Group by section
    sections = {}
    for row in result.data:
        section = row["section_number"]
        if section not in sections:
            sections[section] = {
                "section_number": section,
                "pages": [],
                "content_parts": [],
            }
        sections[section]["pages"].append(row["page_number"])
        sections[section]["content_parts"].append(
            f"--- Page {row['page_number']} ---\n{row['content']}"
        )

    # Build final list
    result_list = []
    for section_num in sorted(sections.keys()):
        info = sections[section_num]
        result_list.append(
            {
                "section_number": section_num,
                "page_count": len(info["pages"]),
                "pages": info["pages"],
                "content": "\n\n".join(info["content_parts"]),
            }
        )

    return result_list


# ═══════════════════════════════════════════════════════════════
# SPEC_DIVISIONS TABLE (LEGACY - kept for compatibility)
# ═══════════════════════════════════════════════════════════════


def insert_division(
    spec_id: str,
    division_code: str,
    section_number: Optional[str],
    section_title: Optional[str],
    start_page: int,
    end_page: int,
) -> Dict[str, Any]:
    """Insert a division record (legacy)"""
    client = get_supabase()

    data = {
        "spec_id": spec_id,
        "division_code": division_code,
        "section_number": section_number,
        "section_title": section_title,
        "start_page": start_page,
        "end_page": end_page,
    }

    result = client.table("spec_divisions").insert(data).execute()
    return result.data[0] if result.data else None


def get_divisions(spec_id: str) -> List[Dict[str, Any]]:
    """Get all divisions for a spec (legacy)"""
    client = get_supabase()
    result = client.table("spec_divisions").select("*").eq("spec_id", spec_id).execute()
    return result.data or []


def delete_divisions(spec_id: str) -> None:
    """Delete all divisions for a spec (for re-parsing)"""
    client = get_supabase()
    client.table("spec_divisions").delete().eq("spec_id", spec_id).execute()


# ═══════════════════════════════════════════════════════════════
# SPEC_TILES TABLE (LEGACY - kept for compatibility)
# ═══════════════════════════════════════════════════════════════


def insert_tile(
    spec_id: str,
    division_code: str,
    section_number: Optional[str],
    section_title: Optional[str],
    part: Optional[str],
    page_from: int,
    page_to: int,
    tile_index: int,
    content: str,
    cross_refs: List[str],
) -> Dict[str, Any]:
    """Insert a tile record (legacy)"""
    client = get_supabase()

    data = {
        "spec_id": spec_id,
        "division_code": division_code,
        "section_number": section_number,
        "section_title": section_title,
        "part": part,
        "page_from": page_from,
        "page_to": page_to,
        "tile_index": tile_index,
        "content": content,
        "cross_refs": cross_refs,
    }

    result = client.table("spec_tiles").insert(data).execute()
    return result.data[0] if result.data else None


def insert_tiles_batch(tiles: List[Dict[str, Any]]) -> None:
    """Batch insert tiles (legacy)"""
    if not tiles:
        return
    client = get_supabase()
    client.table("spec_tiles").insert(tiles).execute()


def get_tiles_by_division(spec_id: str, division_code: str) -> List[Dict[str, Any]]:
    """Get all tiles for a specific division (legacy)"""
    client = get_supabase()
    result = (
        client.table("spec_tiles")
        .select("*")
        .eq("spec_id", spec_id)
        .eq("division_code", division_code)
        .order("tile_index")
        .execute()
    )
    return result.data or []


def get_tiles_by_sections(
    spec_id: str, section_numbers: List[str]
) -> List[Dict[str, Any]]:
    """Get tiles for specific section numbers (legacy)"""
    if not section_numbers:
        return []
    client = get_supabase()
    result = (
        client.table("spec_tiles")
        .select("*")
        .eq("spec_id", spec_id)
        .in_("section_number", section_numbers)
        .order("tile_index")
        .execute()
    )
    return result.data or []


def delete_tiles(spec_id: str) -> None:
    """Delete all tiles for a spec (for re-parsing)"""
    client = get_supabase()
    client.table("spec_tiles").delete().eq("spec_id", spec_id).execute()


# ═══════════════════════════════════════════════════════════════
# SPEC_ANALYSES TABLE
# ═══════════════════════════════════════════════════════════════


def insert_analysis(
    spec_id: str,
    job_id: str,
    division_code: str,
    analysis_type: str,
    result: Dict[str, Any],
    processing_time_ms: int,
) -> Dict[str, Any]:
    """Insert an analysis result"""
    client = get_supabase()

    data = {
        "spec_id": spec_id,
        "job_id": job_id,
        "division_code": division_code,
        "analysis_type": analysis_type,
        "result": result,
        "processing_time_ms": processing_time_ms,
        "processing_time_ms": processing_time_ms,
    }

    result_data = client.table("spec_analyses").insert(data).execute()
    return result_data.data[0] if result_data.data else None


def get_analysis(spec_id: str, division_code: str) -> Optional[Dict[str, Any]]:
    """Get existing analysis for a division"""
    client = get_supabase()
    result = (
        client.table("spec_analyses")
        .select("*")
        .eq("spec_id", spec_id)
        .eq("division_code", division_code)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def get_all_analyses(spec_id: str) -> List[Dict[str, Any]]:
    """Get all analyses for a spec"""
    client = get_supabase()
    result = (
        client.table("spec_analyses")
        .select("*")
        .eq("spec_id", spec_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


# ═══════════════════════════════════════════════════════════════
# JOBS TABLE
# ═══════════════════════════════════════════════════════════════


def delete_job(job_id: str, user_id: str) -> bool:
    """
    Delete a job and all related data.

    Manually deletes in correct order to respect foreign key constraints:
    1. spec_analyses (references job_id and spec_id)
    2. spec_pages (references spec_id)
    3. spec_divisions (references spec_id) - legacy
    4. spec_tiles (references spec_id) - legacy
    5. specs (references job_id)
    6. jobs

    Returns True if successful, False if job not found or not owned by user.
    """
    client = get_supabase()

    # First verify the job exists and belongs to this user
    result = (
        client.table("jobs")
        .select("id")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        return False

    # Get all specs for this job (needed to delete related records)
    specs_result = client.table("specs").select("id").eq("job_id", job_id).execute()
    spec_ids = [s["id"] for s in (specs_result.data or [])]

    print(f"[DB] Deleting job {job_id} with {len(spec_ids)} specs")

    # Delete in order to respect foreign key constraints
    # 1. Delete spec_analyses (has FK to both jobs and specs)
    client.table("spec_analyses").delete().eq("job_id", job_id).execute()
    print(f"[DB] Deleted spec_analyses for job {job_id}")

    # 2. Delete spec_pages for each spec
    for spec_id in spec_ids:
        client.table("spec_pages").delete().eq("spec_id", spec_id).execute()
    print(f"[DB] Deleted spec_pages for {len(spec_ids)} specs")

    # 3. Delete spec_divisions (legacy) for each spec
    for spec_id in spec_ids:
        client.table("spec_divisions").delete().eq("spec_id", spec_id).execute()

    # 4. Delete spec_tiles (legacy) for each spec
    for spec_id in spec_ids:
        client.table("spec_tiles").delete().eq("spec_id", spec_id).execute()

    # 5. Delete specs
    client.table("specs").delete().eq("job_id", job_id).execute()
    print(f"[DB] Deleted specs for job {job_id}")

    # 6. Delete the job itself
    client.table("jobs").delete().eq("id", job_id).execute()
    print(f"[DB] Deleted job {job_id}")

    return True
