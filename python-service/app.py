from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
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

def find_division_04_pages(pdf_path: str) -> list[int]:
    """
    Scan ALL pages for Division 04 content using header/footer scanning.
    
    This approach finds ALL pages containing Division 04 content by checking
    the first 200 and last 200 characters of each page for Division 04 markers.
    
    Returns a list of ALL page numbers that contain Division 04 content.
    """
    matching_pages = []
    
    # Patterns to look for in headers/footers
    patterns = [
        r'04\s*20',           # "04 20" or "04 2000"
        r'04\s*2000',         # "04 2000"
        r'UNIT\s+MASONRY',    # "UNIT MASONRY"
        r'Division\s+04',     # "Division 04"
        r'DIVISION\s+04',     # "DIVISION 04"
        r'SECTION\s+04',      # "SECTION 04"
    ]
    
    with pdfplumber.open(pdf_path) as pdf:
        print(f"[INFO] Scanning {len(pdf.pages)} pages for Division 04 content...")
        
        for page_num, page in enumerate(pdf.pages):
            full_text = page.extract_text() or ""
            
            # Check first 200 characters (header area)
            header = full_text[:200] if len(full_text) > 200 else full_text
            
            # Check last 200 characters (footer area)
            footer = full_text[-200:] if len(full_text) > 200 else ""
            
            # Check if any pattern matches in header or footer
            found = False
            for pattern in patterns:
                if re.search(pattern, header, re.IGNORECASE) or re.search(pattern, footer, re.IGNORECASE):
                    matching_pages.append(page_num)
                    found = True
                    break
            
            if found:
                print(f"[FOUND] Page {page_num + 1} contains Division 04 markers")
    
    if not matching_pages:
        raise ValueError("Could not find any Division 04 pages in specification")
    
    print(f"[INFO] Found {len(matching_pages)} pages with Division 04 content")
    return matching_pages

def extract_division_text(pdf_path: str, page_numbers: list[int]) -> str:
    """
    Extract text from specified pages using pdfplumber.
    
    Args:
        pdf_path: Path to the PDF file
        page_numbers: List of page numbers to extract (0-indexed)
    
    Returns:
        Combined text from all specified pages
    """
    text_parts = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page_num in page_numbers:
            page = pdf.pages[page_num]
            text = page.extract_text() or ""
            text_parts.append(text)
    
    print(f"[INFO] Extracted {len(''.join(text_parts))} characters from {len(page_numbers)} pages")
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
        # Step 1: Find division pages using header/footer scanning
        print(f"[INFO] Scanning for Division 04 pages...")
        page_numbers = find_division_04_pages(temp_path)
        print(f"[INFO] Found {len(page_numbers)} Division 04 pages")
        
        # Step 2: Extract text from those pages using pdfplumber
        print(f"[INFO] Extracting text with pdfplumber...")
        division_text = extract_division_text(temp_path, page_numbers)
        
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
