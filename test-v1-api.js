const GEMINI_API_KEY = 'AIzaSyDBrR4PObq82f9UKG3VEZ0WxCVjm6jFrKY';

async function testV1() {
  console.log('🧪 Testing with v1 API...\n');
  
  // Try v1 instead of v1beta
  const url = 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent';
  
  const response = await fetch(`${url}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ 
        parts: [{ text: 'Say hello' }] 
      }]
    })
  });
  
  console.log('Status:', response.status);
  
  if (response.ok) {
    const data = await response.json();
    console.log('✅ SUCCESS!\n');
    console.log('Response:', data.candidates[0].content.parts[0].text);
  } else {
    const error = await response.json();
    console.log('❌ Error:', JSON.stringify(error, null, 2));
  }
}

testV1();