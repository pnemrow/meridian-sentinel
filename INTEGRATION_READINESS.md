# Meridian Sentinel — Integration Readiness

Backend is running at `http://localhost:8000`. Wire the imported Next.js design to
these endpoints — every field, shape, and curl is verified against the live server.

---

## Quick start

```bash
make install      # pip install -r services/api/requirements.txt into .venv
make run          # uvicorn on port 8000 (cache-only, no credentials needed)
# or
make up           # docker compose: Postgres + API
make seed         # load 4 seed investigations into Postgres
```

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | `/agent/ask` LIVE mode | Grounded co-pilot |
| `SAYARI_CLIENT_ID` + `SAYARI_CLIENT_SECRET` | live API fallback only | Cache-only mode works without |
| `DATABASE_URL` | optional | `postgresql://sentinel:sentinel@localhost:5432/sentinel` — falls back to `output/investigations_seed.json` |
| `OUTPUT_DIR` | optional | default `./output` |
| `OFAC_CACHE_DIR` | optional | default `./services/api/data` |

---

## Health check

```
GET /health
```

```json
{
  "status": "ok",
  "cache_ready": true,
  "ofac_ready": true,
  "agent_ready": true,
  "db_ready": true,
  "cached_entities": 49,
  "ofac_entries": 17207
}
```

```bash
curl http://localhost:8000/health
```

---

## 1. Agent co-pilot — POST /agent/ask (SSE)

**The core demo endpoint.** Returns `text/event-stream`.

**Request:**
```json
{ "question": "Which of these can't we onboard, and why?", "mode": "live" }
```

| Field | Values | Notes |
|-------|--------|-------|
| `question` | any string | NL compliance question |
| `mode` | `"live"` \| `"cached"` | live = Anthropic + tools; cached = replays golden run |
| `run_id` | `"golden_001"` … `"golden_004"` | only for mode=cached, to pick a specific run |

**SSE event protocol** (each line: `data: {json}\n\n`):

```
{"event": "token",       "data": "Based on "}
{"event": "tool_call",   "data": {"id": "toolu_01...", "name": "compare_ofac_vs_sayari", "input": {"threshold": 0.85}}}
{"event": "tool_result", "data": {"id": "toolu_01...", "name": "compare_ofac_vs_sayari", "duration_ms": 412, "ok": true, "summary": "33 both_catch, 4 ownership_gap, 3 matcher_miss — 40 total OFAC exposed", "source": {"cache_file": "output/raw/*.json", "api_endpoint": "..."}}}
{"event": "citation",    "data": {"ref": "toolu_01...", "label": "compare_ofac_vs_sayari", "source": {"cache_file": "...", "api_endpoint": "..."}}}
{"event": "flag",        "data": {"kind": "verify", "entity_id": "abc123", "reason": "Low-confidence resolution for ..."}}
{"event": "answer_meta", "data": {"confidence": "high", "sources_count": 3, "tools_used": ["compare_ofac_vs_sayari", "risk_summary"]}}
{"event": "done",        "data": {}}
{"event": "error",       "data": {"message": "ANTHROPIC_API_KEY not set."}}
```

**Golden runs (mode=cached):**

| run_id | Question |
|--------|---------|
| `golden_001` | Which of these entities can't we onboard, and why? |
| `golden_002` | Show me the ownership structure for Sberbank and explain the risk. |
| `golden_003` | How many entities does OFAC name-screening catch vs Sayari? What's the gap? |
| `golden_004` | Which entity has the highest risk, and what specifically makes it dangerous? |

Keyword matching also works: questions containing "onboard", "ownership", "ofac catch", "sberbank", "highest risk", etc. auto-route to the correct golden run.

```bash
curl -X POST http://localhost:8000/agent/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"Which entities cant we onboard?","mode":"cached"}' \
  --no-buffer
```

**POST /agent/capture** — trigger live capture of all 4 golden runs:
```bash
curl -X POST http://localhost:8000/agent/capture
# Saves to output/agent_runs/golden_00{1-4}.json in background
```

---

## 2. Ownership graph — POST /tools/traverse_ownership

