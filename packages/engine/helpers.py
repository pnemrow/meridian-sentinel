"""
Generic helper utilities for the engine.
"""
from __future__ import annotations
from typing import Any


def to_dict(obj: Any) -> Any:
    """Convert an SDK response object into a plain dict/list.

    Works across Pydantic v1/v2 and dataclasses.
    """
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_dict(v) for v in obj]
    for attr in ("model_dump", "dict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return to_dict(fn())
            except Exception:
                pass
    if hasattr(obj, "__dict__"):
        return {k: to_dict(v) for k, v in vars(obj).items() if not k.startswith("_")}
    return str(obj)


def deep_get(d: Any, *keys: str, default: Any = None) -> Any:
    """Safely walk nested dict keys."""
    cur = d
    for k in keys:
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            return default
    return cur


def first_present(d: dict, *keys: str, default: Any = None) -> Any:
    """Return the value of the first key that exists in d."""
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return default
