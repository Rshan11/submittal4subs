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
from typing import List, Optional
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
from analyzer import (
    TRADE_CONFIGS,
    analyze_division_by_section,
    run_full_analysis,
    should_use_section_analysis,
)
from db import (
    create_spec,
    delete_divisions,
    delete_job,
    delete_pages,
    delete_tiles,
    get_all_analyses,
    get_analysis,
    get_division_summary,
    get_pages_by_division,
    get_pages_by_section,
    get_related_sections,
    get_sections_for_division,
    get_spec,
    insert_analysis,
    insert_pages_batch,
    update_spec_status,
)
from parser import parse_spec
from storage import (
    delete_submittal_file,
    download_pdf,
    download_submittal_file,
    upload_pdf,
    upload_submittal_file,
)

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
    related_sections: Optional[List[str]] = None  # Cross-referenced sections to include


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
                    "section_count": len(info["sections"]),
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
    - For large divisions (100+ pages with multiple sections): uses section-by-section analysis
    - For smaller divisions: uses single-pass analysis
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

        # Get sections for this division (for section-by-section check)
        sections = get_sections_for_division(spec_id, division)
        section_count = len(sections)
        page_count = len(division_pages)

        print(
            f"[ANALYZE] Division has {section_count} sections across {page_count} pages"
        )

        # Decide: section-by-section or single-pass?
        use_section_analysis = should_use_section_analysis(page_count, section_count)

        if use_section_analysis:
            print(f"[ANALYZE] Using SECTION-BY-SECTION analysis (large division)")
            print(
                f"[ANALYZE] Sections to analyze: {[s['section_number'] for s in sections]}"
            )

            # Analyze contract terms FIRST so we can pass to section analysis
            # (needed for federal funding detection in final output)
            contract_analysis = None
            contract_summary_text = None
            if request.include_contract_terms:
                div00_pages = get_pages_by_division(spec_id, "00")
                div01_pages = get_pages_by_division(spec_id, "01")
                contract_pages = div00_pages + div01_pages

                if contract_pages:
                    from analyzer import analyze_contract_terms

                    div01_text = "\n\n".join(
                        [
                            f"--- Page {p['page_number']} ---\n{p['content']}"
                            for p in sorted(
                                contract_pages, key=lambda x: x["page_number"]
                            )
                        ]
                    )
                    print(f"[ANALYZE] Contract text: {len(div01_text):,} chars")
                    contract_analysis = await analyze_contract_terms(
                        div01_text, request.project_name
                    )
                    contract_summary_text = contract_analysis.get("summary", "")
                    print(f"[ANALYZE] Contract analysis complete")

            # Add user-selected related sections to the sections list
            related_section_count = 0
            if request.related_sections:
                print(
                    f"[ANALYZE] Including {len(request.related_sections)} user-selected related sections"
                )
                for section_num in request.related_sections:
                    section_pages = get_pages_by_section(spec_id, section_num)
                    if section_pages:
                        # Build section dict matching the expected format
                        related_content = "\n\n".join(
                            [
                                f"--- Page {p['page_number']} ---\n{p['content']}"
                                for p in sorted(
                                    section_pages, key=lambda x: x["page_number"]
                                )
                            ]
                        )
                        sections.append(
                            {
                                "section_number": section_num,
                                "title": f"Related Section {section_num}",
                                "page_count": len(section_pages),
                                "content": related_content,
                            }
                        )
                        related_section_count += 1
                print(
                    f"[ANALYZE] Added {related_section_count} related sections to analysis"
                )

            # Run section-by-section analysis with contract info
            analysis_result = await analyze_division_by_section(
                sections=sections,
                trade=trade,
                division=division,
                project_name=request.project_name,
                contract_summary=contract_summary_text,
            )

            # Add contract analysis to result
            if contract_analysis:
                analysis_result["contract_analysis"] = contract_analysis

            cross_ref_count = related_section_count

        else:
            print(f"[ANALYZE] Using SINGLE-PASS analysis (small division)")

            # Build division text from pages
            division_text = "\n\n".join(
                [
                    f"--- Page {p['page_number']} (Section {p['section_number'] or 'unknown'}) ---\n{p['content']}"
                    for p in sorted(division_pages, key=lambda x: x["page_number"])
                ]
            )
            print(f"[ANALYZE] Division text: {len(division_text):,} chars")

            # Add user-selected related sections
            related_section_pages = []
            if request.related_sections:
                print(
                    f"[ANALYZE] Including {len(request.related_sections)} user-selected related sections"
                )
                for section_num in request.related_sections:
                    section_pages = get_pages_by_section(spec_id, section_num)
                    related_section_pages.extend(section_pages)

                if related_section_pages:
                    related_text = "\n\n".join(
                        [
                            f"--- Page {p['page_number']} (Related Section {p['section_number'] or 'unknown'}) ---\n{p['content']}"
                            for p in sorted(
                                related_section_pages, key=lambda x: x["page_number"]
                            )
                        ]
                    )
                    division_text += f"\n\n{'=' * 60}\nRELATED SECTIONS (Cross-Referenced)\n{'=' * 60}\n\n{related_text}"
                    print(
                        f"[ANALYZE] Added {len(related_section_pages)} related section pages ({len(related_text):,} chars)"
                    )

            cross_ref_count = len(related_section_pages)

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
                            for p in sorted(
                                contract_pages, key=lambda x: x["page_number"]
                            )
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
            analysis_type="section_by_section" if use_section_analysis else "full",
            result=analysis_result,
            processing_time_ms=analysis_result["processing_time_ms"],
        )

        print(f"\n[ANALYZE] Complete! ({analysis_result['processing_time_ms']}ms)")
        if use_section_analysis:
            print(f"[ANALYZE] Analyzed {section_count} sections individually")

        return AnalyzeResponse(
            spec_id=spec_id,
            division=division,
            pages_analyzed=len(division_pages),
            cross_refs_included=cross_ref_count,
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
# GET /spec/{spec_id}/analyses - Get all saved analyses for a spec
# ═══════════════════════════════════════════════════════════════


@app.get("/spec/{spec_id}/analyses")
async def get_spec_analyses(spec_id: str):
    """
    Get all saved analyses for a spec.
    Returns list of analyses with division code, timestamp, and summary.
    """
    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    analyses = get_all_analyses(spec_id)

    return {
        "spec_id": spec_id,
        "count": len(analyses),
        "analyses": [
            {
                "id": a["id"],
                "division_code": a["division_code"],
                "analysis_type": a["analysis_type"],
                "created_at": a["created_at"],
                "processing_time_ms": a["processing_time_ms"],
                "result": a["result"],
            }
            for a in analyses
        ],
    }


# ═══════════════════════════════════════════════════════════════
# GET /spec/{spec_id}/analysis/{division} - Get specific division analysis
# ═══════════════════════════════════════════════════════════════


@app.get("/spec/{spec_id}/analysis/{division}")
async def get_division_analysis(spec_id: str, division: str):
    """
    Get saved analysis for a specific division.
    Returns the most recent analysis for that division.
    """
    division = division.zfill(2)  # Ensure 2-digit format

    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    analysis = get_analysis(spec_id, division)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail=f"No analysis found for Division {division}. Run /analyze/{spec_id} first.",
        )

    return {
        "spec_id": spec_id,
        "division_code": division,
        "id": analysis["id"],
        "created_at": analysis["created_at"],
        "processing_time_ms": analysis["processing_time_ms"],
        "result": analysis["result"],
    }


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


