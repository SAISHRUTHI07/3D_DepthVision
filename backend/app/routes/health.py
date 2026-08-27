from fastapi import APIRouter
import platform
import time
import sys

router = APIRouter()

@router.get("/health")
def get_health():
    """
    Check the health of the FastAPI backend.
    Includes system and GPU availability details.
    """
    gpu_available = False
    gpu_name = None
    gpu_details = {}
    
    # Try importing torch to check CUDA/GPU status
    try:
        import torch
        gpu_available = torch.cuda.is_available()
        if gpu_available:
            gpu_name = torch.cuda.get_device_name(0)
            gpu_details = {
                "backend": "PyTorch (CUDA)",
                "device_count": torch.cuda.device_count(),
                "current_device": torch.cuda.current_device()
            }
        else:
            gpu_details = {"backend": "PyTorch (CPU-only)"}
    except ImportError:
        # Fallback: PyTorch not installed yet, check using system tools
        import subprocess
        # Check nvidia-smi first
        try:
            output = subprocess.check_output(
                "nvidia-smi --query-gpu=name --format=csv,noheader",
                shell=True,
                text=True,
                timeout=1.5
            )
            gpus = [line.strip() for line in output.strip().split("\n") if line.strip()]
            if gpus:
                gpu_available = True
                gpu_name = gpus[0]
                gpu_details = {
                    "backend": "System CLI (nvidia-smi)",
                    "devices": gpus
                }
        except Exception:
            # Check Win32_VideoController using PowerShell on Windows
            if platform.system() == "Windows":
                try:
                    cmd = 'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"'
                    output = subprocess.check_output(cmd, shell=True, text=True, timeout=1.5)
                    devices = [line.strip() for line in output.strip().split("\n") if line.strip()]
                    
                    gpu_devices = []
                    for d in devices:
                        d_lower = d.lower()
                        if "nvidia" in d_lower or "amd" in d_lower or "radeon" in d_lower or "arc" in d_lower:
                            gpu_devices.append(d)
                            
                    if gpu_devices:
                        gpu_available = True
                        gpu_name = gpu_devices[0]
                        gpu_details = {
                            "backend": "System WMI (Win32_VideoController)",
                            "all_detected_gpus": gpu_devices
                        }
                except Exception:
                    pass

    return {
        "status": "healthy",
        "timestamp": time.time(),
        "platform": {
            "system": platform.system(),
            "node": platform.node(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python_version": sys.version
        },
        "hardware": {
            "gpu_available": gpu_available,
            "gpu_name": gpu_name,
            "gpu_details": gpu_details
        }
    }
