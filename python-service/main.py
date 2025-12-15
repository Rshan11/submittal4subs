"""
Spec Analyzer Python Service
Deployed on Render at submittal4subs.onrender.com

Endpoints:
- POST /upload - Upload PDF, store in R2, create spec record
- POST /parse/{spec_id} - Parse PDF into divisions and tiles
- POST /analyze/{spec_id} - Run AI analysis on a division
"""

import asyncio
import os
from typing import Optional
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load environment variables (check both python-service/.env and parent .env)
load_dotenv()  # python-service/.env
load_dotenv(dotenv_path="../.env")  # parent .env


# Also check for VITE_ prefixed vars (from frontend .env)
def get_env(key: str) -> str:
    return os.getenv(key) or os.getenv(f"VITE_{key}") or ""


# Set normalized env vars
if not os.getenv("SUPABASE_URL"):
    os.environ["SUPABASE_URL"] = get_env("SUPABASE_URL")
if not os.getenv("SUPABASE_SERVICE_KEY"):
    os.environ["SUPABASE_SERVICE_KEY"] = get_env("SUPABASE_SERVICE_KEY") or get_env(
        "SUPABASE_ANON_KEY"
    )
if not os.getenv("GEMINI_API_KEY"):
    os.environ["GEMINI_API_KEY"] = get_env("GEMINI_API_KEY")
if not os.getenv("OPENAI_API_KEY"):
    os.environ["OPENAI_API_KEY"] = get_env("OPENAI_API_KEY")

# Import our modules
from analyzer import TRADE_CONFIGS, run_full_analysis, stitch_tiles
from db import (
    create_spec,
    delete_divisions,
    delete_tiles,
    get_divisions,
    get_spec,
    get_tiles_by_division,
    get_tiles_by_sections,
    insert_analysis,
    insert_division,
    insert_tiles_batch,
    update_spec_status,
)
from parser import parse_spec
from storage import download_pdf, upload_pdf

# ═══════════════════════════════════════════════════════════════
# APP SETUP
# ═══════════════════════════════════════════════════════════════

app = FastAPI(
    title="Spec Analyzer API",
    description="PDF spec parsing and AI analysis service",
    version="2.0.0",
)

# CORS - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Must be False when allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

print("[BOOT] Spec Analyzer Service v2.0")
print(f"[BOOT] SUPABASE_URL: {'OK' if os.getenv('SUPABASE_URL') else 'MISSING'}")
print(
    f"[BOOT] SUPABASE_SERVICE_KEY: {'OK' if os.getenv('SUPABASE_SERVICE_KEY') else 'MISSING'}"
)
print(f"[BOOT] R2_ACCOUNT_ID: {'OK' if os.getenv('R2_ACCOUNT_ID') else 'MISSING'}")
print(f"[BOOT] GEMINI_API_KEY: {'OK' if os.getenv('GEMINI_API_KEY') else 'MISSING'}")
print(f"[BOOT] OPENAI_API_KEY: {'OK' if os.getenv('OPENAI_API_KEY') else 'MISSING'}")


# ═══════════════════════════════════════════════════════════════
# REQUEST/RESPONSE MODELS
# ═══════════════════════════════════════════════════════════════


class UploadResponse(BaseModel):
    spec_id: str
    r2_key: str
    original_name: str
    status: str


class ParseResponse(BaseModel):
    spec_id: str
    status: str
    page_count: int
    division_count: int
    tile_count: int
    divisions: list


class AnalyzeRequest(BaseModel):
    division: str
    include_contract_terms: bool = True
    project_name: Optional[str] = None


class AnalyzeResponse(BaseModel):
    spec_id: str
    division: str
    analysis: dict
    processing_time_ms: int


# ═══════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═══════════════════════════════════════════════════════════════


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "2.0.0",
        "services": {
            "supabase": bool(os.getenv("SUPABASE_URL")),
            "r2": bool(os.getenv("R2_ACCOUNT_ID")),
            "gemini": bool(os.getenv("GEMINI_API_KEY")),
            "openai": bool(os.getenv("OPENAI_API_KEY")),
        },
    }


# ═══════════════════════════════════════════════════════════════
# POST /upload
# ═══════════════════════════════════════════════════════════════