@app.get("/spec/{spec_id}/division/{division}/related")
async def get_division_related_sections(spec_id: str, division: str):
    """
    Get sections from OTHER divisions that are cross-referenced by this division.

    Used to show related specs before analysis, e.g.:
    - Masonry (04) references Joint Sealants (07 92 00)
    - Masonry (04) references Product Requirements (01 60 00)

    Returns sections sorted by reference count (most referenced first).
    """
    spec = get_spec(spec_id)
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    related = get_related_sections(spec_id, division)

    return {
        "spec_id": spec_id,
        "division": division,
        "related_sections": related,
    }


# ═══════════════════════════════════════════════════════════════
# DELETE /job/{job_id}
# ═══════════════════════════════════════════════════════════════


@app.delete("/job/{job_id}")
async def delete_job_endpoint(job_id: str, user_id: str):
    """
    Delete a job and all related data.

    Cascades to delete:
    - All specs for this job
    - All spec_pages for those specs
    - All spec_analyses for those specs

    Requires user_id query param to verify ownership.
    """
    print(f"\n{'=' * 50}")
    print(f"[DELETE] Deleting job: {job_id}")
    print(f"[DELETE] User: {user_id}")
    print(f"{'=' * 50}\n")

    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")

    try:
        success = delete_job(job_id, user_id)

        if not success:
            raise HTTPException(
                status_code=404, detail="Job not found or not owned by this user"
            )

        print(f"[DELETE] Successfully deleted job {job_id}")
        return {"status": "deleted", "job_id": job_id}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[DELETE] ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# SUBMITTAL FILE ENDPOINTS
