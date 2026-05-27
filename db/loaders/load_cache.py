"""
DB loader: output/raw/*.json → entity_cache table.

Run this AFTER Postgres is set up and schema.sql has been applied.
Reads every cached Sayari API response and upserts it into entity_cache
so the demo can run SELECT queries against real data.

Usage:
    export DATABASE_URL=postgresql://user:pass@localhost/sentinel
    python db/loaders/load_cache.py [--output-dir ./output]

Morning task: run this after Postgres is provisioned.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import EntityCache, InputEntity, extract_profile

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sentinel.loader.cache")

UPSERT_SQL = """
INSERT INTO entity_cache (
    entity_id, input_name, match_label, match_score, name_mismatch_flag,
    entity_type, countries, sanctioned, pep, risk_factors,
    degree, source_count, entity_url, raw_json, cached_at
) VALUES (
    %(entity_id)s, %(input_name)s, %(match_label)s, %(match_score)s, %(name_mismatch_flag)s,
    %(entity_type)s, %(countries)s, %(sanctioned)s, %(pep)s, %(risk_factors)s,
    %(degree)s, %(source_count)s, %(entity_url)s, %(raw_json)s, now()
)
ON CONFLICT (entity_id) DO UPDATE SET
    input_name          = EXCLUDED.input_name,
    match_label         = EXCLUDED.match_label,
    match_score         = EXCLUDED.match_score,
    name_mismatch_flag  = EXCLUDED.name_mismatch_flag,
    entity_type         = EXCLUDED.entity_type,
    countries           = EXCLUDED.countries,
    sanctioned          = EXCLUDED.sanctioned,
    pep                 = EXCLUDED.pep,
    risk_factors        = EXCLUDED.risk_factors,
    degree              = EXCLUDED.degree,
    source_count        = EXCLUDED.source_count,
    entity_url          = EXCLUDED.entity_url,
    raw_json            = EXCLUDED.raw_json,
    cached_at           = now()
"""


def load_to_db(output_dir: Path) -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        log.error("DATABASE_URL not set — cannot load to DB. Set it and re-run.")
        sys.exit(1)

    try:
        import psycopg
    except ImportError:
        log.error("psycopg not installed. pip install psycopg[binary]")
        sys.exit(1)

    cache = EntityCache(output_dir)
    profiles = cache.all_profiles()
    log.info("Loaded %d profiles from cache", len(profiles))

    inserted = 0
    errors = 0

    with psycopg.connect(db_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                for p in profiles:
                    if not p.entity_id:
                        continue
                    raw = cache.get_entity_raw(p.entity_id)
                    if raw is None:
                        continue
                    try:
                        cur.execute(UPSERT_SQL, {
                            "entity_id": p.entity_id,
                            "input_name": p.input_name,
                            "match_label": p.match_label,
                            "match_score": float(p.match_score) if p.match_score is not None else None,
                            "name_mismatch_flag": bool(p.name_mismatch_flag),
                            "entity_type": p.type,
                            "countries": p.countries,
                            "sanctioned": p.sanctioned,
                            "pep": p.pep,
                            "risk_factors": p.risk_factors,
                            "degree": p.degree,
                            "source_count": p.source_count,
                            "entity_url": p.entity_url,
                            "raw_json": json.dumps(raw),
                        })
                        inserted += 1
                    except Exception as exc:
                        log.warning("Failed to insert %s: %s", p.entity_id, exc)
                        errors += 1

    log.info("Done: %d inserted/updated, %d errors", inserted, errors)


def main() -> None:
    ap = argparse.ArgumentParser(description="Load cached Sayari data into entity_cache table.")
    ap.add_argument("--output-dir", type=Path, default=_REPO / "output")
    args = ap.parse_args()
    load_to_db(args.output_dir)


if __name__ == "__main__":
    main()
