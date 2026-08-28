from fastapi import APIRouter, BackgroundTasks, HTTPException, status, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List
import os
import glob
import json
import re
import numpy as np
import cv2
import threading
import time
import uuid
from app.services.depth_service import depth_service, DepthModelUnavailable
from app.services.text3d_service import text3d_service, Text3DProviderError
from app.processing.calibration import calibrate_depth_to_elevation
from app.processing.analytics import calculate_slope, calculate_confidence, downsample_grid

router = APIRouter()

# Directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(os.path.dirname(BASE_DIR), "uploads")
MODEL_DIR = os.path.join(os.path.dirname(BASE_DIR), "models")
TEXT3D_MODEL_DIR = os.path.join(os.path.dirname(BASE_DIR), "generated_models")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(TEXT3D_MODEL_DIR, exist_ok=True)

# Pydantic models for request validation
class GCPPoint(BaseModel):
    x: float
    y: float
    elevation: float

class CalibrateRequest(BaseModel):
    gcp_points: List[GCPPoint]

class TextTo3DRequest(BaseModel):
    # ``prompt`` remains accepted for older browser sessions, but the current
    # product is typography-first and the exact visible text is carried in
    # ``text``. It is never interpreted as an object description.
    text: str = ""
    prompt: str = ""
    text_type: str = Field("Auto Detect", alias="type")
    font_style: str = "Bold Sans"
    style: str = "Metallic"
    material: str = "Metallic"
    color: str = "#FFFFFF"
    depth: str = "Medium"
    bevel: str = "Medium"
    layout: str = "Horizontal"
    quality: str = "Balanced"

    class Config:
        allow_population_by_field_name = True


def _load_finite_array(path: str, label: str) -> np.ndarray:
    """Load a 2D numeric map and replace invalid values before math/WebGL export."""
    try:
        array = np.asarray(np.load(path), dtype=np.float32)
    except Exception as exc:
        raise ValueError(f"Error loading {label}: {exc}") from exc
    if array.ndim != 2 or array.size == 0:
        raise ValueError(f"{label.capitalize()} must be a non-empty 2D array")
    finite = np.isfinite(array)
    if not finite.any():
        raise ValueError(f"{label.capitalize()} contains no finite values")
    replacement = float(np.median(array[finite]))
    return np.nan_to_num(array, nan=replacement, posinf=replacement, neginf=replacement)


def _find_original_file(file_id: str) -> str | None:
    pattern = os.path.join(UPLOAD_DIR, f"{file_id}.*")
    files = [
        path for path in glob.glob(pattern)
        if not path.endswith(("_depth_visual.png", "_depth.npy", "_elevation.npy"))
    ]
    return files[0] if files else None


TEXT3D_TYPES = {"Alphabet", "Number", "Word", "Phrase", "Auto Detect"}
TEXT3D_FONTS = {"Bold Sans", "Modern", "Serif", "Rounded", "Futuristic", "Elegant", "Script", "Block", "Display"}
TEXT3D_STYLES = {"Classic", "Metallic", "Chrome", "Gold", "Glass", "Neon", "Stone", "Wood", "Plastic", "Matte", "Glossy", "Futuristic"}
TEXT3D_MATERIALS = {"Metallic", "Plastic", "Glass", "Stone", "Wood", "Chrome", "Matte", "Gloss"}
TEXT3D_DEPTHS = {"Thin", "Medium", "Thick"}
TEXT3D_BEVELS = {"None", "Small", "Medium", "Large"}
TEXT3D_LAYOUTS = {"Horizontal", "Centered", "Stacked", "Single Line"}
TEXT3D_QUALITY = {"Draft", "Balanced", "High"}
TEXT3D_ALLOWED_TEXT = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -&'.,!?")
TEXT3D_JOBS: dict[str, dict] = {}
TEXT3D_LOCK = threading.Lock()


def _detect_text_type(text: str) -> str:
    compact = text.replace(" ", "")
    if len(compact) == 1 and compact.isalpha():
        return "Alphabet"
    if compact.isdigit():
        return "Number"
    return "Phrase" if " " in text.strip() else "Word"