# ═══════════════════════════════════════════════════════════════


class SubmittalUploadResponse(BaseModel):
    r2_key: str
    file_name: str
    file_size: int


class SubmittalDeleteRequest(BaseModel):
    r2_key: str


@app.post("/submittal/upload", response_model=SubmittalUploadResponse)
async def upload_submittal(
    file: UploadFile = File(...),
    item_id: str = Form(...),
):
    """
    Upload a file for a submittal package item.
    Stores in R2 at submittals/{item_id}/{timestamp}_{filename}
    Accepts: PDF, Word, Excel, RTF, images, and other common file types.
    """
    print(f"\n[SUBMITTAL] Upload request for item: {item_id}")
    print(f"[SUBMITTAL] File: {file.filename}")

    # Get file extension and validate it's a supported type
    allowed_extensions = {
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".rtf",
        ".txt",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".tif",
        ".tiff",
        ".bmp",
        ".csv",
        ".ppt",
        ".pptx",
        ".odt",
        ".ods",
        ".odp",
    }

    import os

    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' not supported. Allowed: PDF, Word, Excel, RTF, images, etc.",
        )

    try:
        file_bytes = await file.read()
        file_size = len(file_bytes)
        print(f"[SUBMITTAL] File size: {file_size:,} bytes")

        r2_key = upload_submittal_file(item_id, file.filename, file_bytes)
        print(f"[SUBMITTAL] Uploaded to R2: {r2_key}")

        return SubmittalUploadResponse(
            r2_key=r2_key,
            file_name=file.filename,
            file_size=file_size,
        )

    except Exception as e:
        print(f"[SUBMITTAL] Upload ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/submittal/download/{r2_key:path}")
async def download_submittal(r2_key: str):
    """
    Download a submittal file from R2.
    Returns the file as an attachment.
    """
    print(f"[SUBMITTAL] Download request: {r2_key}")

    # MIME type mapping
    mime_types = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".rtf": "application/rtf",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".bmp": "image/bmp",
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".odt": "application/vnd.oasis.opendocument.text",
        ".ods": "application/vnd.oasis.opendocument.spreadsheet",
        ".odp": "application/vnd.oasis.opendocument.presentation",
    }

    try:
        file_bytes = download_submittal_file(r2_key)

        # Extract filename from r2_key and determine MIME type
        filename = r2_key.split("/")[-1]
        ext = os.path.splitext(filename.lower())[1]
        content_type = mime_types.get(ext, "application/octet-stream")

        from fastapi.responses import Response

        return Response(
            content=file_bytes,
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except Exception as e:
        print(f"[SUBMITTAL] Download ERROR: {e}")
        raise HTTPException(status_code=404, detail="File not found")


@app.get("/submittal/file/{r2_key:path}")
async def get_submittal_file(r2_key: str):
    """
    Get raw PDF bytes for a submittal file (used for PDF merging).
    Returns the file inline without Content-Disposition header.
    """
    print(f"[SUBMITTAL] File request: {r2_key}")

    try:
        pdf_bytes = download_submittal_file(r2_key)

        from fastapi.responses import Response

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
        )

    except Exception as e:
        print(f"[SUBMITTAL] File ERROR: {e}")
        raise HTTPException(status_code=404, detail="File not found")


