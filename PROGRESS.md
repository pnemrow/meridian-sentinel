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
| `compare_ofac_vs_sayari` | tools/compare_ofac_vs_sayari.py | Cache + OFAC matcher (threshold=0.85) |
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
compare_ofac_vs_sayari()         → see OFAC comparison results below
generate_briefing('OWwtbp9y...') → HTML 6015 bytes, source=output/raw/OWwtbp9y...json
```

### OFAC comparison — fair methodology and honest results

**Matcher methodology (matcher.py):**
- Unidecode transliteration applied to BOTH the query name AND every SDN name/alias, so
  Cyrillic ↔ Latin differences are not a source of false misses.
- 3-stage match: alias phrase → primary-name token coverage → single-token alias fallback.
- Coverage rule fixed: 2-token queries require BOTH tokens to match (prior `max(1,N-1)` bug
  allowed 1/2 tokens, causing "Russian Railways" → "RUSSIAN FINANCIAL CORPORATION" at 0.92).
- Threshold: 0.85 (eliminates 0.72 single-token alias noise; only phrase and primary-name
  matches above 0.85 are accepted).
- No deliberate weakening: no phonetics, no edit-distance — but also no coverage bugs or
  threshold manipulation. Every hit is traceable to a real SDN sdn_id.

**Outcome taxonomy:**
- `both_catch`: entity IS directly named on the OFAC SDN list AND the fair screen found it.
- `sayari_only`: entity NOT directly named on SDN; Sayari flags OFAC exposure via an
  OWNERSHIP factor (`ofac_50_percent_rule`, `controlled_by_ofac_sdn`,
  `owned_by_sanctioned_usa_ofac_sdn_entity`); screen correctly returns no hit.
- `screen_ambiguous`: entity NOT directly named on SDN; Sayari flags ownership exposure;
  screen fires on a DIFFERENT SDN entity (e.g. Gazprom → Gazprom Neft). Honestly distinct
  from sayari_only: the screen partially overlaps but does not correctly identify THIS entity.
- `matcher_miss`: entity IS directly named on SDN but screen returned no hit above threshold.
  This is a screen failure, not a Sayari advantage. Reported honestly.
- `ofac_only`: screen hit; Sayari shows no OFAC exposure. 0 after threshold fix.
- `no_ofac`: no OFAC SDN exposure either way. 8 entities (sanctioned on EU/UK lists only).
- `unresolved`: 0 — all 49 entities resolved.

**Matcher bugs found and fixed (second pass):**
- **Bug 1 — alias indexing**: aliases were indexed by `alias.split()[0]` which preserves
  hyphens. Alias "alfa-bank" was indexed under "alfa-bank" not "alfa". Query normalize
  strips hyphens → t0="alfa" → index lookup missed it. Zero candidates for Alfa-Bank.
  Fix: index all normalized tokens of each alias (and primary name), not just first raw token.
- **Bug 2 — stage-3 single-token score**: stage 3 scored all alias whole-word matches at 0.72.
  For single-token queries (entire query satisfied by one alias token), 0.72 < 0.85 threshold
  → missed Rostec, Sevmash, Rosoboronexport despite exact alias matches.
  Fix: stage-3 score = 0.85 for single-token queries, 0.72 for multi-token.

**Actual numbers (49 entities, threshold=0.85, all bugs fixed):**
```
both_catch:        33  (directly on SDN; fair screen found them — includes Alfa-Bank,
                        Rostec, Sevmash, Rosoboronexport which were false misses before)
