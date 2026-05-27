"""
Tool: get_profile

Fetch the full entity profile (risk factors, countries, sanctions status,
relationship counts, source count) for a Sayari entity_id.

Returns CitedResult with:
  data: flat profile dict matching the Profile dataclass fields
  source: entity_url + raw field paths + cache file path
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import (
    EntityCache,
    InputEntity,
    CitedResult,
    SourceCitation,
    build_client,
    fetch_profile,
    extract_profile,
)


def get_profile_tool(
    entity_id: str,
    cache: EntityCache | None = None,
) -> CitedResult:
    """
    Get full entity profile from cache or live API.

    Every returned field is traceable to output/raw/{entity_id}.json
    or a live GET /v1/entity/{id} response.
    """
    entity_url = f"/v1/entity/{entity_id}"
    cache_file = f"output/raw/{entity_id}.json"

    # ── 1. Cache hit ──────────────────────────────────────────────────────
    if cache is not None:
        raw = cache.get_entity_raw(entity_id)
        if raw is not None:
            input_name = cache._id_to_name.get(entity_id, entity_id)
            e = InputEntity(row=0, name=input_name)
            match = {"entity_id": entity_id, "label": None, "score": None}
            profile = extract_profile(e, match, raw)
            return CitedResult(
                data=profile.to_dict(),
                source=SourceCitation(
                    entity_url=entity_url,
                    raw_field_path="data.{label,type,countries,sanctioned,pep,risk,degree,source_count}",
                    cache_file=cache_file,
                    api_endpoint="GET /v1/entity/{id} (cached)",
                ),
            )

    # ── 2. Live API ───────────────────────────────────────────────────────
    client = build_client()
    if client is None:
        return CitedResult(
            data={"error": "No credentials and entity not in cache.", "entity_id": entity_id},
            source=SourceCitation(
                entity_url=entity_url,
                api_endpoint="N/A — SAYARI_CLIENT_ID not set",
            ),
        )

    raw = fetch_profile(client, entity_id)
    e = InputEntity(row=0, name=entity_id)
    match = {"entity_id": entity_id, "label": None, "score": None}
    profile = extract_profile(e, match, raw)
    return CitedResult(
        data=profile.to_dict(),
        source=SourceCitation(
            entity_url=entity_url,
            raw_field_path="data.{label,type,countries,sanctioned,pep,risk,degree,source_count}",
            api_endpoint="GET /v1/entity/{id}",
        ),
    )
