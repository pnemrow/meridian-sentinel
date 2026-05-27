"""
Meridian Sentinel — deterministic compliance engine.

Public API:
    from packages.engine import EntityCache, build_summary, load_entities_from_xlsx
    from packages.engine import build_client, require_client
    from packages.engine import resolve_with_fallback, fetch_profile, extract_profile
    from packages.engine.types import InputEntity, Profile, CitedResult, SourceCitation
"""
from .types import InputEntity, Profile, CitedResult, SourceCitation
from .helpers import to_dict, deep_get, first_present
from .client import build_client, require_client
from .resolve import resolve_with_fallback, PINNED_IDS, RETRY_NAMES
from .profile import fetch_profile, extract_profile
from .aggregate import build_summary
from .loader import load_entities_from_xlsx
from .cache import EntityCache

__all__ = [
    "InputEntity",
    "Profile",
    "CitedResult",
    "SourceCitation",
    "to_dict",
    "deep_get",
    "first_present",
    "build_client",
    "require_client",
    "resolve_with_fallback",
    "PINNED_IDS",
    "RETRY_NAMES",
    "fetch_profile",
    "extract_profile",
    "build_summary",
    "load_entities_from_xlsx",
    "EntityCache",
]
