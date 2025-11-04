import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk@0.32.1'

const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
})

serve(async (req) => {
  try {
    const { divisionRefs, trade, tradeContext, userEmail, filename } = await req.json()
    
    console.log('[SMART COORD] Analyzing divisions:', divisionRefs)
    
    const prompt = `You are analyzing a construction specification for ${trade} work.

The ${trade} specification references the following CSI divisions:
${divisionRefs.map((d: string) => `- Division ${d}`).join('\n')}

Trade Context Summary:
${tradeContext}

Your task: Identify which of these divisions contain CRITICAL coordination requirements for ${trade}.

CRITICAL means:
- Direct interface or dependency (e.g., masonry on concrete substrate)
- Sequencing requirements (e.g., must install after X, before Y)
- Shared responsibility (e.g., both trades work on same element)
- Quality control overlap (e.g., joint inspections required)

NOT CRITICAL:
- General references that don't require coordination
- Standard specifications that ${trade} is aware of
- Adjacent work that doesn't interface directly

Respond ONLY with a JSON array of division numbers that are CRITICAL.
If none are critical, return an empty array [].

Examples:
- Masonry referencing concrete substrate → Include Division 03
- Masonry referencing painting of completed work → Exclude Division 09
- Masonry referencing structural steel it bears on → Include Division 05

Return format: {"criticalDivisions": ["03", "05"]}
Return ONLY the JSON, no other text.`

    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
    
    const responseText = message.content[0].text
    console.log('[SMART COORD] AI response:', responseText)
    
    // Parse JSON response
    let result
    try {
      result = JSON.parse(responseText)
    } catch (e) {
      // Try to extract JSON from text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0])
      } else {
        console.error('[SMART COORD] Could not parse AI response')
        result = { criticalDivisions: divisionRefs.slice(0, 3) } // Fallback
      }
    }
    
    return new Response(
      JSON.stringify(result),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('[SMART COORD] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
