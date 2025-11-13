# Spec Analyzer Python Service

Backend worker service for processing construction specifications.

## Setup

1. Install dependencies:
```bash
cd python-service
pip install -r requirements.txt
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your API keys
```

3. Run locally:
```bash
python app.py
```

Server runs on `http://localhost:8000`

## Deploy to Render

1. Push this code to your GitHub repo
2. In Render dashboard:
   - Root Directory: `python-service`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
3. Add environment variables in Render settings

## API Endpoints

- `GET /` - Service status
- `GET /health` - Health check
- `POST /jobs/{job_id}/run?job_type={type}` - Run processing job

## Job Types

- `phase1_extract` - Extract and filter PDF content by trade
- `phase2_materials` - Extract materials with Gemini (TODO)
- `phase3_crossref` - Process cross-references (TODO)
- `phase4_business` - Extract business terms with Claude (TODO)
- `phase5_report` - Generate final report with ChatGPT (TODO)

## Architecture

```
Edge Functions (Supabase) 
    ↓
Python Service (Render)
    ↓ 
Supabase Database
```

## Trade Mappings

Configure which divisions to extract per trade in `trade_mappings.json`.

Currently supported:
- Masonry (Divisions: 00, 01, 03, 04, 07)
- Electrical (Divisions: 00, 01, 26, 27, 28)
- Plumbing (Divisions: 00, 01, 22)
- HVAC (Divisions: 00, 01, 23)