def _enhance_text_prompt(text: str, text_type: str, font_style: str, style: str, material: str, color: str, depth: str, bevel: str, layout: str, quality: str) -> str:
    detail = {
        "Draft": "clean, low-complexity web-ready topology",
        "Balanced": "clean topology, proportionate extrusion, readable silhouettes, and coherent PBR-ready materials",
        "High": "detailed clean topology, crisp readable glyph edges, high-quality materials, UVs, and web-ready GLB optimization",
    }[quality]
    # JSON encoding preserves quotes and whitespace safely while presenting the
    # exact requested character sequence unambiguously to the remote model.
    exact = json.dumps(text, ensure_ascii=False)
    return (
        f"Create one standalone 3D typography object containing exactly the text {exact}. "
        f"This is a {text_type.lower()} text asset: preserve the exact spelling, capitalization, character order, spaces, and number of characters. "
        "Make every requested glyph clearly readable as actual connected, extruded 3D letter or number geometry. "
        f"Use a {font_style.lower()} typography direction, {style.lower()} appearance, {material.lower()} material, {color} color, "
        f"{depth.lower()} extrusion, {bevel.lower()} bevel edges, and a {layout.lower()} layout. "
        f"Use {detail}. Center and fully frame the complete text as a clean GLB-ready asset. "
        "Do not interpret the text as an object or scene. Do not add, remove, replace, crop, rearrange, misspell, or stylize into unreadable glyphs. "
        "Do not add logos, symbols, decorative text, people, scenery, props, floating fragments, or unrelated objects."
    )


def _canonical_text3d_value(value: str, options: set[str]) -> str | None:
    normalized = value.strip().lower().replace("_", " ")
    return next((option for option in options if option.lower() == normalized), None)


def _validate_text3d_request(request: TextTo3DRequest) -> dict:
    text = (request.text or request.prompt).strip()
    if not text or len(text) > 96:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter between 1 and 96 characters for the 3D word or alphabet.")
    if any(character not in TEXT3D_ALLOWED_TEXT for character in text):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use letters, numbers, spaces, and simple punctuation only for 3D typography.")
    text_type = _canonical_text3d_value(request.text_type, TEXT3D_TYPES)
    font_style = _canonical_text3d_value(request.font_style, TEXT3D_FONTS)
    style = _canonical_text3d_value(request.style, TEXT3D_STYLES)
    material = _canonical_text3d_value(request.material, TEXT3D_MATERIALS)
    depth = _canonical_text3d_value(request.depth, TEXT3D_DEPTHS)
    bevel = _canonical_text3d_value(request.bevel, TEXT3D_BEVELS)
    layout = _canonical_text3d_value(request.layout, TEXT3D_LAYOUTS)
    quality = _canonical_text3d_value(request.quality, TEXT3D_QUALITY)
    color = request.color.strip().upper()
    if not text_type or not font_style or not style or not material or not depth or not bevel or not layout or not quality:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported typography customization option.")
    if not re.fullmatch(r"#[0-9A-F]{6}", color):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid six-digit HEX color, for example #FFD700.")
    if text_type == "Auto Detect":
        text_type = _detect_text_type(text)
    return {"text": text, "text_type": text_type, "font_style": font_style, "style": style, "material": material, "color": color, "depth": depth, "bevel": bevel, "layout": layout, "quality": quality}


def _foreground_mask(image_path: str | None, normalized_depth: np.ndarray) -> tuple[np.ndarray, str]:
    """Return a conservative foreground mask.

    GrabCut is used when the source photograph is available.  It is deliberately
    followed by a central connected-component selection because this product asks
    for one primary object, not a semantic scene segmentation claim.
    """
    h, w = normalized_depth.shape
    fallback = np.ones((h, w), dtype=np.uint8)
    if not image_path:
        return fallback, "depth fallback (source image unavailable)"
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        return fallback, "depth fallback (source image unreadable)"

    # GrabCut scales poorly at full camera resolution and is only used to
    # estimate a subject silhouette before the result is downsampled to the
    # mesh grid. Work at a bounded resolution, then restore a crisp mask for
    # the original depth map. This prevents a 4K upload from leaving the UI in
    # a false "generating" state for minutes.
    work_scale = min(1.0, 512.0 / max(w, h))
    work_w, work_h = max(2, round(w * work_scale)), max(2, round(h * work_scale))
    image = cv2.resize(image, (work_w, work_h), interpolation=cv2.INTER_AREA)
    try:
        mask = np.zeros((work_h, work_w), np.uint8)
        margin_x, margin_y = max(2, int(work_w * .06)), max(2, int(work_h * .06))
        rect = (margin_x, margin_y, max(2, work_w - margin_x * 2), max(2, work_h - margin_y * 2))
        background_model = np.zeros((1, 65), np.float64)
        foreground_model = np.zeros((1, 65), np.float64)
        cv2.grabCut(image, mask, rect, background_model, foreground_model, 4, cv2.GC_INIT_WITH_RECT)
        binary = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)
        if count > 1:
            centre = np.array([work_w / 2, work_h / 2])
            candidates = []
            for index in range(1, count):
                area = stats[index, cv2.CC_STAT_AREA]
                distance = np.linalg.norm(centroids[index] - centre)
                if area >= work_h * work_w * .015:
                    candidates.append((area / (1 + distance * .02), index))
            if candidates:
                binary = (labels == max(candidates)[1]).astype(np.uint8)
        coverage = float(binary.mean())
        if .03 <= coverage <= .93:
            if (work_h, work_w) != (h, w):
                binary = cv2.resize(binary, (w, h), interpolation=cv2.INTER_NEAREST)
            return binary, "OpenCV GrabCut primary-subject segmentation (resolution bounded)"
    except cv2.error:
        pass

    # A finite, conservative fallback is safer than an empty geometry.
    cy0, cy1 = int(h * .10), max(int(h * .90), int(h * .10) + 1)
    cx0, cx1 = int(w * .10), max(int(w * .90), int(w * .10) + 1)
    fallback[cy0:cy1, cx0:cx1] = 1
    return fallback, "central image fallback (segmentation uncertain)"