**Request:**
```json
{ "entity_id": "OWwtbp9y51OcLHJQakLaMw", "depth": 3, "direction": "upstream" }
```

**Response shape:**
```json
{
  "data": {
    "root_entity_id": "OWwtbp9y51OcLHJQakLaMw",
    "nodes": [
      { "entity_id": "OWwtbp9y51OcLHJQakLaMw", "name": null, "type": null, "country": null, "sanctioned": null, "pep": null, "is_root": true },
      { "entity_id": "yfUUY8kigJGVQ8KJ6vy3UQ", "name": "OPEN JOINT STOCK COMPANY BPS-SBERBANK", "type": "Company", "country": "BLR", "sanctioned": true, "pep": false, "is_root": false }
    ],
    "edges": [
      { "parent_id": "5lCpmkzb2GgGWbHzwPNl2g", "child_id": "OWwtbp9y51OcLHJQakLaMw", "relationship_type": "has_shareholder", "percentage": 20.0, "former": false }
    ],
    "sanction_hits": [
      { "entity_id": "yfUUY8kigJGVQ8KJ6vy3UQ", "name": "OPEN JOINT STOCK COMPANY BPS-SBERBANK", "sanctioned": true }
    ],
    "explored_count": 88601,
    "shown": 50,
    "next": true,
    "partial_results": false
  },
  "source": { "entity_url": "/v1/entity/OWwtbp9y51OcLHJQakLaMw", "raw_field_path": "...", "cache_file": "output/raw/traversal/OWwtbp9y51OcLHJQakLaMw.json", "api_endpoint": "GET /v1/traversal/ubo (cached)" }
}
```

Cache-first: the 8 marquee entities read from `output/raw/traversal/{id}.json` (no API quota). Others trigger a live Sayari call if credentials are set.

**8 pre-cached entity IDs:**

| Entity | ID |
|--------|----|
| Sberbank | `OWwtbp9y51OcLHJQakLaMw` |
| VTB Bank | `dy-rh2g0QtzUN_jC_e9S_A` |
| Transneft | `9-IuyJoA08bELHrSY3mXXA` |
| Gazprom | `RZAPsBRdYXTToVqy4ZuNow` |
| Rosneft | `uKGj1Dx23piV16B7oVDwoQ` |
| Rosoboronexport | `9LtTGZXn_LlN05C47cwZ5w` |
| Belorusskaya Kaliynaya | `BSsUPVlxsICOW4GCjb4fqQ` |
| Russian Railways | `RqBOnCZOD5pWG-tCf8wr8A` |

```bash
curl -X POST http://localhost:8000/tools/traverse_ownership \
  -H 'Content-Type: application/json' \
  -d '{"entity_id":"OWwtbp9y51OcLHJQakLaMw"}'
# → nodes: 51, edges: 50, sanction_hits: 11
```

---

## 3. Compare hero — GET /tools/compare_ofac_vs_sayari

```
GET /tools/compare_ofac_vs_sayari?threshold=0.85
```

**Summary shape (the UI funnel reads these fields):**
```json
{
  "data": {
    "summary": {
      "total_entities": 49,
      "both_catch": 33,
      "sayari_only": 2,
      "screen_ambiguous": 2,
      "matcher_miss": 3,
      "ofac_only": 2,
      "no_ofac": 7,
      "unresolved": 0,
      "ofac_screen_finds": 33,
      "ownership_gap": 4,
      "ownership_missed": 4,
      "matcher_missed": 3,
      "total_ofac_exposed": 40,
      "structural_argument": "A fair OFAC name-screen with unidecode transliteration catches 33 of 40 OFAC-exposed entities..."
    },
    "rows": [
      {
        "input_name": "Sberbank",
        "entity_id": "OWwtbp9y51OcLHJQakLaMw",
        "match_label": "PJSC Sberbank",
        "outcome": "both_catch",
        "is_directly_designated": true,
        "is_ownership_exposed": false,
        "direct_factor": "sanctioned_usa_ofac_sdn",
        "ownership_factor": null,
        "ofac_hit": true,
        "ofac_match_name": "SBERBANK OF RUSSIA",
        "ofac_sdn_id": 12765,
        "ofac_programs": ["RUSSIA"],
        "sayari_sanctioned": true,
        "why_screen_missed": null,
        "source_cache_file": "output/raw/OWwtbp9y51OcLHJQakLaMw.json"
      }
    ],
    "ofac_matcher_ready": true
  }
}
```

