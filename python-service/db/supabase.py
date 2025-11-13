from supabase import create_client, Client
import os
from typing import Optional

class SupabaseClient:
    _instance: Optional[Client] = None
    
    @classmethod
    def get_client(cls) -> Client:
        """Get or create Supabase client instance"""
        if cls._instance is None:
            url = os.getenv("SUPABASE_URL")
            key = os.getenv("SUPABASE_KEY")
            
            if not url or not key:
                raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set")
            
            cls._instance = create_client(url, key)
        
        return cls._instance

async def get_job(job_id: str):
    """Fetch job details from database"""
    client = SupabaseClient.get_client()
    response = client.table("jobs").select("*").eq("id", job_id).execute()
    
    if not response.data or len(response.data) == 0:
        raise ValueError(f"Job {job_id} not found")
    
    return response.data[0]

async def update_job_status(job_id: str, status: str, result: dict = None):
    """Update job status in database"""
    client = SupabaseClient.get_client()
    
    update_data = {"status": status}
    if result:
        update_data["result"] = result
    
    response = client.table("jobs").update(update_data).eq("id", job_id).execute()
    return response.data[0] if response.data else None

async def get_document_from_storage(file_path: str) -> bytes:
    """Download PDF from Supabase storage"""
    client = SupabaseClient.get_client()
    
    # Download from storage bucket
    response = client.storage.from_("specifications").download(file_path)
    return response

async def get_division_map(file_hash: str):
    """Get cached division map from document_indexes"""
    client = SupabaseClient.get_client()
    response = client.table("document_indexes").select("division_map").eq("file_hash", file_hash).execute()
    
    if response.data and len(response.data) > 0:
        return response.data[0].get("division_map")
    
    return None
