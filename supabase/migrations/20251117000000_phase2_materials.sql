-- Phase 2 Materials Analysis Table
-- Stores AI-extracted materials, submittals, coordination, and contract terms

CREATE TABLE IF NOT EXISTS phase2_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  materials JSONB DEFAULT '[]'::jsonb,
  submittals JSONB DEFAULT '[]'::jsonb,
  coordination JSONB DEFAULT '[]'::jsonb,
  contract_terms JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast job lookups
CREATE INDEX idx_phase2_job_id ON phase2_materials(job_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_phase2_materials_updated_at BEFORE UPDATE ON phase2_materials
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
