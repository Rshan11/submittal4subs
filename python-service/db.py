"""
Supabase Database Client
"""
import os
from supabase import create_client, Client
from typing import Optional, List, Dict, Any
from datetime import datetime

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
    page_count: Optional[int] = None
) -> Dict[str, Any]:
    """Insert a new spec record"""
    client = get_supabase()

    data = {
        "user_id": user_id,
        "job_id": job_id,
        "r2_key": r2_key,
        "original_name": original_name,
        "page_count": page_count,
        "status": "uploaded"
    }

    result = client.table("specs").insert(data).execute()
    return result.data[0] if result.data else None

def get_spec(spec_id: str) -> Optional[Dict[str, Any]]:
    """Get a spec by ID"""
    client = get_supabase()
    result = client.table("specs").select("*").eq("id", spec_id).single().execute()
    return result.data

def update_spec_status(spec_id: str, status: str, page_count: Optional[int] = None) -> None:
    """Update spec status"""
    client = get_supabase()
    data = {"status": status}
    if page_count is not None:
        data["page_count"] = page_count
    client.table("specs").update(data).eq("id", spec_id).execute()

# ═══════════════════════════════════════════════════════════════
# SPEC_DIVISIONS TABLE
# ═══════════════════════════════════════════════════════════════

def insert_division(
    spec_id: str,
    division_code: str,
    section_number: Optional[str],
    section_title: Optional[str],
    start_page: int,
    end_page: int
) -> Dict[str, Any]:
    """Insert a division record"""
    client = get_supabase()

    data = {
        "spec_id": spec_id,
        "division_code": division_code,
        "section_number": section_number,
        "section_title": section_title,
        "start_page": start_page,
        "end_page": end_page
    }

    result = client.table("spec_divisions").insert(data).execute()
    return result.data[0] if result.data else None

def get_divisions(spec_id: str) -> List[Dict[str, Any]]:
    """Get all divisions for a spec"""
    client = get_supabase()
    result = client.table("spec_divisions").select("*").eq("spec_id", spec_id).execute()
    return result.data or []

def delete_divisions(spec_id: str) -> None:
    """Delete all divisions for a spec (for re-parsing)"""
    client = get_supabase()
    client.table("spec_divisions").delete().eq("spec_id", spec_id).execute()

# ═══════════════════════════════════════════════════════════════
# SPEC_TILES TABLE
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
    cross_refs: List[str]
) -> Dict[str, Any]:
    """Insert a tile record"""
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
        "cross_refs": cross_refs
    }

    result = client.table("spec_tiles").insert(data).execute()
    return result.data[0] if result.data else None

def insert_tiles_batch(tiles: List[Dict[str, Any]]) -> None:
    """Batch insert tiles"""
    if not tiles:
        return
    client = get_supabase()
    client.table("spec_tiles").insert(tiles).execute()

def get_tiles_by_division(spec_id: str, division_code: str) -> List[Dict[str, Any]]:
    """Get all tiles for a specific division"""
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

def get_tiles_by_sections(spec_id: str, section_numbers: List[str]) -> List[Dict[str, Any]]:
    """Get tiles for specific section numbers (for cross-refs)"""
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
    processing_time_ms: int
) -> Dict[str, Any]:
    """Insert an analysis result"""
    client = get_supabase()

    data = {
        "spec_id": spec_id,
        "job_id": job_id,
        "division_code": division_code,
        "analysis_type": analysis_type,
        "result": result,
        "processing_time_ms": processing_time_ms
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
