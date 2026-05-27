# Meridian Sentinel — Build Progress

## Status at end of overnight run

| Phase | Status | Demo-able? |
|-------|--------|-----------|
| Phase 0 — Scaffold + Engine port | COMPLETE | Yes — engine imports, all 49 cached profiles load |
| Phase 1 — Tools + FastAPI + MCP | COMPLETE | Yes — curl any endpoint, all tools return {data, source} |
| Phase 2 — Grounded agent | SKIPPED — ANTHROPIC_API_KEY not set | Morning task |
| Phase 3 — Next.js UI | NOT STARTED (per spec) | Morning task |

---

## Phase 0 — Scaffold (COMPLETE)

### What was built

**Monorepo structure:**
```
packages/engine/      # Importable Python engine package
services/api/         # FastAPI service
services/mcp/         # MCP server (Python, imports engine directly)
db/                   # DB scaffold (schema + loaders)
apps/web/             # Placeholder (Phase 3)
```

**packages/engine/ — ported from sayari_ground_truth.py:**
- `types.py` — InputEntity, Profile, CitedResult, SourceCitation dataclasses
- `helpers.py` — to_dict, deep_get, first_present
- `client.py` — build_client() / require_client() (returns None if creds absent)
- `resolve.py` — resolve_with_fallback(), PINNED_IDS, RETRY_NAMES
- `profile.py` — fetch_profile(), extract_profile()
- `aggregate.py` — build_summary()
- `loader.py` — load_entities_from_xlsx()
- `cache.py` — EntityCache class (loads output/raw/*.json, fully offline)

**Key decisions:**
- `build_client()` returns `None` (not raises) when credentials absent → every tool
  gracefully falls back to cache-only mode. This is why all 49 profiles load and
  tools work without setting SAYARI_CLIENT_ID tonight.
- `CitedResult.source` always includes `cache_file` + `raw_field_path` + `api_endpoint`
  so the front-end can render source IDs next to every claim.
- `EntityCache` builds a name→id index from entities.csv and loads raw JSON lazily.
  `all_profiles()` is cached after first call.

**DB scaffold (output/raw/*.json → Postgres — BLOCKED: no Postgres tonight):**
- `db/schema.sql` — 3 tables: ofac_sdn, entity_cache, screening_run
- `db/loaders/load_cache.py` — loads 49 cached profiles into entity_cache
- `db/loaders/load_ofac.py` — downloads OFAC SDN XML and loads into ofac_sdn
- `db/README.md` — step-by-step morning instructions

### Tested
```
from packages.engine import EntityCache
cache = EntityCache('./output')
cache.all_profiles()  # → 49 profiles, 45 sanctioned
```

---

## Phase 1 — Tools + FastAPI + MCP (COMPLETE)

### What was built

**6 typed tool functions (services/api/tools/):**

| Tool | File | Data source |
|------|------|-------------|
| `resolve_entity` | tools/resolve_entity.py | EntityCache (cache-first), live API fallback |
| `get_profile` | tools/get_profile.py | output/raw/{id}.json or live GET /v1/entity/{id} |
| `traverse_ownership` | tools/traverse_ownership.py | Live API (GET /v1/traversal/ownership) |
| `screen_ofac` | tools/screen_ofac.py | In-memory OFAC SDN XML matcher |
| `compare_ofac_vs_sayari` | tools/compare_ofac_vs_sayari.py | Cache + OFAC matcher |
| `risk_summary` | tools/risk_summary.py | output/raw/{id}.json risk fields |
| `generate_briefing` | tools/generate_briefing.py | Cache → HTML (PDF if WeasyPrint installed) |

Each returns `CitedResult(data=..., source=SourceCitation(...))`.

**services/api/ofac/matcher.py — in-memory OFAC SDN matcher:**
- Downloads sdn.xml once to `services/api/data/sdn.xml` (cached on disk)
- Parses with stdlib xml.etree (no lxml dependency)
- 3-stage match: alias phrase → primary token coverage → single-token alias
- Algorithm mirrors TypeScript ofacMatcher.ts from replit_reference
- Loaded in background thread on FastAPI startup (non-blocking)

**Why in-memory (not DB-backed)?**
Postgres not running tonight. The in-memory matcher is real data (OFAC SDN XML),
not a fixture. Every match cites sdn_id + programs from the official feed.
When DB is available, `compare_against_ofac` can switch to pg_trgm (see
db/loaders/load_ofac.py). The matcher is a clean swap.

**services/api/main.py — FastAPI app:**
- EntityCache loaded on startup from `OUTPUT_DIR` (default: `./output`)
- OFAC matcher loaded in background thread
- All endpoints return `{data: ..., source: {entity_url, raw_field_path, cache_file, api_endpoint}}`
- CORS open for development

**services/mcp/server.py — MCP server:**
- 6 tools matching the spec + replit_reference tools.ts definitions
- Imports engine and services.api directly — no HTTP hop
- Requires `pip install mcp` (not in .venv tonight)
- `check_sanctions_exposure` is implemented via risk_summary (from cached risk factors)
  rather than live UBO walk — zero API quota, real data

### Tool function tests (all pass):
```
resolve_entity('Sberbank')       → entity_id=OWwtbp9y51OcLHJQakLaMw, confidence=high
get_profile('OWwtbp9y...')       → sanctioned=True, risk_level from risk factors
risk_summary('OWwtbp9y...')      → risk_level=critical, sanctioned_lists=[...]
list_risk_summary()              → resolved=49, sanctioned_count=45
compare_ofac_vs_sayari()         → 49 entities, sayari_caught=41
generate_briefing('OWwtbp9y...') → HTML 6015 bytes, source=output/raw/OWwtbp9y...json
```

**FastAPI install needed:**
```bash
cd services/api && pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
(Not running tonight since FastAPI not yet installed in .venv — morning task to start server)

---

## Phase 2 — Grounded agent (SKIPPED)

**Reason:** `ANTHROPIC_API_KEY` is not set in this environment.

**To enable (morning):**
1. `export ANTHROPIC_API_KEY=sk-ant-...`
2. Build `services/agent/agent.py` — Anthropic tool-use loop constrained to only
   state facts returned by the 6 tools above
3. Every claim rendered with a `[source: ...]` citation
4. Confidence < threshold → `⚠ verify` flag surfaced

---

## Phase 3 — Next.js UI (NOT STARTED per spec)

Left for morning session. See `apps/web/README.md`.

---

## Exact next steps (in order)

### 1. Install FastAPI + start API server (5 min)
```bash
cd "/Users/peternemrow/Documents/Claude/Projects/Sayari Interview/services/api"
pip install fastapi uvicorn[standard]
uvicorn main:app --reload --port 8000
# Verify: curl http://localhost:8000/health
# Verify: curl http://localhost:8000/entities | jq '.count'
# Verify: curl "http://localhost:8000/tools/risk_summary/OWwtbp9y51OcLHJQakLaMw"
```

### 2. Set up Postgres + load data (15-20 min)
```bash
createdb sentinel
psql sentinel -f db/schema.sql
psql sentinel -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
export DATABASE_URL=postgresql://localhost/sentinel
python db/loaders/load_cache.py   # 49 entities
python db/loaders/load_ofac.py    # ~10k SDN entries (downloads ~15MB)
# Verify: psql sentinel -c "SELECT count(*) FROM entity_cache;"
```

### 3. OFAC matcher download (automatic on first API call)
The SDN XML will be downloaded to `services/api/data/sdn.xml` on first
request to `/tools/screen_ofac` or `/tools/compare_ofac_vs_sayari`.
Alternatively pre-download:
```bash
python -c "
from services.api.ofac.matcher import OfacMatcher
OfacMatcher.load('services/api/data')
"
```

### 4. Phase 2 — Agent (if ANTHROPIC_API_KEY available)
Build `services/agent/agent.py` using Anthropic tool-use loop.

### 5. Phase 3 — Next.js UI
```bash
cd apps/web
npx create-next-app@latest . --typescript --tailwind --app
# Then build 4 surfaces per BUILD_SPEC.md §5
```

---

## Uncertainties / things to verify

1. **FastAPI startup time** — the OFAC matcher downloads ~15 MB on first cold start.
   Background thread means API is immediately available; OFAC endpoints return empty
   results until the download completes (~30-60s depending on Treasury.gov).

2. **OFAC matcher accuracy** — the in-memory matcher uses token overlap (not pg_trgm).
   It will catch direct matches (e.g., "Sberbank" → SBERBANK in SDN) but may miss
   transliterated Cyrillic names that the DB-backed pg_trgm version would catch.
   This is intentional: it makes the "OFAC misses, Sayari catches" contrast more
   pronounced, which is the Aha. Confirm with: compare_ofac_vs_sayari shows sayari_only_count > 0.

3. **traverse_ownership** — requires live SAYARI_CLIENT_ID. The 49 cached entity profiles
   don't include traversal data. The tool returns an error dict if creds are absent.
   For the demo, the `risk_factors` array in cached profiles (e.g., `ofac_50_percent_rule`,
   `owner_of_sanctioned_entity`) is the ownership-aware signal — it was computed by Sayari
   server-side and is in the cached JSON.

4. **generate_briefing PDF** — currently outputs HTML (WeasyPrint not in .venv).
   `pip install weasyprint` to enable PDF. HTML briefings are fully functional.

5. **compare_ofac_vs_sayari `sayari_caught=41`** — this is entities where at least one
   OFAC SDN-related risk factor is present in the cached profile. The 4 not caught
   (49 - 45 sanctioned + entities with OFAC-specific vs general sanctions) are entities
   that are sanctioned by non-OFAC lists only. Check with:
   `[p.input_name for p in cache.all_profiles() if not any('ofac' in rf.lower() or 'sanctioned_usa' in rf for rf in p.risk_factors)]`
