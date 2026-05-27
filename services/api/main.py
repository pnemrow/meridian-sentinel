"""
Meridian Sentinel — FastAPI service.

Exposes the engine's tool functions over HTTP with a consistent
{data, source} envelope. Every endpoint cites its data source so
the front-end can render source IDs next to every claim.

Startup:
    cd services/api
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Environment variables (optional — omit to run in cache-only mode):
    SAYARI_CLIENT_ID=...
    SAYARI_CLIENT_SECRET=...
    OUTPUT_DIR=../../output          # path to the ground-truth output/ directory
    OFAC_CACHE_DIR=./data            # where sdn.xml is cached
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Path setup ────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import EntityCache

from services.api.tools.resolve_entity import resolve_entity_tool
from services.api.tools.get_profile import get_profile_tool
from services.api.tools.traverse_ownership import traverse_ownership_tool
from services.api.tools.screen_ofac import screen_ofac_tool
from services.api.tools.compare_ofac_vs_sayari import compare_ofac_vs_sayari_tool
from services.api.tools.risk_summary import risk_summary_tool, list_risk_summary_tool
from services.api.tools.generate_briefing import generate_briefing_tool
from services.api.ofac.matcher import OfacMatcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("sentinel.api")

# ── Globals (populated on startup) ───────────────────────────────────────────

_cache: EntityCache | None = None
_ofac_matcher: OfacMatcher | None = None


def _get_cache() -> EntityCache:
    if _cache is None:
        raise HTTPException(status_code=503, detail="Entity cache not ready")
    return _cache


def _get_ofac() -> OfacMatcher | None:
    """Returns None gracefully if OFAC matcher is still loading."""
    return _ofac_matcher


# ── Startup / shutdown ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache, _ofac_matcher

    output_dir = os.environ.get("OUTPUT_DIR", str(_REPO / "output"))
    ofac_cache_dir = os.environ.get("OFAC_CACHE_DIR", str(_HERE / "data"))

    log.info("Loading entity cache from %s", output_dir)
    _cache = EntityCache(output_dir)
    profiles = _cache.all_profiles()
    log.info("Entity cache ready: %d profiles", len(profiles))

    # Load OFAC matcher in a background thread so startup is non-blocking
    def _load_ofac():
        global _ofac_matcher
        try:
            log.info("Loading OFAC SDN matcher (may download ~15 MB XML)…")
            _ofac_matcher = OfacMatcher.load(ofac_cache_dir)
            log.info("OFAC matcher ready: %d entries", len(_ofac_matcher._entries))
        except Exception as exc:
            log.warning("OFAC matcher failed to load: %s — screen_ofac will return empty results", exc)

    threading.Thread(target=_load_ofac, daemon=True).start()

    yield  # app runs

    log.info("Shutdown complete.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Meridian Sentinel API",
    description=(
        "Compliance co-pilot API. Every response includes a `source` object "
        "citing the exact Sayari API endpoint and field path that produced the data."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten for production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / response models ─────────────────────────────────────────────────

class ResolveRequest(BaseModel):
    name: str
    country: str | None = None
    address: str | None = None
    identifier: str | None = None
    limit: int = 5


class TraverseRequest(BaseModel):
    entity_id: str
    depth: int = 3
    direction: str = "upstream"


class BriefingRequest(BaseModel):
    entity_id: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _result(cited) -> dict:
    """Serialise a CitedResult to a plain dict for JSON response."""
    return cited.to_dict()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "cache_ready": _cache is not None,
        "ofac_ready": _ofac_matcher is not None,
        "cached_entities": len(_cache.all_profiles()) if _cache else 0,
        "ofac_entries": len(_ofac_matcher._entries) if _ofac_matcher else 0,
    }


@app.post("/tools/resolve_entity")
def resolve_entity(req: ResolveRequest):
    """Resolve a vendor name to Sayari entity candidates."""
    result = resolve_entity_tool(
        name=req.name,
        country=req.country,
        address=req.address,
        identifier=req.identifier,
        limit=req.limit,
        cache=_get_cache(),
    )
    return _result(result)


@app.get("/tools/get_profile/{entity_id}")
def get_profile(entity_id: str):
    """Get full entity profile from cache or live API."""
    result = get_profile_tool(entity_id=entity_id, cache=_get_cache())
    return _result(result)


@app.post("/tools/traverse_ownership")
def traverse_ownership(req: TraverseRequest):
    """Walk the ownership graph from entity_id."""
    result = traverse_ownership_tool(
        entity_id=req.entity_id,
        depth=req.depth,
        direction=req.direction,
    )
    return _result(result)


@app.get("/tools/screen_ofac")
def screen_ofac(name: str = Query(...), threshold: float = 0.7, limit: int = 5):
    """Screen a name against the OFAC SDN feed."""
    result = screen_ofac_tool(
        name=name,
        threshold=threshold,
        limit=limit,
        ofac_matcher=_get_ofac(),
    )
    return _result(result)


@app.get("/tools/compare_ofac_vs_sayari")
def compare_ofac_vs_sayari(threshold: float = 0.7):
    """Side-by-side OFAC name-screen vs Sayari for all cached entities."""
    result = compare_ofac_vs_sayari_tool(
        cache=_get_cache(),
        ofac_matcher=_get_ofac(),
        threshold=threshold,
    )
    return _result(result)


@app.get("/tools/risk_summary/{entity_id}")
def risk_summary(entity_id: str):
    """Structured risk summary for a single entity."""
    result = risk_summary_tool(entity_id=entity_id, cache=_get_cache())
    return _result(result)


@app.get("/tools/risk_summary")
def list_risk_summary():
    """Aggregate risk summary for the full entity list."""
    result = list_risk_summary_tool(cache=_get_cache())
    return _result(result)


@app.post("/tools/generate_briefing")
def generate_briefing(req: BriefingRequest):
    """Render a compliance briefing PDF (or HTML fallback)."""
    result = generate_briefing_tool(entity_id=req.entity_id, cache=_get_cache())
    return _result(result)


# ── Convenience data endpoints ────────────────────────────────────────────────

@app.get("/entities")
def list_entities():
    """List all cached entities (from entities.csv)."""
    cache = _get_cache()
    profiles = cache.all_profiles()
    return {
        "count": len(profiles),
        "entities": [
            {
                "entity_id": p.entity_id,
                "input_name": p.input_name,
                "match_label": p.match_label,
                "type": p.type,
                "countries": p.countries,
                "sanctioned": p.sanctioned,
                "risk_count": len(p.risk_factors),
                "entity_url": p.entity_url,
            }
            for p in profiles
        ],
        "source": {
            "cache_file": "output/entities.csv + output/raw/*.json",
            "api_endpoint": "cached GET /v1/entity/{id} responses",
        },
    }


@app.get("/summary")
def get_summary():
    """Macro-level risk summary for the full entity list."""
    cache = _get_cache()
    summary = cache.get_summary()
    if summary is None:
        from packages.engine import build_summary
        summary = build_summary(cache.all_profiles())
    return {
        "data": summary,
        "source": {
            "cache_file": "output/summary.json",
            "api_endpoint": "aggregated from cached GET /v1/entity/{id} responses",
        },
    }
