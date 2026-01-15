"""
R2 Storage Integration (Cloudflare R2 via S3-compatible API)
"""

import os

import boto3
from botocore.config import Config

# R2 Configuration
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "spec-analyzer")


def get_r2_client():
    """Create R2 client using S3-compatible API"""
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_pdf(user_id: str, job_id: str, spec_id: str, pdf_bytes: bytes) -> str:
    """
    Upload PDF to R2 storage
    Path: specs/{user_id}/{job_id}/{spec_id}.pdf
    Returns the R2 key
    """
    client = get_r2_client()
    r2_key = f"specs/{user_id}/{job_id}/{spec_id}.pdf"

    client.put_object(
        Bucket=R2_BUCKET_NAME, Key=r2_key, Body=pdf_bytes, ContentType="application/pdf"
    )

    return r2_key


def download_pdf(r2_key: str) -> bytes:
    """Download PDF from R2 storage"""
    client = get_r2_client()

    response = client.get_object(Bucket=R2_BUCKET_NAME, Key=r2_key)

    return response["Body"].read()


def delete_pdf(r2_key: str) -> bool:
    """Delete PDF from R2 storage"""
    client = get_r2_client()

    try:
        client.delete_object(Bucket=R2_BUCKET_NAME, Key=r2_key)
        return True
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════════
# SUBMITTAL FILE STORAGE
# ═══════════════════════════════════════════════════════════════


def upload_submittal_file(item_id: str, filename: str, pdf_bytes: bytes) -> str:
    """
    Upload a submittal PDF to R2 storage.
    Path: submittals/{item_id}/{timestamp}_{safe_filename}.pdf
    Returns the R2 key.
    """
    import re
    import time

    client = get_r2_client()

    # Generate safe filename
    timestamp = int(time.time() * 1000)
    safe_name = re.sub(r"[^a-zA-Z0-9.-]", "_", filename)
    r2_key = f"submittals/{item_id}/{timestamp}_{safe_name}"

    client.put_object(
        Bucket=R2_BUCKET_NAME, Key=r2_key, Body=pdf_bytes, ContentType="application/pdf"
    )

    return r2_key


def download_submittal_file(r2_key: str) -> bytes:
    """Download a submittal PDF from R2 storage"""
    client = get_r2_client()

    response = client.get_object(Bucket=R2_BUCKET_NAME, Key=r2_key)

    return response["Body"].read()


def delete_submittal_file(r2_key: str) -> bool:
    """Delete a submittal PDF from R2 storage"""
    client = get_r2_client()

    try:
        client.delete_object(Bucket=R2_BUCKET_NAME, Key=r2_key)
        return True
    except Exception:
        return False
