import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { div00Text, div01Text, trade, userEmail, filename } = await req.json();
    
    console.log('[CONTRACT] Starting analysis');
    console.log('[CONTRACT] Division 00 length:', div00Text?.length || 0);
    console.log('[CONTRACT] Division 01 length:', div01Text?.length || 0);

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const claudeKey = Deno.env.get('ANTHROPIC_API_KEY');
    
    if (!geminiKey && !claudeKey) {
      throw new Error('No AI API keys configured');
    }

    // Analyze Division 00 (Procurement & Contracting)
    console.log('[CONTRACT] Analyzing Division 00...');
    const div00Results = await analyzeDivision00(geminiKey, claudeKey, div00Text || '');
    
    // Analyze Division 01 (General Requirements)
    console.log('[CONTRACT] Analyzing Division 01...');
    const div01Results = await analyzeDivision01(geminiKey, claudeKey, div01Text || '');

    return new Response(JSON.stringify({
      division00: div00Results,
      division01: div01Results,
      metadata: {
        processed_at: new Date().toISOString(),
        filename,
        trade
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[CONTRACT ERROR]', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: error.stack
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function analyzeDivision00(geminiKey: string, claudeKey: string, text: string) {
  const prompt = `Analyze Division 00 (Procurement & Contracting Requirements) for a construction subcontractor.

Use color coding to show confidence:
🟢 = Clearly specified, standard terms, low risk
🟡 = Specified but verify, unusual, or needs attention  
🔴 = High risk, unusual, expensive, or problematic

Organize into these categories:

## 💰 PAYMENT & FINANCIAL
- Payment terms and schedule
- Retainage percentage
- Change order markup limits (FLAG if <20%)
- Bonding requirements

## ⚖️ LEGAL & LIABILITY
- Liquidated damages (FLAG any amount)
- Insurance requirements
- Warranty period
- Indemnification clauses

## 📋 BIDDING & SUBMITTALS
- Bid bond requirements
- Submittal procedures
- Approved product lists
- Substitution procedures

## 🔐 SECURITY & ACCESS
- Site access requirements
- Security clearances needed
- Badging/background checks

For each item:
- Quote exact text from spec
- Mark 🟢🟡🔴 based on risk/clarity
- Flag anything unusual or expensive

Specification text:
${text}`;

  return await callAI(geminiKey, claudeKey, prompt, 'Division 00');
}

async function analyzeDivision01(geminiKey: string, claudeKey: string, text: string) {
  const prompt = `Analyze Division 01 (General Requirements) for a construction subcontractor.

Use color coding to show confidence:
🟢 = Clearly specified, standard terms, low risk
🟡 = Specified but verify, unusual, or needs attention  
🔴 = High risk, unusual, expensive, or problematic

Organize into these categories:

## 📝 SUBMITTALS & DOCUMENTATION
- Product data submittals
- Shop drawings
- Samples required
- Close-out documents

## ✅ QUALITY CONTROL
- Testing requirements
- Inspection procedures
- Mock-up requirements
- Acceptance criteria

## 👷 SITE PROCEDURES
- Project meetings schedule
- Daily reports
- Site logistics
- Cleanup requirements

## 🛡️ SAFETY & INSURANCE
- Safety plan requirements
- Insurance certificates timing
- Site-specific safety rules

For each item:
- Quote exact text from spec
- Mark 🟢🟡🔴 based on risk/clarity
- Flag anything unusual or expensive

Specification text:
${text}`;

  return await callAI(geminiKey, claudeKey, prompt, 'Division 01');
}

async function callAI(geminiKey: string, claudeKey: string, prompt: string, division: string) {
  // Try Gemini first
  if (geminiKey) {
    try {
      console.log(`[${division}] Trying Gemini...`);
      const result = await callGemini(geminiKey, prompt);
      console.log(`[${division}] ✅ Gemini success`);
      return result;
    } catch (error) {
      console.error(`[${division}] ❌ Gemini failed:`, error.message);
      // Fall through to Claude
    }
  }

  // Fallback to Claude
  if (claudeKey) {
    try {
      console.log(`[${division}] Trying Claude...`);
      const result = await callClaude(claudeKey, prompt);
      console.log(`[${division}] ✅ Claude success`);
      return result;
    } catch (error) {
      console.error(`[${division}] ❌ Claude failed:`, error.message);
      throw error;
    }
  }

  throw new Error('No AI API available');
}

async function callGemini(apiKey: string, prompt: string) {
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8000,
          topP: 0.95,
        }
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API error');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callClaude(apiKey: string, prompt: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Claude API error');
  }

  const data = await response.json();
  return data.content[0].text;
}
