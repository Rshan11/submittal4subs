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
    const { text, trade, userEmail, filename, chunkInfo, isChunked } = await req.json();
    
    console.log(`[TRADE] Analyzing ${trade}, text length:`, text.length);
    if (chunkInfo) {
      console.log(`[TRADE] Chunk context: ${chunkInfo}`);
    }
    
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    
    // Add chunk context to prompt if provided
    let contextNote = '';
    if (chunkInfo && isChunked) {
      contextNote = `\n\nNOTE: This is ${chunkInfo}. Focus on extracting requirements from this specific section. The results will be combined with other sections later.\n`;
    }
    
    // Analyze trade requirements
    const tradePrompt = `You are creating a pricing checklist for a ${trade} contractor.${contextNote}

Use color coding:
🟢 = Fully specified (size, grade, brand, standard) - ready to price
🟡 = Partially specified (some vagueness) - note assumptions
🔴 = Missing critical info - RFI required before pricing

Read what's ACTUALLY in the spec and organize:

## MATERIALS
List every material specified:
- Include: type, size, grade, manufacturer if given
- For each item show:
  🟢/🟡/🔴 [Item name and specs]
  Spec says: "[exact quote]"
  ✓ What's clear
  ⚠️ What's vague
  ❌ What's missing

## INSTALLATION REQUIREMENTS
- Procedures, sequences, conditions
- Use same color coding

## TESTING & INSPECTION  
- What tests required
- Who performs them
- Acceptance criteria

## SUBMITTALS
- What submittals needed
- Timing requirements
- Approval process

## CRITICAL/EXPENSIVE/RISKY ITEMS
Flag anything that:
- Has tight tolerances
- Requires mock-ups
- Has limited approved brands
- Could cause delays
- Is unusually expensive

Show what's ACTUALLY specified - don't assume or predict.

Specification text:
${text.substring(0, 60000)}`;

    const requirements = await callClaude(apiKey, tradePrompt);
    
    // Extract submittals
    const submittals = extractSubmittals(requirements);
    
    // Analyze change order triggers
    const changeOrderPrompt = `Analyze potential change order triggers for ${trade} contractor.

Look for:
- Vague specifications that may need clarification
- "As directed by architect" clauses
- Allowances or unit prices
- Conditions that trigger extra work

Use 🟢🟡🔴 to mark likelihood.

Specification text:
${text.substring(0, 40000)}`;

    const changeOrders = await callClaude(apiKey, changeOrderPrompt);
    
    return new Response(JSON.stringify({
      requirements,
      submittals,
      changeOrders
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[TRADE ERROR]', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function callClaude(apiKey: string, prompt: string) {
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
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Claude API error');
  }

  const data = await response.json();
  return data.content[0].text;
}

function extractSubmittals(text: string) {
  const submittals: any[] = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (line.match(/SD-\d{2}|submittal/i)) {
      submittals.push({
        name: line.trim(),
        type: 'Product Data'
      });
    }
  }
  
  return submittals;
}
