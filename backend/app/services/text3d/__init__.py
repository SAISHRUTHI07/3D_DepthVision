"""Pluggable, server-side Text-to-3D integration.

This package deliberately has no browser-facing credentials or synthetic model
fallback. A configured provider must return a real GLB which is validated
before it becomes available to the viewer.
"""

from .base import Text3DEngine, Text3DProviderError
from .service import create_text3d_service

__all__ = ["Text3DEngine", "Text3DProviderError", "create_text3d_service"]
