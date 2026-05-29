"""
Sayari SDK client factory.

Centralises credential lookup so every layer that needs a live client
imports from here rather than duplicating os.environ logic.

Credential resolution prefers the in-memory store in `services.api.credentials`
(which the in-app credential modal writes to) so a user can override .env
without restarting. The engine package itself remains standalone-importable —
if services.api isn't on the path, we fall back to os.environ.
"""
from __future__ import annotations

import os


def _lookup(key: str) -> str | None:
    """Store-first lookup with a clean env fallback when run outside the API."""
    try:
        from services.api.credentials import get_credential  # noqa: PLC0415
        return get_credential(key)
    except ImportError:
        return os.environ.get(key) or None


def build_client():
    """Instantiate the official Sayari SDK client (handles OAuth + token refresh).

    Returns None if credentials are not set — callers fall back to cached data.
    """
    cid = _lookup("SAYARI_CLIENT_ID")
    secret = _lookup("SAYARI_CLIENT_SECRET")
    if not cid or not secret:
        return None
    try:
        from sayari.client import Sayari
        return Sayari(client_id=cid, client_secret=secret)
    except Exception as exc:
        import logging
        logging.getLogger("engine.client").warning("Sayari client init failed: %s", exc)
        return None


def require_client():
    """Like build_client() but raises if credentials are absent."""
    client = build_client()
    if client is None:
        raise RuntimeError(
            "Sayari credentials not set. "
            "Export SAYARI_CLIENT_ID and SAYARI_CLIENT_SECRET."
        )
    return client
