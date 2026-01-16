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


def upload_submittal_file(item_id: str, filename: str, file_bytes: bytes) -> str:
    """
    Upload a submittal file to R2 storage.
    Path: submittals/{item_id}/{timestamp}_{safe_filename}
    Returns the R2 key.
    Supports: PDF, Word, Excel, RTF, images, and other common file types.
    """
    import os
    import re
    import time

    client = get_r2_client()

    # MIME type mapping
    mime_types = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".rtf": "application/rtf",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".bmp": "image/bmp",
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".odt": "application/vnd.oasis.opendocument.text",
        ".ods": "application/vnd.oasis.opendocument.spreadsheet",
        ".odp": "application/vnd.oasis.opendocument.presentation",
    }

    # Get content type based on extension
    ext = os.path.splitext(filename.lower())[1]
    content_type = mime_types.get(ext, "application/octet-stream")

    # Generate safe filename
    timestamp = int(time.time() * 1000)
    safe_name = re.sub(r"[^a-zA-Z0-9.-]", "_", filename)
    r2_key = f"submittals/{item_id}/{timestamp}_{safe_name}"

    client.put_object(
        Bucket=R2_BUCKET_NAME, Key=r2_key, Body=file_bytes, ContentType=content_type
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
