"""Provider selection and configuration boundary for Text-to-3D."""

import os

from .base import Text3DEngine
from .provider import GenericHttpText3DEngine, TripoText3DEngine, UnavailableText3DEngine


def create_text3d_service() -> Text3DEngine:
    """Create the provider selected by server-side environment configuration."""
    provider = os.getenv("TEXT3D_PROVIDER", "").strip().lower()
    if provider == "tripo":
        return TripoText3DEngine()
    if provider == "generic_http":
        return GenericHttpText3DEngine()
    return UnavailableText3DEngine()
