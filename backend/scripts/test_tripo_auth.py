"""One-shot, secret-safe Tripo authentication diagnostic.

This intentionally submits the smallest requested text-to-model task.  If
Tripo accepts it, the script prints the returned task ID and exits; it never
polls, downloads, or prints credentials.  A successfully accepted request can
consume Tripo account credits.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# Running ``python scripts/test_tripo_auth.py`` places scripts/ on sys.path,
# so add backend/ before importing the application's existing env loader.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import load_backend_env  # noqa: E402


def sanitize(value: object, secret: str) -> str:
    """Make diagnostic output safe even if a remote error echoes a secret."""
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False)
    elif value is None:
        text = ""
    else:
        text = str(value)
    if secret:
        text = text.replace(secret, "<redacted>")
    return " ".join(text.split())[:500]


def response_details(body: bytes, secret: str) -> tuple[object, str, str | None]:
    """Return only safe code/message/task metadata from a Tripo response."""
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None, "Tripo returned a non-JSON response.", None
    if not isinstance(payload, dict):
        return None, "Tripo returned an unexpected response body.", None
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    message = payload.get("message") or payload.get("error") or data.get("message") or data.get("error") or ""
    task_id = data.get("task_id") if isinstance(data.get("task_id"), str) else None
    return payload.get("code"), sanitize(message, secret), task_id


def main() -> int:
    load_backend_env()
    api_key = os.getenv("TRIPO_API_KEY", "").strip()
    base_url = os.getenv("TRIPO_API_BASE_URL", "https://openapi.tripo3d.ai/v3").strip().rstrip("/")

    if not api_key:
        print("HTTP status code: not requested")
        print("Tripo response code: unavailable")
        print("Sanitized error message: TRIPO_API_KEY is missing or empty.")
        print("Authentication accepted: no")
        print("Task ID returned: no")
        return 2

    payload = {
        "prompt": "a simple wooden chair",
        "model": "v3.1-20260211",
    }
    request = Request(
        f"{base_url}/generation/text-to-model",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            http_status, body = response.status, response.read()
    except HTTPError as error:
        http_status, body = error.code, error.read()
    except URLError as error:
        print("HTTP status code: network error")
        print("Tripo response code: unavailable")
        print(f"Sanitized error message: {sanitize(error.reason, api_key)}")
        print("Authentication accepted: no")
        print("Task ID returned: no")
        return 1

    tripo_code, message, task_id = response_details(body, api_key)
    # A task ID is definitive proof of authentication. Tripo's observed v3
    # credit error also proves that the token was accepted far enough to check
    # the account, even though task creation is denied.
    credit_denied = tripo_code == 2010 or "not enough credit" in message.lower()
    accepted = bool(task_id) or credit_denied
    print(f"HTTP status code: {http_status}")
    print(f"Tripo response code: {tripo_code if tripo_code is not None else 'unavailable'}")
    print(f"Sanitized error message: {message or 'none'}")
    print(f"Authentication accepted: {'yes' if accepted else 'no'}")
    print(f"Task ID returned: {'yes' if task_id else 'no'}")
    if task_id:
        print(f"Tripo task ID: {task_id}")
    return 0 if accepted else 1


if __name__ == "__main__":
    raise SystemExit(main())
