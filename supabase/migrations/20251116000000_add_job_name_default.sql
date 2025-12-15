-- Set default value for job_name to prevent null constraint violations
ALTER TABLE jobs 
  ALTER COLUMN job_name SET DEFAULT 'phase1_extract';

-- Backfill any existing NULLs with the default value
UPDATE jobs SET job_name = 'phase1_extract' WHERE job_name IS NULL;
