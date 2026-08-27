from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import health, upload, process
from fastapi.staticfiles import StaticFiles
import os
from app.config import load_backend_env

load_backend_env()

# Initialize the FastAPI app
app = FastAPI(
    title="DepthWizard API Backend",
    description="Backend API for DepthWizard - Single-View Height Estimation & 3D Flythrough",
    version="1.0.0"
)

# Configure CORS Middleware
# Allows the React frontend running on local ports (e.g. 5173) to communicate with the FastAPI backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Using wildcard for development; restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve files uploaded and processed in the uploads folder
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(os.path.dirname(BASE_DIR), "uploads")
MODEL_DIR = os.path.join(os.path.dirname(BASE_DIR), "models")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/models", StaticFiles(directory=MODEL_DIR), name="models")

# Include routes
app.include_router(health.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(process.router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "app": "DepthWizard API",
        "description": "Single-View Height Estimation and 3D Flythrough Backend",
        "status": "online",
        "documentation": "/docs"
    }
