# Unified Architecture Deployment Guide

## ✅ COMPLETED
1. Created `supabase/functions/analyze-spec-unified/index.ts`
   - Single Edge Function that handles all analysis
   - Finds division boundaries using regex search for "SECTION XXX" headers
   - Extracts Division 00 and trade division text
   - Single Gemini API call for complete analysis
   - Returns contract, materials, and coordination data

2. Updated `main.js` frontend
   - Simplified `analyzeDocument()` function
   - Extracts full PDF text (all pages)
   - Calls unified Edge Function
   - Formats results for display

## 🚀 DEPLOYMENT STEPS

### Step 1: Deploy the New Edge Function

```bash
cd c:\spec-analyzer
npx supabase functions deploy analyze-spec-unified
```

### Step 2: Test on Animal Shelter Spec

1. Open the application
2. Select "Masonry" trade
3. Upload `CONVERSE-COUNTY-ANIMAL-SHELTER-SPECS.pdf`
4. Enter email and click Analyze
5. Verify results:
   - ✅ Finds Division 04 at correct page (191, not 160)
   - ✅ Extracts "Cumberland Tudor" brick
   - ✅ Flags CMU color as missing (🔴)
   - ✅ Marks anchors as clear (🟢)
   - ✅ Takes under 10 seconds

### Step 3: Delete Old Edge Functions (After Testing)

Once the unified function works correctly:

```bash
# Delete old functions
rm -rf supabase/functions/identify-sections
rm -rf supabase/functions/analyze-contract
rm -rf supabase/functions/analyze-coordination
rm -rf supabase/functions/identify-critical-coordination
rm -rf supabase/functions/analyze-trade
rm -rf supabase/functions/analyze-spec
```

### Step 4: Update Supabase (Optional)

If the old functions were deployed:

```bash
supabase functions delete identify-sections
supabase functions delete analyze-contract
supabase functions delete analyze-coordination
supabase functions delete identify-critical-coordination
supabase functions delete analyze-trade
supabase functions delete analyze-spec
```

## 🔍 TESTING CHECKLIST

- [ ] Edge Function deploys successfully
- [ ] Frontend loads without errors
- [ ] PDF extraction works (shows progress)
- [ ] Analysis completes in < 10 seconds
- [ ] Division 04 found at page 191
- [ ] Materials list includes 20+ items
- [ ] "Cumberland Tudor" brick found
- [ ] CMU color flagged as missing
- [ ] Risk levels (🟢🟡🔴) display correctly
- [ ] Coordination section populated
- [ ] No console errors

## 📊 EXPECTED PERFORMANCE

- **Full PDF extraction**: ~5-10 seconds
- **AI analysis**: ~5-8 seconds
- **Total time**: < 15 seconds
- **API calls**: 1 (instead of 4-6)
- **Cost per analysis**: ~$0.02-0.03 (instead of $0.10+)

## 🐛 TROUBLESHOOTING

### "Division not found" error
- Check that SECTION headers exist in PDF
- Verify regex pattern matches format (e.g., "SECTION 040")
- Increase search range if needed

### Timeout errors
- Check Gemini API key is valid
- Verify PDF text extraction completed
- Check for very large PDFs (>500 pages)

### Wrong materials extracted
- Verify division boundaries are correct
- Check that Division 04 text is being extracted
- Look at console logs for extracted page ranges

## 🎯 SUCCESS CRITERIA (from task)

When testing on Animal Shelter spec:
- ✅ Finds Division 04 at page 191 (not 160)
- ✅ Extracts "Cumberland Tudor" brick
- ✅ Flags CMU color as missing (🔴)
- ✅ Marks anchors as clear (🟢)
- ✅ Finds all 20+ masonry materials
- ✅ Takes under 10 seconds total

## 📝 NOTES

- The unified function searches for actual "SECTION XXX" headers instead of relying on TOC page numbers
- Form feed characters (`\f`) in PDF text mark page breaks for accurate page counting
- Division boundaries are calculated by finding first and last section in each division range
- Single Gemini call reduces latency and cost significantly
