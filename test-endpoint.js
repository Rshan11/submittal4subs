// Quick test of the new analyze-spec endpoint

const testData = {
    pdfText: `DIVISION 04 - MASONRY
    
SECTION 04 21 13 - THIN BRICK MASONRY

1.1 MATERIALS
A. Thin Brick: ASTM C1088, Grade Exterior
B. Mortar: ASTM C270, Type M
   1. Cold weather additives NOT PERMITTED
   
1.2 INSTALLATION
A. Weather Limitations:
   1. Cold Weather: Minimum temperature 40°F
   2. Hot Weather: Maximum 100°F, or 90°F with wind exceeding 8 mph
   
1.3 QUALITY ASSURANCE
A. Installer Qualifications: 5 years minimum experience`,
    trade: 'masonry'
};

console.log('Testing /api/analyze-spec endpoint...');
console.log('Trade:', testData.trade);
console.log('Text length:', testData.pdfText.length);

fetch('http://localhost:3001/api/analyze-spec', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(testData)
})
.then(response => {
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers.get('content-type'));
    return response.json();
})
.then(data => {
    console.log('\n✅ SUCCESS! Got JSON response');
    console.log('Structure detected:', data.structure?.divisionsFound?.length, 'divisions');
    console.log('Confidence:', data.confidence);
    console.log('Warnings:', data.warnings?.length || 0);
    console.log('\nSecurity analysis length:', data.security?.length);
    console.log('Contract analysis length:', data.contract?.length);
    console.log('Trade analysis length:', data.tradeRequirements?.length);
})
.catch(error => {
    console.error('❌ ERROR:', error.message);
    console.error('Full error:', error);
});
