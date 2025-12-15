-- Migration: Add classification_method column to spec_pages table
-- Tracks which tier was used to classify each page:
--   'toc' = Table of Contents mapping (Tier 1, most accurate)
--   'footer' = Footer pattern matching (Tier 2)
--   'keyword' = Keyword fallback (Tier 3)
--   NULL = Unclassified

ALTER TABLE spec_pages
ADD COLUMN IF NOT EXISTS classification_method VARCHAR(10);

-- Add comment explaining the column
COMMENT ON COLUMN spec_pages.classification_method IS 'Classification tier used: toc (Table of Contents), footer (pattern matching), keyword (fallback), or NULL (unclassified)';

-- Index for analyzing classification effectiveness
CREATE INDEX IF NOT EXISTS idx_spec_pages_classification
ON spec_pages(spec_id, classification_method);
