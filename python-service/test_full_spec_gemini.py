import os
import json
import textwrap
from pypdf import PdfReader
import requests

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

PDF_PATH = "25-0925_MPES-II_100CD Specs.pdf"

def load_full_pdf_text(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    pages_text = []

    for i, page in enumerate(reader.pages):
        try:
            txt = page.extract_text() or ""
        except Exception as e:
            print(f"[WARN] Failed to extract page {i+1}: {e}")
            txt = ""
        # Tag pages so the model can reference them
        pages_text.append(f"--- PAGE {i+1} ---\n{txt}\n")

    full_text = "\n".join(pages_text)
    print(f"[INFO] Extracted text length: {len(full_text)} characters from {len(reader.pages)} pages")
    return full_text


def build_masonry_prompt(spec_text: str) -> str:
    # Keep it all in one prompt – simple but explicit
    return textwrap.dedent(f"""
    You are an expert construction specifications analyst for a masonry subcontractor.

    You will be given the FULL spec book text for a project. It includes many divisions (01, 02, 03, 04, 05, 07, 08, 09, 22, etc.).

    TASK:
    1. Identify ALL content that is clearly related to **Division 04 – Masonry** or masonry work, even if the formatting is messy.
       - Look for section numbers like "04 05 00", "04 20 00", "UNIT MASONRY", "MASONRY", "BRICK", "CONCRETE MASONRY UNITS", etc.
       - Include related requirements even if the heading isn't perfectly formatted (e.g., if page headers are broken).
    2. From that masonry-related content, extract:
       - Section titles and numbers
       - Material requirements (brick, CMU, mortar, grout, accessories)
       - Execution requirements (installation, tolerances, cleaning, protection)
       - Any special notes that would affect a masonry subcontractor's scope, risk, or submittals.
    3. Ignore plumbing, mechanical, electrical, and other non-masonry sections.

    Return your answer in concise JSON with this structure:

    {{
      "found_division_04": true/false,
      "sections": [
        {{
          "section_number": "string or null",
          "section_title": "string or null",
          "page_range": "e.g. 'pp. 210-225' or null",
          "summary": "short summary of what this section covers for masonry",
          "key_requirements": [
            "bullet of important requirement",
            "another requirement"
          ]
        }}
      ],
      "notes_for_masonry_sub": [
        "important note 1",
        "important note 2"
      ]
    }}

    If you truly find no masonry content, set "found_division_04": false and explain why.

    NOW HERE IS THE FULL SPEC TEXT:

    {spec_text}
    """)


def call_gemini(prompt: str) -> dict:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ]
    }

    params = {"key": GEMINI_API_KEY}

    print("[INFO] Calling Gemini 2.0 Flash…")
    resp = requests.post(GEMINI_API_URL, params=params, json=payload, timeout=600)
    print(f"[INFO] Gemini HTTP status: {resp.status_code}")

    if resp.status_code != 200:
        print("[ERROR] Gemini response body:")
        print(resp.text)
        resp.raise_for_status()

    data = resp.json()
    return data


def main():
    print("[BOOT] test_full_spec_gemini.py starting…")

    if not os.path.exists(PDF_PATH):
        raise FileNotFoundError(f"PDF not found at: {PDF_PATH}")

    # 1) Read full text
    spec_text = load_full_pdf_text(PDF_PATH)

    # Optional: warn if extremely large
    if len(spec_text) > 800_000:
        print("[WARN] Spec text is very large; model context may be stressed.")

    # 2) Build prompt
    prompt = build_masonry_prompt(spec_text)

    # 3) Call Gemini
    data = call_gemini(prompt)

    # 4) Extract text response
    try:
        candidates = data.get("candidates", [])
        content_parts = candidates[0]["content"]["parts"]
        model_text = "".join(p.get("text", "") for p in content_parts)
    except Exception as e:
        print("[ERROR] Failed to parse Gemini response:", e)
        print(json.dumps(data, indent=2))
        return

    print("\n========== RAW MODEL OUTPUT (truncated) ==========")
    print(model_text[:4000])  # show first 4k chars
    print("=================================================\n")

    # 5) Try to parse JSON if the model obeyed
    masonry_json = None
    try:
        # naive: find first { ... } block
        start = model_text.find("{")
        end = model_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            masonry_json = json.loads(model_text[start:end+1])
    except Exception as e:
        print("[WARN] Could not parse JSON from model output:", e)

    if masonry_json:
        print("[INFO] Parsed JSON summary:")
        print(json.dumps(masonry_json, indent=2))
        found_div_04 = masonry_json.get("found_division_04")
        print(f"[RESULT] found_division_04 = {found_div_04}")
    else:
        print("[INFO] Model output was not valid JSON. Check the raw output above.")

    # 6) Show usage / cost info if present
    usage = data.get("usageMetadata") or data.get("usage") or {}
    if usage:
        print("\n[USAGE] Token usage metadata:")
        print(json.dumps(usage, indent=2))
    else:
        print("\n[USAGE] No usage metadata returned by Gemini.")


if __name__ == "__main__":
    main()
