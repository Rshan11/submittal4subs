# Masonry Division Configuration Fix

## Problem Identified

The masonry trade was configured to extract too many divisions, including Division 03 (Concrete) and Division 07 (Thermal/Moisture Protection) which aren't essential for masonry bidding.

## Solution Applied

Updated `python-service/trade_mappings.json` to focus on the **3 essential divisions** for masonry contractors:

```json
"masonry": {
  "name": "Masonry & Concrete",
  "primary_divisions": ["00", "01", "04"],
  "division_names": {
    "00": "Procurement and Contracting Requirements",
    "01": "General Requirements",
    "04": "Masonry"
  }
}
```

### What Each Division Provides:

- **Division 00**: Procurement and contracting requirements
  - ⚠️ Will be skipped if not present in spec (some specs don't have it)
  - Not critical for subcontractors (more for GCs)
  
- **Division 01**: General Requirements ✅ CRITICAL
  - Submittals, schedules, coordination procedures
  - Quality control requirements
  - Testing and inspection requirements
  
- **Division 04**: Masonry ✅ CRITICAL
  - Actual masonry materials and specifications
  - Brick, block, CMU specifications
  - Mortar and grout requirements
  - Installation methods and standards

### Removed Divisions:

- ~~Division 03: Concrete~~ - Not essential for masonry bidding
- ~~Division 07: Thermal/Moisture~~ - Not essential for masonry bidding

These can be added back later if needed, but for quick bidding, Divisions 01 and 04 are what matter most.

## Deployment Status

✅ **Committed**: `0f991de`
✅ **Pushed to GitHub**: Successfully pushed to origin/main
🔄 **Render Auto-Deploy**: Should be deploying automatically now

### Check Deployment Status:

1. Go to https://dashboard.render.com
2. Select your Python service
3. Check the "Events" tab for deployment progress
4. Look for "Deploy live" status

### Verify Deployment:

```bash
curl https://YOUR-SERVICE-NAME.onrender.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "spec-analyzer-python",
  "version": "0.1.0"
}
```

## Testing Instructions

### Step 1: Re-run Analysis

1. Go to your dashboard
2. Find the job that only extracted Division 01
3. Click to re-analyze that job
4. The system will now extract **both Division 01 AND Division 04**

### Step 2: Verify Results

Check that the analysis now includes:
- ✅ Division 01: General Requirements
- ✅ Division 04: Masonry specifications
- ✅ Materials breakdown from Division 04
- ✅ Coordination requirements from Division 01

### Step 3: Test with Small Spec First

Before re-running the 3,548-page spec:
1. Test with a smaller spec (under 500 pages) first
2. Verify both divisions are being extracted
3. Check that materials are being identified correctly

## Technical Details

### Configuration Files Changed:

1. **`python-service/trade_mappings.json`**
   - Removed Division 03 and 07 from masonry
   - Kept essential divisions: 00, 01, 04

2. **`python-service/app.py`** (Previous Update)
   - Added CORS middleware
   - Added background task processing
   - Added timeout handling

### How It Works:

1. **Phase 0** (Document Intelligence): Builds division map from TOC
2. **Phase 1** (Extraction): Uses `trade_mappings.json` to determine which divisions to extract
3. **Phase 2** (Materials Analysis): Analyzes extracted divisions for materials

The system looks up `trade_config["primary_divisions"]` and only extracts those divisions from the spec.

## If Division 00 Is Missing

The system gracefully handles missing divisions:
- If Division 00 is not in the spec, it logs a warning and continues
- Division 01 and 04 will still be extracted
- No errors will occur

This is common - many specs don't have Division 00 or call it Division 1 instead.

## Next Steps After Deployment

1. ✅ Wait for Render to complete deployment (~2-3 minutes)
2. ✅ Verify health endpoint responds
3. ✅ Test with a small spec first
4. ✅ Re-run analysis on the masonry job
5. ✅ Verify Division 04 is now being extracted
6. ✅ Check that materials list includes masonry-specific items

## Expected Outcome

After this fix, masonry jobs will extract:
- Division 00 (if present)
- Division 01 (General Requirements)
- Division 04 (Masonry specifications)

This provides all the information needed for accurate masonry bidding without processing unnecessary divisions.
