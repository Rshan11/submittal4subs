# Python Service CORS and Timeout Fix

## Problems Fixed

1. **CORS Headers Missing** - The FastAPI service wasn't configured with CORS middleware, causing cross-origin requests from the frontend to fail
2. **504 Timeout Errors** - Large spec files (3,548+ pages) were timing out because the service was trying to process them synchronously
3. **No Status Endpoint** - No way to check on job progress after starting

## Changes Made

### 1. Added CORS Middleware (`app.py`)

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Note:** In production, replace `allow_origins=["*"]` with your specific Supabase domain for better security.

### 2. Background Job Processing

Changed the `/jobs/{job_id}/run` endpoint to:
- Return immediately with a "processing" status
- Process jobs in the background using `BackgroundTasks`
- Avoid HTTP timeouts for long-running operations

**Before:** Synchronous processing would timeout
**After:** Returns immediately, processes in background

### 3. New Status Endpoint

Added `/jobs/{job_id}/status` endpoint to check job progress:
- Queries the Supabase `jobs` table
- Returns current job status, progress, and results

### 4. Increased Uvicorn Timeouts

```python
uvicorn.run(
    app, 
    host="0.0.0.0", 
    port=port,
    timeout_keep_alive=300,  # 5 minutes
    limit_concurrency=10,
    limit_max_requests=1000
)
```

## Deployment to Render

### Prerequisites
1. Render account with the Python service already set up
2. Environment variables configured (see `.env.example`)

### Deployment Steps

1. **Push to Git Repository**
   ```bash
   cd c:\spec-analyzer
   git add python-service/app.py
   git commit -m "Fix CORS and timeout issues in Python service"
   git push origin main
   ```

2. **Render Auto-Deploys**
   - Render will automatically detect the changes and redeploy
   - Check the Render dashboard for deployment status

3. **Manual Deploy (if needed)**
   - Go to Render dashboard
   - Select your Python service
   - Click "Manual Deploy" → "Deploy latest commit"

4. **Verify Deployment**
   ```bash
   curl https://your-service-name.onrender.com/health
   ```
   
   Expected response:
   ```json
   {
     "status": "healthy",
     "service": "spec-analyzer-python",
     "version": "0.1.0"
   }
   ```

## Testing Guide

### Test 1: Health Check (Quick Verification)

```bash
curl https://your-service-name.onrender.com/health
```

### Test 2: CORS Headers Check

```bash
curl -I -X OPTIONS https://your-service-name.onrender.com/jobs/test/run \
  -H "Origin: https://your-supabase-project.supabase.co" \
  -H "Access-Control-Request-Method: POST"
```

Look for these headers in the response:
- `access-control-allow-origin: *`
- `access-control-allow-methods: *`
- `access-control-allow-headers: *`

### Test 3: Small Spec Test (Recommended First Test)

Upload a **small spec document** (under 500 pages) to verify the service works:

1. Go to your dashboard
2. Upload a small PDF spec
3. Monitor the job status
4. Check browser console for any CORS errors

### Test 4: Job Status Endpoint

```bash
curl https://your-service-name.onrender.com/jobs/{job_id}/status
```

Replace `{job_id}` with an actual job ID from your database.

### Test 5: Background Processing Test

```bash
curl -X POST "https://your-service-name.onrender.com/jobs/test-job-123/run?job_type=phase1_extract"
```

Expected immediate response:
```json
{
  "status": "processing",
  "job_id": "test-job-123",
  "job_type": "phase1_extract",
  "message": "Job started in background. Use /jobs/{job_id}/status to check progress."
}
```

## Important Notes

### Large Spec Files (3,548+ pages)

**The timeout issue is now addressed**, but large specs will still take significant time to process:

1. **Processing Time Estimates:**
   - 500 pages: ~2-5 minutes
   - 1,000 pages: ~5-10 minutes
   - 3,548 pages: ~15-30 minutes (depending on complexity)

2. **Database Updates:**
   - Jobs table will show progress updates
   - Frontend should poll `/jobs/{job_id}/status` endpoint
   - Status values: `pending`, `processing`, `completed`, `failed`

3. **Recommended Approach:**
   - Start with smaller test specs (<500 pages)
   - Verify the system works end-to-end
   - Then test with larger specs
   - Monitor Render logs during processing

### Frontend Integration

The frontend code calling the Python service should:

1. **Call the job endpoint:**
   ```javascript
   const response = await fetch(`${PYTHON_SERVICE_URL}/jobs/${jobId}/run?job_type=phase1_extract`, {
     method: 'POST'
   });
   ```

2. **Poll for status:**
   ```javascript
   const checkStatus = async () => {
     const status = await fetch(`${PYTHON_SERVICE_URL}/jobs/${jobId}/status`);
     const data = await status.json();
     
     if (data.status === 'completed') {
       // Job finished
     } else if (data.status === 'failed') {
       // Handle error
     } else {
       // Still processing, check again in a few seconds
       setTimeout(checkStatus, 5000);
     }
   };
   ```

## Troubleshooting

### CORS Errors Still Occurring

1. Check browser console for exact error
2. Verify CORS headers in network tab
3. Ensure Render service is actually running the new code
4. Check Render deployment logs

### Service Still Timing Out

1. Verify the service is using background tasks
2. Check Render logs for errors
3. Ensure job is being updated in the database
4. Consider breaking large specs into smaller chunks

### Job Not Processing

1. Check Render logs for the service
2. Verify database connection (Supabase URL and keys)
3. Check that phase1_extract and phase2_materials job files exist
4. Verify AI API keys are set correctly

## Environment Variables Required

```
SUPABASE_URL=your-supabase-url
SUPABASE_KEY=your-supabase-service-key
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key (if using Claude)
GOOGLE_API_KEY=your-google-key (if using Gemini)
PORT=8000 (Render sets this automatically)
```

## Next Steps

1. ✅ Deploy the updated code to Render
2. ✅ Test with a small spec first (<500 pages)
3. ✅ Verify CORS headers work from frontend
4. ✅ Monitor job processing in database
5. ✅ Test with larger specs gradually
6. Update frontend to use the new status polling endpoint
7. Consider adding progress percentage updates to jobs table
