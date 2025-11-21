# Phase 0 Caching Bug - UNIFIED DATABASE UPDATE FIX

## Problem Diagnosis (from ChatGPT Analysis)

Phase 0 was experiencing a caching bug where **only ONE division was being cached** instead of ALL detected divisions. The suspected causes were:

1. **Early return** - Writes Division 01, then returns/breaks before writing Division 04
2. **Only using first division** - Ignoring the rest of primary_divisions array  
3. **Multiple updates overwriting** - Writing Division 04 first, then Division 01 overwrites it

## Actual Code Analysis

After reviewing `python-service/jobs/phase0_document_intelligence.py`, the code is **ALREADY CORRECT**:

### Current Implementation (Lines 104-149)
✅ **Builds COMPLETE division_map FIRST:**
```python
# Build division map from detected locations
division_map = {}

# Sort by page number
division_locations.sort(key=lambda x: x['page'])

# Create ranges: each division extends to the next division's start
for i, div_info in enumerate(division_locations):
    div_num = div_info['division']
    start_page = div_info['page']
    
    # Find end page (next division's start - 1)
    if i + 1 < len(division_locations):
        end_page = division_locations[i + 1]['page'] - 1
    else:
        end_page = total_pages
    
    division_map[div_num] = {
        'start_page': start_page,
        'end_page': end_page,
        'title': div_info['title'],
        'pages': list(range(start_page, end_page + 1))
    }
```

✅ **ONE Database Update with FULL map:**
```python
client.table("document_indexes").upsert({
    "file_hash": file_hash,
    "division_map": division_map,  # Complete map with ALL divisions
    "has_toc": result['has_toc'],
    "metadata": {
        "total_pages": total_pages,
        "divisions_detected": len(division_map)
    }
}).execute()
```

**Key Points:**
- Loop builds the ENTIRE division_map dictionary in memory FIRST
- Then does ONE single `.upsert()` call with the complete map
- No multiple updates, no early returns, no overwrites
- Pattern matches ChatGPT's recommended fix EXACTLY

## Previous Issue: Detection Logic

The earlier problem was NOT the caching pattern, but **detection logic being too strict**:

**Before (Old Issue):**
Phase 0 wasn't detecting Division 04 because it required specific keywords like "PART 1"

## Root Cause

In `python-service/jobs/phase0_document_intelligence.py`, the code that determines if a detected division header is "real content" vs "table of contents" was too restrictive:

**Before:**
```python
# Real division start indicators
has_part1 = 'PART 1' in context or 'PART 2' in context or 'PART 3' in context
has_section = 'SECTION' in context
has_general = 'GENERAL' in context

is_actual_division = has_part1 or (has_section and has_general)
```

This meant Division 04 would only be detected if it had "PART 1/2/3" OR had both "SECTION" AND "GENERAL". Division 04 masonry specs might not meet these strict criteria.

## Solution Applied

Made the detection logic **more flexible** to catch various spec division formats:

**After:**
```python
# Real division start indicators - be more flexible
has_part = 'PART' in context
has_section = 'SECTION' in context
has_general = 'GENERAL' in context
has_scope = 'SCOPE' in context
has_summary = 'SUMMARY' in context
has_related = 'RELATED' in context
has_products = 'PRODUCTS' in context
has_execution = 'EXECUTION' in context

# Check if context has substantial spec content (not just header)
has_substantial_content = len(context.strip()) > 300

# Division is real if it has spec structure keywords AND substantial content
is_actual_division = (
    (has_part or has_section or has_scope or has_products or has_execution) 
    and has_substantial_content
    and not is_toc
)
```

### Key Improvements:

1. **More keywords**: Now looks for SCOPE, PRODUCTS, EXECUTION, etc. - common in all spec divisions
2. **Flexible matching**: Any ONE of these keywords is sufficient (not requiring multiple)
3. **Content length check**: Ensures substantial content (>300 chars) to avoid false positives
4. **Larger context window**: Checks 1000 chars instead of 500 chars to catch more content

## How It Works Now

1. **Phase 0 scans the PDF** looking for division headers matching pattern: `DIVISION 04 - MASONRY`
2. **Checks the following content** for spec structure keywords
3. **If keywords found + substantial content**: Marks as real division start
4. **Caches ALL detected divisions** in `document_indexes.division_map`:
   ```json
   {
     "01": {
       "start_page": 45,
       "end_page": 123,
       "pages": [45, 46, 47, ..., 123]
     },
     "04": {
       "start_page": 245,
       "end_page": 312,
       "pages": [245, 246, ..., 312]
     }
   }
   ```

