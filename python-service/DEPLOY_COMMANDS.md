# Quick Deployment Commands

## Step 1: Commit and Push Changes

```bash
cd c:\spec-analyzer
git add python-service/app.py python-service/CORS_TIMEOUT_FIX.md python-service/DEPLOY_COMMANDS.md
git commit -m "Fix CORS and timeout issues - add background processing"
git push origin main
```

## Step 2: Verify Deployment on Render

After pushing, Render will automatically deploy. Check status at:
https://dashboard.render.com

## Step 3: Test the Deployment

### Test Health Endpoint
```bash
curl https://YOUR-SERVICE-NAME.onrender.com/health
```

### Test CORS Headers
```bash
curl -I -X OPTIONS https://YOUR-SERVICE-NAME.onrender.com/jobs/test/run -H "Origin: https://your-supabase-project.supabase.co" -H "Access-Control-Request-Method: POST"
```

## Step 4: Test with Small Spec

1. Open your application dashboard
2. Upload a **small PDF spec** (under 500 pages)
3. Watch the browser console for any CORS errors
4. Monitor job status in the database

## Troubleshooting

### If Render doesn't auto-deploy:
1. Go to https://dashboard.render.com
2. Select your Python service
3. Click "Manual Deploy" → "Deploy latest commit"

### If you get errors:
1. Check Render logs at: https://dashboard.render.com → Your Service → Logs
2. Verify environment variables are set
3. Check that all required packages are in requirements.txt

### If CORS errors persist:
- Clear browser cache
- Check browser console for exact error message
- Verify the service restarted with new code

## Quick Status Check

```bash
# Check if service is running
curl https://YOUR-SERVICE-NAME.onrender.com/

# Check health
curl https://YOUR-SERVICE-NAME.onrender.com/health

# Start a test job (will return immediately now)
curl -X POST "https://YOUR-SERVICE-NAME.onrender.com/jobs/test-123/run?job_type=phase1_extract"

# Check job status
curl https://YOUR-SERVICE-NAME.onrender.com/jobs/test-123/status
```

Replace `YOUR-SERVICE-NAME` with your actual Render service name.

## What Changed

1. ✅ **CORS middleware added** - Fixes cross-origin request errors
2. ✅ **Background processing** - Jobs run in background, no more timeouts
3. ✅ **Status endpoint** - Can check job progress with `/jobs/{id}/status`
4. ✅ **Increased timeouts** - Uvicorn configured for longer-running operations

## Important: Test Small First!

**Don't test with a 3,548-page spec immediately!**

Start with:
- 50-100 pages: Quick validation (~1-2 min)
- 200-500 pages: Medium test (~3-5 min)
- 1,000+ pages: Full stress test (~10+ min)

This ensures the system works before committing to long processing times.
