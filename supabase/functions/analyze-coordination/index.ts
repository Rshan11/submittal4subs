import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// COST SAFETY: Lock to Haiku 3.5 (faster & better than Haiku 3)
const REQUIRED_MODEL = 'claude-3-5-haiku-20241022';
const MAX_COST_PER_CALL = 0.05; // 5 cents max

function validateModel(model: string) {
  if (model !== REQUIRED_MODEL) {
    throw new Error(`COST ALERT: Wrong model ${model}! Expected ${REQUIRED_MODEL}`);
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { text, trade, userEmail, filename } = await req.json();
    
    console.log(`[COORD API] Analyzing coordination for ${trade}, text length:`, text.length);
    console.log(`[COORD API] Text contains Division 03:`, text.includes('DIVISION 03'));
    console.log(`[COORD API] Text contains Division 04:`, text.includes('DIVISION 04'));
    console.log(`[COORD API] Text contains Division 07:`, text.includes('DIVISION 07'));
    
    // Count pages from different divisions to verify extraction
    const pageMatches = text.match(/--- PAGE (\d+) ---/g);
    if (pageMatches) {
      console.log(`[COORD API] Total page markers:`, pageMatches.length);
    }
    
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    
    const coordPrompt = `You are analyzing coordination requirements for a ${trade} contractor.

The ${trade} contractor needs an ACTIONABLE CHECKLIST with:
1. Specific materials/products from other divisions they must coordinate with
2. Exact product specifications (thickness, type, brands)  
3. What actions the ${trade} contractor must take
4. Interface details between trades

The text below contains specifications from divisions that reference ${trade} work.

FORMAT YOUR RESPONSE AS AN ACTIONABLE CHECKLIST:
- Material specifications with dimensions and types
- Approved brands/manufacturers  
- Specific actions the ${trade} contractor must perform
- Coordination requirements with other trades

Focus on CONCRETE DETAILS like:
✓ "2 inch rigid XPS insulation board"
✓ "Grace Perm-A-Barrier or approved equal"
✓ "Size masonry anchors for insulation + sheathing thickness"

NOT vague statements like:
✗ "Coordinate with other trades"
✗ "Follow specifications"

Analyze ALL divisions present in the text below. If Division 07 is present, include specific flashing, waterproofing, and sealant requirements.

Specification text:
${text.substring(0, 80000)}`;

    const coordination = await callClaude(apiKey, coordPrompt, trade);
    
    return new Response(JSON.stringify({
      coordination
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[COORD ERROR]', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function callClaude(apiKey: string, prompt: string, trade: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: REQUIRED_MODEL,
      max_tokens: 4000,
      system: `You are a construction specification analyst. When analyzing coordination sections that contain multiple CSI divisions, you MUST analyze each division separately and completely. Never skip divisions. If the text includes Division 07 (Thermal & Moisture Protection), it MUST be included in your analysis with specific details about flashing, waterproofing, and sealants relevant to ${trade} work.`,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('[COORD API ERROR]', error);
    throw new Error(error.error?.message || 'Claude API error');
  }

  const data = await response.json();
  console.log('[COORD API] Response received, length:', data.content[0].text.length);
  
  // Log if Division 07 appears in response
  const responseText = data.content[0].text;
  console.log('[COORD API] Response includes Division 07:', responseText.includes('Division 07') || responseText.includes('DIVISION 07'));
  
  return responseText;
}
