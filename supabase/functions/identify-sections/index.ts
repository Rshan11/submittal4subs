import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent'

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { tocText, totalPages, trade, userEmail, filename, bookmarks } = await req.json()
    
    const textLength = tocText?.length || 0
    const estTokens = Math.floor(textLength / 4)
    
    console.log('[IDENTIFY] Request received:', {
      filename,
      totalPages,
      textLength: textLength.toLocaleString(),
      estimatedTokens: estTokens.toLocaleString(),
      hasBookmarks: !!bookmarks
    })
    
    // Use bookmarks if available
    if (bookmarks && Object.keys(bookmarks).length > 0) {
      console.log('[IDENTIFY] ✓ Using PDF bookmarks directly')
      return new Response(
        JSON.stringify({ 
          index: { 
            sections: bookmarks,
            method: 'bookmarks' 
          }
        }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }
    
    // Keyword-based search
    console.log('[IDENTIFY] Using keyword-based division search')
    
    const prompt = `You are analyzing a construction specification document to identify CSI MasterFormat division locations.

TASK: Find where each division ACTUALLY appears by scanning for content keywords.

CRITICAL: 
- Use "--- PAGE X ---" markers for actual PDF page numbers
- Ignore TOC page numbers (they don't match PDF pages)
- Only return divisions with HIGH CONFIDENCE

DIVISION KEYWORDS:

Division 00: "AGREEMENT", "GENERAL CONDITIONS", "EJCDC", "BID FORM"
Division 01: "SUMMARY", "SUBMITTALS", "QUALITY REQUIREMENTS"
Division 02: "DEMOLITION", "SITE SURVEY"
Division 03: "CAST-IN-PLACE CONCRETE", "CONCRETE FORMWORK", "MIX DESIGN", "ASTM C150"
Division 04: "UNIT MASONRY", "MASONRY MORTAR", "CMU", "BRICK", "ASTM C90", "GROUT"
Division 05: "STRUCTURAL STEEL", "METAL FABRICATIONS", "WELDING", "AISC"
Division 06: "ROUGH CARPENTRY", "FINISH CARPENTRY", "LUMBER"
Division 07: "WATERPROOFING", "INSULATION", "ROOFING", "FLASHING", "SEALANTS"
Division 08: "DOORS", "WINDOWS", "GLAZING", "HARDWARE", "HOLLOW METAL"
Division 09: "GYPSUM BOARD", "TILE", "FLOORING", "PAINTING"
Division 10: "TOILET PARTITIONS", "LOCKERS", "SIGNAGE"
Division 21: "FIRE SUPPRESSION", "SPRINKLERS", "NFPA"
Division 22: "PLUMBING", "FIXTURES", "DOMESTIC WATER", "SANITARY WASTE"
Division 23: "HVAC", "DUCTWORK", "AIR HANDLING", "MECHANICAL"
Division 26: "ELECTRICAL", "PANELBOARDS", "CONDUIT", "LIGHTING", "NEC"
Division 27: "COMMUNICATIONS", "DATA", "STRUCTURED CABLING"
Division 28: "FIRE ALARM", "SECURITY", "ACCESS CONTROL"
Division 31: "EARTHWORK", "EXCAVATION", "GRADING"
Division 32: "PAVING", "ASPHALT", "LANDSCAPING", "SITE IMPROVEMENTS"
Division 33: "UTILITIES", "STORM SEWER", "SANITARY SEWER"

VALIDATION:
- Each division needs 3+ keywords from its list
- If Division 04 contains "AGREEMENT" or "INSURANCE", that's WRONG
- Most divisions are 10-80 pages

OUTPUT (JSON only):
{
  "sections": {
    "div00": { "start": 2, "end": 15, "title": "Procurement and Contracting Requirements" },
    "3": { "start": 18, "end": 47, "title": "Concrete" },
    "4": { "start": 160, "end": 173, "title": "Masonry" }
  }
}

TEXT (${totalPages} pages):
${tocText}

Return only divisions found with HIGH CONFIDENCE.`

    console.log('[IDENTIFY] Calling Gemini...')
    const startTime = Date.now()
    
    const response = await fetch(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        })
      }
    )
    
    const duration = Date.now() - startTime
    console.log(`[IDENTIFY] Response in ${duration}ms`)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[IDENTIFY] Gemini error:', errorText)
      throw new Error(`Gemini API error: ${response.status}`)
    }
    
    const data = await response.json()
    const aiText = data.candidates[0].content.parts[0].text
    
    console.log('[IDENTIFY] Response preview:', aiText.substring(0, 300))
    
    const jsonMatch = aiText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[IDENTIFY] No JSON in response')
      throw new Error('AI did not return valid JSON')
    }
    
    const parsed = JSON.parse(jsonMatch[0])
    const sections = parsed.sections || {}
    
    console.log('[IDENTIFY] Found divisions:', Object.keys(sections).join(', '))
    
    for (const [key, value] of Object.entries(sections)) {
      const pageCount = value.end - value.start + 1
      console.log(`[IDENTIFY]   ${key}: pp. ${value.start}-${value.end} (${pageCount} pages)`)
    }
    
    // Save to database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    await supabase.from('spec_indexes').insert({
      user_email: userEmail,
      filename: filename,
      total_pages: totalPages,
      sections: sections,
      method: 'keyword_search'
    })
    
    return new Response(
      JSON.stringify({ 
        index: {
          ...parsed,
          metadata: {
            method: 'keyword_search',
            processingTime: duration
          }
        }
      }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
    
  } catch (error) {
    console.error('[IDENTIFY] Error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
})
