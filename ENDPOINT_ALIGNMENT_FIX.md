# Endpoint Alignment Fix

## Problem
The Edge Function `analyze-spec-python` was calling `/jobs/{id}/run?job_type=phase1_extract` but the Python service doesn't have that endpoint anymore.

## Solution
Updated the Edge Function to call the correct `/analyze` endpoint that exists in the Python service.

## Changes Made

### 1. Edge Function: `supabase/functions/analyze-spec-python/index.ts`

**Before:**
```typescript
const pythonUrl = `${PYTHON_SERVICE_URL}/jobs/${job.id}/run?job_type=phase1_extract`;
const pythonResp = await fetch(pythonUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  }
});
```

**After:**
```typescript
// Download the PDF from Supabase storage
const { data: fileData, error: downloadError } = await supabase
  .storage
  .from('specifications')
  .download(filePath);

if (downloadError || !fileData) {
  console.error("[ERROR] Failed to download file:", downloadError);
  await supabase.from("jobs").update({
    status: "failed",
    result: { error: `Failed to download file: ${downloadError?.message}` }
  }).eq("id", job.id);
  throw new Error(`Failed to download file: ${downloadError?.message}`);
}

// Create FormData with the PDF file
const formData = new FormData();
formData.append('file', fileData, filePath.split('/').pop() || 'spec.pdf');
formData.append('trade', tradeType);

const pythonUrl = `${PYTHON_SERVICE_URL}/analyze`;
const pythonResp = await fetch(pythonUrl, {
  method: "POST",
  body: formData
});
```

**Response Handling Updated:**
```typescript
const pythonResult = await pythonResp.json();
console.log("[PHASE 1] ✓ Python service completed analysis");

// Update job with results
await supabase.from("jobs").update({
  status: "completed",
  result: pythonResult,
  completed_at: new Date().toISOString()
}).eq("id", job.id);

return jsonResp({
  success: true,
  jobId: job.id,
  status: "completed",
  message: "Spec analysis completed successfully.",
  result: pythonResult
}, 200);
```

### 2. Python Service: `python-service/app.py`

**Available Endpoints:**
- `POST /analyze` - Analyzes a specification PDF with file upload
  - Parameters: `file` (UploadFile), `trade` (string, default: "masonry")
  - Returns: `AnalysisResponse` with materials, submittals, coordination, exclusions, alternates, and summary
- `GET /health` - Health check endpoint

## Key Changes

1. **File Download**: Edge Function now downloads the PDF from Supabase storage before sending to Python service
2. **FormData**: Using FormData to send the file as multipart/form-data (required by FastAPI's UploadFile)
3. **Synchronous Response**: The `/analyze` endpoint processes synchronously and returns results immediately
4. **Job Updates**: Results are now saved directly to the job record with status "completed"

## Testing Next Steps

1. Deploy the updated Edge Function to Supabase
2. Test the complete flow:
   - Upload a PDF
   - Call the `analyze-spec-python` endpoint
   - Verify the Python service receives and processes the file with PyMuPDF
   - Check that results are saved to the job record

## Notes

- The Python service now uses PyMuPDF (via pypdf) for better text extraction
- The analysis is synchronous - results return immediately instead of background processing
- The trade type is passed through to the Python service for trade-specific analysis