@app.post("/submittal/delete")
async def delete_submittal(request: SubmittalDeleteRequest):
    """
    Delete a submittal PDF file from R2.
    """
    print(f"[SUBMITTAL] Delete request: {request.r2_key}")

    try:
        success = delete_submittal_file(request.r2_key)

        if success:
            print(f"[SUBMITTAL] Deleted: {request.r2_key}")
            return {"status": "deleted", "r2_key": request.r2_key}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete file")

    except HTTPException:
        raise
    except Exception as e:
        print(f"[SUBMITTAL] Delete ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# SUBMITTAL AI EXTRACTION
# ═══════════════════════════════════════════════════════════════


class ExtractSubmittalsRequest(BaseModel):
    text: str


class SubmittalItem(BaseModel):
    spec_section: str
    description: str
    manufacturer: str


class ExtractSubmittalsResponse(BaseModel):
    items: List[SubmittalItem]
    error: Optional[str] = None


@app.post("/extract-submittals", response_model=ExtractSubmittalsResponse)
async def extract_submittals(request: ExtractSubmittalsRequest):
    """
    Extract submittal items from analysis text using Gemini AI.
    Returns structured list of items requiring submittals.
    """
    import json

    import httpx

    print(f"[SUBMITTALS] Extract request, text length: {len(request.text)}")

    if not request.text:
        return ExtractSubmittalsResponse(items=[], error="No text provided")

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        print("[SUBMITTALS] ERROR: GEMINI_API_KEY not configured")
        return ExtractSubmittalsResponse(items=[], error="AI service not configured")

    prompt = f"""Extract ONLY physical materials and products requiring submittals from this construction spec analysis.
Return ONLY a valid JSON array, no other text or markdown formatting:

[{{"spec_section": "04 20 00", "description": "Item name", "manufacturer": "Manufacturer or empty string"}}]

INCLUDE these types of items:
- Physical materials (CMU, concrete, steel, mortar, grout, flashing, etc.)
- Products with specific manufacturers (especially "Basis of Design" or "Or Equal")
- Items from "Quote These Items" or "Manufacturers Summary"
- Equipment and fixtures requiring product data

DO NOT INCLUDE administrative/procedural items such as:
- Schedules (preliminary, full, updated, CPM schedule)
- Certificates (insurance, hazard, compliance)
- Request logs, proposal requests
- Substitution requests or forms
- Generic "shop drawings", "product data", "samples" headers
- Closeout documents, warranties, O&M manuals
- As-builts, record drawings
- LEED documentation, commissioning reports
- Test reports, inspection reports
- Mock-ups, mockups
- Meeting minutes, progress reports
- Payment applications, change orders

Important:
- spec_section should be the CSI division code if known, or empty string
- description should be a clear material/product name (e.g., "CMU - CarbonCure Environmental", "Packaged Mortar - 400 Series")
- manufacturer should be the company name, or empty string if unknown

Analysis text:
{request.text}"""

    try:
        gemini_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{gemini_url}?key={gemini_api_key}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.1,
                        "maxOutputTokens": 2048,
                    },
                },
            )

            if response.status_code != 200:
                print(f"[SUBMITTALS] Gemini API error: {response.status_code}")
                print(f"[SUBMITTALS] Response: {response.text}")
                return ExtractSubmittalsResponse(
                    items=[], error=f"AI API error: {response.status_code}"
                )

            result = response.json()
            result_text = (
                result.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )

            print(f"[SUBMITTALS] Raw AI response: {result_text[:500]}")

            # Clean up response - remove markdown code blocks if present
            if result_text.startswith("```"):
                result_text = result_text.split("\n", 1)[1]
                result_text = result_text.rsplit("```", 1)[0]

            # Also handle ```json prefix
            if result_text.startswith("json"):
                result_text = result_text[4:].strip()

            items = json.loads(result_text)
            print(f"[SUBMITTALS] Extracted {len(items)} items")

            # Validate and convert to proper format
            valid_items = []
            for item in items:
                valid_items.append(
                    SubmittalItem(
                        spec_section=str(item.get("spec_section", "")),
                        description=str(item.get("description", "Unknown Item")),
                        manufacturer=str(item.get("manufacturer", "")),
                    )
                )

            return ExtractSubmittalsResponse(items=valid_items)

    except json.JSONDecodeError as e:
        print(f"[SUBMITTALS] JSON parse error: {e}")
        return ExtractSubmittalsResponse(items=[], error="Failed to parse AI response")
    except Exception as e:
        print(f"[SUBMITTALS] Error: {e}")
        return ExtractSubmittalsResponse(items=[], error=str(e))