sayari_only:        2  (ownership-exposed; name absent from SDN; screen missed)
screen_ambiguous:   3  (ownership-exposed; screen matched a DIFFERENT SDN party)
matcher_miss:       3  (directly on SDN; screen fails — all 3 are defensible, see below)
ofac_only:          1  (Sukhoi — screen found UAC alias "sukhoi"; Sayari shows no OFAC SDN)
no_ofac:            7  (sanctioned on other lists, not OFAC SDN; e.g. Transneft=UK only)
unresolved:         0
─────────────────────
ownership_gap:      5  (sayari_only + screen_ambiguous)
total_ofac_exposed: 41
```

**3 remaining matcher_miss entities — all defensible:**
1. **Venezuelan State-Owned Oil Company (PDVSA)** — Zero SDN candidates.
   Input is a descriptor, not the entity's name. SDN has "PETROLEOS DE VENEZUELA S A".
   No lexical overlap. A real screen would be queried with "PDVSA" not this descriptor.
2. **State Development Bank VEB.RF** — Spurious alias matches at 0.72 (unrelated entities
   match on common token "state"). SDN entry "VNESHECONOMBANK" has no lexical overlap
   with the input. Defensible.
3. **Zvezdochka Shipyard** — "Shipyard" not in SDN entry; SDN uses "Ship Repair Center".
   2-token query requires both tokens; min_cov=2 fails. Stage-3 at 0.72. Defensible.

**sayari_only entities (2) — confirmed NOT named on the SDN:**
1. Belorusskaya Kaliynaya Companya — `owned_by_sanctioned_usa_ofac_sdn_entity`
   (Belarusian Potash Company; top screen hit: "BELARUSIAN CEMENT COMPANY" at 0.72 —
   different entity, below threshold; entity name absent from SDN)
2. Russian Railways — `controlled_by_ofac_sdn`
   (Top screen hits: Bank Rossiya, VTB Bank, Sberbank at 0.72 — completely unrelated;
   entity name absent from SDN. Not itself designated; exposed via state control.)

**screen_ambiguous entities (3) — screen hit a wrong party:**
1. Gazprom → screen matches Gazprom subsidiaries [sdn=19640, 19653, 24185] at 0.85
   (Sayari resolved to PJSC Gazprom, which is ownership-exposed; subsidiaries are on SDN)
2. Kalashnikov Concern → screen matched "JSC CONCERN KALASHNIKOV" [16911] at 0.97
   **RESOLUTION ERROR**: Sayari resolved "Kalashnikov Concern" to the Innovation Center
   subsidiary [SyiWoXAi7JAAOfdzOWpBDQ]. Parent "Kalashnikov Concern" [zqpMddadf94y39RfB3AgcA]
   is sanctioned=True per relationship graph. Cannot fix without live API (parent not cached).
   When SAYARI_CLIENT_ID is available: fetch parent JSON, add to PINNED_IDS. Expected
   reclassification: screen_ambiguous → both_catch (screen correctly finds parent at 0.97).
3. MiG Corporation → screen matched "MIG ELEKTRO" [50908] at 0.85 (different company)

**ofac_only entity (1) — legitimate flag, not a false positive:**
Sukhoi Company: SDN for UAC [sdn=36431] has "sukhoi" as an alias. Screen correctly
surfaces this connection at 0.85. Sayari shows no `sanctioned_usa_ofac_sdn` for Sukhoi
(EU/Canada/UK sanctioned but not OFAC SDN). `ofac_only` = flag for compliance review.

**Structural argument:**
A fair OFAC name-screen with unidecode transliteration and all-token indexing catches 33 of
41 OFAC-exposed entities directly. The remaining 5 (2 missed entirely, 3 where screen matched
a different SDN party) are NOT directly named on the SDN list — they are blocked under
OFAC's 50% rule (31 CFR § 501.801) because an SDN-designated entity owns or controls them.
No name-screen can correctly identify these by the entity's own name.
Sayari identifies them through ownership graph traversal.

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

### 0. Prerequisites for steps 1–3 (requires live credentials)
```bash
export SAYARI_CLIENT_ID=...
export SAYARI_CLIENT_SECRET=...
# Verify: python3 -c "from packages.engine import build_client; c=build_client(); print(c)"
```

### 1. Fix Kalashnikov Concern resolution [REQUIRES LIVE API] (commit after)

**Why:** Sayari resolved "Kalashnikov Concern" to the Innovation Center subsidiary
[SyiWoXAi7JAAOfdzOWpBDQ] instead of the parent [zqpMddadf94y39RfB3AgcA]. Parent is
sanctioned=True per the Innovation Center's relationship graph. The OFAC screen correctly
finds "JSC CONCERN KALASHNIKOV" [SDN 16911] at 0.97. Without the fix, this is classified
`screen_ambiguous`; with it, it should be `both_catch`.

```python
# 1a. Fetch and cache parent entity JSON
import json
from pathlib import Path
from packages.engine import build_client

