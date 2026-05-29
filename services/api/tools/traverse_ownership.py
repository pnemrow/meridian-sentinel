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


# ── Shared node/edge absorbers ───────────────────────────────────────────────
# The cached UBO JSON and the live Sayari traversal API return the same nested
# shape: `data[].path[].entity` walking from root toward a `target` at the end.
# Both `_transform_traversal` (cache) and `_absorb_live` (live API) use the
# same step-by-step walker so they stay in lockstep.

def _absorb_path_step(step: dict, prev_id: str,
                      nodes_by_id: dict, edges: list, edge_seen: set) -> str:
    """
    Absorb one entity in a traversal path: register the node, build the edge
    `entity → prev_id` (entity is the owner of prev_id). Returns the entity_id
    so the caller can advance `prev_id` for the next step.

    Returns prev_id unchanged if the step is unusable (no entity id).
    """
    ent = step.get("entity") or {}
    ent_id = ent.get("id") or ""
    if not ent_id:
        return prev_id

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

    field = step.get("field") or "has_shareholder"
    rel_data = (step.get("relationships") or {}).get(field) or {}

    edge_key = (ent_id, prev_id)
    if edge_key not in edge_seen:
        edges.append({
            "source": ent_id,
            "target": prev_id,
            "relationship": field,
            "percentage": rel_data.get("most_recent_percentage"),
            "former": bool(rel_data.get("former", False)),
            "last_observed": rel_data.get("last_observed"),
        })
        edge_seen.add(edge_key)
    return ent_id


def _absorb_target(target: dict, nodes_by_id: dict) -> None:
    """Register the path's `target` node (often == path[-1].entity; dedupe by id)."""
    if not isinstance(target, dict):
        return
    t_id = target.get("id") or ""
    if not t_id or t_id in nodes_by_id:
        return
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


# ── Cache-based transform ─────────────────────────────────────────────────────

def _load_traversal_cache(entity_id: str, cache_dir: Path | None = None) -> dict | None:
    """Try to load pre-fetched traversal JSON.

    Search order:
      1. {cache_dir}/raw/traversal/{id}{suffix}.json — run-scoped cache, if a
         run cache_dir was provided (e.g. output/runs/run_20260528_.../)
      2. _TRAVERSAL_DIR/{id}{suffix}.json              — default cache at
         output/raw/traversal/

    Checks the `_ubo` suffix as a secondary file for historical Sukhoi-style
    pre-fetched UBO traversals.
    """
    search_dirs: list[Path] = []
    if cache_dir is not None:
        per_run = Path(cache_dir) / "raw" / "traversal"
        if per_run != _TRAVERSAL_DIR:
            search_dirs.append(per_run)
    search_dirs.append(_TRAVERSAL_DIR)

    for d in search_dirs:
        for suffix in ("", "_ubo"):
            path = d / f"{entity_id}{suffix}.json"
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
        prev_id = root_id
        for step in item.get("path", []) or []:
            prev_id = _absorb_path_step(step, prev_id, nodes_by_id, edges, edge_seen)
        _absorb_target(item.get("target"), nodes_by_id)

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
    """Extract nodes/edges from a live Sayari traversal/ownership API response.

    The live API returns the same nested `data[].path[].entity` shape as the
    cached JSON — earlier versions of this function assumed a flat
    `data[].target / source` shape, which is why live-fetched ownership graphs
    rendered with only the root node. Now mirrors `_transform_traversal` via
    the shared `_absorb_path_step` / `_absorb_target` helpers.

    `is_upstream` is kept in the signature for call-site compatibility; the
    walker already produces owner→owned edges, so upstream vs downstream is
    just a matter of which Sayari endpoint the caller queried.
    """
    items = payload.get("data") or []
    for item in items:
        prev_id = root_id
        for step in item.get("path", []) or []:
            prev_id = _absorb_path_step(step, prev_id, nodes_by_id, edges, edge_seen)
        _absorb_target(item.get("target"), nodes_by_id)


def _live_traversal(entity_id: str, depth: int, direction: str,
                    cache_dir: Path | None = None) -> CitedResult:
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

    # Hold the raw Sayari payload so we can persist it verbatim on success —
    # that way the next call cache-hits via _transform_traversal exactly the
    # same way as the pre-fetched marquee entities.
    raw_upstream_payload: dict | None = None

    try:
        if direction in ("upstream", "both"):
            raw_upstream_payload = to_dict(client.traversal.ubo(id=entity_id, limit=50, max_depth=depth))
            explored_count = raw_upstream_payload.get("explored_count")
            _absorb_live(raw_upstream_payload, entity_id, True, nodes_by_id, edges, edge_seen)
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

    # Persist the RAW Sayari upstream payload (the path-nested shape) so the
    # next call cache-hits via _transform_traversal and produces the same
    # nodes/edges. Previous versions wrote the *normalised* edges array under
    # the "data" key, which then failed to re-parse via the path walker.
    #
    # When cache_dir is provided (run-scoped), the file lands at
    # {cache_dir}/raw/traversal/{id}.json so each upload's traversals stay
    # alongside the entity profiles they go with. Otherwise it falls back to
    # the default _TRAVERSAL_DIR (output/raw/traversal/) — list_1's home.
    if raw_upstream_payload is not None:
        write_dir = (
            Path(cache_dir) / "raw" / "traversal"
            if cache_dir is not None else _TRAVERSAL_DIR
        )
        write_dir.mkdir(parents=True, exist_ok=True)
        cache_path = write_dir / f"{entity_id}.json"
        try:
            cache_path.write_text(
                json.dumps(raw_upstream_payload, default=str, ensure_ascii=False),
                encoding="utf-8",
            )
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
    active run. It also drives the per-run traversal cache search/write — the
    loader checks `{cache.base_dir}/raw/traversal/{id}.json` before falling
    back to the default `output/raw/traversal/{id}.json`.
    """
    cache_dir = cache.base_dir if cache is not None else None
    raw = _load_traversal_cache(entity_id, cache_dir=cache_dir)
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
        # Cache citation: prefer the run-scoped path when the file actually
        # lives there, so source links resolve to the file that was read.
        cache_file = f"output/raw/traversal/{entity_id}.json"
        if cache_dir is not None:
            per_run = Path(cache_dir) / "raw" / "traversal" / f"{entity_id}.json"
            if per_run.exists():
                # Repo-relative path for the front-end's source link
                try:
                    cache_file = str(per_run.relative_to(_REPO))
                except ValueError:
                    cache_file = str(per_run)
        return CitedResult(
            data=graph,
            source=SourceCitation(
                entity_url=f"/v1/entity/{entity_id}",
                raw_field_path="data[].{source, target, path[].{entity, field, relationships}}",
                cache_file=cache_file,
                api_endpoint="GET /v1/traversal/ubo (cached)",
            ),
        )

    # Not cached — try live API (writes to per-run dir if cache_dir is set)
    return _live_traversal(entity_id, depth, direction, cache_dir=cache_dir)