# ═══════════════════════════════════════════════════════════════
# FILE CONVERSION (for submittal package PDF merging)
# ═══════════════════════════════════════════════════════════════


@app.get("/submittal/file-as-pdf/{r2_key:path}")
async def get_submittal_file_as_pdf(r2_key: str):
    """
    Get a submittal file as PDF. If it's already a PDF, return as-is.
    If it's a convertible format (doc, docx, rtf, etc.), convert to PDF first.
    Uses LibreOffice for conversion on supported systems.
    """
    import shutil
    import subprocess
    import tempfile

    print(f"[SUBMITTAL] File-as-PDF request: {r2_key}")

    # Extract filename and extension
    filename = r2_key.split("/")[-1]
    ext = os.path.splitext(filename.lower())[1]

    # Convertible extensions
    convertible_extensions = {
        ".doc",
        ".docx",
        ".rtf",
        ".txt",
        ".odt",
        ".xls",
        ".xlsx",
        ".ods",
        ".csv",
        ".ppt",
        ".pptx",
        ".odp",
    }

    # Image extensions (convert via different method)
    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".bmp"}

    try:
        file_bytes = download_submittal_file(r2_key)

        # If already PDF, return as-is
        if ext == ".pdf":
            from fastapi.responses import Response

            return Response(content=file_bytes, media_type="application/pdf")

        # Handle image files
        if ext in image_extensions:
            pdf_bytes = convert_image_to_pdf(file_bytes, ext)
            if pdf_bytes:
                from fastapi.responses import Response

                return Response(content=pdf_bytes, media_type="application/pdf")
            else:
                raise HTTPException(status_code=500, detail="Image conversion failed")

        # Handle document files via LibreOffice
        if ext in convertible_extensions:
            pdf_bytes = convert_document_to_pdf(file_bytes, filename)
            if pdf_bytes:
                from fastapi.responses import Response

                return Response(content=pdf_bytes, media_type="application/pdf")
            else:
                raise HTTPException(
                    status_code=500, detail=f"Document conversion failed for {ext} file"
                )

        # Unsupported format
        raise HTTPException(
            status_code=400, detail=f"File type {ext} cannot be converted to PDF"
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[SUBMITTAL] File-as-PDF ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def convert_image_to_pdf(image_bytes: bytes, ext: str) -> Optional[bytes]:
    """Convert an image to PDF using PIL/Pillow."""
    try:
        from io import BytesIO

        from PIL import Image

        # Open image
        img = Image.open(BytesIO(image_bytes))

        # Convert to RGB if necessary (for PNG with transparency, etc.)
        if img.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Save as PDF
        pdf_buffer = BytesIO()
        img.save(pdf_buffer, format="PDF", resolution=100.0)
        pdf_buffer.seek(0)

        print(
            f"[SUBMITTAL] Converted image to PDF ({len(pdf_buffer.getvalue())} bytes)"
        )
        return pdf_buffer.getvalue()

    except Exception as e:
        print(f"[SUBMITTAL] Image conversion error: {e}")
        return None


def convert_document_to_pdf(doc_bytes: bytes, filename: str) -> Optional[bytes]:
    """Convert a document to PDF using pure Python libraries."""
    ext = os.path.splitext(filename.lower())[1]

    print(f"[SUBMITTAL] Converting {ext} file to PDF...")

    if ext in (".docx", ".doc"):
        return convert_docx_to_pdf(doc_bytes)
    elif ext in (".xlsx", ".xls", ".csv"):
        return convert_excel_to_pdf(doc_bytes, ext)
    elif ext in (".txt", ".rtf"):
        return convert_text_to_pdf(doc_bytes, ext)
    else:
        print(f"[SUBMITTAL] No converter available for {ext}")
        return None


def convert_docx_to_pdf(doc_bytes: bytes) -> Optional[bytes]:
    """Convert DOCX to PDF using python-docx and reportlab."""
    try:
        from io import BytesIO
        from docx import Document
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

        doc = Document(BytesIO(doc_bytes))

        pdf_buffer = BytesIO()
        pdf_doc = SimpleDocTemplate(
            pdf_buffer,
            pagesize=letter,
            leftMargin=inch,
            rightMargin=inch,
            topMargin=inch,
            bottomMargin=inch,
        )

        styles = getSampleStyleSheet()
        story = []

        for para in doc.paragraphs:
            if para.text.strip():
                text = (
                    para.text.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                )
                if para.style.name.startswith("Heading"):
                    story.append(Paragraph(text, styles["Heading1"]))
                else:
                    story.append(Paragraph(text, styles["Normal"]))
                story.append(Spacer(1, 6))

        if not story:
            story.append(Paragraph("(Empty document)", styles["Normal"]))

        pdf_doc.build(story)
        pdf_buffer.seek(0)

        print(f"[SUBMITTAL] Converted DOCX to PDF ({len(pdf_buffer.getvalue())} bytes)")
        return pdf_buffer.getvalue()

    except Exception as e:
        print(f"[SUBMITTAL] DOCX conversion error: {e}")
        return None


def convert_excel_to_pdf(doc_bytes: bytes, ext: str) -> Optional[bytes]:
    """Convert Excel/CSV to PDF using openpyxl and reportlab."""
    try:
        from io import BytesIO, StringIO
        from reportlab.lib.pagesizes import letter, landscape
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

        if ext == ".csv":
            import csv

            content = doc_bytes.decode("utf-8", errors="replace")
            reader = csv.reader(StringIO(content))
            data = list(reader)
        else:
            from openpyxl import load_workbook

            wb = load_workbook(BytesIO(doc_bytes), data_only=True)
            ws = wb.active
            data = []
            for row in ws.iter_rows(max_row=100, max_col=20):
                row_data = [
                    str(cell.value) if cell.value is not None else "" for cell in row
                ]
                if any(row_data):
                    data.append(row_data)

        if not data:
            data = [["(Empty spreadsheet)"]]

        pdf_buffer = BytesIO()
        pdf_doc = SimpleDocTemplate(pdf_buffer, pagesize=landscape(letter))

        max_cell_len = 50
        for i, row in enumerate(data):
            data[i] = [
                cell[:max_cell_len] + "..." if len(cell) > max_cell_len else cell
                for cell in row
            ]

        table = Table(data)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )

        pdf_doc.build([table])
        pdf_buffer.seek(0)

        print(
            f"[SUBMITTAL] Converted Excel/CSV to PDF ({len(pdf_buffer.getvalue())} bytes)"
        )
        return pdf_buffer.getvalue()

    except Exception as e:
        print(f"[SUBMITTAL] Excel conversion error: {e}")
        return None


