"""
DB loader: OFAC SDN XML → ofac_sdn table.

Ports the logic from replit_reference/services/sayari-py/app/ofac_refresh.py,
adapted to work with this repo's structure (uses stdlib xml.etree instead of lxml
to avoid an extra dependency).

Usage:
    export DATABASE_URL=postgresql://user:pass@localhost/sentinel
    python db/loaders/load_ofac.py [--xml-path /tmp/sdn.xml]
    # Omit --xml-path to download fresh from OFAC.

Morning task: run this after Postgres is provisioned.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# Re-use the in-memory XML parser from the OFAC matcher module
from services.api.ofac.matcher import stream_entries_from_xml, _download_sdn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sentinel.loader.ofac")

UPSERT_SQL = """
INSERT INTO ofac_sdn (
    sdn_id, primary_name, primary_name_lower, sdn_type,
    programs, aliases, addresses, identifiers,
    list_date, publish_date, fetched_at, removed_at
) VALUES (
    %(sdn_id)s, %(primary_name)s, %(primary_name_lower)s, %(sdn_type)s,
    %(programs)s, %(aliases)s, %(addresses)s, %(identifiers)s,
    %(publish_date)s, %(publish_date)s, %(fetched_at)s, NULL
)
ON CONFLICT (sdn_id) DO UPDATE SET
    primary_name        = EXCLUDED.primary_name,
    primary_name_lower  = EXCLUDED.primary_name_lower,
    sdn_type            = EXCLUDED.sdn_type,
    programs            = EXCLUDED.programs,
    aliases             = EXCLUDED.aliases,
    addresses           = EXCLUDED.addresses,
    identifiers         = EXCLUDED.identifiers,
    publish_date        = EXCLUDED.publish_date,
    fetched_at          = EXCLUDED.fetched_at,
    removed_at          = NULL
"""

UPSERT_BATCH = 250


def _flush(cur, batch: list, fetched_at: dt.datetime, publish_date: dt.datetime | None) -> int:
    if not batch:
        return 0
    params = [
        {
            "sdn_id": e.sdn_id,
            "primary_name": e.primary_name,
            "primary_name_lower": e.primary_name_lower,
            "sdn_type": e.sdn_type,
            "programs": e.programs,
            "aliases": json.dumps([{"name": a} for a in e.aliases]),
            "addresses": "[]",
            "identifiers": "[]",
            "publish_date": publish_date,
            "fetched_at": fetched_at,
        }
        for e in batch
    ]
    cur.executemany(UPSERT_SQL, params)
    return len(batch)


def load_to_db(xml_path: str) -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        log.error("DATABASE_URL not set.")
        sys.exit(1)

    try:
        import psycopg
    except ImportError:
        log.error("psycopg not installed. pip install psycopg[binary]")
        sys.exit(1)

    fetched_at = dt.datetime.now(dt.timezone.utc)
    publish_date = fetched_at  # SDN has a single feed-wide date

    total = 0
    with psycopg.connect(db_url) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                # Collect existing active sdn_ids for soft-delete
                cur.execute("SELECT sdn_id FROM ofac_sdn WHERE removed_at IS NULL")
                existing: set[int] = {r[0] for r in cur.fetchall()}

                batch = []
                seen: set[int] = set()
                for entry in stream_entries_from_xml(xml_path):
                    seen.add(entry.sdn_id)
                    batch.append(entry)
                    if len(batch) >= UPSERT_BATCH:
                        total += _flush(cur, batch, fetched_at, publish_date)
                        batch.clear()
                total += _flush(cur, batch, fetched_at, publish_date)

                if total == 0:
                    raise RuntimeError("Parser yielded zero rows — refusing to soft-delete everything.")

                # Soft-delete entries that disappeared from the feed
                missing = list(existing - seen)
                if missing:
                    cur.execute(
                        "UPDATE ofac_sdn SET removed_at = %s WHERE sdn_id = ANY(%s) AND removed_at IS NULL",
                        (fetched_at, missing),
                    )
                    log.info("Soft-deleted %d entries no longer in feed", cur.rowcount or 0)

    log.info("Done: %d SDN entries upserted.", total)


def main() -> None:
    ap = argparse.ArgumentParser(description="Load OFAC SDN XML into ofac_sdn table.")
    ap.add_argument("--xml-path", type=str, default=None,
                    help="Path to sdn.xml; omit to download fresh.")
    args = ap.parse_args()

    xml_path = args.xml_path
    if xml_path is None:
        import tempfile
        tmp = tempfile.NamedTemporaryFile(prefix="sdn_", suffix=".xml", delete=False)
        tmp.close()
        xml_path = tmp.name
        log.info("Downloading OFAC SDN XML…")
        _download_sdn(xml_path)

    load_to_db(xml_path)


if __name__ == "__main__":
    main()
