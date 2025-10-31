/**
 * Extract specific divisions from construction specification text
 */

/**
 * Skip table of contents at start of spec
 */
function skipTableOfContents(specText) {
  // Look for common TOC end markers
  const tocEndPatterns = [
    /END OF TABLE OF CONTENTS/i,
    /END OF CONTENTS/i,
    /\*\*\* END OF TABLE OF CONTENTS \*\*\*/i
  ];
  
  // Check for TOC end marker
  for (const pattern of tocEndPatterns) {
    const match = specText.match(pattern);
    if (match) {
      console.log('Found TOC end marker, skipping to:', match.index);
      return specText.substring(match.index + match[0].length);
    }
  }
  
  // If no marker found, skip first 5% of document (usually TOC is at beginning)
  const skipAmount = Math.floor(specText.length * 0.05);
  console.log('No TOC marker found, skipping first 5% of document:', skipAmount, 'characters');
  return specText.substring(skipAmount);
}

/**
 * Find all division headers in the spec and map their locations
 */
function mapDivisions(specText) {
  // Skip TOC to avoid finding divisions listed in table of contents
  const contentText = skipTableOfContents(specText);
  const skippedAmount = specText.length - contentText.length;
  
  const divisionMap = [];
  
  // Common division header patterns
  const patterns = [
    /DIVISION\s+(\d{1,2})\s*[-–—]?\s*([^\n]+)/gi,
    /SECTION\s+(\d{2})\s*(\d{2})\s*(\d{2})\s*[-–—]?\s*([^\n]+)/gi,
    /DIV\.\s*(\d{1,2})\s*[-–—]?\s*([^\n]+)/gi
  ];
  
  patterns.forEach(pattern => {
    let match;
    // Search in content after TOC, not full text
    while ((match = pattern.exec(contentText)) !== null) {
      const divNumber = match[1].padStart(2, '0');
      const title = match[2] || match[4] || '';
      
      divisionMap.push({
        division: divNumber,
        title: title.trim(),
        startIndex: match.index + skippedAmount, // Adjust for skipped TOC
        header: match[0]
      });
    }
  });
  
  // Sort by position in document
  divisionMap.sort((a, b) => a.startIndex - b.startIndex);
  
  // Filter out TOC entries by checking if divisions are close together
  // Real divisions should be at least 3 pages (9000 chars) apart
  const filtered = [];
  for (let i = 0; i < divisionMap.length; i++) {
    const current = divisionMap[i];
    const next = divisionMap[i + 1];
    
    // Calculate size of this division
    const divSize = next ? (next.startIndex - current.startIndex) : (specText.length - current.startIndex);
    
    // If division is > 3 pages (9000 chars), it's probably real content
    // If it's the last division, include it
    if (divSize > 9000 || !next) {
      filtered.push(current);
    } else {
      console.log(`Skipping short division ${current.division} (${divSize} chars) - likely TOC entry`);
    }
  }
  
  // Remove duplicates (same division number)
  const unique = [];
  const seen = new Set();
  filtered.forEach(div => {
    if (!seen.has(div.division)) {
      unique.push(div);
      seen.add(div.division);
    }
  });
  
  return unique;
}

/**
 * Extract text for specific division(s)
 */
function extractDivisions(specText, divisionNumbers) {
  const divMap = mapDivisions(specText);
  
  if (divMap.length === 0) {
    console.warn('No division headers found in spec');
    return specText; // Fallback: return all text
  }
  
  let extractedText = '';
  
  divisionNumbers.forEach(targetDiv => {
    const divIndex = divMap.findIndex(d => d.division === targetDiv.padStart(2, '0'));
    
    if (divIndex === -1) {
      console.warn(`Division ${targetDiv} not found in spec`);
      return;
    }
    
    const startIndex = divMap[divIndex].startIndex;
    const endIndex = divIndex < divMap.length - 1 
      ? divMap[divIndex + 1].startIndex 
      : specText.length;
    
    const divText = specText.substring(startIndex, endIndex);
    extractedText += divText + '\n\n';
  });
  
  return extractedText.trim();
}

/**
 * Get page count estimate for a text section
 */
function estimatePages(text) {
  // Rough estimate: ~3000 chars per page
  return Math.ceil(text.length / 3000);
}

/**
 * Analyze spec structure and return metadata
 */
function analyzeSpecStructure(specText) {
  const divMap = mapDivisions(specText);
  
  const structure = {
    totalLength: specText.length,
    estimatedPages: estimatePages(specText),
    divisionsFound: divMap.map(d => ({
      number: d.division, // Fixed: was d.number, should be d.division
      title: d.title,
      estimatedPages: estimatePages(
        specText.substring(
          d.startIndex,
          divMap[divMap.indexOf(d) + 1]?.startIndex || specText.length
        )
      )
    })),
    hasStructure: divMap.length > 0
  };
  
  return structure;
}

export {
  mapDivisions,
  extractDivisions,
  analyzeSpecStructure,
  estimatePages
};
