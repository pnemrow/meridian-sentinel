"""
db/seed.py — seed 4 investigations into Postgres (or JSON fallback).

Usage:
    python db/seed.py                    # reads DATABASE_URL from env
    DATABASE_URL=postgresql://localhost/sentinel python db/seed.py

Fallback: if Postgres is unavailable, writes output/investigations_seed.json
so the investigation routes can serve demo data without a live DB.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))


# ── Seed data (real outcomes from the compare run) ───────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _ago(days: int = 0, hours: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat()


INVESTIGATIONS = [
    {
        "id": 1,
        "source": "upload",
        "source_detail": "list_1.xlsx",
        "status": "complete",
        "created_at": _ago(days=3),
        "completed_at": _ago(days=3, hours=-1),
        "total_entities": 49,
        "flagged_count": 42,   # sanctioned (45) minus 3 where screen is ambiguous
        "cleared_count": 4,
        "escalated_count": 2,
        "blocked_count": 40,
        "pending_count": 3,
    },
    {
        "id": 2,
        "source": "sftp",
        "source_detail": "/inbound/sftp/may2025_vendors.xlsx",
        "status": "pending",
        "created_at": _ago(hours=4),
        "completed_at": None,
        "total_entities": 0,
        "flagged_count": 0,
        "cleared_count": 0,
        "escalated_count": 0,
        "blocked_count": 0,
        "pending_count": 0,
    },
    {
        "id": 3,
        "source": "upload",
        "source_detail": "emergency_counterparty_check.xlsx",
        "status": "complete",
        "created_at": _ago(days=1),
        "completed_at": _ago(days=1, hours=-2),
        "total_entities": 12,
        "flagged_count": 8,
        "cleared_count": 2,
        "escalated_count": 2,
        "blocked_count": 4,
        "pending_count": 4,
    },
    {
        "id": 4,
        "source": "api",
        "source_detail": "POST /v1/screen via Meridian Risk API",
        "status": "complete",
        "created_at": _ago(days=7),
        "completed_at": _ago(days=7, hours=-3),
        "total_entities": 31,
        "flagged_count": 18,
        "cleared_count": 10,
        "escalated_count": 3,
        "blocked_count": 5,
        "pending_count": 13,
    },
]

# Sample entity results for investigation 1 (top 6 highest-risk entities)
ENTITY_RESULTS_INV1 = [
    {
        "investigation_id": 1,
        "entity_id": "OWwtbp9y51OcLHJQakLaMw",
        "input_name": "Sberbank",
        "match_label": "PJSC Sberbank",
        "outcome": "both_catch",
        "risk_level": "critical",
        "ofac_programs": ["RUSSIA"],
        "ownership_factor": None,
        "direct_factor": "sanctioned_usa_ofac_sdn",
        "ofac_match_name": "SBERBANK OF RUSSIA",
        "ofac_sdn_id": 12765,
        "is_directly_designated": True,
        "is_ownership_exposed": False,
    },
    {
        "investigation_id": 1,
        "entity_id": "dy-rh2g0QtzUN_jC_e9S_A",
        "input_name": "VTB Bank",
        "match_label": "VTB Bank (PJSC)",
        "outcome": "both_catch",
        "risk_level": "critical",
        "ofac_programs": ["RUSSIA"],
        "ownership_factor": None,
        "direct_factor": "sanctioned_usa_ofac_sdn",
        "ofac_match_name": "BANK VTB",
        "ofac_sdn_id": 30714,
        "is_directly_designated": True,
        "is_ownership_exposed": False,
    },
    {
        "investigation_id": 1,
        "entity_id": "BSsUPVlxsICOW4GCjb4fqQ",
        "input_name": "Belorusskaya Kaliynaya Companya",
        "match_label": "Belarusian Potash Company",
        "outcome": "sayari_only",
        "risk_level": "critical",
        "ofac_programs": [],
        "ownership_factor": "owned_by_sanctioned_usa_ofac_sdn_entity",
        "direct_factor": None,
        "ofac_match_name": None,
        "ofac_sdn_id": None,
        "is_directly_designated": False,
        "is_ownership_exposed": True,
    },
    {
        "investigation_id": 1,
        "entity_id": "RqBOnCZOD5pWG-tCf8wr8A",
        "input_name": "Russian Railways",
        "match_label": "JSC Russian Railways",
        "outcome": "sayari_only",
        "risk_level": "critical",
        "ofac_programs": [],
        "ownership_factor": "controlled_by_ofac_sdn",
        "direct_factor": None,
        "ofac_match_name": None,
        "ofac_sdn_id": None,
        "is_directly_designated": False,
        "is_ownership_exposed": True,
    },
    {
        "investigation_id": 1,
        "entity_id": "RZAPsBRdYXTToVqy4ZuNow",
        "input_name": "Gazprom",
        "match_label": "PJSC Gazprom",
        "outcome": "screen_ambiguous",
        "risk_level": "critical",
        "ofac_programs": [],
        "ownership_factor": "owner_of_sanctioned_usa_ofac_sdn_entity",
        "direct_factor": None,
        "ofac_match_name": "GAZPROM NEFT",
        "ofac_sdn_id": 19640,
        "is_directly_designated": False,
        "is_ownership_exposed": True,
    },
    {
        "investigation_id": 1,
        "entity_id": "zqpMddadf94y39RfB3AgcA",
        "input_name": "Kalashnikov Concern",
        "match_label": "JSC Concern Kalashnikov",
        "outcome": "ofac_only",
        "risk_level": "critical",
        "ofac_programs": ["RUSSIA"],
        "ownership_factor": None,
        "direct_factor": None,
        "ofac_match_name": "JSC CONCERN KALASHNIKOV",
        "ofac_sdn_id": 16911,
        "is_directly_designated": False,
        "is_ownership_exposed": False,
    },
]

# Sample dispositions for some entity results
DISPOSITIONS = [
    # entity_result_id 1 (Sberbank) → blocked
    {"entity_result_id": 1, "status": "blocked", "reviewer": "alice.chen@meridian.ch",
     "rationale": "OFAC SDN confirmed. No transactions permitted.", "created_at": _ago(days=2)},
    # entity_result_id 2 (VTB) → blocked
    {"entity_result_id": 2, "status": "blocked", "reviewer": "alice.chen@meridian.ch",
     "rationale": "OFAC SDN confirmed. Blocked.", "created_at": _ago(days=2)},
    # entity_result_id 3 (Belorusskaya) → escalated
    {"entity_result_id": 3, "status": "escalated", "reviewer": "mark.osei@meridian.ch",
     "rationale": "Ownership-exposure via Uralchem (OFAC SDN). Escalated to CCO.", "created_at": _ago(days=2)},
    # entity_result_id 5 (Gazprom) → pending
    {"entity_result_id": 5, "status": "pending", "reviewer": None,
     "rationale": None, "created_at": _ago(days=2)},
]


# ── Postgres loader ───────────────────────────────────────────────────────────

def seed_postgres(db_url: str) -> None:
    import psycopg2
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Investigations
    cur.execute("DELETE FROM disposition; DELETE FROM entity_result; DELETE FROM investigation;")
    for inv in INVESTIGATIONS:
        cur.execute("""
            INSERT INTO investigation
              (id, source, source_detail, status, created_at, completed_at,
               total_entities, flagged_count, cleared_count, escalated_count,
               blocked_count, pending_count)
            VALUES (%(id)s, %(source)s, %(source_detail)s, %(status)s,
                    %(created_at)s, %(completed_at)s, %(total_entities)s,
                    %(flagged_count)s, %(cleared_count)s, %(escalated_count)s,
                    %(blocked_count)s, %(pending_count)s)
        """, inv)

    # Reset sequence
    cur.execute("SELECT setval('investigation_id_seq', (SELECT MAX(id) FROM investigation));")

    # Entity results for investigation 1
    for i, er in enumerate(ENTITY_RESULTS_INV1, start=1):
        er_with_json = {**er, "result_json": json.dumps({k: v for k, v in er.items()})}
        cur.execute("""
            INSERT INTO entity_result
              (investigation_id, entity_id, input_name, match_label, outcome,
               risk_level, ofac_programs, ownership_factor, direct_factor,
               ofac_match_name, ofac_sdn_id, is_directly_designated,
               is_ownership_exposed, result_json)
            VALUES (%(investigation_id)s, %(entity_id)s, %(input_name)s, %(match_label)s,
                    %(outcome)s, %(risk_level)s, %(ofac_programs)s, %(ownership_factor)s,
                    %(direct_factor)s, %(ofac_match_name)s, %(ofac_sdn_id)s,
                    %(is_directly_designated)s, %(is_ownership_exposed)s,
                    %(result_json)s::jsonb)
        """, er_with_json)

    # Dispositions
    for d in DISPOSITIONS:
        cur.execute("""
            INSERT INTO disposition (entity_result_id, status, reviewer, rationale, created_at)
            VALUES (%(entity_result_id)s, %(status)s, %(reviewer)s, %(rationale)s, %(created_at)s)
        """, d)

    conn.commit()
    cur.close()
    conn.close()
    print(f"Seeded {len(INVESTIGATIONS)} investigations, "
          f"{len(ENTITY_RESULTS_INV1)} entity results, "
          f"{len(DISPOSITIONS)} dispositions.")


# ── JSON fallback ─────────────────────────────────────────────────────────────

def seed_json() -> None:
    """Write seed data to output/ as JSON for demo-without-Postgres mode."""
    out_dir = _REPO / "output"
    out_dir.mkdir(exist_ok=True)
    seed = {
        "investigations": INVESTIGATIONS,
        "entity_results": ENTITY_RESULTS_INV1,
        "dispositions": DISPOSITIONS,
    }
    path = out_dir / "investigations_seed.json"
    path.write_text(json.dumps(seed, indent=2, default=str), encoding="utf-8")
    print(f"Wrote JSON seed → {path}")


if __name__ == "__main__":
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        try:
            seed_postgres(db_url)
        except Exception as exc:
            print(f"Postgres seed failed ({exc}), falling back to JSON seed.")
            seed_json()
    else:
        print("DATABASE_URL not set — writing JSON seed.")
        seed_json()
