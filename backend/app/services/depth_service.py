import os
import torch
import numpy as np
from PIL import Image
import cv2
from transformers import pipeline
from huggingface_hub import snapshot_download


MODEL_ID = "LiheYoung/depth-anything-small-hf"


class DepthModelUnavailable(RuntimeError):
    """Raised when the real depth model is not installed on this machine."""

class DepthService:
    def __init__(self):
        self.pipe = None

    def load_model(self):
        """
        Loads the Intel Depth Anything Small model in a lazy-loading fashion.
        Utilizes GPU/CUDA if available, otherwise falls back to CPU.
        """
        if self.pipe is None:
            # Detect device (0 for GPU, -1 for CPU)
            device = 0 if torch.cuda.is_available() else -1
            print(f"[DepthService] Loading '{MODEL_ID}' on device: {'GPU (CUDA)' if device == 0 else 'CPU'}")

            # Do not let a web request during an image operation hang the API.
            # The model is a required local dependency, so locate a complete
            # cached snapshot first and report a concrete installation command
            # if it is absent.
            try:
                model_path = snapshot_download(repo_id=MODEL_ID, local_files_only=True)
            except Exception as exc:
                raise DepthModelUnavailable(
                    f"Required depth model '{MODEL_ID}' is not installed locally. "
                    "Install it once with internet access using: "
                    "python -c \"from huggingface_hub import snapshot_download; "
                    f"snapshot_download('{MODEL_ID}')\". Original check: {exc}"
                ) from exc

            try:
                self.pipe = pipeline(task="depth-estimation", model=model_path, device=device)
            except Exception as exc:
                raise DepthModelUnavailable(
                    f"The locally cached depth model '{MODEL_ID}' could not be loaded: {exc}"
                ) from exc
            print("[DepthService] Model loaded successfully.")

    def run_depth_estimation(self, image_path: str, uploads_dir: str, file_id: str, ext: str):
        """
        Runs monocular depth estimation on the uploaded image.
        Saves:
          - A raw depth 2D matrix as '<file_id>_depth.npy' for future mathematical operations.
          - A visual colormapped depth map as '<file_id>_depth_visual.png' for front-end rendering.
        Returns visual path, processing time (approx), and metadata.
        """
        import time
        start_time = time.time()
        
        # Ensure model is loaded
        self.load_model()
        
        # Load image
        image = Image.open(image_path).convert("RGB")
        orig_w, orig_h = image.size
        
        # Run inference
        result = self.pipe(image)
        
        # Get raw depth predictions (lower resolution, e.g. 384x384 or similar)
        predicted_depth = result["predicted_depth"]
        
        # Convert to numpy array
        if hasattr(predicted_depth, "cpu"):
            # If it's a PyTorch tensor
            depth_np = predicted_depth.squeeze().cpu().numpy()
        elif hasattr(predicted_depth, "numpy"):
            depth_np = predicted_depth.numpy()
        else:
            depth_np = np.array(predicted_depth, dtype=np.float32)
            
        # Resize raw depth to original image resolution for accurate coordinate mapping
        depth_resized = cv2.resize(depth_np, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
        valid = np.isfinite(depth_resized)
        if not valid.any():
            raise ValueError("Depth model returned no finite depth values for this image.")
        replacement = float(np.median(depth_resized[valid]))
        depth_resized = np.nan_to_num(depth_resized, nan=replacement, posinf=replacement, neginf=replacement)
        
        # Save raw depth map as a numpy file for calibration/mesh processing
        raw_depth_filename = f"{file_id}_depth.npy"
        raw_depth_path = os.path.join(uploads_dir, raw_depth_filename)
        np.save(raw_depth_path, depth_resized)
        
        # Normalize raw depth map to 0-255 for visualization
        # Note: We invert it so that "closer" or "higher" objects are bright, and "further/lower" are dark, or vice versa.
        # Intel depth models output relative depth where higher numerical value = closer.
        # Let's normalize it to 0-255.
        depth_min = float(depth_resized.min())
        depth_max = float(depth_resized.max())
        
        if depth_max - depth_min > 0:
            depth_normalized = ((depth_resized - depth_min) / (depth_max - depth_min) * 255.0).astype(np.uint8)
        else:
            depth_normalized = np.zeros_like(depth_resized, dtype=np.uint8)
            
        # Apply colormap (e.g. VIRIDIS for elevation feel, or INFERNO/GRAY)
        # Viridis is excellent for terrain/geospatial display
        visual_depth_color = cv2.applyColorMap(depth_normalized, cv2.COLORMAP_VIRIDIS)
        
        # Save colorized visual representation
        visual_filename = f"{file_id}_depth_visual.png"
        visual_filepath = os.path.join(uploads_dir, visual_filename)
        cv2.imwrite(visual_filepath, visual_depth_color)
        
        elapsed_time = time.time() - start_time
        
        return {
            "raw_depth_file": raw_depth_filename,
            "visual_depth_file": visual_filename,
            "width": orig_w,
            "height": orig_h,
            "min_val": float(depth_min),
            "max_val": float(depth_max),
            "processing_time_sec": round(elapsed_time, 3),
            "model_name": MODEL_ID
        }

# Singleton instance
depth_service = DepthService()
