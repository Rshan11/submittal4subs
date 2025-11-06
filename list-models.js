const GEMINI_API_KEY = 'AIzaSyAXIx7ROgwi6pZSt6-CntBQZxX0arsHLHc';

async function listModels() {
  console.log('🔍 Checking available models...\n');
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
  );
  
  if (!response.ok) {
    console.error('❌ Error:', response.status);
    return;
  }
  
  const data = await response.json();
  
  console.log('✅ Available models:\n');
  
  data.models
    .filter(m => m.supportedGenerationMethods.includes('generateContent'))
    .forEach(model => {
      console.log(`📦 ${model.name}`);
      console.log(`   Display: ${model.displayName}`);
      console.log(`   Methods: ${model.supportedGenerationMethods.join(', ')}`);
      console.log('');
    });
}

listModels();