**UI funnel numbers:** `33 of 40 found; 7 missed = 4 ownership + 3 name-variation; Sayari catches all 40`

```bash
curl "http://localhost:8000/tools/compare_ofac_vs_sayari?threshold=0.85"
```

---

## 4. Risk summary — GET /tools/risk_summary/{entity_id}

```
GET /tools/risk_summary/{entity_id}
```

```json
{
  "data": {
    "entity_id": "OWwtbp9y51OcLHJQakLaMw",
    "input_name": "Sberbank",
    "match_label": "PJSC Sberbank",
    "risk_level": "critical",
    "top_risks": [
      {"factor": "sanctioned_usa_ofac_sdn", "description": "On OFAC SDN list"}
    ],
    "all_risk_factors": ["sanctioned_usa_ofac_sdn", "sanctioned_eu_sanctions", "..."],
    "sanctioned": true,
    "sanctioned_lists": ["sanctioned_usa_ofac_sdn", "sanctioned_eu_sanctions"],
    "pep_adjacent": false,
    "state_owned": false,
    "country_risk": ["RUS"],
    "countries": ["RUS"],
    "degree": 59632,
    "source_count": null,
    "confidence": "high",
    "warn_verify": false
  },
  "source": { "entity_url": "/v1/entity/OWwtbp9y51OcLHJQakLaMw", "cache_file": "output/raw/OWwtbp9y51OcLHJQakLaMw.json" }
}
```

```bash
curl http://localhost:8000/tools/risk_summary/OWwtbp9y51OcLHJQakLaMw
```

---

## 5. Entity list — GET /entities

```
GET /entities
```

```json
{
  "count": 49,
  "entities": [
    {
      "entity_id": "OWwtbp9y51OcLHJQakLaMw",
      "input_name": "Sberbank",
      "match_label": "PJSC Sberbank",
      "type": "Company",
      "countries": ["RUS"],
      "sanctioned": true,
      "risk_count": 12,
      "entity_url": "/v1/entity/OWwtbp9y51OcLHJQakLaMw"
    }
  ]
}
```

```bash
curl http://localhost:8000/entities
```

---

## 6. Investigations API

### GET /api/investigations

```json
{
  "investigations": [
    {
      "id": 1,
      "source": "upload",
      "source_detail": "list_1.xlsx",
      "status": "complete",
      "created_at": "2025-05-24T14:43:00+00:00",
      "completed_at": "2025-05-24T15:43:00+00:00",
      "counts": { "total": 49, "flagged": 42, "cleared": 4, "escalated": 2, "blocked": 40, "pending": 3 }
    },
    {
      "id": 2,
      "source": "sftp",
      "source_detail": "/inbound/sftp/may2025_vendors.xlsx",
      "status": "pending",
      "created_at": "2025-05-27T10:43:00+00:00",
      "completed_at": null,
      "counts": { "total": 0, "flagged": 0, "cleared": 0, "escalated": 0, "blocked": 0, "pending": 0 }
    }
  ]
}
```

```bash
curl http://localhost:8000/api/investigations
```

### GET /api/investigations/{id}

Same as list item but includes `"results": [...]` array of entity results.

```bash
curl http://localhost:8000/api/investigations/1
```

### GET /api/results/{run_id}

