"""Backward-compatible import surface for the Text-to-3D service package."""

from app.services.text3d import Text3DEngine, Text3DProviderError, create_text3d_service
from app.services.text3d.provider import GenericHttpText3DEngine, UnavailableText3DEngine


# app.main loads backend/.env before importing routes that import this module.
text3d_service: Text3DEngine = create_text3d_service()

__all__ = [
    "GenericHttpText3DEngine",
    "Text3DEngine",
    "Text3DProviderError",
    "UnavailableText3DEngine",
    "text3d_service",
]