@router.get("/process/{file_id}/input-analysis")
def input_analysis(file_id: str):
    """Return measurable, non-generative input-quality signals.

    A scene classifier is intentionally not invented here: the installed local
    model is Depth Anything, not a semantic classifier.  The client uses these
    signals to guide the user toward the terrain or object workflow and asks for
    confirmation when scene type matters.
    """
    image_path = _find_original_file(file_id)
    if not image_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uploaded image not found.")
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file could not be read as an image.")
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast = float(gray.std())
    pixels = width * height
    resolution_score = 1.0 if pixels >= 2_000_000 else .82 if pixels >= 900_000 else .62 if pixels >= 350_000 else .38
    sharpness_score = min(sharpness / 180.0, 1.0)
    contrast_score = min(contrast / 55.0, 1.0)
    quality = float(np.clip(.48 * resolution_score + .32 * sharpness_score + .20 * contrast_score, 0, 1))
    quality_label = "Good" if quality >= .72 else "Usable" if quality >= .5 else "Limited"
    recommendation = "Terrain" if width / max(height, 1) > 1.7 and contrast < 50 else "Choose Terrain for aerial/landscape imagery; choose Object for a building, person, vehicle, or subject."
    return {
        "file_id": file_id,
        "width": width,
        "height": height,
        "input_quality": quality,
        "input_quality_label": quality_label,
        "sharpness": round(sharpness, 1),
        "contrast": round(contrast, 1),
        "scene_classification": "not_available",
        "scene_classification_note": "No semantic image classifier is installed locally, so scene type requires user confirmation.",
        "workflow_recommendation": recommendation,
        "single_view_note": "One image supports depth and visible-surface reconstruction. Side and back geometry remain estimated."
    }

@router.post("/process/{file_id}/depth")
def process_depth(file_id: str):
    """
    Run monocular depth estimation on a previously uploaded image.
    Saves the relative depth map and returns visualization metadata.
    """
    pattern = os.path.join(UPLOAD_DIR, f"{file_id}.*")
    matching_files = glob.glob(pattern)
    
    original_files = [
        f for f in matching_files 
        if not f.endswith("_depth_visual.png") and not f.endswith("_depth.npy") and not f.endswith("_elevation.npy")
    ]
    
    if not original_files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded image not found. Please upload the image first."
        )
        
    image_path = original_files[0]
    filename = os.path.basename(image_path)
    _, ext = os.path.splitext(filename)
    
    try:
        result = depth_service.run_depth_estimation(
            image_path=image_path,
            uploads_dir=UPLOAD_DIR,
            file_id=file_id,
            ext=ext
        )
        
        result["original_image_url"] = f"/uploads/{file_id}{ext}"
        result["visual_depth_url"] = f"/uploads/{result['visual_depth_file']}"
        result["file_id"] = file_id
        
        return result
    except DepthModelUnavailable as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error executing depth estimation: {str(e)}"
        )

