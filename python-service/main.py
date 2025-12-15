"""
Spec Analyzer Python Service
Deployed on Render at submittal4subs.onrender.com

Endpoints:
- POST /upload - Upload PDF, store in R2, create spec record
- POST /parse/{spec_id} - Parse PDF into pages with section tags
- POST /analyze/{spec_id} - Run AI analysis on a division
- GET /spec/{spec_id}/divisions - Get divisions found in a spec

Architecture: Page-Level Tagging
- Each page is individually tagged with its section number
- No range calculation, no merging, no end-page detection
- Query by division_code for accurate results
"""

import asyncio
import os
import sys
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
from analyzer import TRADE_CONFIGS, run_full_analysis
from db import (
    create_spec,
    delete_divisions,
    delete_pages,
    delete_tiles,
    get_division_summary,
    get_pages_by_division,
    get_pages_by_section,
    get_spec,
    insert_analysis,
    insert_pages_batch,
    update_spec_status,
)
from parser import parse_spec
from storage import download_pdf, upload_pdf

# ═══════════════════════════════════════════════════════════════
# APP SETUP
# ═══════════════════════════════════════════════════════════════

app = FastAPI(
    title="Spec Analyzer API",
    description="PDF spec parsing and AI analysis service (Page-Level Architecture)",
    version="3.0.0",
)

# CORS - allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Must be False when allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

print("[BOOT] Spec Analyzer Service v3.0 (Page-Level Architecture)")
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
    divisions: list
    toc_found: bool = False
    classification_stats: dict = None


class AnalyzeRequest(BaseModel):
    division: str
    include_contract_terms: bool = True
    project_name: Optional[str] = None


class AnalyzeResponse(BaseModel):
    spec_id: str
    division: str
    pages_analyzed: int
    cross_refs_included: int
    analysis: dict
    processing_time_ms: int