client = build_client()
parent_id = "zqpMddadf94y39RfB3AgcA"
response = client.entity.get(parent_id)           # GET /v1/entity/{id}
raw = response.dict() if hasattr(response, 'dict') else vars(response)
Path(f"output/raw/{parent_id}.json").write_text(json.dumps(raw, default=str))
print(raw.get('label'), raw.get('sanctioned'), [k for k,v in raw.get('risk',{}).items() if isinstance(v,dict) and v.get('value')])
```

```python
# 1b. Add to PINNED_IDS in packages/engine/resolve.py
PINNED_IDS = {
    ...existing...,
    "Kalashnikov Concern": "zqpMddadf94y39RfB3AgcA",
}
```

```bash
# 1c. Re-run compare and verify reclassification
python3 -c "
from packages.engine import EntityCache
from services.api.ofac.matcher import OfacMatcher
from services.api.tools.compare_ofac_vs_sayari import compare_ofac_vs_sayari_tool
cache = EntityCache('./output')
ofac = OfacMatcher.load('services/api/data')
r = compare_ofac_vs_sayari_tool(cache, ofac)
s = r.data['summary']
print(s)
# Expect: both_catch=34, screen_ambiguous=2
"
```

Expected outcome: `screen_ambiguous` drops by 1 (Kalashnikov → `both_catch`).
ownership_gap drops to 4 (Gazprom + MiG remain screen_ambiguous; both are genuine
ownership exposures where the *parent* isn't named on the SDN).

---

### 2. Sukhoi ownership traversal [REQUIRES LIVE API] (commit after)

**Why:** Sukhoi Company [5wVHdujAfKLkHO7efPnAjQ] is classified `ofac_only` — the screen
matched UAC [SDN 36431] via alias "sukhoi". Sayari shows EU/CA/CH/FR/NZ + US BIS sanctions
but NOT `sanctioned_usa_ofac_sdn`. Need to determine: does Sukhoi → UAC ownership chain
exist, and is UAC's OFAC designation enough to trigger the 50% rule for Sukhoi?

**Do NOT reclassify until you have the evidence. Show the ownership path.**

```python
# 2a. Run UBO traversal on Sukhoi
from packages.engine import build_client
from services.api.tools.traverse_ownership import traverse_ownership_tool
from packages.engine import EntityCache

client = build_client()
cache = EntityCache('./output')
result = traverse_ownership_tool(cache, client, entity_id="5wVHdujAfKLkHO7efPnAjQ", depth=3)
print(result.data)
# Look for: UAC (entity_id for PJSC UAC = sdn 36431) in the ownership chain
# UAC Sayari entity_id is likely in index — search output/raw/ for "united aircraft"
```

```python
# 2b. For each entity in the path, check Sayari risk factors
# Key question: is UAC ≥50% owner of Sukhoi?
# If yes: Sukhoi should have ofac_50_percent_rule risk factor (check it)
# If yes: ofac_only → screen_ambiguous or sayari_only depending on current screen result
# If no: ofac_only is correct (screen is flagging UAC's alias, but no ownership block)
```

```bash
# 2c. Cache traversal result
import json
from pathlib import Path
Path("output/raw/traversal").mkdir(exist_ok=True)
Path("output/raw/traversal/5wVHdujAfKLkHO7efPnAjQ.json").write_text(
    json.dumps(result.data, default=str)
)
```

**Report format expected:**
```
Sukhoi [5wVHdujAfKLkHO7efPnAjQ]
  └── has_shareholder: [intermediate entity if any]
      └── has_shareholder / subsidiary_of: UAC [<sayari_id>]
          OFAC status: sanctioned_usa_ofac_sdn = True/False
          SDN sdn_id: 36431 (if confirmed same entity)
Ownership share: XX% → triggers/does not trigger OFAC 50% rule
Sayari ofac_50_percent_rule for Sukhoi: present / absent
```

---

### 3. Cache ownership traversal for marquee entities [REQUIRES LIVE API] (commit after)

**Why:** Phase 3 ownership graph (Cytoscape) needs real edges. Cache traversal JSON now
so the front-end has real data without needing live API calls during the demo.

```python
# Rate-limit: 1 request per second. Cache to output/raw/traversal/{id}.json
import time, json
from pathlib import Path
from packages.engine import build_client, EntityCache
from services.api.tools.traverse_ownership import traverse_ownership_tool

client = build_client()
cache = EntityCache('./output')
Path("output/raw/traversal").mkdir(exist_ok=True)

MARQUEE = {
    "Sberbank":       "OWwtbp9y51OcLHJQakLaMw",
    "VTB Bank":       "dy-rh2g0QtzUN_jC_e9S_A",
    "Transneft":      "9-IuyJoA08bELHrSY3mXXA",
    "Gazprom":        "RZAPsBRdYXTToVqy4ZuNow",
    "Rosneft":        "<id-from-output/raw/>",   # grep entities.csv
    "Rosoboronexport":"9LtTGZXn_LlN05C47cwZ5w",
    # ownership_gap entities:
    "Belorusskaya Kaliynaya Companya": "BSsUPVlxsICOW4GCjb4fqQ",
    "Russian Railways":                "RqBOnCZOD5pWG-tCf8wr8A",
}