@router.post("/process/{file_id}/calibrate")
def process_calibration(file_id: str, request: CalibrateRequest):
    """
    Calibrate a relative depth map to absolute/approximate physical elevation.
    Requires relative depth map (npy) to be already generated.
    """
    depth_file_path = os.path.join(UPLOAD_DIR, f"{file_id}_depth.npy")
    if not os.path.exists(depth_file_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Relative depth map not found. Please run depth estimation first."
        )
        
    try:
        depth_map = _load_finite_array(depth_file_path, "depth map")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error loading depth map: {str(e)}"
        )
        
    gcp_list = [gcp.dict() for gcp in request.gcp_points]
    
    try:
        elevation_map, scale, offset, num_points_used, method = calibrate_depth_to_elevation(
            depth_map=depth_map,
            gcp_points=gcp_list
        )
        
        elevation_filename = f"{file_id}_elevation.npy"
        elevation_path = os.path.join(UPLOAD_DIR, elevation_filename)
        np.save(elevation_path, elevation_map)
        
        return {
            "file_id": file_id,
            "scale": scale,
            "offset": offset,
            "num_points_used": num_points_used,
            "method": method,
            "elevation_min": float(elevation_map.min()),
            "elevation_max": float(elevation_map.max()),
            "is_calibrated": num_points_used > 0,
            "message": "Depth calibration applied successfully."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error applying calibration: {str(e)}"
        )

@router.get("/process/{file_id}/terrain")
def get_terrain_data(
    file_id: str,
    grid_size: int = Query(128, ge=16, le=512, description="Target dimension of the downsampled square grid"),
    pixel_size: float = Query(1.0, gt=0, description="Horizontal scale (pixel size) in meters for slope calculations")
):
    """
    Generate and serve a downsampled terrain grid containing:
      - Elevation values
      - Slope values (degrees)
      - Confidence values (0-1)
    Allows smooth WebGL visualization in Three.js by optimizing the mesh density.
    """
    elevation_path = os.path.join(UPLOAD_DIR, f"{file_id}_elevation.npy")
    depth_path = os.path.join(UPLOAD_DIR, f"{file_id}_depth.npy")
    
    # 1. Graceful elevation fallback: If not calibrated, perform relative calibration automatically
    is_gcp_calibrated = os.path.exists(elevation_path)
    
    if not os.path.exists(depth_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Depth map not found. Please run depth estimation first."
        )
        
    try:
        depth_map = _load_finite_array(depth_path, "depth map")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error loading depth map: {str(e)}"
        )
        
    if is_gcp_calibrated:
        try:
            elevation_map = _load_finite_array(elevation_path, "calibrated elevation map")
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error loading calibrated elevation map: {str(e)}"
            )
    else:
        # Perform default relative mapping (0m to 100m range)
        try:
            elevation_map, _, _, _, _ = calibrate_depth_to_elevation(depth_map, [])
            # Save it so it's cached
            np.save(elevation_path, elevation_map)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error applying auto-relative calibration: {str(e)}"
            )

    try:
        # 2. Calculate Slope and Confidence
        slope_map = calculate_slope(elevation_map, pixel_size)
        confidence_map = calculate_confidence(depth_map)
        
        # 3. Downsample grids to optimize WebGL rendering
        downsampled_elevation = downsample_grid(elevation_map, grid_size)
        downsampled_slope = downsample_grid(slope_map, grid_size)
        downsampled_confidence = downsample_grid(confidence_map, grid_size)
        
        # 4. Extract stats
        stats = {
            "elevation_min": float(downsampled_elevation.min()),
            "elevation_max": float(downsampled_elevation.max()),
            "slope_min": float(downsampled_slope.min()),
            "slope_max": float(downsampled_slope.max()),
            "confidence_min": float(downsampled_confidence.min()),
            "confidence_max": float(downsampled_confidence.max())
        }
        
        return {
            "file_id": file_id,
            "grid_size": grid_size,
            "is_calibrated": is_gcp_calibrated,
            "elevation_grid": np.nan_to_num(downsampled_elevation, nan=0.0, posinf=0.0, neginf=0.0).flatten().tolist(),
            "slope_grid": np.nan_to_num(downsampled_slope, nan=0.0, posinf=0.0, neginf=0.0).flatten().tolist(),
            "confidence_grid": np.clip(np.nan_to_num(downsampled_confidence, nan=0.0, posinf=0.0, neginf=0.0), 0, 1).flatten().tolist(),
            "stats": stats
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating terrain analytics: {str(e)}"
        )

