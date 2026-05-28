"""
Tool: traverse_ownership

Walk the Sayari ownership graph from an entity_id and return a normalized graph.

Cache-first: reads from output/raw/traversal/{entity_id}.json when available
(for the 8 marquee entities pre-fetched in the live-API session).
Falls back to live Sayari API for uncached entities.

Returns CitedResult with data shape (matches design contract):
  {
    root_entity_id: str,
    nodes: [{id, label, type, country, sanctioned, pep}],
    edges: [{source, target, relationship, percentage, former, last_observed}],
    sanction_hits: [{id, label}],
    explored_count: int | None,   # total graph nodes Sayari explored
    shown: int,                   # paths returned (capped at 50)
    next: bool | None,            # True = more paths available
    partial_results: bool,        # True = not all paths returned
  }
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import (
    CitedResult,
    SourceCitation,
    build_client,
    to_dict,
)

_TRAVERSAL_DIR = _REPO / "output" / "raw" / "traversal"


# ── Cache-based transform ─────────────────────────────────────────────────────

def _load_traversal_cache(entity_id: str) -> dict | None:
    """Try to load pre-fetched traversal JSON. Checks {id}.json and {id}_ubo.json."""
    for suffix in ("", "_ubo"):
        path = _TRAVERSAL_DIR / f"{entity_id}{suffix}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def _transform_traversal(root_id: str, traversal_data: dict) -> dict:
    """
    Transform cached UBO traversal response into normalized nodes/edges.

    API structure:
      data[].source = root entity_id (string)
      data[].target = discovered entity dict (owner at end of path)
      data[].path[] = steps from root toward the owner:
        path[j].entity   = entity at step j
        path[j].field    = relationship type (e.g. "has_shareholder")
        path[j].relationships.{field}.most_recent_percentage
        path[j].relationships.{field}.former

    Edge direction: path[j].entity → path[j-1].entity (or root if j==0)
    i.e. parent_id = path[j].entity.id (the owner),
         child_id  = path[j-1].entity.id or root_id
    """
    nodes_by_id: dict[str, dict] = {}
    edges: list[dict] = []
    edge_seen: set[tuple] = set()

    # Root node placeholder (label filled from profile cache if available)
    nodes_by_id[root_id] = {
        "id": root_id,
        "label": None,
        "type": None,
        "country": None,
        "sanctioned": None,
        "pep": None,
    }

    items = traversal_data.get("data", [])

    for item in items:
        path_steps: list[dict] = item.get("path", [])

        prev_id = root_id
        for step in path_steps:
            ent: dict = step.get("entity") or {}
            ent_id: str = ent.get("id") or ""
            if not ent_id:
                continue

            # Add/update node
            if ent_id not in nodes_by_id:
                countries = ent.get("countries") or []
                nodes_by_id[ent_id] = {
                    "id": ent_id,
                    "label": ent.get("label") or ent.get("translated_label"),
                    "translated_label": ent.get("translated_label"),
                    "type": ent.get("type"),
                    "country": countries[0] if countries else None,
                    "sanctioned": ent.get("sanctioned"),
                    "pep": ent.get("pep"),
                }

            # Build edge: ent_id → prev_id (ent_id is owner of prev_id)
            field: str = step.get("field") or "has_shareholder"
            rels: dict = step.get("relationships") or {}
            rel_data: dict = rels.get(field) or {}
            pct = rel_data.get("most_recent_percentage")
            former = bool(rel_data.get("former", False))
            last_observed = rel_data.get("last_observed")

            edge_key = (ent_id, prev_id)
            if edge_key not in edge_seen:
                edges.append({
                    "source": ent_id,
                    "target": prev_id,
                    "relationship": field,
                    "percentage": pct,
                    "former": former,
                    "last_observed": last_observed,
                })
                edge_seen.add(edge_key)

            prev_id = ent_id

        # Also process target (may be same as path[-1].entity; dedup handles it)
        target: dict = item.get("target") or {}
        if isinstance(target, dict):
            t_id = target.get("id") or ""
            if t_id and t_id not in nodes_by_id:
                countries = target.get("countries") or []
                nodes_by_id[t_id] = {
                    "id": t_id,
                    "label": target.get("label") or target.get("translated_label"),
                    "translated_label": target.get("translated_label"),
                    "type": target.get("type"),
                    "country": countries[0] if countries else None,
                    "sanctioned": target.get("sanctioned"),
                    "pep": target.get("pep"),
                }

    root_node = nodes_by_id.get(root_id, {})
    sanction_hits = [
        {"id": n["id"], "label": n.get("label")}
        for n in nodes_by_id.values()
        if n.get("sanctioned") and n["id"] != root_id
    ]

    return {
        "root_entity_id": root_id,
        "nodes": list(nodes_by_id.values()),
        "edges": edges,
        "sanction_hits": sanction_hits,
        "explored_count": traversal_data.get("explored_count"),
        "shown": len(items),
        "next": traversal_data.get("next"),
        "partial_results": traversal_data.get("partial_results", False),
    }


# ── Live API fallback ─────────────────────────────────────────────────────────

def _absorb_live(payload: dict, root_id: str, is_upstream: bool,
                 nodes_by_id: dict, edges: list, edge_seen: set) -> None:
    """Extract nodes/edges from a live Sayari traversal/ownership API response."""
    data = payload.get("data") or []
    for rel in data:
        target = rel.get("target") or {}
        source = rel.get("source") or {}
        if isinstance(target, str):
            target = {"id": target}
        if isinstance(source, str):
            source = {"id": source}
        rel_type = rel.get("type") or rel.get("relationship") or ""
        pct = rel.get("percentage") or rel.get("ownership_percentage")
        try:
            pct_f = float(pct) if pct is not None else None
        except (TypeError, ValueError):
            pct_f = None

        tgt_id = target.get("id") or target.get("entity_id") or ""
        src_id = source.get("id") or source.get("entity_id") or root_id

        if tgt_id and tgt_id not in nodes_by_id:
            countries = target.get("countries") or []
            nodes_by_id[tgt_id] = {
                "id": tgt_id,
                "label": target.get("label") or target.get("name") or "",
                "translated_label": target.get("translated_label"),
                "type": target.get("type"),
                "country": countries[0] if countries else None,
                "sanctioned": target.get("sanctioned"),
                "pep": target.get("pep"),
            }
        if tgt_id and src_id:
            src_node = tgt_id if is_upstream else src_id
            tgt_node = src_id if is_upstream else tgt_id
            edge_key = (src_node, tgt_node)
            if edge_key not in edge_seen:
                edges.append({
                    "source": src_node,
                    "target": tgt_node,
                    "relationship": rel_type or None,
                    "percentage": pct_f,
                    "former": False,
                    "last_observed": None,
                })
                edge_seen.add(edge_key)


def _live_traversal(entity_id: str, depth: int, direction: str) -> CitedResult:
    entity_url = f"/v1/entity/{entity_id}"
    nodes_by_id: dict[str, dict] = {
        entity_id: {"id": entity_id, "label": None, "type": None,
                    "country": None, "sanctioned": None, "pep": None}
    }
    edges: list[dict] = []
    edge_seen: set = set()
    explored_count = None

    client = build_client()
    if client is None:
        return CitedResult(
            data={
                "root_entity_id": entity_id,
                "nodes": [], "edges": [], "sanction_hits": [],
                "explored_count": None, "shown": 0, "next": None,
                "partial_results": False,
                "error": "No Sayari credentials — traversal requires a live client.",
            },
            source=SourceCitation(entity_url=entity_url,
                                  api_endpoint="N/A — SAYARI_CLIENT_ID not set"),
        )

    try:
        if direction in ("upstream", "both"):
            payload = to_dict(client.traversal.ubo(id=entity_id, limit=50, max_depth=depth))
            explored_count = payload.get("explored_count")
            _absorb_live(payload, entity_id, True, nodes_by_id, edges, edge_seen)
        if direction in ("downstream", "both"):
            try:
                payload = to_dict(client.traversal.ownership(id=entity_id, limit=50, max_depth=depth))
                _absorb_live(payload, entity_id, False, nodes_by_id, edges, edge_seen)
            except Exception:
                pass
    except Exception as exc:
        return CitedResult(
            data={
                "root_entity_id": entity_id,
                "nodes": [], "edges": [], "sanction_hits": [],
                "explored_count": None, "shown": 0, "next": None,
                "partial_results": False,
                "error": f"Traversal failed: {exc}",
            },
            source=SourceCitation(entity_url=entity_url,
                                  api_endpoint=f"GET /v1/traversal/ubo?id={entity_id}"),
        )

    # Cache result for future use
    _TRAVERSAL_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = _TRAVERSAL_DIR / f"{entity_id}.json"
    try:
        cache_path.write_text(json.dumps({"data": edges, "explored_count": explored_count},
                                         default=str), encoding="utf-8")
    except Exception:
        pass

    sanction_hits = [
        {"id": n["id"], "label": n.get("label")}
        for n in nodes_by_id.values()
        if n.get("sanctioned") and n["id"] != entity_id
    ]

    return CitedResult(
        data={
            "root_entity_id": entity_id,
            "nodes": list(nodes_by_id.values()),
            "edges": edges,
            "sanction_hits": sanction_hits,
            "explored_count": explored_count,
            "shown": len(edges),
            "next": None,
            "partial_results": False,
        },
        source=SourceCitation(
            entity_url=entity_url,
            raw_field_path="data[].{target, path[].{entity, relationships, field}}",
            api_endpoint=f"GET /v1/traversal/ubo?id={entity_id}&max_depth={depth}&limit=50",
        ),
    )


# ── Public tool function ──────────────────────────────────────────────────────

def traverse_ownership_tool(
    entity_id: str,
    depth: int = 3,
    direction: str = "upstream",
    cache=None,  # Optional EntityCache — used for root-node label lookup
) -> CitedResult:
    """
    Walk the ownership graph for entity_id. Cache-first.

    Returns normalized {nodes, edges, sanction_hits, explored_count, shown, next, partial_results}.
    Reads from output/raw/traversal/{entity_id}.json when available; fetches live otherwise.

    The optional `cache` arg (a run-scoped EntityCache) is used to look up the
    root entity's label so the response carries a meaningful name for the
    active run. Without it, the root node renders with label=None.
    """
    raw = _load_traversal_cache(entity_id)
    if raw is not None:
        graph = _transform_traversal(entity_id, raw)
        # Fill the root-node label from the provided cache so a run_id-scoped
        # call cites the right cache_file in the response source. Without this
        # the root carries label=None and the UI shows just the entity_id.
        if cache is not None and graph.get("nodes"):
            try:
                raw_entity = cache.get_entity_raw(entity_id)
                if raw_entity:
                    root_label = raw_entity.get("label") or raw_entity.get("translated_label")
                    root_country = (raw_entity.get("countries") or [None])[0]
                    for n in graph["nodes"]:
                        if n.get("id") == entity_id:
                            if not n.get("label"):
                                n["label"] = root_label
                            if not n.get("translated_label"):
                                n["translated_label"] = raw_entity.get("translated_label")
                            if not n.get("country"):
                                n["country"] = root_country
                            if not n.get("type"):
                                n["type"] = raw_entity.get("type")
                            break
            except Exception:
                pass
        return CitedResult(
            data=graph,
            source=SourceCitation(
                entity_url=f"/v1/entity/{entity_id}",
                raw_field_path="data[].{source, target, path[].{entity, field, relationships}}",
                cache_file=f"output/raw/traversal/{entity_id}.json",
                api_endpoint="GET /v1/traversal/ubo (cached)",
            ),
        )

    # Not cached — try live API
    return _live_traversal(entity_id, depth, direction)
