"""
Tool: resolve_entity

Resolves a raw vendor/counterparty name to ranked Sayari entity candidates.

Returns CitedResult with:
  data:
    candidates: list of {entity_id, name, score, countries, matched_via}
    best_match: the top candidate (or None)
    confidence: "high" | "low" | "unresolved"
    warn_mismatch: bool — True if label doesn't match input tokens
  source: Sayari resolution API call citation
"""
from __future__ import annotations

import sys
from pathlib import Path

# Engine is in packages/engine relative to repo root
_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import (
    EntityCache,
    InputEntity,
    CitedResult,
    SourceCitation,
    build_client,
    resolve_with_fallback,
    first_present,
    PINNED_IDS,
)


def _find_in_cache(cache: EntityCache, name: str) -> dict | None:
    """Check if the entity_id is already in cache by input name."""
    eid = cache.find_entity_id(name)
    if not eid:
        return None
    raw = cache.get_entity_raw(eid)
    if raw is None:
        return None
    data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    label = data.get("label") or data.get("translated_label") or name
    return {
        "entity_id": eid,
        "name": label,
        "score": None,
        "countries": data.get("countries", []),
        "matched_via": "cache",
        "cache_file": cache.cache_file_path(eid),
    }


def resolve_entity_tool(
    name: str,
    country: str | None = None,
    address: str | None = None,
    identifier: str | None = None,
    limit: int = 5,
    cache: EntityCache | None = None,
) -> CitedResult:
    """
    Resolve a name to Sayari entity candidates.

    Strategy:
      1. Check EntityCache (output/raw/) by input name — free, quota-free.
      2. If not cached and live client available, call Sayari resolution API.
      3. Return structured candidates with confidence signals.
    """
    e = InputEntity(row=0, name=name, country=country, address=address)

    # ── 1. Cache hit ──────────────────────────────────────────────────────
    if cache is not None:
        cached = _find_in_cache(cache, name)
        if cached:
            # Also pull from resolution log for match_score if available
            profile = cache.get_profile(cached["entity_id"])
            score = profile.match_score if profile else None
            mismatch = profile.name_mismatch_flag if profile else False
            confidence = (
                "low" if mismatch or (score is not None and score < 50)
                else "high"
            )
            entity_url = f"/v1/entity/{cached['entity_id']}"
            return CitedResult(
                data={
                    "candidates": [cached],
                    "best_match": cached,
                    "confidence": confidence,
                    "warn_mismatch": mismatch,
                },
                source=SourceCitation(
                    entity_url=entity_url,
                    raw_field_path="data.label, data.countries",
                    cache_file=cached["cache_file"],
                    api_endpoint="GET /v1/entity/{id} (cached)",
                ),
            )

    # ── 2. Live API ───────────────────────────────────────────────────────
    client = build_client()
    if client is None:
        return CitedResult(
            data={
                "candidates": [],
                "best_match": None,
                "confidence": "unresolved",
                "warn_mismatch": False,
                "error": "No Sayari credentials and entity not in cache.",
            },
            source=SourceCitation(api_endpoint="N/A — SAYARI_CLIENT_ID not set"),
        )

    best, raw, retry_name = resolve_with_fallback(client, e)
    candidates = []
    if best:
        eid = first_present(best, "entity_id", "id")
        label = first_present(best, "label", "name") or name
        score = first_present(best, "score")
        countries = best.get("countries", [])
        candidates.append({
            "entity_id": eid,
            "name": label,
            "score": score,
            "countries": countries if isinstance(countries, list) else [countries],
            "matched_via": f"resolution_api" + (f"_retry:{retry_name}" if retry_name else ""),
        })
        # Also pull remaining candidates from raw
        for row in (raw.get("data") or [])[1:limit]:
            rid = first_present(row, "entity_id", "id")
            rlabel = first_present(row, "label", "name") or ""
            if rid and rid != eid:
                candidates.append({
                    "entity_id": rid,
                    "name": rlabel,
                    "score": first_present(row, "score"),
                    "countries": row.get("countries", []),
                    "matched_via": "resolution_api",
                })

    confidence = "unresolved" if not candidates else (
        "low" if (
            best and isinstance(first_present(best, "score"), (int, float))
            and first_present(best, "score") < 50
        ) else "high"
    )

    return CitedResult(
        data={
            "candidates": candidates[:limit],
            "best_match": candidates[0] if candidates else None,
            "confidence": confidence,
            "warn_mismatch": False,
        },
        source=SourceCitation(
            entity_url=(
                f"/v1/entity/{candidates[0]['entity_id']}" if candidates else None
            ),
            raw_field_path="data[0].entity_id, data[0].label, data[0].score",
            api_endpoint="POST /v1/resolution",
        ),
    )
