"""
Cloud Image Upload Service for JDLX
====================================
Uses ImgBB API (if key is configured) as primary.
Fallback 1: Catbox.moe (Free, Keyless, Permanent, High Reliability).
Fallback 2: Graph.org / Telegra.ph (Free, Keyless, Permanent).
Render's filesystem is ephemeral — files are lost on redeploy.
This service ensures images survive permanently across server restarts.
"""

import base64
import os
import requests
from utils.logger import logger

IMGBB_API_KEY = os.environ.get("IMGBB_API_KEY", "")
IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload"


def upload_to_imgbb(file_data, filename):
    """Uploads base64 image data to ImgBB if key is present."""
    if not IMGBB_API_KEY:
        return None
    try:
        logger.info(f"Attempting cloud upload to ImgBB for {filename}...")
        b64_image = base64.b64encode(file_data).decode("utf-8")
        payload = {
            "key": IMGBB_API_KEY,
            "image": b64_image,
            "name": filename,
        }
        response = requests.post(IMGBB_UPLOAD_URL, data=payload, timeout=20)
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                image_url = data["data"]["display_url"]
                logger.info(f"Image uploaded to ImgBB: {image_url}")
                return image_url
            else:
                logger.error(f"ImgBB upload returned success=false: {data}")
        else:
            logger.error(f"ImgBB upload failed with status {response.status_code}")
    except Exception as e:
        logger.error(f"ImgBB upload exception: {str(e)}")
    return None


def save_media_to_db(filename, mime_type, file_data):
    """
    Saves binary image data into the persistent uploaded_media table in the database.
    Guarantees that even if local disk is wiped on Render redeploy/restart, the file survives forever.
    """
    try:
        from database import get_db
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """CREATE TABLE IF NOT EXISTS uploaded_media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT UNIQUE NOT NULL,
                mime_type TEXT NOT NULL,
                data BLOB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        base_name = os.path.basename(filename)
        data_bytes = bytes(file_data) if isinstance(file_data, (bytes, bytearray, memoryview)) else file_data
        cursor.execute(
            "INSERT OR REPLACE INTO uploaded_media (filename, mime_type, data) VALUES (?, ?, ?)",
            (base_name, mime_type or "image/jpeg", data_bytes)
        )
        if filename != base_name:
            cursor.execute(
                "INSERT OR REPLACE INTO uploaded_media (filename, mime_type, data) VALUES (?, ?, ?)",
                (filename, mime_type or "image/jpeg", data_bytes)
            )
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to save media to uploaded_media DB for {filename}: {str(e)}")
        return False


def upload_to_catbox(file_data, filename):
    """
    Uploads binary image data to Catbox.moe keyless public endpoint.
    It is extremely fast, free, permanent, and requires no API key.
    Includes browser User-Agent headers to avoid Cloudflare/bot blocks on cloud hosts.
    """
    url = "https://catbox.moe/user/api.php"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Origin": "https://catbox.moe",
        "Referer": "https://catbox.moe/",
    }
    payload = {"reqtype": "fileupload"}
    ext = os.path.splitext(filename)[1].lower() if "." in filename else ".jpg"
    mime_map = {
        ".png": "image/png",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif"
    }
    mime = mime_map.get(ext, "image/jpeg")

    for attempt in range(2):
        try:
            logger.info(f"Attempting keyless cloud upload to Catbox for {filename} (attempt {attempt + 1})...")
            files = {"fileToUpload": (filename, file_data, mime)}
            response = requests.post(url, data=payload, files=files, headers=headers, timeout=15)
            if response.status_code == 200:
                image_url = response.text.strip()
                if image_url.startswith("http"):
                    logger.info(f"Image uploaded successfully via Catbox: {image_url}")
                    return image_url
                else:
                    logger.error(f"Unexpected response text from Catbox: {image_url}")
            else:
                logger.error(f"Upload to Catbox failed with status code {response.status_code}: {response.text[:200]}")
        except Exception as e:
            logger.error(f"Upload to Catbox exception (attempt {attempt + 1}): {str(e)}")
    return None


def upload_to_telegraph_or_graph(file_data, filename):
    """
    Fallback upload endpoint with strict timeout.
    """
    endpoints = [
        "https://telegra.ph/upload"
    ]
    
    ext = filename.rsplit(".", 1)[1].lower() if "." in filename else "jpg"
    mime_types = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp"
    }
    mime = mime_types.get(ext, "image/jpeg")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }

    for url in endpoints:
        try:
            files = {"file": ("file", file_data, mime)}
            response = requests.post(url, files=files, headers=headers, timeout=5)
            if response.status_code == 200:
                result = response.json()
                if isinstance(result, list) and len(result) > 0 and "src" in result[0]:
                    src_path = result[0]["src"]
                    domain = url.rsplit("/upload", 1)[0]
                    image_url = f"{domain}{src_path}"
                    logger.info(f"Image uploaded successfully via keyless Telegraph: {image_url}")
                    return image_url
        except Exception:
            pass
            
    return None


def upload_image_to_cloud(file_data, filename="image.jpg"):
    """
    Uploads image binary data to cloud hosting.
    Tries ImgBB first if API key is configured.
    Falls back to Catbox (fast, free, permanent).
    
    Args:
        file_data: Binary image data (bytes)
        filename: Optional filename for reference
        
    Returns:
        str: Permanent URL of the uploaded image, or None on failure
    """
    # 1. Try ImgBB if key is present
    if IMGBB_API_KEY:
        url = upload_to_imgbb(file_data, filename)
        if url:
            return url
            
    # 2. Try Catbox.moe keyless public endpoint (Highly recommended, free, permanent)
    url = upload_to_catbox(file_data, filename)
    if url:
        return url

    # 3. Fallback attempt
    url = upload_to_telegraph_or_graph(file_data, filename)
    if url:
        return url
        
    logger.warning(f"All cloud upload attempts failed for {filename}. Will rely on database persistence.")
    return None


def upload_file_object_to_cloud(file_storage, filename=None):
    """
    Convenience wrapper that accepts a Flask FileStorage object.
    
    Args:
        file_storage: Flask request.files['file'] object
        filename: Optional custom filename
        
    Returns:
        str: Permanent URL of the uploaded image, or None on failure
    """
    try:
        file_data = file_storage.read()
        # Reset the stream position so it can be re-read if needed for local fallback
        file_storage.seek(0)

        name = filename or file_storage.filename or "image.jpg"

        # Performance: resize + re-encode before it leaves the server. This is a
        # pure transport optimization — the returned URL is identical, the image
        # is just smaller to download. Falls back to the original bytes on any
        # processing failure, so an upload can never break because of this.
        try:
            from utils.image_optimizer import optimize_image_bytes
            file_data = optimize_image_bytes(file_data, name)
        except Exception:
            pass

        return upload_image_to_cloud(file_data, name)
    except Exception as e:
        logger.error(f"Error reading file for cloud upload: {str(e)}")
        return None