```json
{
  "run_id": 1,
  "count": 6,
  "results": [
    {
      "entity_id": "OWwtbp9y51OcLHJQakLaMw",
      "input_name": "Sberbank",
      "resolved": { "entity_id": "OWwtbp9y51OcLHJQakLaMw", "label": "PJSC Sberbank", "confidence": "high", "entity_url": "/v1/entity/OWwtbp9y51OcLHJQakLaMw" },
      "screening": {
        "ofac_sdn": { "hit": true, "sdn_id": 12765, "programs": ["RUSSIA"], "match_name": "SBERBANK OF RUSSIA" },
        "ownership_exposure": { "has_exposure": false, "factor": null },
        "other_sanctions": [],
        "risk_level": "critical",
        "outcome": "both_catch",
        "is_directly_designated": true
      },
      "disposition": { "status": "blocked", "reviewer": "alice.chen@meridian.ch", "rationale": "OFAC SDN confirmed.", "updated_at": "" },
      "sources": [{ "cache_file": "output/raw/OWwtbp9y51OcLHJQakLaMw.json", "api_endpoint": "GET /v1/entity/{id} (cached)" }]
    }
  ]
}
```

```bash
curl http://localhost:8000/api/results/1
```

### GET /api/results/{run_id}/{entity_id}

Single entity customer payload (same shape as one item in the results array above).

```bash
curl "http://localhost:8000/api/results/1/OWwtbp9y51OcLHJQakLaMw"
```

### POST /api/results/{run_id}/{entity_id}/disposition

```json
{ "status": "blocked", "reviewer": "alice.chen@meridian.ch", "rationale": "OFAC SDN confirmed. No transactions permitted." }
```

Valid statuses: `pending` | `cleared` | `escalated` | `blocked`

```bash
curl -X POST "http://localhost:8000/api/results/1/OWwtbp9y51OcLHJQakLaMw/disposition" \
  -H 'Content-Type: application/json' \
  -d '{"status":"blocked","reviewer":"analyst@meridian.ch","rationale":"OFAC SDN confirmed."}'
```

---

## 7. Supporting tool endpoints

### GET /tools/screen_ofac

```
GET /tools/screen_ofac?name=Sberbank&threshold=0.85
```

```json
{
  "data": {
    "query": "Sberbank",
    "matches": [
      { "sdn_id": 12765, "primary_name": "SBERBANK OF RUSSIA", "match_score": 0.92, "programs": ["RUSSIA"], "type": "Entity" }
    ]
  }
}
```

### GET /tools/get_profile/{entity_id}

```bash
curl http://localhost:8000/tools/get_profile/OWwtbp9y51OcLHJQakLaMw
```

Returns full entity profile including all risk factors, identifiers, degree, source_count.

### POST /tools/resolve_entity

```json
{ "name": "Sberbank", "country": "RUS" }
```

```bash
curl -X POST http://localhost:8000/tools/resolve_entity \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sberbank","country":"RUS"}'
```

### POST /tools/generate_briefing

```json
{ "entity_id": "OWwtbp9y51OcLHJQakLaMw" }
```

Returns HTML briefing (PDF if WeasyPrint installed).

---

## CORS

All origins allowed (`*`) + explicit `localhost:3000`, `localhost:3001`. No auth required for
demo. Preflight requests handled automatically.

---

## Key entity IDs for wiring UI fixtures

| Entity | entity_id | Ownership cached? | Outcome |
|--------|-----------|-------------------|---------|
| Sberbank | `OWwtbp9y51OcLHJQakLaMw` | ✓ | both_catch |
| VTB Bank | `dy-rh2g0QtzUN_jC_e9S_A` | ✓ | both_catch |
| Gazprom | `RZAPsBRdYXTToVqy4ZuNow` | ✓ | screen_ambiguous |
| Rosneft | `uKGj1Dx23piV16B7oVDwoQ` | ✓ | both_catch |
| Rosoboronexport | `9LtTGZXn_LlN05C47cwZ5w` | ✓ | both_catch |
| Transneft | `9-IuyJoA08bELHrSY3mXXA` | ✓ | no_ofac (UK/EU only) |
| Russian Railways | `RqBOnCZOD5pWG-tCf8wr8A` | ✓ | sayari_only |
| Belorusskaya Kaliynaya | `BSsUPVlxsICOW4GCjb4fqQ` | ✓ | sayari_only |
| Kalashnikov Concern | `zqpMddadf94y39RfB3AgcA` | ✗ | ofac_only |
| Sukhoi | `5wVHdujAfKLkHO7efPnAjQ` | ✓ (ubo) | ofac_only |
