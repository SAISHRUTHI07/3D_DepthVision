from fastapi import APIRouter, UploadFile, File, HTTPException, status
import os
import uuid
import shutil
from PIL import Image, UnidentifiedImageError

router = APIRouter()

# Define upload directory relative to this file
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(os.path.dirname(BASE_DIR), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Validations
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_IMAGE_PIXELS = 50_000_000

@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    Upload an RGB/satellite/aerial image.
    Validates file extension and size (max 10MB).
    """
    # 1. Validate Extension
    filename = file.filename
    _, ext = os.path.splitext(filename.lower())
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed formats are: {', '.join(ALLOWED_EXTENSIONS)}"
        )
    
    # 2. Validate Size (supports various Starlette/FastAPI versions)
    try:
        # Seek to end to get file size
        file.file.seek(0, 2)
        file_size = file.file.tell()
        file.file.seek(0)  # Reset pointer to start
    except Exception:
        # Fallback if seek is unsupported
        file_size = 0
        
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size allowed is {MAX_FILE_SIZE / (1024 * 1024)}MB."
        )
        
    # 3. Generate unique identifier and save file
    file_id = uuid.uuid4().hex
    stored_filename = f"{file_id}{ext}"
    stored_filepath = os.path.join(UPLOAD_DIR, stored_filename)
    
    try:
        with open(stored_filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not save file: {str(e)}"
        )

    # Verify the bytes are genuinely a readable image before it enters the
    # reconstruction pipeline.  This prevents a renamed non-image file from
    # failing much later in model inference with an unclear message.
    try:
        with Image.open(stored_filepath) as image:
            image.verify()
        with Image.open(stored_filepath) as image:
            width, height = image.size
        if width * height > MAX_IMAGE_PIXELS:
            raise ValueError(f"Image dimensions are too large ({width}×{height}). Maximum is {MAX_IMAGE_PIXELS:,} pixels.")
    except (UnidentifiedImageError, OSError, ValueError) as e:
        try:
            os.remove(stored_filepath)
        except OSError:
            pass
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid image: {str(e)}")
        
    return {
        "success": True,
        "file_id": file_id,
        "filename": filename,
        "stored_filename": stored_filename,
        "size_bytes": file_size,
        "size": file_size,
        "content_type": file.content_type or "application/octet-stream",
        "original_image_url": f"/uploads/{stored_filename}",
        "url": f"/uploads/{stored_filename}",
        "width": width,
        "height": height,
        "message": "Image uploaded successfully."
    }
