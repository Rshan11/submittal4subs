-- Phase 0 Cache Fix - Cleanup Script
-- Run this to clear invalid cache entries before redeploying

-- OPTION 1: Clear specific bad entries (RECOMMENDED)
-- Replace with your actual file_hash values
UPDATE document_indexes
SET division_map = NULL
WHERE file_hash IN (
  'c57c2363298d872c228fec68b17ed4c3a2ff7afd4ec4c277e710435f6a2f8910',
  -- Add other file_hashes with empty {} maps here
  '94a920fe...'  -- Example: another problematic hash
);

-- OPTION 2: Clear ALL empty division maps (more aggressive)
-- This finds rows where division_map is empty {} or null
UPDATE document_indexes
SET division_map = NULL
WHERE division_map IS NULL 
   OR division_map = '{}'::jsonb
   OR jsonb_typeof(division_map) = 'object' AND division_map = '{}'::jsonb;

-- OPTION 3: Delete rows entirely (cleanest)
-- Forces complete re-detection on next run
DELETE FROM document_indexes
WHERE division_map IS NULL 
   OR division_map = '{}'::jsonb
   OR jsonb_typeof(division_map) = 'object' AND division_map = '{}'::jsonb;

-- VERIFICATION: Check what will be affected BEFORE running cleanup
-- Run this first to see which rows have problems:
SELECT 
  file_hash,
  jsonb_pretty(division_map) as division_map,
  CASE 
    WHEN division_map IS NULL THEN 'NULL'
    WHEN division_map = '{}'::jsonb THEN 'EMPTY'
    WHEN jsonb_object_keys(division_map) IS NULL THEN 'NO_KEYS'
    ELSE 'HAS_DATA'
  END as status,
  created_at,
  last_used_at
FROM document_indexes
ORDER BY created_at DESC;

-- After cleanup, verify results:
SELECT 
  COUNT(*) as total_rows,
  COUNT(CASE WHEN division_map IS NOT NULL AND division_map != '{}'::jsonb THEN 1 END) as valid_caches,
  COUNT(CASE WHEN division_map IS NULL OR division_map = '{}'::jsonb THEN 1 END) as invalid_caches
FROM document_indexes;
