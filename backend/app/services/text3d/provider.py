"""Concrete HTTP adapter for a real external Text-to-3D service.

The provider contract is documented in ``backend/TEXT3D_PROVIDER.md``. It is
generic so a provider can be selected without exposing credentials to the web
client or embedding a vendor SDK in the frontend.
"""

import json
import os
from pathlib import Path
import struct
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import uuid

from .base import Text3DEngine, Text3DProviderError


class UnavailableText3DEngine(Text3DEngine):
    def configured(self) -> bool:
        return False

    def status(self) -> dict:
        return {
            "configured": False,
            "provider_available": False,
            "engine": "not_configured",
            "engine_installed": False,
            "message": "Text-to-3D is ready for a compatible provider, but no provider is configured.",
            "required": "Set TEXT3D_PROVIDER=generic_http, TEXT3D_API_URL, and TEXT3D_API_KEY in backend/.env, then restart FastAPI.",
        }

    def generate(self, payload: dict, models_dir: str, update_status) -> dict:
        raise Text3DProviderError(self.status()["required"], "provider_not_configured")


class GenericHttpText3DEngine(Text3DEngine):
    """Adapter for a real provider following the documented JSON contract."""

    max_model_bytes = 150 * 1024 * 1024

    def _provider(self) -> str:
        return os.getenv("TEXT3D_PROVIDER", "").strip().lower()

    def _url(self) -> str:
        return os.getenv("TEXT3D_API_URL", "").strip()

    def _key(self) -> str:
        return os.getenv("TEXT3D_API_KEY", "").strip()

    def configured(self) -> bool:
        return self._provider() == "generic_http" and bool(self._url()) and bool(self._key())

    def status(self) -> dict:
        configured = self.configured()
        missing = []
        if self._provider() != "generic_http":
            missing.append("TEXT3D_PROVIDER=generic_http")
        if not self._url():
            missing.append("TEXT3D_API_URL")
        if not self._key():
            missing.append("TEXT3D_API_KEY")
        return {
            "configured": configured,
            "provider_available": configured,
            "engine": "generic_http" if configured else "not_configured",
            "engine_installed": configured,
            "message": "Text-to-3D provider configured. A real GLB will be validated before preview." if configured else "Text-to-3D credentials/configuration are missing.",
            "required": "Set " + ", ".join(missing) + " in backend/.env and restart FastAPI." if missing else None,
        }

    def _request_json(self, url: str, *, payload: dict | None = None) -> dict:
        headers = {"Accept": "application/json", "Authorization": f"Bearer {self._key()}"}
        body, method = None, "GET"
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body, method = json.dumps(payload).encode("utf-8"), "POST"
        try:
            with urlopen(Request(url, data=body, headers=headers, method=method), timeout=45) as response:
                decoded = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            if error.code in {401, 403}:
                raise Text3DProviderError("Text-to-3D provider rejected the configured API key.", "authentication_failed") from error
            if error.code == 429:
                raise Text3DProviderError("Text-to-3D provider rate limit reached. Retry later.", "rate_limited") from error
            if error.code >= 500:
                raise Text3DProviderError("Text-to-3D provider is temporarily unavailable.", "provider_unavailable") from error
            raise Text3DProviderError(f"Text-to-3D provider request failed (HTTP {error.code}).", "provider_request_failed") from error
        except URLError as error:
            raise Text3DProviderError("Text-to-3D provider could not be reached. Check API URL and network.", "network_failure") from error
        except (ValueError, UnicodeDecodeError) as error:
            raise Text3DProviderError("Text-to-3D provider returned invalid JSON.", "invalid_provider_response") from error
        if not isinstance(decoded, dict):
            raise Text3DProviderError("Text-to-3D provider response must be a JSON object.", "invalid_provider_response")
        return decoded

    @staticmethod
    def _model_url(result: dict) -> str | None:
        for key in ("model_url", "glb_url", "download_url"):
            value = result.get(key)
            if isinstance(value, str) and value:
                return value
        urls = result.get("model_urls")
        return urls.get("glb") if isinstance(urls, dict) and isinstance(urls.get("glb"), str) else None

    def _poll(self, initial: dict, update_status) -> dict:
        current = initial
        timeout = max(30, int(os.getenv("TEXT3D_TIMEOUT_SECONDS", "600")))
        interval = max(1, float(os.getenv("TEXT3D_POLL_SECONDS", "4")))
        started = time.monotonic()
        while True:
            state = str(current.get("status", "completed" if self._model_url(current) else "queued")).lower()
            if state in {"completed", "succeeded", "success", "ready"}:
                return current
            if state in {"failed", "cancelled", "canceled", "error"}:
                raise Text3DProviderError(str(current.get("error") or current.get("message") or "Text-to-3D generation failed at the provider."), "generation_failed")
            if time.monotonic() - started > timeout:
                raise Text3DProviderError("Text-to-3D generation timed out at the provider.", "timeout")
            status_url = current.get("status_url")
            job_id = current.get("job_id") or current.get("id") or current.get("result")
            if not isinstance(status_url, str) or not status_url:
                template = os.getenv("TEXT3D_STATUS_URL_TEMPLATE", "").strip()
                if not template or not isinstance(job_id, str) or not job_id:
                    raise Text3DProviderError("Provider returned an asynchronous job without status_url. Return status_url or set TEXT3D_STATUS_URL_TEMPLATE containing {job_id}.", "invalid_provider_response")
                status_url = template.replace("{job_id}", quote(job_id, safe=""))
            update_status("processing", "Provider is generating 3D geometry.")
            time.sleep(interval)
            current = self._request_json(status_url)

    @staticmethod
    def _validate_glb(data: bytes) -> dict:
        if len(data) < 20 or data[:4] != b"glTF":
            raise Text3DProviderError("Generated file is not a binary GLB.", "invalid_model")
        version, total_length = struct.unpack_from("<II", data, 4)
        if version != 2 or total_length != len(data):
            raise Text3DProviderError("Generated GLB header is invalid.", "invalid_model")
        json_length, chunk_type = struct.unpack_from("<I4s", data, 12)
        if chunk_type != b"JSON" or 20 + json_length > len(data):
            raise Text3DProviderError("Generated GLB has no valid JSON chunk.", "invalid_model")
        try:
            document = json.loads(data[20:20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
        except (ValueError, UnicodeDecodeError) as error:
            raise Text3DProviderError("Generated GLB JSON could not be read.", "invalid_model") from error
        accessors, positions, triangles = document.get("accessors", []), 0, 0
        for mesh in document.get("meshes", []):
            for primitive in mesh.get("primitives", []):
                position_index = (primitive.get("attributes") or {}).get("POSITION")
                if isinstance(position_index, int) and position_index < len(accessors):
                    positions += int(accessors[position_index].get("count", 0) or 0)
                index = primitive.get("indices")
                if isinstance(index, int) and index < len(accessors):
                    triangles += int(accessors[index].get("count", 0) or 0) // 3
        if positions < 3 or not document.get("meshes"):
            raise Text3DProviderError("Generated GLB contains no renderable vertex geometry.", "invalid_model")
        return {"vertices": positions, "triangles": triangles}

    def _download_model(self, model_url: str, models_dir: str) -> dict:
        try:
            with urlopen(Request(model_url, headers={"Accept": "model/gltf-binary,application/octet-stream"}), timeout=90) as response:
                data = response.read(self.max_model_bytes + 1)
        except (HTTPError, URLError) as error:
            raise Text3DProviderError("Generated GLB could not be downloaded from the provider.", "model_download_failed") from error
        if len(data) > self.max_model_bytes:
            raise Text3DProviderError("Generated GLB exceeds the 150 MB safety limit.", "invalid_model")
        geometry = self._validate_glb(data)
        output_dir = Path(models_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        filename = f"text3d_{uuid.uuid4().hex}.glb"
        (output_dir / filename).write_bytes(data)
        return {"model_filename": filename, "geometry": geometry}

    def generate(self, payload: dict, models_dir: str, update_status) -> dict:
        if not self.configured():
            raise Text3DProviderError(self.status()["required"], "provider_not_configured")
        update_status("preparing", "Preparing prompt for the configured Text-to-3D provider.")
        provider_payload = {"prompt": payload["enhanced_prompt"], "original_prompt": payload["prompt"], "category": payload["category"], "style": payload["style"], "quality": payload["quality"], "output_format": "glb"}
        update_status("generating", "Submitting generation request to provider.")
        result = self._poll(self._request_json(self._url(), payload=provider_payload), update_status)
        model_url = self._model_url(result)
        if not model_url:
            raise Text3DProviderError("Provider completed without a GLB model URL.", "unsupported_format")
        update_status("downloading", "Downloading the generated GLB.")
        stored = self._download_model(model_url, models_dir)
        update_status("validating", "Validated GLB geometry and mesh structure.")
        return {**stored, "provider_metadata": {"provider": "generic_http", "geometry": stored["geometry"], "provider_job_id": result.get("job_id") or result.get("id") or result.get("result")}}


class TripoText3DEngine(GenericHttpText3DEngine):
    """Official Tripo OpenAPI Text-to-3D adapter.

    Tripo's task API is asynchronous. The backend submits a real
    ``text_to_model`` task, waits for its terminal status, downloads the
    temporary output URL immediately, then validates the GLB before exposing
    it to the browser.
    """

    default_base_url = "https://openapi.tripo3d.ai/v3"

    def _tripo_key(self) -> str:
        return os.getenv("TRIPO_API_KEY", "").strip()

    def _tripo_base_url(self) -> str:
        return os.getenv("TRIPO_API_BASE_URL", self.default_base_url).strip().rstrip("/")

    def _tripo_model_version(self) -> str:
        return os.getenv("TRIPO_MODEL_VERSION", "v3.1-20260211").strip()

    def configured(self) -> bool:
        return bool(self._tripo_key()) and bool(self._tripo_base_url())

    def status(self) -> dict:
        configured = self.configured()
        return {
            "configured": configured,
            "provider_available": configured,
            "engine": "tripo" if configured else "not_configured",
            "engine_installed": configured,
            "message": "Tripo Text-to-3D is configured. Generated GLBs are validated before preview." if configured else "Tripo Text-to-3D credentials are missing.",
            "required": "Set TEXT3D_PROVIDER=tripo and TRIPO_API_KEY in backend/.env, then restart FastAPI." if not configured else None,
        }

    def _tripo_request(self, url: str, *, payload: dict | None = None) -> dict:
        headers = {"Accept": "application/json", "Authorization": f"Bearer {self._tripo_key()}"}
        body, method = None, "GET"
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body, method = json.dumps(payload).encode("utf-8"), "POST"
        try:
            with urlopen(Request(url, data=body, headers=headers, method=method), timeout=45) as response:
                decoded = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            # V3 returns structured ``error_code`` / ``error_message`` data
            # for many failed requests. Read it only to present a safe error;
            # credentials are never logged or returned by this adapter.
            provider_code, provider_message = self._tripo_http_error(error)
            if provider_code == 2010 or (provider_message and "not enough credit" in provider_message.lower()):
                raise Text3DProviderError(provider_message or "Tripo account has insufficient credits to create this task.", "insufficient_credits") from error
            if error.code in {401, 403}:
                message = provider_message or "Tripo rejected the configured API key."
                raise Text3DProviderError(message, "authentication_failed") from error
            if error.code == 429:
                raise Text3DProviderError(provider_message or "Tripo rate limit reached. Retry later.", "rate_limited") from error
            if error.code >= 500:
                raise Text3DProviderError(provider_message or "Tripo is temporarily unavailable.", "provider_unavailable") from error
            code_note = f" (Tripo error {provider_code})" if provider_code is not None else ""
            raise Text3DProviderError(provider_message or f"Tripo request failed (HTTP {error.code}){code_note}.", "provider_request_failed") from error
        except URLError as error:
            raise Text3DProviderError("Tripo could not be reached. Check the network and API base URL.", "network_failure") from error
        except (ValueError, UnicodeDecodeError) as error:
            raise Text3DProviderError("Tripo returned invalid JSON.", "invalid_provider_response") from error
        if not isinstance(decoded, dict):
            raise Text3DProviderError("Tripo returned an invalid response.", "invalid_provider_response")
        if decoded.get("code") not in (None, 0):
            message = decoded.get("message") or decoded.get("error") or "Tripo rejected the generation request."
            raise Text3DProviderError(f"Tripo: {message}", "provider_request_failed")
        data = decoded.get("data")
        if not isinstance(data, dict):
            raise Text3DProviderError("Tripo response did not contain task data.", "invalid_provider_response")
        return data

    def _tripo_http_error(self, error: HTTPError) -> tuple[object | None, str | None]:
        """Read a v3 error body without ever exposing the configured key."""
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None, None
        if not isinstance(payload, dict):
            return None, None
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        provider_code = payload.get("error_code", payload.get("code", data.get("error_code")))
        message = payload.get("error_message") or payload.get("message") or data.get("error_message") or data.get("message")
        if not isinstance(message, str):
            return provider_code, None
        # Remote error bodies should not contain a credential, but defensively
        # strip it before this becomes a user-visible job failure.
        sanitized = message.replace(self._tripo_key(), "<redacted>").strip()
        return provider_code, sanitized[:500] or None

    @staticmethod
    def _tripo_quality_options(quality: str, style: str) -> dict:
        if quality == "Draft":
            options = {"geometry_quality": "standard", "texture_quality": "standard", "face_limit": 20000}
        elif quality == "High":
            options = {"geometry_quality": "detailed", "texture_quality": "detailed", "face_limit": 100000}
        else:
            options = {"geometry_quality": "standard", "texture_quality": "detailed", "face_limit": 50000}
        if style == "Low Poly":
            options["smart_low_poly"] = True
            options["face_limit"] = min(options["face_limit"], 20000)
        return options

    @staticmethod
    def _tripo_model_url(output: dict) -> str | None:
        # V3 returns the downloadable GLB at data.output.model_url.
        value = output.get("model_url")
        return value if isinstance(value, str) and value else None

    def generate(self, payload: dict, models_dir: str, update_status) -> dict:
        if not self.configured():
            raise Text3DProviderError(self.status()["required"], "provider_not_configured")
        update_status("preparing", "Preparing your prompt for Tripo Text-to-3D.")
        task_payload = {
            "prompt": payload["enhanced_prompt"],
            "model": self._tripo_model_version(),
            "negative_prompt": "object representing the meaning of the text, scenery, people, unrelated objects, extra words, logos, changed spelling, random letters, flat 2D text, floating disconnected fragments, cropped text, broken geometry",
            "texture": True,
            "pbr": True,
            "export_uv": True,
            "compress": "geometry",
            "auto_size": True,
            **self._tripo_quality_options(payload["quality"], payload["style"]),
        }
        update_status("generating", "Submitting a real Text-to-3D task to Tripo.")
        created = self._tripo_request(f"{self._tripo_base_url()}/generation/text-to-model", payload=task_payload)
        task_id = created.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise Text3DProviderError("Tripo did not return a task ID.", "invalid_provider_response")

        timeout = max(30, int(os.getenv("TRIPO_TIMEOUT_SECONDS", "900")))
        interval = max(1, float(os.getenv("TRIPO_POLL_SECONDS", "3")))
        started = time.monotonic()
        task = created
        while True:
            task = self._tripo_request(f"{self._tripo_base_url()}/tasks/{quote(task_id, safe='')}")
            task_status = str(task.get("status", "unknown")).lower()
            if task_status == "success":
                break
            if task_status in {"failed", "banned", "expired", "cancelled", "unknown"}:
                message = task.get("error_message") or task.get("message") or task.get("error") or f"Tripo task {task_status}."
                error_code = task.get("error_code")
                if error_code is not None:
                    message = f"{message} (Tripo error {error_code})"
                raise Text3DProviderError(f"Tripo generation failed: {message}", "generation_failed")
            if time.monotonic() - started > timeout:
                raise Text3DProviderError("Tripo generation timed out.", "timeout")
            progress = task.get("progress")
            progress_note = f" ({progress}%)" if isinstance(progress, (int, float)) else ""
            update_status("processing", f"Tripo is building the 3D model{progress_note}")
            time.sleep(interval)

        output = task.get("output")
        model_url = self._tripo_model_url(output) if isinstance(output, dict) else None
        if not model_url:
            raise Text3DProviderError("Tripo completed without a downloadable model URL.", "unsupported_format")
        update_status("downloading", "Downloading Tripo's generated model for validation.")
        stored = self._download_model(model_url, models_dir)
        update_status("validating", "Validated generated GLB geometry and mesh structure.")
        return {
            **stored,
            "provider_metadata": {
                "provider": "tripo",
                "provider_task_id": task_id,
                "model_version": self._tripo_model_version(),
                "geometry": stored["geometry"],
            },
        }
