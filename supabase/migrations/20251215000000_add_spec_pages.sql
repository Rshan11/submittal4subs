-- Migration: Add spec_pages table for page-level tagging
-- This replaces the range-based division detection with per-page section tagging
-- Each page is individually tagged with its section number from the header/footer

-- Create new table for page-level storage
CREATE TABLE IF NOT EXISTS spec_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spec_id UUID NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    section_number VARCHAR(20),  -- "03 30 00", "04 22 00.13", null if not detected
    division_code VARCHAR(2),    -- "03", "04", "07" (first 2 digits of section)
    content TEXT NOT NULL,
    char_count INTEGER,
    cross_refs TEXT[],           -- Array of section numbers mentioned: ["07 92 00", "05 12 00"]
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(spec_id, page_number)
);

-- Index for fast division queries
CREATE INDEX IF NOT EXISTS idx_spec_pages_division ON spec_pages(spec_id, division_code);

-- Index for section lookups (used for cross-reference fetching)
CREATE INDEX IF NOT EXISTS idx_spec_pages_section ON spec_pages(spec_id, section_number);

-- Index for spec + page ordering
CREATE INDEX IF NOT EXISTS idx_spec_pages_order ON spec_pages(spec_id, page_number);

-- Add comment explaining the table
COMMENT ON TABLE spec_pages IS 'Page-level storage for parsed PDF specifications. Each page is tagged with its section number from header/footer detection.';
COMMENT ON COLUMN spec_pages.section_number IS 'Section number detected from page header/footer, e.g., "03 30 00" or "04 22 00.13"';
COMMENT ON COLUMN spec_pages.division_code IS 'First two digits of section_number, e.g., "03", "04". Used for division-level queries.';
COMMENT ON COLUMN spec_pages.cross_refs IS 'Array of section numbers referenced in the page content, excluding self-references.';