@app.post("/upload", response_model=UploadResponse)
async def upload_spec(
    file: UploadFile = File(...), user_id: str = Form(...), job_id: str = Form(...)
):
    """
    Upload a PDF specification.

    - Generates a spec_id (UUID)
    - Stores PDF in R2 at specs/{user_id}/{job_id}/{spec_id}.pdf
    - Creates row in specs table with status='uploaded'
    """
    print(f"\n{'=' * 50}")
    print(f"[UPLOAD] New upload request")
    print(f"[UPLOAD] User: {user_id}")
    print(f"[UPLOAD] Job: {job_id}")
    print(f"[UPLOAD] File: {file.filename}")
    print(f"{'=' * 50}\n")

    # Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        # Read file bytes
        pdf_bytes = await file.read()
        print(f"[UPLOAD] File size: {len(pdf_bytes):,} bytes")

        # Generate spec_id
        spec_id = str(uuid4())
        print(f"[UPLOAD] Generated spec_id: {spec_id}")

        # Upload to R2
        r2_key = upload_pdf(user_id, job_id, spec_id, pdf_bytes)
        print(f"[UPLOAD] Uploaded to R2: {r2_key}")

        # Create database record
        spec = create_spec(
            user_id=user_id, job_id=job_id, r2_key=r2_key, original_name=file.filename
        )
        print(f"[UPLOAD] Created spec record: {spec['id']}")

        return UploadResponse(
            spec_id=spec["id"],
            r2_key=r2_key,
            original_name=file.filename,
            status="uploaded",
        )

    except Exception as e:
        print(f"[UPLOAD] ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# POST /parse/{spec_id}
# ═══════════════════════════════════════════════════════════════


@app.post("/parse/{spec_id}", response_model=ParseResponse)
async def parse_spec_endpoint(spec_id: str):
    """
    Parse a PDF specification into divisions and tiles.

    - Fetches PDF from R2
    - Scans all pages for division headers
    - Creates spec_divisions records
    - Chunks text into ~4000 char tiles
    - Detects cross-references
    - Creates spec_tiles records
    - Updates specs.status = 'ready'
    """
    import sys

    print(f"\n{'=' * 50}", flush=True)
    print(f"[PARSE] Parsing spec: {spec_id}", flush=True)
    print(f"{'=' * 50}\n", flush=True)
    sys.stdout.flush()

    # Get spec record
    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    print(f"[PARSE] Found spec: {spec['original_name']}", flush=True)
    print(f"[PARSE] R2 key: {spec['r2_key']}", flush=True)
    sys.stdout.flush()

    try:
        # Update status to processing
        update_spec_status(spec_id, "processing")
        print("[PARSE] Status updated to processing", flush=True)

        # Download PDF from R2
        print("[PARSE] Downloading PDF from R2...", flush=True)
        sys.stdout.flush()
        pdf_bytes = download_pdf(spec["r2_key"])
        print(f"[PARSE] Downloaded {len(pdf_bytes):,} bytes", flush=True)

        # Clear existing divisions and tiles (for re-parsing)
        print("[PARSE] Clearing existing divisions/tiles...")
        delete_divisions(spec_id)
        delete_tiles(spec_id)

        # Parse the PDF
        print("[PARSE] Scanning for divisions...")
        result = parse_spec(pdf_bytes, spec_id)

        print(f"[PARSE] Found {result['division_count']} divisions")
        print(f"[PARSE] Generated {result['tile_count']} tiles")

        # Insert divisions
        for div in result["divisions"]:
            insert_division(
                spec_id=spec_id,
                division_code=div["division_code"],
                section_number=div.get("section_number"),
                section_title=div.get("section_title"),
                start_page=div["start_page"],
                end_page=div["end_page"],
            )
            print(
                f"[PARSE]   Division {div['division_code']}: pages {div['start_page']}-{div['end_page']}"
            )

        # Insert tiles in batches
        if result["tiles"]:
            print(f"[PARSE] Inserting {len(result['tiles'])} tiles...")
            # Batch insert (Supabase handles large batches)
            insert_tiles_batch(result["tiles"])

        # Update spec status
        update_spec_status(spec_id, "ready", result["page_count"])

        print(f"\n[PARSE] Complete!")

        return ParseResponse(
            spec_id=spec_id,
            status="ready",
            page_count=result["page_count"],
            division_count=result["division_count"],
            tile_count=result["tile_count"],
            divisions=[
                {
                    "code": d["division_code"],
                    "title": d.get("section_title"),
                    "pages": f"{d['start_page']}-{d['end_page']}",
                }
                for d in result["divisions"]
            ],
        )

    except Exception as e:
        print(f"[PARSE] ERROR: {e}")
        update_spec_status(spec_id, "failed")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# POST /analyze/{spec_id}
# ═══════════════════════════════════════════════════════════════


@app.post("/analyze/{spec_id}", response_model=AnalyzeResponse)
async def analyze_spec_endpoint(spec_id: str, request: AnalyzeRequest):
    """
    Run AI analysis on a specific division.

    - Fetches tiles for the requested division
    - Collects cross-references from tiles
    - Fetches tiles for referenced sections
    - Sends to Gemini for extraction
    - Sends to ChatGPT for executive summary
    - Stores result in spec_analyses
    """
    division = request.division.zfill(2)  # Ensure 2-digit format

    print(f"\n{'=' * 50}")
    print(f"[ANALYZE] Analyzing spec: {spec_id}")
    print(f"[ANALYZE] Division: {division}")
    print(f"[ANALYZE] Include contract terms: {request.include_contract_terms}")
    print(f"{'=' * 50}\n")

    # Get spec record
    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    if spec["status"] != "ready":
        raise HTTPException(
            status_code=400,
            detail=f"Spec not ready for analysis. Current status: {spec['status']}",
        )

    # Determine trade from division
    trade = None
    for trade_name, config in TRADE_CONFIGS.items():
        if config["division"] == division:
            trade = trade_name
            break

    if not trade:
        trade = "general"  # Default trade

    print(f"[ANALYZE] Trade: {trade}")

    try:
        # Get tiles for requested division
        print(f"[ANALYZE] Fetching tiles for Division {division}...")
        division_tiles = get_tiles_by_division(spec_id, division)

        if not division_tiles:
            raise HTTPException(
                status_code=404, detail=f"No tiles found for Division {division}"
            )

        print(f"[ANALYZE] Found {len(division_tiles)} tiles")

        # Collect cross-references
        all_cross_refs = set()
        for tile in division_tiles:
            refs = tile.get("cross_refs") or []
            all_cross_refs.update(refs)

        print(f"[ANALYZE] Found {len(all_cross_refs)} cross-references")

        # Get tiles for cross-referenced sections
        if all_cross_refs:
            cross_ref_tiles = get_tiles_by_sections(spec_id, list(all_cross_refs))
            print(f"[ANALYZE] Fetched {len(cross_ref_tiles)} cross-ref tiles")
        else:
            cross_ref_tiles = []

        # Stitch division tiles together
        division_text = stitch_tiles(division_tiles)
        print(f"[ANALYZE] Division text: {len(division_text):,} chars")

        # Get Division 00/01 tiles for contract terms
        div01_text = None
        if request.include_contract_terms:
            div00_tiles = get_tiles_by_division(spec_id, "00")
            div01_tiles = get_tiles_by_division(spec_id, "01")
            all_contract_tiles = div00_tiles + div01_tiles

            if all_contract_tiles:
                div01_text = stitch_tiles(
                    sorted(all_contract_tiles, key=lambda x: x.get("tile_index", 0))
                )
                print(f"[ANALYZE] Contract terms text: {len(div01_text):,} chars")

        # Run AI analysis
        print("[ANALYZE] Running AI analysis...")
        analysis_result = await run_full_analysis(
            division_text=division_text,
            div01_text=div01_text,
            trade=trade,
            project_name=request.project_name,
        )

        # Store in database
        print("[ANALYZE] Saving analysis to database...")
        insert_analysis(
            spec_id=spec_id,
            job_id=spec["job_id"],
            division_code=division,
            analysis_type="full",
            result=analysis_result,
            processing_time_ms=analysis_result["processing_time_ms"],
        )

        print(f"\n[ANALYZE] Complete! ({analysis_result['processing_time_ms']}ms)")

        return AnalyzeResponse(
            spec_id=spec_id,
            division=division,
            analysis=analysis_result,
            processing_time_ms=analysis_result["processing_time_ms"],
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ANALYZE] ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# GET /spec/{spec_id}/divisions
# ═══════════════════════════════════════════════════════════════


@app.get("/spec/{spec_id}/divisions")
async def get_spec_divisions(spec_id: str):
    """Get all divisions found in a spec"""
    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    divisions = get_divisions(spec_id)

    return {
        "spec_id": spec_id,
        "status": spec["status"],
        "page_count": spec.get("page_count"),
        "divisions": [
            {
                "code": d["division_code"],
                "section_number": d.get("section_number"),
                "title": d.get("section_title"),
                "start_page": d["start_page"],
                "end_page": d["end_page"],
            }
            for d in divisions
        ],
    }


# ═══════════════════════════════════════════════════════════════
# RUN SERVER
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn


# ═══════════════════════════════════════════════════════════════
# RUN SERVER
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
