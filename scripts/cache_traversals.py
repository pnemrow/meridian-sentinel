#!/usr/bin/env python3
"""
cache_traversals.py — one-off ownership-traversal cache builder

Walks each run's entities.csv, POSTs to the running backend's
/tools/traverse_ownership for every entity_id, and lets the backend write
the per-entity ownership JSON to the appropriate raw/traversal/ directory.

After Phase B of the traversal-loader rewrite, passing ?run_id=<id> on the
POST makes the backend's _live_traversal write the cache file into
output/runs/{run_id}/raw/traversal/{entity_id}.json (run-scoped) rather
than into output/raw/traversal/ (default).

Usage:
    python scripts/cache_traversals.py

Requirements:
    - Backend running on localhost:8000 (PYTHONPATH=. .venv/bin/uvicorn services.api.main:app --port 8000)
    - SAYARI_CLIENT_ID + SAYARI_CLIENT_SECRET in .env (must be valid; this
      hits the live Sayari API ~90 times, rate-limited to 1 req/sec)

Idempotent: skips entities whose cache file already exists and is non-trivial.
"""
import csv
import json
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BACKEND = "http://localhost:8000"


def cache_for(run_dir: Path, traversal_dir: Path, run_id: str | None = None) -> None:
    """Walk run_dir/entities.csv and POST traverse_ownership for each row.

    When run_id is set, the request is scoped to that run so the backend
    writes the cache file into the run-scoped traversal_dir. When run_id is
    None, the backend uses the default cache at output/raw/traversal/.
    """
    entities_csv = run_dir / "entities.csv"
    if not entities_csv.exists():
        print(f"  no entities.csv at {entities_csv}")
        return

    with entities_csv.open() as f:
        rows = list(csv.DictReader(f))

    total = 0
    cached = 0
    skipped = 0
    failed = 0
    for row in rows:
        eid = row.get("entity_id", "").strip()
        if not eid:
            continue
        total += 1
        out = traversal_dir / f"{eid}.json"
        if out.exists() and out.stat().st_size > 100:
            skipped += 1
            continue

        url = f"{BACKEND}/tools/traverse_ownership"
        if run_id:
            url += f"?run_id={run_id}"
        body = json.dumps({"entity_id": eid, "depth": 3}).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            resp_bytes = urllib.request.urlopen(req, timeout=60).read()
            data = json.loads(resp_bytes).get("data", {}) or {}
            nodes_n = len(data.get("nodes") or [])
            edges_n = len(data.get("edges") or [])
            if "error" in data:
                print(f"  ! {eid}: backend reported error: {data['error']}")
                failed += 1
            else:
                cached += 1
                print(f"  ✓ {eid}: {nodes_n} nodes, {edges_n} edges  ({row.get('input_name','')[:48]})")
        except Exception as exc:
            failed += 1
            print(f"  ✗ {eid}: {exc}")

        # Self-heal: if the loader cache-hit returned data from the DEFAULT
        # dir (because a stale file already exists at output/raw/traversal/),
        # the backend won't have written into the per-run dir. Copy it now so
        # the per-run cache is self-contained.
        default_file = REPO / "output" / "raw" / "traversal" / f"{eid}.json"
        if (run_id is not None
                and not out.exists()
                and default_file.exists()
                and default_file.stat().st_size > 100):
            try:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(default_file.read_bytes())
                print(f"    ↳ copied from default dir into per-run cache")
            except Exception as exc:
                print(f"    ↳ copy failed: {exc}")

        # Sayari rate limit — one request per second, conservatively
        time.sleep(1.1)

    print(f"  total: {total} entities · {cached} newly cached · {skipped} already cached · {failed} failed")


def main() -> int:
    # ── list_1 (default cache at output/) ─────────────────────────────────
    print("Caching list_1 traversals (output/raw/traversal/)...")
    cache_for(
        run_dir=REPO / "output",
        traversal_dir=REPO / "output" / "raw" / "traversal",
        run_id=None,
    )

    # ── list_3 (run-scoped cache at output/runs/{run_id}/raw/traversal/) ──
    # Hardcoded for the pinned demo run. Generalize to all output/runs/* if
    # future demos need broader coverage.
    list3_run_id = "run_20260528_040151_71d93a"
    list3_run_dir = REPO / "output" / "runs" / list3_run_id
    if list3_run_dir.exists():
        print(f"\nCaching list_3 traversals ({list3_run_dir.relative_to(REPO)}/raw/traversal/)...")
        cache_for(
            run_dir=list3_run_dir,
            traversal_dir=list3_run_dir / "raw" / "traversal",
            run_id=list3_run_id,
        )
    else:
        print(f"\nlist_3 run_dir not found: {list3_run_dir} — skipping")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