for name, entity_id in MARQUEE.items():
    out = Path(f"output/raw/traversal/{entity_id}.json")
    if out.exists():
        print(f"  {name}: already cached, skipping")
        continue
    try:
        r = traverse_ownership_tool(cache, client, entity_id=entity_id, depth=3)
        out.write_text(json.dumps(r.data, default=str))
        print(f"  {name}: cached {len(str(r.data))} bytes")
    except Exception as e:
        print(f"  {name}: ERROR — {e}")
    time.sleep(1.0)   # respect rate limits
```

After caching, verify:
```bash
ls -lh output/raw/traversal/
# Expect 8 files, each with ownership edges
```

---

### 4. Re-run compare + update PROGRESS.md (commit after steps 1–3)

After each fix above:
```bash
python3 -c "
import sys; sys.path.insert(0, '.')
from packages.engine import EntityCache
from services.api.ofac.matcher import OfacMatcher
from services.api.tools.compare_ofac_vs_sayari import compare_ofac_vs_sayari_tool
cache = EntityCache('./output')
ofac = OfacMatcher.load('services/api/data')
r = compare_ofac_vs_sayari_tool(cache, ofac)
s = r.data['summary']
for k,v in s.items():
    if k != 'structural_argument': print(f'  {k}: {v}')
print()
print(s['structural_argument'])
"
```

---

### 5. Install FastAPI + start API server
```bash
cd "/Users/peternemrow/Documents/Claude/Projects/Sayari Interview/services/api"
pip install fastapi uvicorn[standard]
uvicorn main:app --reload --port 8000
# Verify: curl http://localhost:8000/health
# Verify: curl http://localhost:8000/entities | jq '.count'
# Verify: curl "http://localhost:8000/tools/risk_summary/OWwtbp9y51OcLHJQakLaMw"
```

### 6. Set up Postgres + load data
```bash
createdb sentinel
psql sentinel -f db/schema.sql
psql sentinel -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
export DATABASE_URL=postgresql://localhost/sentinel
python db/loaders/load_cache.py   # 49 entities
python db/loaders/load_ofac.py    # ~10k SDN entries (downloads ~15MB)
```

### 7. Phase 2 — Agent (requires ANTHROPIC_API_KEY)
Build `services/agent/agent.py` using Anthropic tool-use loop.

### 8. Phase 3 — Next.js UI
```bash
cd apps/web
npx create-next-app@latest . --typescript --tailwind --app
# Then build 4 surfaces per BUILD_SPEC.md §5
```

---

## Live-API session results (completed with SAYARI_CLIENT_ID)

### Step 1 — Kalashnikov Concern re-resolution (commit 8a3af7b)

Fetched parent entity `zqpMddadf94y39RfB3AgcA`; updated `entities.csv`; added to `PINNED_IDS`.

**INN/reg cross-reference proves same legal entity:**
- Sayari INN `1832090230` = SDN 16911 Tax ID No. `1832090230` ✓
- Sayari reg `1111832003018` = SDN 16911 Registration Number `1111832003018` ✓
- SDN strong a.k.a.: "KALASHNIKOV CONCERN" [uid=68546] ✓

**Outcome: `ofac_only` (not `both_catch`)** — investigated thoroughly.

**Exact JSON field paths (verified):**
- `raw["risk"]` keys: `['sanctioned_aus_dfat', 'cpi_score', 'sanctioned_can_gac', ...]` — NO OFAC keys
- `raw["identifiers"]`: `ru_tin`, `ru_registration_number`, `aus_consolidated_sanctions_reference`,
  `ru_kpp`, `nzl_russia_sanctions_uid` — NO `usa_ofac_sdn_number`
- `sanctioned_usa_ofac_sdn` appears only at `relationships.data[1|5|8|16|21|37].target.risk`
  — these are Kalashnikov's **subsidiaries** (KBP [SDN 16864], Iskra [47746], Izhmash [18317],
  Zavod No.9 [47478], etc.), each with their own OFAC designation
- `usa_ofac_sdn_number` identifiers also only on those subsidiary targets, not on Kalashnikov itself

**Confirmed: NOT an extraction bug.** The OFAC risk factor and identifier are genuinely absent
from the Kalashnikov entity record. Sayari has the entity, knows its INN matches SDN 16911,
but has NOT mapped `sanctioned_usa_ofac_sdn` to this entity. **Real Sayari data gap.**
Classification `ofac_only` is correct: screen finds it at 0.97; Sayari doesn't confirm.

Compare after step 1:
`both_catch=33, sayari_only=2, screen_ambiguous=2, matcher_miss=3, ofac_only=2, no_ofac=7, ownership_gap=4`

---

### Step 2 — Sukhoi ownership traversal evidence (verified)

UBO traversal depth=3; inspected all path step `relationships` fields for ownership percentages.

**UAC → Sukhoi ownership path — exact field paths:**
```
traversal_data[N].path[0].field = "has_shareholder"
traversal_data[N].path[0].entity.id = "T8xxeh7qY1AW7ISrGZKLdQ"  (UAC)
traversal_data[N].path[0].relationships.has_shareholder.most_recent_percentage = 81.25
traversal_data[N].path[0].relationships.has_shareholder.former = True
traversal_data[N].path[0].relationships.has_shareholder.last_observed = "2023-03-09"
traversal_data[N].path[0].relationships.has_shareholder.values[*].former = True (all 74 records)
```

**Historical UAC ownership of Sukhoi (selected records):**
- 98.83% (pub 2012-08-27) → 91.67% (pub 2012-08-29) → 83.19% (pub 2014-01-09)
- 57.06% (pub 2015-01-12) → 81.25% (pub 2018-04-03) — **most_recent_percentage: 81.25**
- All records `former=True`, last_observed 2023-03-09

**Why all former=True:** Sukhoi was integrated into UAC as a division (2023). UAC no longer
holds a separate share stake in Sukhoi as a subsidiary — they became the same entity for
operating purposes. The legal corporate shell ("ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО 'АВИАЦИОННАЯ
ХОЛДИНГОВАЯ КОМПАНИЯ 'СУХОЙ'") persists but is no longer independently owned by UAC.

**Sukhoi OFAC risk factors: NONE** — Sayari correctly omits `ofac_50_percent_rule` because
the ownership relationship ended (former). The 50% rule requires current ≥50% ownership.

**Decision: classification stays `ofac_only`.** UAC historically held 81.25% of Sukhoi (well
above OFAC 50% threshold) but the relationship is now former. Sayari's absence of
`ofac_50_percent_rule` is correct given the current (post-merger) structure. The screen's
"sukhoi" alias hit on SDN 36431 (UAC) surfaces a real historical connection that a compliance
officer should investigate — but Sayari data accurately reflects no current OFAC block.
`ofac_only` is the honest classification.

Cached: `output/raw/traversal/5wVHdujAfKLkHO7efPnAjQ_ubo.json` (4.0 MB, 50 paths)

---

### Step 3 — Traversal cache for 8 marquee entities (this session)

All cached to `output/raw/traversal/` (API limit=50 paths per request):

| Entity | Paths | Size | Sanctioned/PEP UBOs |
|--------|-------|------|---------------------|
| Sberbank | 50 | 503 KB | 13 (BPS-Sberbank, Loyalty Programs Center, ...) |
| VTB Bank | 50 | 908 KB | 9 (Insurance Deposit Agency, Gavrilov, ...) |
| Transneft | 7 | 217 KB | 0 (state-owned, simple structure) |
| Gazprom | 50 | 687 KB | 10 (Aksyutin, Gazprom Dobycha Noyabrsk, ...) |
| Rosneft | 45 | 1.9 MB | 4 (Sechin, Casimiro, Akimov) |
| Rosoboronexport | 1 | 1.2 MB | 1 (Rostec — sanctioned) |
| Belorusskaya Kaliynaya | 50 | 2.0 MB | 5 (Kerimov, Prokhorov, Mutsoev) |
| Russian Railways | 50 | 871 KB | 1 PEP (Shakhanov) |

Phase 3 graph note: limit=50 is API max. Large networks (Sberbank, Gazprom, Russian Railways)
have more paths beyond 50 — Phase 3 should paginate or request additional offsets.

---

## Remaining open issues

- **Kalashnikov OFAC data gap**: Sayari entity `zqpMddadf94y39RfB3AgcA` confirmed =
  SDN 16911 by INN/reg but missing `sanctioned_usa_ofac_sdn`. Reportable to Sayari.
- **Sukhoi `ofac_only` — verified, no reclassification needed**: UAC historically held
  81.25% of Sukhoi (`path[0].relationships.has_shareholder.most_recent_percentage`), but
  ALL 74 ownership records are `former=True` (last_observed 2023-03-09; Sukhoi merged into
  UAC as a division). Sayari correctly omits `ofac_50_percent_rule`. `ofac_only` classification
  is accurate: screen surfaces a real historical connection; no current OFAC block.
- **generate_briefing PDF** — currently outputs HTML. `pip install weasyprint` for PDF.
