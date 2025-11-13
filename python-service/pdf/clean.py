"""
Text cleaning and normalization utilities
"""
import re
from typing import str

def clean_text(text: str) -> str:
    """
    Clean extracted PDF text:
    - Remove excessive whitespace
    - Fix common OCR errors
    - Remove page headers/footers patterns
    """
    # Remove common header/footer patterns
    # Example: "Page 123 of 456"
    text = re.sub(r'Page \d+ of \d+', '', text, flags=re.IGNORECASE)
    
    # Remove standalone page numbers
    text = re.sub(r'\n\d+\n', '\n', text)
    
    # Fix multiple spaces
    text = re.sub(r' {2,}', ' ', text)
    
    # Fix multiple newlines (keep max 2)
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Remove leading/trailing whitespace from lines
    lines = [line.strip() for line in text.split('\n')]
    text = '\n'.join(lines)
    
    return text

def normalize_text(text: str) -> str:
    """
    Normalize text for consistent processing:
    - Convert to UTF-8
    - Standardize quotes
    - Fix common formatting issues
    """
    # Convert various quote styles to standard quotes
    text = text.replace('"', '"').replace('"', '"')
    text = text.replace(''', "'").replace(''', "'")
    
    # Fix em/en dashes
    text = text.replace('—', '-').replace('–', '-')
    
    # Remove zero-width spaces and other invisible characters
    text = re.sub(r'[\u200b-\u200d\ufeff]', '', text)
    
    # Ensure UTF-8 encoding
    text = text.encode('utf-8', errors='ignore').decode('utf-8')
    
    return text.strip()

def extract_section_number(text: str) -> str:
    """
    Extract MasterFormat section number from text
    Examples: "Section 04 20 00", "04 20 00", "042000"
    """
    # Look for pattern: 2 digits, space/nothing, 2 digits, space/nothing, 2 digits
    pattern = r'\b(\d{2})\s?(\d{2})\s?(\d{2})\b'
    match = re.search(pattern, text)
    
    if match:
        return f"{match.group(1)} {match.group(2)} {match.group(3)}"
    
    return None

def find_cross_references(text: str) -> list:
    """
    Find cross-references to other sections in text
    Examples: "See Section 03 30 00", "refer to Division 07"
    """
    references = []
    
    # Pattern for section references
    section_pattern = r'(?:Section|Sec\.|§)\s*(\d{2}\s?\d{2}\s?\d{2})'
    section_matches = re.finditer(section_pattern, text, re.IGNORECASE)
    
    for match in section_matches:
        section_num = match.group(1).replace(' ', '')
        formatted = f"{section_num[:2]} {section_num[2:4]} {section_num[4:6]}"
        references.append({
            "type": "section",
            "reference": formatted,
            "context": text[max(0, match.start()-50):min(len(text), match.end()+50)]
        })
    
    # Pattern for division references
    division_pattern = r'(?:Division|Div\.)\s*(\d{2})'
    division_matches = re.finditer(division_pattern, text, re.IGNORECASE)
    
    for match in division_matches:
        references.append({
            "type": "division",
            "reference": match.group(1),
            "context": text[max(0, match.start()-50):min(len(text), match.end()+50)]
        })
    
    return references
