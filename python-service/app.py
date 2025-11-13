from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Spec Analyzer Python Service")

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

@app.post("/jobs/{job_id}/run")
async def run_job(job_id: str, job_type: str):
    """
    Main endpoint to trigger job processing
    Job types: phase1_extract, phase2_materials, phase3_crossref, phase4_business, phase5_report
    """
    try:
        if job_type == "phase1_extract":
            from jobs.phase1_extract import run_phase1
            result = await run_phase1(job_id)
            return result
        elif job_type == "phase2_materials":
            from jobs.phase2_materials import run_phase2
            result = await run_phase2(job_id)
            return result
        else:
            raise HTTPException(status_code=400, detail=f"Unknown job type: {job_type}")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "job_id": job_id}
        )

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
