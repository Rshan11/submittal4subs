from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pdfplumber
import os
import re
from typing import Optional

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════════
# TILE-BASED SPEC EXTRACTION
# ═══════════════════════════════════════════════════════════════
#
# Strategy: Don't try to detect divisions with Python.
# Just extract ALL text and tile it. Let Gemini find divisions.
#
# 1. Extract full text (dumb extraction, no heuristics)
# 2. Tile into 50K char chunks with 5K overlap
# 3. Return tiles to caller for Gemini scanning
# ═══════════════════════════════════════════════════════════════

# Configuration
TILE_SIZE = 50000       # 50K characters per tile
TILE_OVERLAP = 5000     # 5K character overlap between tiles

class TileResponse(BaseModel):
    total_chars: int
    total_pages: int
    tile_count: int
    tile_size: int
    tile_overlap: int
    tiles: list[dict]  # [{index, start, end, text}]

class ExtractResponse(BaseModel):
    total_chars: int
    total_pages: int
    text: str

def extract_all_text(pdf_path: str) -> tuple[str, int]:
    """
    Extract ALL text from PDF. No division detection. No heuristics.
    Just dump everything into one giant string.

    Memory-optimized: processes pages one at a time to avoid OOM.

    Returns: (full_text, page_count)
    """
    import gc

    # First pass: get page count without loading all pages
    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)

    print(f"[EXTRACT] Processing {page_count} pages (memory-optimized)...")

    # Process in batches to manage memory
    BATCH_SIZE = 20
    all_text_parts = []

    for batch_start in range(0, page_count, BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, page_count)
        batch_text = []

        # Open PDF fresh for each batch to release memory
        with pdfplumber.open(pdf_path) as pdf:
            for i in range(batch_start, batch_end):
                page = pdf.pages[i]
                page_text = page.extract_text() or ""
                batch_text.append(f"\n--- PAGE {i + 1} ---\n{page_text}")
                # Clear page resources
                page.flush_cache()

        # Join batch and add to results
        all_text_parts.append("\n".join(batch_text))

        print(f"[EXTRACT] Processed pages {batch_start + 1}-{batch_end}/{page_count}")

        # Force garbage collection between batches
        gc.collect()

    full_text = "\n".join(all_text_parts)

    # Clear the parts list to free memory
    all_text_parts = None
    gc.collect()

    # Normalize whitespace but preserve structure
    full_text = re.sub(r'[ \t]+', ' ', full_text)  # Collapse horizontal whitespace
    full_text = re.sub(r'\n{4,}', '\n\n\n', full_text)  # Max 3 newlines

    print(f"[EXTRACT] Complete: {len(full_text):,} chars from {page_count} pages")
    return full_text, page_count

def tile_text(text: str, tile_size: int = TILE_SIZE, overlap: int = TILE_OVERLAP) -> list[dict]:
    """
    Slice text into overlapping tiles.

    Example with tile_size=50000, overlap=5000:
    - Tile 0: chars 0-50000
    - Tile 1: chars 45000-95000
    - Tile 2: chars 90000-140000
    - etc.

    Overlap ensures we don't cut division headers in half.
    """
    tiles = []
    text_len = len(text)

    if text_len == 0:
        return tiles

    # Calculate step (tile_size minus overlap)
    step = tile_size - overlap

    start = 0
    index = 0

    while start < text_len:
        end = min(start + tile_size, text_len)
        tile_text = text[start:end]

        tiles.append({
            "index": index,
            "start": start,
            "end": end,
            "char_count": len(tile_text),
            "text": tile_text
        })

        index += 1
        start += step

        # Don't create tiny trailing tiles
        if text_len - start < overlap:
            break

    print(f"[TILE] Created {len(tiles)} tiles from {text_len:,} chars")
    return tiles

# ═══════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.post("/extract", response_model=ExtractResponse)
async def extract_text(file: UploadFile = File(...)):
    """
    Extract ALL text from PDF. No tiling, just raw text.
    Use this if you want to handle tiling elsewhere.
    """
    temp_path = f"/tmp/{file.filename}"

    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        full_text, page_count = extract_all_text(temp_path)

        return ExtractResponse(
            total_chars=len(full_text),
            total_pages=page_count,
            text=full_text
        )

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/extract-tiles", response_model=TileResponse)
async def extract_and_tile(
    file: UploadFile = File(...),
    tile_size: int = Form(default=TILE_SIZE),
    tile_overlap: int = Form(default=TILE_OVERLAP)
):
    """
    Extract ALL text from PDF and tile it.

    This is the main endpoint for the tiling strategy:
    1. Extracts all text (no division detection)
    2. Tiles into chunks with overlap
    3. Returns tiles for Gemini scanning

    Query params:
    - tile_size: Characters per tile (default 50000)
    - tile_overlap: Overlap between tiles (default 5000)
    """
    temp_path = f"/tmp/{file.filename}"

    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Step 1: Extract all text
        full_text, page_count = extract_all_text(temp_path)

        # Step 2: Tile it
        tiles = tile_text(full_text, tile_size, tile_overlap)

        return TileResponse(
            total_chars=len(full_text),
            total_pages=page_count,
            tile_count=len(tiles),
            tile_size=tile_size,
            tile_overlap=tile_overlap,
            tiles=tiles
        )

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": "3.0-tiled",
        "strategy": "tile-based extraction",
        "tile_size": TILE_SIZE,
        "tile_overlap": TILE_OVERLAP
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