def convert_text_to_pdf(doc_bytes: bytes, ext: str) -> Optional[bytes]:
    """Convert TXT/RTF to PDF using reportlab."""
    try:
        from io import BytesIO
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

        try:
            text = doc_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = doc_bytes.decode("latin-1", errors="replace")

        if ext == ".rtf":
            import re

            text = re.sub(r"\\[a-z]+\d*\s?", "", text)
            text = re.sub(r"[{}]", "", text)
            text = text.strip()

        pdf_buffer = BytesIO()
        pdf_doc = SimpleDocTemplate(
            pdf_buffer,
            pagesize=letter,
            leftMargin=inch,
            rightMargin=inch,
            topMargin=inch,
            bottomMargin=inch,
        )

        styles = getSampleStyleSheet()
        story = []

        paragraphs = text.split("\n\n")
        for para in paragraphs:
            para = para.strip()
            if para:
                para = (
                    para.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                )
                story.append(Paragraph(para, styles["Normal"]))
                story.append(Spacer(1, 6))

        if not story:
            story.append(Paragraph("(Empty document)", styles["Normal"]))
                story.append(Spacer(1, 6))

        if not story:
            story.append(Paragraph("(Empty document)", styles['Normal']))

        pdf_doc.build(story)
        pdf_buffer.seek(0)

        print(f"[SUBMITTAL] Converted text to PDF ({len(pdf_buffer.getvalue())} bytes)")
        return pdf_buffer.getvalue()

    except Exception as e:
        print(f"[SUBMITTAL] Text conversion error: {e}")
        return None


# ═══════════════════════════════════════════════════════════════
# RUN SERVER
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