# ═══════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═══════════════════════════════════════════════════════════════


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "3.0.0",
        "architecture": "page-level",
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
    Parse a PDF specification into pages with section tags.

    Page-Level Architecture:
    - Each page is individually tagged with its section number
    - Section number detected from page header/footer
    - No range calculation or merging
    - Query by division_code for accurate division content
    """
    print(f"\n{'=' * 50}", flush=True)
    print(f"[PARSE] Parsing spec: {spec_id}", flush=True)
    print(f"[PARSE] Architecture: Page-Level Tagging", flush=True)
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

        # Clear existing data (for re-parsing)
        print("[PARSE] Clearing existing pages/divisions/tiles...")
        delete_pages(spec_id)
        delete_divisions(spec_id)  # Legacy cleanup
        delete_tiles(spec_id)  # Legacy cleanup

        # Parse the PDF with page-level tagging
        print("[PARSE] Parsing pages with section detection...")
        result = parse_spec(pdf_bytes, spec_id)

        print(f"[PARSE] Found {len(result['divisions'])} divisions")
        print(f"[PARSE] Processed {len(result['pages'])} pages with content")

        # Insert pages in batches
        if result["pages"]:
            print(f"[PARSE] Inserting {len(result['pages'])} pages...")
            insert_pages_batch(result["pages"])

        # Update spec status
        update_spec_status(spec_id, "ready", result["page_count"])

        # Build division list for response
        division_list = []
        for div_code in sorted(result["division_summary"].keys()):
            info = result["division_summary"][div_code]
            pages = info["pages"]
            division_list.append(
                {
                    "code": div_code,
                    "page_count": info["count"],
                    "sections": info["sections"],
                    "page_range": f"{min(pages)}-{max(pages)}" if pages else None,
                }
            )

        print(f"\n[PARSE] Complete!")
        for div in division_list:
            print(
                f"[PARSE]   Division {div['code']}: {div['page_count']} pages ({div['page_range']})"
            )

        return ParseResponse(
            spec_id=spec_id,
            status="ready",
            page_count=result["page_count"],
            division_count=len(result["divisions"]),
            divisions=division_list,
            toc_found=result.get("toc_found", False),
            classification_stats=result.get("classification_stats"),
        )

    except Exception as e:
        print(f"[PARSE] ERROR: {e}")
        import traceback

        traceback.print_exc()
        update_spec_status(spec_id, "failed")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# POST /analyze/{spec_id}
# ═══════════════════════════════════════════════════════════════


@app.post("/analyze/{spec_id}", response_model=AnalyzeResponse)
async def analyze_spec_endpoint(spec_id: str, request: AnalyzeRequest):
    """
    Run AI analysis on a specific division.

    Page-Level Architecture:
    - Fetches all pages tagged with the requested division_code
    - Collects cross-references from those pages
    - Fetches cross-referenced pages (limited to top 10 sections)
    - Runs Gemini extraction + OpenAI summary
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
        # Get pages for requested division
        print(f"[ANALYZE] Fetching pages for Division {division}...")
        division_pages = get_pages_by_division(spec_id, division)

        if not division_pages:
            raise HTTPException(
                status_code=404, detail=f"No pages found for Division {division}"
            )

        print(f"[ANALYZE] Found {len(division_pages)} pages")

        # Collect cross-references from those pages
        all_cross_refs = set()
        for page in division_pages:
            refs = page.get("cross_refs") or []
            all_cross_refs.update(refs)

        # Filter to external refs only (not same division)
        external_refs = [r for r in all_cross_refs if not r.startswith(division)]
        print(f"[ANALYZE] Found {len(external_refs)} cross-referenced sections")

        # Fetch cross-referenced pages (limit to top 10 to avoid token explosion)
        cross_ref_pages = []
        for ref in sorted(external_refs)[:10]:
            ref_pages = get_pages_by_section(spec_id, ref)
            cross_ref_pages.extend(ref_pages)

        if cross_ref_pages:
            print(f"[ANALYZE] Fetched {len(cross_ref_pages)} cross-ref pages")

        # Build division text from pages
        division_text = "\n\n".join(
            [
                f"--- Page {p['page_number']} (Section {p['section_number'] or 'unknown'}) ---\n{p['content']}"
                for p in sorted(division_pages, key=lambda x: x["page_number"])
            ]
        )
        print(f"[ANALYZE] Division text: {len(division_text):,} chars")

        # Get Division 00/01 for contract terms
        div01_text = None
        if request.include_contract_terms:
            div00_pages = get_pages_by_division(spec_id, "00")
            div01_pages = get_pages_by_division(spec_id, "01")
            contract_pages = div00_pages + div01_pages

            if contract_pages:
                div01_text = "\n\n".join(
                    [
                        f"--- Page {p['page_number']} ---\n{p['content']}"
                        for p in sorted(contract_pages, key=lambda x: x["page_number"])
                    ]
                )
                print(f"[ANALYZE] Contract text: {len(div01_text):,} chars")

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
            pages_analyzed=len(division_pages),
            cross_refs_included=len(cross_ref_pages),
            analysis=analysis_result,
            processing_time_ms=analysis_result["processing_time_ms"],
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ANALYZE] ERROR: {e}")
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# GET /spec/{spec_id}/divisions
# ═══════════════════════════════════════════════════════════════


@app.get("/spec/{spec_id}/divisions")
async def get_spec_divisions(spec_id: str):
    """Get all divisions found in a spec using page-level data"""
    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    # Get division summary from spec_pages
    divisions = get_division_summary(spec_id)

    return {
        "spec_id": spec_id,
        "status": spec["status"],
        "page_count": spec.get("page_count"),
        "architecture": "page-level",
        "divisions": [
            {
                "code": d["division_code"],
                "page_count": d["page_count"],
                "sections": d.get("sections", []),
                "page_range": d.get("page_range"),
            }
            for d in divisions
        ],
    }


# ═══════════════════════════════════════════════════════════════
# RUN SERVER
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
