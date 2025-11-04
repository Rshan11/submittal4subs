-- Add spec_indices table for TOC caching
CREATE TABLE IF NOT EXISTS spec_indices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  filename text NOT NULL,
  total_pages int NOT NULL,
  toc_found boolean DEFAULT false,
  toc_pages text,
  sections jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(user_email, filename)
);

ALTER TABLE spec_indices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service full access indices" ON spec_indices;
DROP POLICY IF EXISTS "Users can view their own indices" ON spec_indices;

CREATE POLICY "Service full access indices" 
  ON spec_indices FOR ALL 
  USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Users can view their own indices"
  ON spec_indices FOR SELECT
  USING (user_email = auth.jwt()->>'email');

CREATE INDEX IF NOT EXISTS idx_spec_indices_user_file 
  ON spec_indices(user_email, filename);
