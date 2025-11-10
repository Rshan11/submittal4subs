-- ============================================================================
-- PHASE 0: Document Intelligence Caching Layer
-- ============================================================================
-- This migration creates the caching infrastructure for document intelligence
-- analysis, including TOC detection and division mapping.
-- ============================================================================

-- Create document_intelligence_cache table
CREATE TABLE IF NOT EXISTS public.document_intelligence_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_hash VARCHAR(64) UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    total_pages INTEGER NOT NULL,
    file_size BIGINT NOT NULL,
    intelligence_data JSONB NOT NULL,
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    access_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_hash
    ON public.document_intelligence_cache(document_hash);

CREATE INDEX IF NOT EXISTS idx_cached_at
    ON public.document_intelligence_cache(cached_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_name
    ON public.document_intelligence_cache(file_name);

-- Create function to update last_accessed timestamp
CREATE OR REPLACE FUNCTION update_cache_access()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_accessed = NOW();
    NEW.access_count = OLD.access_count + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cache access tracking
CREATE TRIGGER trigger_update_cache_access
    BEFORE UPDATE ON public.document_intelligence_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_cache_access();

-- Create function to clean old cache entries (optional maintenance)
CREATE OR REPLACE FUNCTION clean_old_cache_entries(days_old INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.document_intelligence_cache
    WHERE last_accessed < NOW() - (days_old || ' days')::INTERVAL
    AND access_count < 5;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create analysis_jobs table for tracking user analyses
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    job_name TEXT NOT NULL,
    document_hash VARCHAR(64) REFERENCES public.document_intelligence_cache(document_hash),
    file_name TEXT NOT NULL,
    trade VARCHAR(50) NOT NULL,
    total_pages INTEGER,
    file_size BIGINT,
    analysis_data JSONB,
    metadata JSONB,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    processing_time_ms INTEGER,
    error_message TEXT
);

-- Indexes for analysis_jobs
CREATE INDEX IF NOT EXISTS idx_user_jobs
    ON public.analysis_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_hash_jobs
    ON public.analysis_jobs(document_hash);

CREATE INDEX IF NOT EXISTS idx_job_status
    ON public.analysis_jobs(status);

-- Enable Row Level Security
ALTER TABLE public.document_intelligence_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for document_intelligence_cache
-- Allow service role full access
CREATE POLICY "Service role full access on cache"
    ON public.document_intelligence_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to read cache
CREATE POLICY "Authenticated users can read cache"
    ON public.document_intelligence_cache
    FOR SELECT
    TO authenticated
    USING (true);

-- RLS Policies for analysis_jobs
-- Users can view their own jobs
CREATE POLICY "Users can view own jobs"
    ON public.analysis_jobs
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Users can create their own jobs
CREATE POLICY "Users can create own jobs"
    ON public.analysis_jobs
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own jobs
CREATE POLICY "Users can update own jobs"
    ON public.analysis_jobs
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service role full access to jobs
CREATE POLICY "Service role full access on jobs"
    ON public.analysis_jobs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Create view for cache statistics
CREATE OR REPLACE VIEW public.cache_statistics AS
SELECT
    COUNT(*) as total_entries,
    SUM(file_size) as total_size_bytes,
    AVG(total_pages) as avg_pages,
    SUM(access_count) as total_accesses,
    COUNT(CASE WHEN cached_at > NOW() - INTERVAL '24 hours' THEN 1 END) as entries_last_24h,
    COUNT(CASE WHEN last_accessed > NOW() - INTERVAL '7 days' THEN 1 END) as active_last_week
FROM public.document_intelligence_cache;

-- Grant appropriate permissions
GRANT SELECT ON public.cache_statistics TO authenticated;
GRANT ALL ON public.document_intelligence_cache TO service_role;
GRANT ALL ON public.analysis_jobs TO service_role;
GRANT SELECT ON public.document_intelligence_cache TO authenticated;
GRANT ALL ON public.analysis_jobs TO authenticated;

-- Add helpful comments
COMMENT ON TABLE public.document_intelligence_cache IS 'Caches document intelligence analysis results including TOC detection and division mapping';
COMMENT ON TABLE public.analysis_jobs IS 'Tracks user analysis jobs and links to cached document intelligence';
COMMENT ON COLUMN public.document_intelligence_cache.document_hash IS 'SHA-256 hash of document content for deduplication';
COMMENT ON COLUMN public.document_intelligence_cache.intelligence_data IS 'Complete intelligence analysis including TOC, division map, and metadata';
COMMENT ON FUNCTION clean_old_cache_entries IS 'Maintenance function to remove old, rarely accessed cache entries';
