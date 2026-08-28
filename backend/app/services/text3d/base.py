"""Contracts shared by all Text-to-3D provider adapters."""

from abc import ABC, abstractmethod


class Text3DProviderError(RuntimeError):
    """A safe, user-presentable provider failure."""

    def __init__(self, message: str, code: str = "engine_error"):
        super().__init__(message)
        self.code = code


class Text3DEngine(ABC):
    @abstractmethod
    def configured(self) -> bool:
        """Whether generation may safely be submitted."""

    @abstractmethod
    def status(self) -> dict:
        """Return safe configuration state without secrets."""

    @abstractmethod
    def generate(self, payload: dict, models_dir: str, update_status) -> dict:
        """Generate, download, and validate a real GLB."""
