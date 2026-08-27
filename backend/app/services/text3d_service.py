"""Backend-only Meshy Text-to-3D provider adapter."""
from abc import ABC, abstractmethod
import json
import logging
import os
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LOGGER = logging.getLogger("depthwizard.text3d")

class Text3DProviderError(RuntimeError):
    def __init__(self, message: str, code: str = "provider_error"):
        super().__init__(message); self.code = code

class Text3DProvider(ABC):
    @abstractmethod
    def configured(self) -> bool: ...
    @abstractmethod
    def provider_status(self) -> dict: ...
    @abstractmethod
    def generate(self, payload: dict, models_dir: str, update_status) -> dict: ...

class MeshyText3DProvider(Text3DProvider):
    MAX_MODEL_BYTES = 150 * 1024 * 1024
    def _url(self): return os.getenv("TEXT3D_API_URL", "").strip()
    def _key(self): return os.getenv("MESHY_API_KEY", "").strip() or os.getenv("TEXT3D_API_KEY", "").strip()
    def configured(self): return os.getenv("TEXT3D_PROVIDER", "meshy").strip().lower() == "meshy" and bool(self._url()) and bool(self._key())
    def configuration(self): return {"configured": self.configured(), "provider": "meshy", "api_key_set": bool(self._key()), "provider_url_set": bool(self._url())}
    def _headers(self, accept="application/json"): return {"Accept": accept, "Authorization": f"Bearer {self._key()}"}
    def _json(self, url, payload=None):
        headers = self._headers(); body = None
        if payload is not None: headers["Content-Type"] = "application/json"; body = json.dumps(payload).encode("utf-8")
        try:
            with urlopen(Request(url, data=body, headers=headers, method="POST" if payload is not None else "GET"), timeout=45) as response: return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            if error.code in {401, 403}: raise Text3DProviderError("Meshy API key is invalid or unauthorized. Check MESHY_API_KEY in backend/.env.", "authentication_failed") from error
            if error.code == 402: raise Text3DProviderError("Meshy account has insufficient credits for this generation.", "insufficient_credits") from error
            if error.code == 429: raise Text3DProviderError("Meshy rate limit reached. Please retry later.", "rate_limited") from error
            if error.code >= 500: raise Text3DProviderError("Meshy service is temporarily unavailable. Please try again.", "provider_unavailable") from error
            raise Text3DProviderError("Meshy rejected the generation request. Try a more detailed description.", "provider_request_failed") from error
        except URLError as error: raise Text3DProviderError("Could not reach Meshy. Check your network connection and provider URL.", "network_failure") from error
        except (ValueError, UnicodeDecodeError) as error: raise Text3DProviderError("Meshy returned an invalid response.", "invalid_provider_response") from error
    def provider_status(self):
        if not self.configured(): return {"provider": "meshy", "configured": False, "reachable": False, "error": "MESHY_API_KEY or TEXT3D_API_KEY is not configured."}
        try:
            self._json(f"{self._url()}?page_size=1")
            return {"provider": "meshy", "configured": True, "reachable": True}
        except Text3DProviderError as error:
            LOGGER.warning("Meshy status failed: %s", error.code)
            return {"provider": "meshy", "configured": False, "reachable": False, "error": str(error), "error_code": error.code}
    def _create_task(self, payload):
        task_id = self._json(self._url(), payload).get("result")
        if not isinstance(task_id, str) or not task_id: raise Text3DProviderError("Meshy did not return a generation task id.", "invalid_provider_response")
        return task_id
    def _poll_task(self, task_id, stage, update_status, started, timeout):
        while True:
            if time.monotonic() - started > timeout: raise Text3DProviderError("3D generation is taking longer than expected. Please retry.", "timeout")
            task = self._json(f"{self._url().rstrip('/')}/{task_id}"); task_status = str(task.get("status", "")).upper(); progress = task.get("progress")
            LOGGER.info("Meshy %s task %s status=%s progress=%s", stage, task_id, task_status, progress)
            if task_status == "SUCCEEDED": return task
            if task_status in {"FAILED", "CANCELED"}: raise Text3DProviderError("Meshy could not generate this model. Try a more detailed description.", "generation_failed")
            update_status(stage, f"{stage.capitalize()} task in progress" + (f" ({progress}%)." if isinstance(progress, (int, float)) else ".")); time.sleep(float(os.getenv("TEXT3D_POLL_SECONDS", "4")))
    def generate(self, payload, models_dir, update_status):
        if not self.configured(): raise Text3DProviderError("Meshy AI is not configured. Add MESHY_API_KEY to backend/.env.", "not_configured")
        timeout = int(os.getenv("TEXT3D_TIMEOUT_SECONDS", "600")); started = time.monotonic(); quality = payload["quality"]
        preview = {"mode": "preview", "prompt": payload["enhanced_prompt"][:600], "ai_model": "latest", "target_formats": ["glb"]}
        if quality == "Ultra": preview["ultra_mode"] = True
        update_status("submitting", "Preparing 3D generation."); LOGGER.info("Meshy preview requested")
        preview_id = self._create_task(preview); LOGGER.info("Meshy preview task id=%s", preview_id)
        update_status("processing", "Generating 3D geometry."); self._poll_task(preview_id, "processing", update_status, started, timeout)
        resolution = "4k" if quality in {"High", "Ultra"} else "2k"
        refine = {"mode": "refine", "preview_task_id": preview_id, "enable_pbr": True, "texture_resolution": resolution, "texture_prompt": payload["enhanced_prompt"][:600], "target_formats": ["glb"], "auto_size": True}
        update_status("refining", "Applying PBR materials and textures."); LOGGER.info("Meshy refine requested preview=%s", preview_id)
        refine_id = self._create_task(refine); LOGGER.info("Meshy refine task id=%s", refine_id)
        completed = self._poll_task(refine_id, "refining", update_status, started, timeout)
        model_url = (completed.get("model_urls") or {}).get("glb")
        if not isinstance(model_url, str) or not model_url: raise Text3DProviderError("Meshy completed without a GLB output.", "unsupported_format")
        update_status("downloading", "Downloading and validating generated GLB."); result = self._download_glb(model_url, models_dir)
        LOGGER.info("Meshy generation completed preview=%s refine=%s", preview_id, refine_id)
        return {**result, "provider_metadata": {"provider": "meshy", "preview_task_id": preview_id, "refine_task_id": refine_id, "consumed_credits": completed.get("consumed_credits")}}
    def _download_glb(self, model_url, models_dir):
        try:
            with urlopen(Request(model_url, headers=self._headers("model/gltf-binary,application/octet-stream")), timeout=90) as response: data = response.read(self.MAX_MODEL_BYTES + 1)
        except (HTTPError, URLError) as error: raise Text3DProviderError("Generated GLB could not be downloaded from Meshy.", "model_download_failed") from error
        if len(data) < 20 or len(data) > self.MAX_MODEL_BYTES or data[:4] != b"glTF": raise Text3DProviderError("Meshy returned an invalid GLB model.", "invalid_model")
        Path(models_dir).mkdir(parents=True, exist_ok=True); filename = f"meshy_{uuid.uuid4().hex}.glb"; Path(models_dir, filename).write_bytes(data)
        return {"model_filename": filename}

text3d_service = MeshyText3DProvider()
