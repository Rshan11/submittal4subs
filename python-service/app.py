from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Spec Analyzer Python Service")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your Supabase domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "ok", "service": "spec-analyzer-python"}

@app.get("/health")
async def health():
    """Health check endpoint for Render"""
    return {
        "status": "healthy",
        "service": "spec-analyzer-python",
        "version": "0.1.0"
    }

async def process_job_in_background(job_id: str, job_type: str):
    """Background task for processing jobs"""
    try:
        if job_type == "phase1_extract":
            from jobs.phase1_extract import run_phase1
            await run_phase1(job_id)
        elif job_type == "phase2_materials":
            from jobs.phase2_materials import run_phase2
            await run_phase2(job_id)
    except Exception as e:
        print(f"Error processing job {job_id}: {str(e)}")

@app.post("/jobs/{job_id}/run")
async def run_job(job_id: str, job_type: str, background_tasks: BackgroundTasks):
    """
    Main endpoint to trigger job processing
    Returns immediately and processes in background to avoid timeouts
    Job types: phase1_extract, phase2_materials, phase3_crossref, phase4_business, phase5_report
    """
    try:
        # Validate job type
        valid_types = ["phase1_extract", "phase2_materials"]
        if job_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Unknown job type: {job_type}")
        
        # Add job to background tasks
        background_tasks.add_task(process_job_in_background, job_id, job_type)
        
        # Return immediately
        return {
            "status": "processing",
            "job_id": job_id,
            "job_type": job_type,
            "message": "Job started in background. Use /jobs/{job_id}/status to check progress."
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "job_id": job_id}
        )

@app.get("/jobs/{job_id}/status")
async def get_job_status(job_id: str):
    """
    Check job status from Supabase
    """
    try:
        from db.supabase import get_supabase_client
        supabase = get_supabase_client()
        
        # Get job status from database
        response = supabase.table("jobs").select("*").eq("id", job_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        return response.data[0]
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "job_id": job_id}
        )

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    # Increase timeout for large spec processing
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=port,
        timeout_keep_alive=300,  # 5 minutes
        limit_concurrency=10,
        limit_max_requests=1000
    )