@router.get("/process/{file_id}/object")
def get_object_reconstruction_data(
    file_id: str,
    grid_size: int = Query(128, ge=32, le=256, description="Square mesh resolution for object reconstruction")
):
    """Prepare finite depth and silhouette data for a client-side textured mesh.

    The response is intentionally restricted to the visible surface and a marked
    estimated shell.  A single photograph cannot measure an object's back.
    """
    depth_path = os.path.join(UPLOAD_DIR, f"{file_id}_depth.npy")
    if not os.path.exists(depth_path):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Depth map not found. Please run depth estimation first.")
    try:
        depth = _load_finite_array(depth_path, "depth map")
        values = depth[np.isfinite(depth)]
        low, high = np.percentile(values, [2, 98])
        if not np.isfinite(low) or not np.isfinite(high) or high - low < 1e-6:
            normalized = np.zeros_like(depth, dtype=np.float32)
        else:
            normalized = np.clip((depth - low) / (high - low), 0, 1)
        normalized = np.nan_to_num(normalized, nan=.5, posinf=1.0, neginf=0.0)
        mask, segmentation_method = _foreground_mask(_find_original_file(file_id), normalized)

        depth_grid = downsample_grid(normalized, grid_size)
        mask_grid = downsample_grid(mask.astype(np.float32), grid_size)
        confidence_grid = downsample_grid(calculate_confidence(depth), grid_size)
        depth_grid = np.nan_to_num(depth_grid, nan=0.0, posinf=1.0, neginf=0.0)
        mask_grid = np.nan_to_num(mask_grid, nan=0.0, posinf=0.0, neginf=0.0)
        confidence_grid = np.clip(np.nan_to_num(confidence_grid, nan=0.0), 0, 1)
        active = mask_grid > .45
        reconstruction_confidence = float(np.clip(confidence_grid[active].mean() if active.any() else confidence_grid.mean(), 0, 1))
        ys, xs = np.where(active)
        bounds = {
            "x_min": int(xs.min()) if xs.size else 0,
            "x_max": int(xs.max()) if xs.size else grid_size - 1,
            "y_min": int(ys.min()) if ys.size else 0,
            "y_max": int(ys.max()) if ys.size else grid_size - 1,
        }
        return {
            "file_id": file_id,
            "grid_size": grid_size,
            "depth_grid": depth_grid.flatten().tolist(),
            "object_mask": mask_grid.flatten().tolist(),
            "confidence_grid": confidence_grid.flatten().tolist(),
            "stats": {"depth_min": float(depth_grid.min()), "depth_max": float(depth_grid.max()), "mask_coverage": float(active.mean()), "subject_bounds": bounds},
            "reconstruction_confidence": reconstruction_confidence,
            "segmentation_method": segmentation_method,
            "estimated_regions": "Side and back surfaces are approximate because a single image only reveals the front-visible surface."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error preparing object reconstruction: {str(e)}")


@router.post("/text3d/enhance")
@router.post("/text-to-3d/enhance", include_in_schema=False)
def enhance_text_to_3d_prompt(request: TextTo3DRequest):
    typography = _validate_text3d_request(request)
    return {"success": True, **typography, "enhanced_prompt": _enhance_text_prompt(**typography)}


def _run_text3d_job(job_id: str, payload: dict):
    def update_status(current_status: str, message: str):
        with TEXT3D_LOCK:
            if job_id in TEXT3D_JOBS:
                TEXT3D_JOBS[job_id].update({"status": current_status, "message": message, "updated_at": time.time()})
    try:
        result = text3d_service.generate(payload, TEXT3D_MODEL_DIR, update_status)
        with TEXT3D_LOCK:
            TEXT3D_JOBS[job_id].update({"success": True, "status": "completed", "message": "3D model is ready and its GLB geometry was validated.", "model_url": f"/api/text3d/model/{result['model_filename']}", "format": "glb", "metadata": result["provider_metadata"], "updated_at": time.time()})
    except Text3DProviderError as error:
        with TEXT3D_LOCK:
            TEXT3D_JOBS[job_id].update({"success": False, "status": "failed", "error_code": error.code, "message": str(error), "updated_at": time.time()})
    except Exception:
        with TEXT3D_LOCK:
            TEXT3D_JOBS[job_id].update({"success": False, "status": "failed", "message": "Text-to-3D generation failed unexpectedly. Check the configured provider and retry.", "updated_at": time.time()})


@router.post("/text3d/generate", status_code=status.HTTP_202_ACCEPTED)
@router.post("/text-to-3d", status_code=status.HTTP_202_ACCEPTED, include_in_schema=False)
def text_to_3d(request: TextTo3DRequest, background_tasks: BackgroundTasks):
    typography = _validate_text3d_request(request)
    if not text3d_service.configured():
        state = text3d_service.status()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=state.get("required") or state["message"])
    enhanced_prompt = _enhance_text_prompt(**typography)
    job_id = uuid.uuid4().hex
    job = {"job_id": job_id, "success": True, "status": "preparing", "message": "Preparing exact 3D typography generation.", "prompt": typography["text"], "text": typography["text"], "enhanced_prompt": enhanced_prompt, **typography, "created_at": time.time(), "updated_at": time.time()}
    with TEXT3D_LOCK:
        TEXT3D_JOBS[job_id] = job
    background_tasks.add_task(_run_text3d_job, job_id, {"prompt": typography["text"], "enhanced_prompt": enhanced_prompt, **typography, "output_format": "glb"})
    return {**job, "status_url": f"/api/text3d/status/{job_id}"}


