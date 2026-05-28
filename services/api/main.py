"""
Meridian Sentinel — FastAPI service.

Exposes the engine's tool functions over HTTP with a consistent
{data, source} envelope. Every endpoint cites its data source so
the front-end can render source IDs next to every claim.

Startup:
    cd services/api
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Environment variables:
    SAYARI_CLIENT_ID=...         (optional — omit for cache-only mode)
    SAYARI_CLIENT_SECRET=...     (optional)
    ANTHROPIC_API_KEY=...        (required for /agent/ask in LIVE mode)
    DATABASE_URL=postgresql://localhost/sentinel   (optional — falls back to JSON seed)
    OUTPUT_DIR=../../output      (path to the ground-truth output/ directory)
    OFAC_CACHE_DIR=./data        (where sdn.xml is cached)
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Path setup ────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# Load .env from repo root (override=True so newly populated values win over
# previously-empty shell exports; no-op if file missing or python-dotenv absent)
try:
    from dotenv import load_dotenv  # type: ignore[import]
    load_dotenv(_REPO / ".env", override=True)
except ImportError:
    pass

from packages.engine import EntityCache

from services.api.tools.resolve_entity import resolve_entity_tool
from services.api.tools.get_profile import get_profile_tool
from services.api.tools.traverse_ownership import traverse_ownership_tool
from services.api.tools.screen_ofac import screen_ofac_tool
from services.api.tools.compare_ofac_vs_sayari import compare_ofac_vs_sayari_tool
from services.api.tools.risk_summary import risk_summary_tool, list_risk_summary_tool
from services.api.tools.generate_briefing import generate_briefing_tool
from services.api.ofac.matcher import OfacMatcher
from services.api.routers.investigations import router as investigations_router

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
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",    # Next.js dev
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "*",                        # tighten for production
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(investigations_router)


# ── Static front-end (design-prototype mounted at /ui/) ──────────────────────
_FRONTEND_DIR = _REPO / "design-prototype"
if _FRONTEND_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="ui")

    from fastapi.responses import RedirectResponse

    @app.get("/", include_in_schema=False)
    def _root_redirect():
        return RedirectResponse(url="/ui/")


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


class AgentRequest(BaseModel):
    question: str
    mode: str = "live"       # "live" | "cached"
    run_id: str | None = None  # for CACHED: specific golden run to replay


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
        "agent_ready": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "db_ready": bool(os.environ.get("DATABASE_URL")),
        "cached_entities": len(_cache.all_profiles()) if _cache else 0,
        "ofac_entries": len(_ofac_matcher._entries) if _ofac_matcher else 0,
    }


# ── Agent endpoint ────────────────────────────────────────────────────────────

@app.post("/agent/ask")
async def agent_ask(req: AgentRequest):
    """
    Grounded streaming co-pilot. Returns Server-Sent Events.

    SSE event protocol:
      token       — text chunk from the model
      tool_call   — tool invocation {id, name, input}
      tool_result — tool result {id, name, duration_ms, ok, summary, source}
      citation    — source citation {ref, label, source}
      flag        — verify flag {kind, entity_id, reason}
      answer_meta — {confidence, sources_count, tools_used}
      done        — stream end
      error       — {message}

    mode=live    → calls Anthropic API + executes real tools (ANTHROPIC_API_KEY required)
    mode=cached  → replays captured golden run from output/agent_runs/{run_id}.json
    """
    cache = _get_cache()
    ofac = _get_ofac()

    from services.api.agent.runner import run_agent_live, run_agent_cached

    if req.mode == "cached":
        stream = run_agent_cached(question=req.question, run_id=req.run_id)
    else:
        stream = run_agent_live(
            question=req.question,
            cache=cache,
            ofac_matcher=ofac,
            capture=False,
        )

    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/agent/capture")
async def agent_capture():
    """
    Run all 4 golden questions live and save their event streams to
    output/agent_runs/golden_00{1-4}.json. Requires ANTHROPIC_API_KEY.
    """
    cache = _get_cache()
    ofac = _get_ofac()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not set")

    from services.api.agent.runner import capture_golden_runs
    import asyncio

    # Run capture in background task
    async def _run():
        await capture_golden_runs(cache, ofac)

    asyncio.create_task(_run())
    return {"status": "capturing", "message": "Golden runs starting in background. Check output/agent_runs/."}


# ── Tool endpoints ─────────────────────────────────────────────────────────────

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


@app.get("/tools/raw_profile/{entity_id}")
def raw_profile(entity_id: str):
    """
    Return the cached raw Sayari API response for an entity. Exposes the
    fields the Profile dataclass omits (identifiers, the source_count map,
    full risk metadata) so the front-end can render Identity Evidence and
    feed-broken-down Sources without inventing data.
    """
    cache = _get_cache()
    try:
        raw = cache.get_entity_raw(entity_id)
    except (FileNotFoundError, KeyError):
        raw = None
    if raw is None:
        raise HTTPException(404, f"No cached raw profile for {entity_id}")
    return {
        "data": raw,
        "source": {
            "entity_url": f"/v1/entity/{entity_id}",
            "raw_field_path": "data",
            "cache_file": cache.cache_file_path(entity_id),
            "api_endpoint": "GET /v1/entity/{id} (cached)",
        },
    }


@app.post("/tools/traverse_ownership")
def traverse_ownership(req: TraverseRequest):
    """Walk the ownership graph from entity_id. Cache-first for 8 marquee entities."""
    result = traverse_ownership_tool(
        entity_id=req.entity_id,
        depth=req.depth,
        direction=req.direction,
    )
    return _result(result)


@app.get("/tools/screen_ofac")
def screen_ofac(name: str = Query(...), threshold: float = 0.85, limit: int = 5):
    """Screen a name against the OFAC SDN feed."""
    result = screen_ofac_tool(
        name=name,
        threshold=threshold,
        limit=limit,
        ofac_matcher=_get_ofac(),
    )
    return _result(result)


@app.get("/tools/compare_ofac_vs_sayari")
def compare_ofac_vs_sayari(threshold: float = 0.85):
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
    """Render a compliance briefing (HTML; PDF if WeasyPrint installed)."""
    result = generate_briefing_tool(entity_id=req.entity_id, cache=_get_cache())
    return _result(result)


@app.get("/tools/generate_briefing/{entity_id}/download")
def generate_briefing_download(entity_id: str):
    """
    Stream the briefing back as an attachment for the browser to download.
    Returns application/pdf when WeasyPrint is available, text/html otherwise.
    The browser's filename is derived from the entity_id.
    """
    result = generate_briefing_tool(entity_id=entity_id, cache=_get_cache())
    data = result.data
    if data.get("format") == "pdf":
        path = Path(data["pdf_path"])
        return FileResponse(
            path,
            media_type="application/pdf",
            filename=f"meridian-sentinel-briefing-{entity_id}.pdf",
        )
    # HTML fallback (no WeasyPrint)
    path = Path(data["html_path"])
    return FileResponse(
        path,
        media_type="text/html",
        filename=f"meridian-sentinel-briefing-{entity_id}.html",
    )


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
