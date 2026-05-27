"""
Tool: traverse_ownership

Walk the Sayari ownership graph from an entity_id.

Returns CitedResult with:
  data:
    root_entity_id: str
    nodes: list of {entity_id, name, type, country, sanctioned}
    edges: list of {parent_id, child_id, relationship_type, percentage}
    sanction_hits: nodes that are sanctioned (the key finding)
  source: Sayari traversal API citation
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import (
    CitedResult,
    SourceCitation,
    build_client,
    to_dict,
)


def _attr(obj, *names, default=None):
    for n in names:
        if obj is None:
            return default
        v = getattr(obj, n, None)
        if v is None and isinstance(obj, dict):
            v = obj.get(n)
        if v is not None:
            return v
    return default


def traverse_ownership_tool(
    entity_id: str,
    depth: int = 3,
    direction: str = "upstream",
) -> CitedResult:
    """
    Walk the ownership graph.

    Direction: "upstream" (find owners/parents), "downstream" (find subsidiaries), "both".
    Depth: max hops (1-5; default 3).

    NOTE: This tool requires a live Sayari client — there is no pre-cached
    traversal data. It burns API quota proportional to depth × relationship count.
    """
    entity_url = f"/v1/entity/{entity_id}"
    nodes_by_id: dict[str, dict] = {}
    edges: list[dict] = []

    client = build_client()
    if client is None:
        return CitedResult(
            data={
                "root_entity_id": entity_id,
                "nodes": [],
                "edges": [],
                "sanction_hits": [],
                "error": "No Sayari credentials — traversal requires a live client.",
            },
            source=SourceCitation(
                entity_url=entity_url,
                api_endpoint="N/A — SAYARI_CLIENT_ID not set",
            ),
        )

    def _absorb(payload, is_upstream: bool) -> None:
        data = _attr(payload, "data", default=payload) or []
        for rel in data:
            target = _attr(rel, "target")
            source = _attr(rel, "source")
            rel_type = str(_attr(rel, "type", "relationship", default="") or "")
            pct = _attr(rel, "percentage", "ownership_percentage")
            try:
                pct_f = float(pct) if pct is not None else None
            except (TypeError, ValueError):
                pct_f = None

            tgt = to_dict(target) if target else {}
            src = to_dict(source) if source else {}
            tgt_id = _attr(tgt, "id") or _attr(tgt, "entity_id") or ""
            src_id = _attr(src, "id") or _attr(src, "entity_id") or entity_id

            if tgt_id and tgt_id not in nodes_by_id:
                tgt_countries = _attr(tgt, "countries", default=[]) or []
                nodes_by_id[tgt_id] = {
                    "entity_id": tgt_id,
                    "name": _attr(tgt, "label", "name") or "",
                    "type": _attr(tgt, "type") or None,
                    "country": tgt_countries[0] if tgt_countries else None,
                    "sanctioned": _attr(tgt, "sanctioned"),
                }
            if tgt_id and src_id:
                # upstream: target is parent, source is child
                parent = tgt_id if is_upstream else src_id
                child  = src_id if is_upstream else tgt_id
                edges.append({
                    "parent_id": parent,
                    "child_id": child,
                    "relationship_type": rel_type or None,
                    "percentage": pct_f,
                })

    def _call(fn) -> None:
        try:
            payload = fn(id=entity_id, limit=50, max_depth=depth)
        except TypeError:
            try:
                payload = fn(id=entity_id, limit=50, depth=depth)
            except TypeError:
                payload = fn(id=entity_id, limit=50)
        _absorb(to_dict(payload), is_upstream=(fn == client.traversal.ownership))

    try:
        if direction in ("upstream", "both"):
            _call(client.traversal.ownership)
        if direction in ("downstream", "both"):
            try:
                _call(client.traversal.traversal)
            except Exception:
                pass  # downstream traversal is best-effort
    except Exception as exc:
        return CitedResult(
            data={
                "root_entity_id": entity_id,
                "nodes": [],
                "edges": [],
                "sanction_hits": [],
                "error": f"Traversal failed: {exc}",
            },
            source=SourceCitation(
                entity_url=entity_url,
                api_endpoint=f"GET /v1/traversal/ownership?id={entity_id}",
            ),
        )

    sanction_hits = [n for n in nodes_by_id.values() if n.get("sanctioned")]

    endpoint = (
        "GET /v1/traversal/ownership"
        if direction == "upstream"
        else "GET /v1/traversal/traversal"
        if direction == "downstream"
        else "GET /v1/traversal/{ownership,traversal}"
    )
    return CitedResult(
        data={
            "root_entity_id": entity_id,
            "nodes": list(nodes_by_id.values())[:50],
            "edges": edges[:100],
            "sanction_hits": sanction_hits,
        },
        source=SourceCitation(
            entity_url=entity_url,
            raw_field_path="data[].{target.id, target.label, target.sanctioned, type, percentage}",
            api_endpoint=endpoint,
        ),
    )