def _safe_text3d_configuration():
    """Safe engine status only—never returns credentials or provider URLs."""
    return text3d_service.status()


@router.get("/text3d/status")
def text3d_status():
    return _safe_text3d_configuration()


@router.get("/text-to-3d/configuration")
def text_to_3d_configuration():
    # Backward-compatible route for older frontend sessions.
    return _safe_text3d_configuration()


@router.get("/text3d/status/{job_id}")
@router.get("/text-to-3d/{job_id}", include_in_schema=False)
def get_text_to_3d_job(job_id: str):
    with TEXT3D_LOCK:
        job = TEXT3D_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Text-to-3D job not found or server restarted.")
        return job


@router.get("/text3d/model/{filename}")
def get_validated_text3d_model(filename: str):
    """Serve only locally stored, already-validated Text-to-3D GLBs."""
    safe_name = os.path.basename(filename)
    if safe_name != filename or not safe_name.startswith("text3d_") or not safe_name.endswith(".glb"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Text-to-3D model name.")
    model_path = os.path.join(TEXT3D_MODEL_DIR, safe_name)
    if not os.path.isfile(model_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validated Text-to-3D model not found.")
    return FileResponse(model_path, media_type="model/gltf-binary", filename=safe_name, content_disposition_type="inline")

@router.get("/process/{file_id}/analytics")
def query_point_analytics(
    file_id: str,
    x: int = Query(..., description="Pixel X coordinate (column) in original image"),
    y: int = Query(..., description="Pixel Y coordinate (row) in original image"),
    pixel_size: float = Query(1.0, gt=0, description="Horizontal scale (pixel size) in meters")
):
    """
    Lookup full-resolution elevation, slope, and confidence values at a specific pixel location.
    Provides precise analytics for point-and-click operations.
    """
    elevation_path = os.path.join(UPLOAD_DIR, f"{file_id}_elevation.npy")
    depth_path = os.path.join(UPLOAD_DIR, f"{file_id}_depth.npy")
    
    if not os.path.exists(depth_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Depth map not found. Please run depth estimation first."
        )
        
    try:
        depth_map = _load_finite_array(depth_path, "depth map")
        height, width = depth_map.shape
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error loading depth map: {str(e)}"
        )
        
    # Check spatial query boundary
    if not (0 <= x < width and 0 <= y < height):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query coordinates ({x}, {y}) out of range. Image dimensions are {width}x{height}."
        )
        
    # Load elevation
    is_gcp_calibrated = os.path.exists(elevation_path)
    if is_gcp_calibrated:
        try:
            elevation_map = _load_finite_array(elevation_path, "elevation map")
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Error loading elevation map: {str(e)}"
            )
    else:
        # Load relative scale
        elevation_map, _, _, _, _ = calibrate_depth_to_elevation(depth_map, [])
        
    try:
        # Calculate full maps to get exact local gradient at the queried point
        slope_map = calculate_slope(elevation_map, pixel_size)
        confidence_map = calculate_confidence(depth_map)
        
        return {
            "file_id": file_id,
            "x": x,
            "y": y,
            "image_width": width,
            "image_height": height,
            "elevation": float(elevation_map[y, x]),
            "slope": float(slope_map[y, x]),
            "confidence": float(confidence_map[y, x]),
            "is_calibrated": is_gcp_calibrated,
            "message": "Approximate elevation (relative mapping)" if not is_gcp_calibrated else "Calibrated elevation"
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error performing point query: {str(e)}"
        )
