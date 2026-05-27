"""
Investigations router — persistence + retrieval API.

Endpoints:
  GET  /api/investigations               list all investigations
  GET  /api/investigations/{id}          single investigation detail
  GET  /api/results/{run_id}             all entity results for a run
  GET  /api/results/{run_id}/{entity_id} single entity customer payload
  POST /api/results/{run_id}/{entity_id}/disposition  analyst decision

Postgres (via DATABASE_URL) is primary; falls back to output/investigations_seed.json
so the demo works without a live DB.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

_SEED_PATH = _REPO / "output" / "investigations_seed.json"

router = APIRouter(prefix="/api", tags=["investigations"])


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_conn():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return None
    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(db_url)
        return conn
    except Exception:
        return None


def _load_seed() -> dict:
    if _SEED_PATH.exists():
        return json.loads(_SEED_PATH.read_text(encoding="utf-8"))
    return {"investigations": [], "entity_results": [], "dispositions": []}


# ── Request models ────────────────────────────────────────────────────────────

class DispositionRequest(BaseModel):
    status: str          # pending | cleared | escalated | blocked
    reviewer: str | None = None
    rationale: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/investigations")
def list_investigations():
    """List all investigations with source, status, and outcome counts."""
    conn = _get_conn()
    if conn:
        try:
            import psycopg2.extras
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("""
                SELECT id, source, source_detail, status, created_at, completed_at,
                       total_entities, flagged_count, cleared_count,
                       escalated_count, blocked_count, pending_count
                FROM investigation
                ORDER BY created_at DESC
            """)
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return {"investigations": _format_investigations(rows)}
        except Exception:
            conn.close()

    # JSON fallback
    seed = _load_seed()
    return {"investigations": _format_investigations(seed.get("investigations", []))}


def _format_investigations(rows: list[dict]) -> list[dict]:
    return [
        {
            "id": r["id"],
            "source": r["source"],
            "source_detail": r.get("source_detail"),
            "status": r["status"],
            "created_at": str(r.get("created_at", "")),
            "completed_at": str(r.get("completed_at", "")) if r.get("completed_at") else None,
            "counts": {
                "total": r.get("total_entities", 0),
                "flagged": r.get("flagged_count", 0),
                "cleared": r.get("cleared_count", 0),
                "escalated": r.get("escalated_count", 0),
                "blocked": r.get("blocked_count", 0),
                "pending": r.get("pending_count", 0),
            },
        }
        for r in rows
    ]


@router.get("/investigations/{investigation_id}")
def get_investigation(investigation_id: int):
    """Single investigation with all entity results."""
    conn = _get_conn()
    if conn:
        try:
            import psycopg2.extras
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                "SELECT * FROM investigation WHERE id = %s", (investigation_id,)
            )
            inv = cur.fetchone()
            if not inv:
                conn.close()
                raise HTTPException(status_code=404, detail="Investigation not found")

            cur.execute(
                """SELECT er.*, d.status as disposition_status, d.reviewer, d.rationale,
                          d.created_at as disposition_at
                   FROM entity_result er
                   LEFT JOIN disposition d ON d.entity_result_id = er.id
                   WHERE er.investigation_id = %s
                   ORDER BY er.id""",
                (investigation_id,),
            )
            results = [dict(r) for r in cur.fetchall()]
            conn.close()
            return {**_format_investigations([dict(inv)])[0], "results": results}
        except HTTPException:
            raise
        except Exception:
            if conn:
                conn.close()

    # JSON fallback
    seed = _load_seed()
    investigations = seed.get("investigations", [])
    inv = next((i for i in investigations if i["id"] == investigation_id), None)
    if not inv:
        raise HTTPException(status_code=404, detail="Investigation not found")
    entity_results = [r for r in seed.get("entity_results", [])
                      if r.get("investigation_id") == investigation_id]
    return {**_format_investigations([inv])[0], "results": entity_results}


@router.get("/results/{run_id}")
def list_results(run_id: int, request: Request):
    """All entity results for a screening run."""
    conn = _get_conn()
    if conn:
        try:
            import psycopg2.extras
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """SELECT er.*, d.status as disposition_status, d.reviewer, d.rationale
                   FROM entity_result er
                   LEFT JOIN disposition d ON d.entity_result_id = er.id
                   WHERE er.investigation_id = %s
                   ORDER BY er.id""",
                (run_id,),
            )
            rows = [_format_entity_result(dict(r)) for r in cur.fetchall()]
            conn.close()
            return {"run_id": run_id, "results": rows, "count": len(rows)}
        except Exception:
            if conn:
                conn.close()

    seed = _load_seed()
    entity_results = [r for r in seed.get("entity_results", [])
                      if r.get("investigation_id") == run_id]
    return {"run_id": run_id, "results": entity_results, "count": len(entity_results)}


@router.get("/results/{run_id}/{entity_id}")
def get_entity_result(run_id: int, entity_id: str):
    """
    Customer payload for one entity: resolved + screening + disposition + sources.

    This is the per-entity briefing shape the front-end consumes for entity detail.
    """
    conn = _get_conn()
    result_row = None

    if conn:
        try:
            import psycopg2.extras
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """SELECT er.*, d.status as disposition_status, d.reviewer, d.rationale,
                          d.created_at as disposition_at
                   FROM entity_result er
                   LEFT JOIN disposition d ON d.entity_result_id = er.id
                   WHERE er.investigation_id = %s AND er.entity_id = %s
                   LIMIT 1""",
                (run_id, entity_id),
            )
            row = cur.fetchone()
            conn.close()
            if row:
                result_row = dict(row)
        except Exception:
            if conn:
                conn.close()

    if result_row is None:
        # JSON fallback
        seed = _load_seed()
        for r in seed.get("entity_results", []):
            if r.get("investigation_id") == run_id and r.get("entity_id") == entity_id:
                result_row = r
                break

    if not result_row:
        raise HTTPException(status_code=404, detail="Entity result not found")

    return _format_entity_result(result_row)


def _format_entity_result(r: dict) -> dict:
    """Build the customer payload shape for an entity result."""
    return {
        "entity_id": r.get("entity_id"),
        "input_name": r.get("input_name"),
        "resolved": {
            "entity_id": r.get("entity_id"),
            "label": r.get("match_label"),
            "confidence": "low" if r.get("warn_verify") else "high",
            "entity_url": f"/v1/entity/{r['entity_id']}" if r.get("entity_id") else None,
        },
        "screening": {
            "ofac_sdn": {
                "hit": bool(r.get("ofac_sdn_id")),
                "sdn_id": r.get("ofac_sdn_id"),
                "programs": r.get("ofac_programs") or [],
                "match_name": r.get("ofac_match_name"),
            },
            "ownership_exposure": {
                "has_exposure": bool(r.get("is_ownership_exposed")),
                "factor": r.get("ownership_factor"),
            },
            "other_sanctions": [],  # populated from risk_factors in full profile
            "risk_level": r.get("risk_level", "unknown"),
            "outcome": r.get("outcome"),
            "is_directly_designated": bool(r.get("is_directly_designated")),
        },
        "disposition": {
            "status": r.get("disposition_status", "pending"),
            "reviewer": r.get("reviewer"),
            "rationale": r.get("rationale"),
            "updated_at": str(r.get("disposition_at", "")),
        },
        "sources": [
            {
                "cache_file": f"output/raw/{r['entity_id']}.json" if r.get("entity_id") else None,
                "api_endpoint": "GET /v1/entity/{id} (cached)",
            }
        ],
    }


@router.post("/results/{run_id}/{entity_id}/disposition")
def set_disposition(run_id: int, entity_id: str, req: DispositionRequest):
    """Record analyst decision on an entity result."""
    valid_statuses = {"pending", "cleared", "escalated", "blocked"}
    if req.status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid_statuses}")

    conn = _get_conn()
    if conn:
        try:
            import psycopg2.extras
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            # Find entity_result id
            cur.execute(
                "SELECT id FROM entity_result WHERE investigation_id=%s AND entity_id=%s LIMIT 1",
                (run_id, entity_id),
            )
            row = cur.fetchone()
            if not row:
                conn.close()
                raise HTTPException(status_code=404, detail="Entity result not found")

            er_id = row["id"]

            # Upsert disposition
            cur.execute(
                """INSERT INTO disposition (entity_result_id, status, reviewer, rationale)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (entity_result_id)
                   DO UPDATE SET status=EXCLUDED.status, reviewer=EXCLUDED.reviewer,
                                 rationale=EXCLUDED.rationale, updated_at=now()
                   RETURNING id, status, reviewer, rationale, updated_at""",
                (er_id, req.status, req.reviewer, req.rationale),
            )
            result = dict(cur.fetchone())
            conn.commit()
            conn.close()
            return {"ok": True, "disposition": result}
        except HTTPException:
            raise
        except Exception as exc:
            if conn:
                conn.close()
            raise HTTPException(status_code=500, detail=str(exc))

    # JSON fallback: disposition not persisted without DB
    return {
        "ok": True,
        "disposition": {
            "status": req.status,
            "reviewer": req.reviewer,
            "rationale": req.rationale,
            "note": "Disposition not persisted — DATABASE_URL not set.",
        },
    }
