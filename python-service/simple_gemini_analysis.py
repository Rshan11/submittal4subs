import os
import json
import requests

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

EXTRACTED_FILE = "division_04_extracted.txt"

def load_extracted_text():
    """Load the extracted Division 04 text."""
    if not os.path.exists(EXTRACTED_FILE):
        print(f"[ERROR] Extracted file not found: {EXTRACTED_FILE}")
        print("[INFO] Run simple_header_scan_test.py first to extract Division 04 content")
        return None
    
    with open(EXTRACTED_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    
    print(f"[INFO] Loaded {len(content):,} characters from {EXTRACTED_FILE}")
    return content


def build_masonry_analysis_prompt(spec_text):
    """Build the prompt for Gemini to analyze masonry content."""
    return f"""You are an expert construction specifications analyst for a masonry subcontractor.

Analyze the following Division 04 - Masonry specification content and extract:

1. MATERIALS:
   - All masonry units (CMU, brick, block types)
   - Mortar specifications and requirements
   - Grout specifications
   - Reinforcement requirements
   - Any special materials or accessories

2. SUBMITTALS:
   - Required product data
   - Required samples
   - Required certifications
   - Required test reports
   - Any special documentation

3. COORDINATION REQUIREMENTS:
   - Work by other trades that affects masonry
   - Required coordination with other systems
   - Scheduling requirements
   - Interface requirements

4. CRITICAL TERMS & CONDITIONS:
   - Quality standards
   - Testing requirements
   - Tolerance requirements
   - Installation requirements
   - Warranty requirements

Return your analysis in the following JSON format:

{{
  "materials": {{
    "masonry_units": [
      {{
        "type": "string",
        "specification": "string",
        "requirements": ["requirement 1", "requirement 2"]
      }}
    ],
    "mortar": {{
      "type": "string",
      "specification": "string",
      "requirements": ["requirement 1", "requirement 2"]
    }},
    "grout": {{
      "type": "string",
      "specification": "string",
      "requirements": ["requirement 1", "requirement 2"]
    }},
    "reinforcement": {{
      "type": "string",
      "specification": "string",
      "requirements": ["requirement 1", "requirement 2"]
    }},
    "other": ["other material 1", "other material 2"]
  }},
  "submittals": [
    {{
      "type": "string",
      "description": "string",
      "timing": "string"
    }}
  ],
  "coordination": [
    {{
      "trade": "string",
      "requirement": "string",
      "timing": "string"
    }}
  ],
  "critical_terms": [
    {{
      "category": "string",
      "requirement": "string",
      "specification": "string"
    }}
  ],
  "summary": "Brief overall summary of key masonry requirements and risks for a masonry subcontractor"
}}

DIVISION 04 SPECIFICATION TEXT:

{spec_text}
"""


def call_gemini(prompt):
    """Send prompt to Gemini and get response."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")
    
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ]
    }
    
    params = {"key": GEMINI_API_KEY}
    
    print(f"[INFO] Sending request to Gemini {GEMINI_MODEL}...")
    resp = requests.post(GEMINI_API_URL, params=params, json=payload, timeout=120)
    print(f"[INFO] Gemini HTTP status: {resp.status_code}")
    
    if resp.status_code != 200:
        print("[ERROR] Gemini response body:")
        print(resp.text)
        resp.raise_for_status()
    
    data = resp.json()
    return data


def extract_json_from_response(model_text):
    """Extract JSON from model response."""
    # Find JSON block
    start = model_text.find("{")
    end = model_text.rfind("}")
    
    if start != -1 and end != -1 and end > start:
        json_text = model_text[start:end+1]
        return json.loads(json_text)
    
    return None


def main():
    print("="*80)
    print("GEMINI MASONRY ANALYSIS")
    print("="*80 + "\n")
    
    # Load extracted text
    spec_text = load_extracted_text()
    if not spec_text:
        return
    
    # Build prompt
    prompt = build_masonry_analysis_prompt(spec_text)
    prompt_size = len(prompt)
    print(f"[INFO] Prompt size: {prompt_size:,} characters\n")
    
    # Call Gemini
    try:
        data = call_gemini(prompt)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            print("\n[ERROR] Rate limit exceeded. Please wait a few minutes and try again.")
            print("[INFO] Alternative: Enable billing on your Google AI Studio account for higher limits.")
        else:
            print(f"\n[ERROR] API call failed: {e}")
        return
    except Exception as e:
        print(f"\n[ERROR] API call failed: {e}")
        return
    
    # Extract response
    try:
        candidates = data.get("candidates", [])
        if not candidates:
            print("[ERROR] No candidates in response")
            print(json.dumps(data, indent=2))
            return
        
        content_parts = candidates[0]["content"]["parts"]
        model_text = "".join(p.get("text", "") for p in content_parts)
    except Exception as e:
        print(f"[ERROR] Failed to parse Gemini response: {e}")
        print(json.dumps(data, indent=2))
        return
    
    # Parse JSON
    print("\n" + "="*80)
    print("ANALYSIS RESULTS")
    print("="*80 + "\n")
    
    masonry_analysis = extract_json_from_response(model_text)
    
    if masonry_analysis:
        # Print formatted results
        print(json.dumps(masonry_analysis, indent=2))
        
        # Save to file
        output_file = "division_04_analysis.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(masonry_analysis, f, indent=2)
        print(f"\n[SUCCESS] Analysis saved to: {output_file}")
    else:
        print("[WARN] Could not parse JSON from model output")
        print("\n[INFO] Raw model output (first 2000 chars):")
        print(model_text[:2000])
    
    # Show usage and cost
    usage = data.get("usageMetadata", {})
    if usage:
        print("\n" + "="*80)
        print("TOKEN USAGE & COST")
        print("="*80)
        
        prompt_tokens = usage.get("promptTokenCount", 0)
        completion_tokens = usage.get("candidatesTokenCount", 0)
        total_tokens = usage.get("totalTokenCount", 0)
        
        print(f"Prompt tokens:     {prompt_tokens:,}")
        print(f"Completion tokens: {completion_tokens:,}")
        print(f"Total tokens:      {total_tokens:,}")
        
        # Gemini 2.5 Flash pricing (free tier has very high limits)
        # Free tier: 15 RPM, 1M TPM, 1500 RPD
        print("\n[INFO] Gemini 2.5 Flash Free Tier:")
        print("  - 15 requests per minute")
        print("  - 1M tokens per minute")
        print("  - 1500 requests per day")
        print(f"  - This request used {(prompt_tokens/1_000_000)*100:.2f}% of per-minute token limit")
    
    print("\n" + "="*80)


if __name__ == "__main__":
    main()
