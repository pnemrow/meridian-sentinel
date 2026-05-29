"""
Cache layer — load pre-fetched entity profiles from output/raw/*.json.

This is the core data layer for offline/quota-free operation.  Every cached
file is a real Sayari API response saved during the initial ground-truth run
and is therefore fully auditable back to a specific API call.

Usage:
    from packages.engine.cache import EntityCache
    cache = EntityCache("/path/to/output")
    raw = cache.get_entity("OWwtbp9y51OcLHJQakLaMw")  # returns the raw dict
    profile = cache.get_profile("OWwtbp9y51OcLHJQakLaMw")  # returns a Profile
"""
from __future__ import annotations

import csv
import json
import logging
from pathlib import Path
from typing import Any

from .types import InputEntity, Profile
from .profile import extract_profile

log = logging.getLogger("engine.cache")


class EntityCache:
    """In-memory cache backed by output/raw/*.json files."""

    def __init__(self, output_dir: str | Path):
        self._out = Path(output_dir)
        self._raw_dir = self._out / "raw"
        # entity_id -> raw dict (loaded lazily)
        self._entity_cache: dict[str, dict] = {}
        # input_name -> entity_id (loaded from entities.csv)
        self._name_index: dict[str, str] = {}
        # entity_id -> input_name
        self._id_to_name: dict[str, str] = {}
        # list of all profiles (built lazily on first full_scan call)
        self._profiles: list[Profile] | None = None
        self._load_name_index()

    @property
    def base_dir(self) -> Path:
        """Public accessor for the cache root (output/ for default cache,
        output/runs/{run_id}/ for run-scoped caches). Used by tools that
        need to derive sibling directories like raw/traversal/."""
        return self._out

    # ------------------------------------------------------------------
    # Index
    # ------------------------------------------------------------------

    def _load_name_index(self) -> None:
        """Build name → entity_id index from entities.csv."""
        csv_path = self._out / "entities.csv"
        if not csv_path.exists():
            log.warning("entities.csv not found at %s; name-index will be empty", csv_path)
            return
        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                eid = row.get("entity_id", "").strip()
                name = row.get("input_name", "").strip()
                if eid and name:
                    self._name_index[name.lower()] = eid
                    self._id_to_name[eid] = name
        log.info("EntityCache: loaded %d name→id mappings", len(self._name_index))

    # ------------------------------------------------------------------
    # Raw access
    # ------------------------------------------------------------------

    def entity_ids(self) -> list[str]:
        """Return all entity IDs that have cached profile files."""
        return [p.stem for p in self._raw_dir.glob("*.json") if not p.stem.startswith("row")]

    def get_entity_raw(self, entity_id: str) -> dict | None:
        """Return raw entity profile dict (loaded from cache file)."""
        if entity_id in self._entity_cache:
            return self._entity_cache[entity_id]
        path = self._raw_dir / f"{entity_id}.json"
        if not path.exists():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        self._entity_cache[entity_id] = raw
        return raw

    def get_resolution_raw(self, row_num: int) -> dict | None:
        """Return raw resolution response for input row N."""
        path = self._raw_dir / f"row{row_num}_resolution.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def find_entity_id(self, name: str) -> str | None:
        """Look up entity_id by input name (case-insensitive)."""
        return self._name_index.get(name.lower())

    # ------------------------------------------------------------------
    # Profile access
    # ------------------------------------------------------------------

    def get_profile(self, entity_id: str) -> Profile | None:
        """Build a Profile from cached raw data. Returns None if not cached."""
        raw = self.get_entity_raw(entity_id)
        if raw is None:
            return None
        input_name = self._id_to_name.get(entity_id, entity_id)
        e = InputEntity(row=0, name=input_name)
        # Synthetic match dict — entity_id came from the pinned/resolved run
        match = {"entity_id": entity_id, "label": None, "score": None}
        return extract_profile(e, match, raw)

    def all_profiles(self) -> list[Profile]:
        """Return Profile objects for every cached entity (built once, then cached)."""
        if self._profiles is not None:
            return self._profiles
        profiles = []
        # Load from entities.csv to preserve original ordering and input names
        csv_path = self._out / "entities.csv"
        if csv_path.exists():
            with csv_path.open(newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    eid = row.get("entity_id", "").strip()
                    if not eid:
                        continue
                    raw = self.get_entity_raw(eid)
                    if raw is None:
                        continue
                    input_name = row.get("input_name", eid)
                    e = InputEntity(row=0, name=input_name)
                    match = {"entity_id": eid, "label": None, "score": None}
                    p = extract_profile(e, match, raw)
                    p.input_name = input_name
                    profiles.append(p)
        self._profiles = profiles
        return profiles

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def get_summary(self) -> dict | None:
        summary_path = self._out / "summary.json"
        if not summary_path.exists():
            return None
        return json.loads(summary_path.read_text(encoding="utf-8"))

    def cache_file_path(self, entity_id: str) -> str:
        """Return the relative path to the cache file for source citations."""
        return f"output/raw/{entity_id}.json"
