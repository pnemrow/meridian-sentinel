"""
Sayari SDK client factory.

Centralises credential lookup so every layer that needs a live client
imports from here rather than duplicating os.environ logic.
"""
from __future__ import annotations

import os


def build_client():
    """Instantiate the official Sayari SDK client (handles OAuth + token refresh).

    Returns None if credentials are not set — callers fall back to cached data.
    """
    cid = os.environ.get("SAYARI_CLIENT_ID")
    secret = os.environ.get("SAYARI_CLIENT_SECRET")
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
