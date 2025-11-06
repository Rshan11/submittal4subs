const GEMINI_API_KEY = 'AIzaSyAXix7ROgwi6pZSt6-CntBQZxX0arsHLHc';  // Using your key from the error

const testSpec = `
SECTION 04 20 00
UNIT MASONRY

2.1 CONCRETE MASONRY UNITS
A. CMU: 8x8x16 hollow load-bearing units
   1. Standard: ASTM C90
   2. Grade: As required for application
   3. Finish: Match sample in architect's office
   4. Manufacturers: Oldcastle APG, Cemex, or approved equal

2.2 MORTAR  
A. Type: Type S conforming to ASTM C270
B. Color: Match existing building mortar

2.3 JOINT REINFORCEMENT
A. Wire: 9 gauge, ladder type, mill galvanized
   1. Standard: ASTM A951
   2. Manufacturers:
      a. Dur-O-Wal: Standard Ladder, 9ga
      b. Hohmann & Barnard: Wire-Bond, 9ga

2.4 MASONRY ANCHORS
A. Stainless steel anchors, Type 316
   1. Size: 3/4 inch embedment
   2. Standard: ASTM A666
   3. Manufacturers:
      a. Hilti: Model HUS-EZ 3/4
      b. Simpson Strong-Tie: Model HIT-HY200
`;

const prompt = `Extract materials from this masonry spec as JSON:

{
  "materials": [
    {
      "itemName": "...",
      "specifications": "...",
      "approvedVendors": ["..."],
      "riskLevel": "clear|vague|missing",
      "whatsMissing": "..."
    }
  ]
}

Mark 🔴 if color/grade/finish missing. Mark 🟢 if has model numbers.

Spec:
${testSpec}`;

async function test() {
  console.log('🧪 Testing...\n');
  
  // THIS IS THE WORKING URL FROM YOUR CODE
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
  
  const response = await fetch(`${url}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('❌ Error:', JSON.stringify(error, null, 2));
    return;
  }
  
  const data = await response.json();
  const text = data.candidates[0].content.parts[0].text;
  
  console.log('✅ SUCCESS!\n');
  console.log('Response:');
  console.log(text);
}

test();