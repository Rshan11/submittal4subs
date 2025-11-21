from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
import pypdf
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

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable not set")

genai.configure(api_key=GEMINI_API_KEY)

class AnalysisResponse(BaseModel):
    materials: list
    submittals: list
    coordination: list
    exclusions: list
    alternates: list
    summary: str

def find_division_04_pages(pdf_path: str) -> tuple[int, int]:
    """Scan PDF for Division 04 start/end pages using header patterns."""
    reader = pypdf.PdfReader(pdf_path)
    div_04_start = None
    div_04_end = None
    
    division_pattern = re.compile(r'DIVISION\s+(\d+)', re.IGNORECASE)
    section_04_pattern = re.compile(r'SECTION\s+04', re.IGNORECASE)
    
    for page_num in range(len(reader.pages)):
        page = reader.pages[page_num]
        text = page.extract_text()
        
        # Look for Division 04 start
        if div_04_start is None:
            if section_04_pattern.search(text) or re.search(r'\b04\s*\d{4}\b', text):
                div_04_start = page_num
                print(f"[FOUND] Division 04 starts at page {page_num + 1}")
        
        # Look for next division (Division 05+)
        elif div_04_start is not None and div_04_end is None:
            div_match = division_pattern.search(text)
            if div_match:
                div_num = int(div_match.group(1))
                if div_num > 4:
                    div_04_end = page_num - 1
                    print(f"[FOUND] Division 04 ends at page {page_num} (Division {div_num} starts)")
                    break
    
    if div_04_start is None:
        raise ValueError("Could not find Division 04 in specification")
    
    if div_04_end is None:
        div_04_end = len(reader.pages) - 1
        print(f"[INFO] Division 04 extends to end of document (page {div_04_end + 1})")
    
    return div_04_start, div_04_end

def extract_division_text(pdf_path: str, start_page: int, end_page: int) -> str:
    """Extract text from specified page range."""
    reader = pypdf.PdfReader(pdf_path)
    text_parts = []
    
    for page_num in range(start_page, end_page + 1):
        page = reader.pages[page_num]
        text_parts.append(page.extract_text())
    
    return "\n\n".join(text_parts)

def analyze_with_gemini(text: str, trade: str = "masonry") -> dict:
    """Send text to Gemini for analysis."""
    
    prompt = f"""You are analyzing construction specifications for a {trade} contractor.

Extract the following information from the specification text:

1. MATERIALS - List all {trade} materials specified (brick types, mortar, CMU, stone, etc.)
2. SUBMITTALS - List all required submittals (product data, samples, test reports, etc.)
3. COORDINATION - List coordination requirements with other trades
4. EXCLUSIONS - List any work explicitly excluded or by others
5. ALTERNATES - List any alternate materials or methods mentioned

Return ONLY a JSON object with this structure:
{{
  "materials": ["item 1", "item 2"],
  "submittals": ["item 1", "item 2"],
  "coordination": ["item 1", "item 2"],
  "exclusions": ["item 1", "item 2"],
  "alternates": ["item 1", "item 2"],
  "summary": "Brief 2-3 sentence overview of the scope"
}}

SPECIFICATION TEXT:
{text}
"""
    
    model = genai.GenerativeModel("gemini-2.0-flash-exp")
    response = model.generate_content(prompt)
    
    # Parse JSON from response
    import json
    response_text = response.text.strip()
    
    # Remove markdown code blocks if present
    if response_text.startswith("```json"):
        response_text = response_text[7:]
    if response_text.startswith("```"):
        response_text = response_text[3:]
    if response_text.endswith("```"):
        response_text = response_text[:-3]
    
    return json.loads(response_text.strip())

@app.post("/analyze")
async def analyze_specification(
    file: UploadFile = File(...),
    trade: str = "masonry"
) -> AnalysisResponse:
    """
    Analyze a construction specification PDF.
    
    Process:
    1. Find Division 04 pages using header scanning
    2. Extract text from those pages
    3. Send to Gemini for analysis
    4. Return structured results
    """
    
    # Save uploaded file temporarily
    temp_path = f"/tmp/{file.filename}"
    with open(temp_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    try:
        # Step 1: Find division pages
        print(f"[INFO] Scanning for Division 04...")
        start_page, end_page = find_division_04_pages(temp_path)
        print(f"[INFO] Division 04: pages {start_page + 1} to {end_page + 1}")
        
        # Step 2: Extract text
        print(f"[INFO] Extracting text...")
        division_text = extract_division_text(temp_path, start_page, end_page)
        print(f"[INFO] Extracted {len(division_text)} characters")
        
        # Step 3: Analyze with Gemini
        print(f"[INFO] Analyzing with Gemini...")
        analysis = analyze_with_gemini(division_text, trade)
        print(f"[INFO] Analysis complete")
        
        return AnalysisResponse(**analysis)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.0-simple"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
