"""
In-memory credential store for LIVE-mode features.

Design notes:
  - Credentials live in a module-level dict on the API process. They are
    intentionally lost on container restart — no disk persistence.
  - The store wins over env vars when both are set, so an analyst trying
    new credentials in-app overrides whatever was baked into .env.
  - The browser never sees these values back. The GET status endpoint
    returns booleans only; the modal collects keys and forwards them via
    a single POST. localStorage is not used.

Three entry points across the UI route to this store via /api/credentials:
  - Mode badge: switching to LIVE without Sayari creds.
  - Co-pilot: submitting a freeform LIVE question without an Anthropic key.
  - Ownership graph: requesting a traversal for an uncached entity without
    Sayari creds.
"""
from __future__ import annotations

import os

# Intentional module-level mutable state — exactly one store per process.
_store: dict[str, str] = {}


def set_credentials(
    sayari_client_id: str | None = None,
    sayari_client_secret: str | None = None,
    anthropic_api_key: str | None = None,
) -> None:
    """Upsert credentials. None values are ignored so partial updates work."""
    if sayari_client_id is not None:
        _store["SAYARI_CLIENT_ID"] = sayari_client_id
    if sayari_client_secret is not None:
        _store["SAYARI_CLIENT_SECRET"] = sayari_client_secret
    if anthropic_api_key is not None:
        _store["ANTHROPIC_API_KEY"] = anthropic_api_key


def get_credential(key: str) -> str | None:
    """Look up a credential — store first, then process env. Returns None if absent.

    Store-first ordering means an in-app entry overrides whatever was loaded
    from .env at boot. Setting the same key to empty string in-app *does not*
    fall back to env (it returns None) — empty in-app entry is a clear signal.
    """
    if key in _store:
        return _store[key] or None
    return os.environ.get(key) or None


def status() -> dict[str, bool]:
    """Boolean availability map for each LIVE feature.

    `sayari` is true only when *both* id and secret are set, since the SDK
    needs both. `anthropic` is true when the key is set.
    """
    return {
        "sayari": bool(get_credential("SAYARI_CLIENT_ID"))
                  and bool(get_credential("SAYARI_CLIENT_SECRET")),
        "anthropic": bool(get_credential("ANTHROPIC_API_KEY")),
    }


def clear() -> None:
    """Wipe the in-memory store. Env vars (if any) become the source again."""
    _store.clear()