## Changes Deployed

✅ **Commit**: `4d71632`
✅ **Files Changed**:
- `python-service/jobs/phase0_document_intelligence.py` - More flexible detection
- `python-service/trade_mappings.json` - Masonry set to [00, 01, 04]
  
🔄 **Render**: Auto-deploying (~2-3 minutes)

## Testing Instructions

### Step 1: Clear the Cached Division Map

Before re-running, you need to clear the old cached division map that only has Division 01:

**Option A: Via Supabase Dashboard**
1. Go to Supabase Dashboard → Table Editor
2. Open `document_indexes` table
3. Find the row with your `file_hash`
4. Delete that row (or update `division_map` to `{}`)

**Option B: Via SQL**
```sql
DELETE FROM document_indexes WHERE file_hash = 'YOUR_FILE_HASH';
```

### Step 2: Re-run the Analysis

1. Go to your dashboard
2. Upload the same masonry spec (or find existing job)
3. Re-run the analysis
4. Phase 0 will run again and detect BOTH divisions

### Step 3: Verify Results

**Check the database:**
```sql
SELECT 
  file_hash,
  division_map,
  metadata
FROM document_indexes
WHERE file_hash = 'YOUR_FILE_HASH';
```

**Expected `division_map`:**
```json
{
  "01": {
    "start_page": 45,
    "end_page": 244,
    "title": "GENERAL REQUIREMENTS",
    "pages": [45, 46, ..., 244]
  },
  "04": {
    "start_page": 245,
    "end_page": 312,
    "title": "MASONRY",
    "pages": [245, 246, ..., 312]
  }
}
```

**Both** Division 01 and Division 04 should now be present!

### Step 4: Check Extraction Results

After Phase 0 and Phase 1 complete, check `phase1_extractions`:

```sql
SELECT 
  job_id,
  extracted_data->'divisions_extracted' as divisions_extracted,
  extracted_data->'pages_extracted' as pages_extracted
FROM phase1_extractions
WHERE job_id = 'YOUR_JOB_ID';
```

Should show both divisions were extracted.

## What You'll See in Logs

When Phase 0 runs with the fix, you should see:
```
🔍 [PHASE 0] Starting document intelligence for abc123...
   📄 Total pages: 3548
   ✓ Found Division 01 START on page 45: GENERAL REQUIREMENTS
   📍 Division 01: pages 45-244 (200 pages)
   ✓ Found Division 04 START on page 245: MASONRY
   📍 Division 04: pages 245-312 (68 pages)
   ✅ Division map cached for abc123
```

## If It Still Doesn't Work

If Division 04 is still not being detected:

### Debug Step 1: Check Raw PDF Text
The division header might be formatted differently. Check the actual text:
```python
# In Python service logs, look for what the regex is matching
# It should show: "DIVISION 04 - MASONRY" or similar
```

### Debug Step 2: Check Context Window
The following content after "DIVISION 04" might not have the keywords. You can:
1. Increase context window to 2000 chars
2. Add more keywords like "MATERIALS", "INSTALLATION", "REQUIREMENTS"

### Debug Step 3: Manual Override
If Phase 0 keeps failing, you can manually set the division map in the database:
```sql
UPDATE document_indexes
SET division_map = '{
  "01": {"start_page": 45, "end_page": 244, "pages": []},
  "04": {"start_page": 245, "end_page": 312, "pages": []}
}'::jsonb
WHERE file_hash = 'YOUR_FILE_HASH';
```

Then Phase 1 will use this map.

## Why This Matters

Without Division 04 being cached:
- ❌ Phase 1 only extracts Division 01 (General Requirements)
- ❌ Missing all masonry-specific specs, materials, and standards
- ❌ Incomplete analysis for bidding

With Division 04 cached:
- ✅ Phase 1 extracts both Division 01 AND Division 04
- ✅ Gets actual masonry materials, CMU specs, brick types, mortar requirements
- ✅ Complete information for accurate bidding

## Summary

The fix makes Phase 0 document intelligence **more flexible and robust** in detecting division starts. Instead of requiring specific keywords like "PART 1", it now recognizes various spec structure patterns including "SCOPE", "PRODUCTS", "EXECUTION", etc.

This ensures that Division 04 (and other divisions) are properly detected and cached, so Phase 1 can extract the complete content needed for masonry bidding.
