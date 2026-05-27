# Meridian Sentinel — Clean Rebuild Spec

A trustworthy-AI compliance co-pilot for a Sayari FDE proof-of-concept. This spec
rebuilds the bloated Replit project ("Meridian Sentinel" / codename *arclight*)
into a lean, fully-*real*, defensible system around the existing deterministic
engine. It is both the build brief for Claude Code and the "approach" narrative
for the live review.

## 1. Thesis (the one sentence)

A compliance officer at *Meridian Energy Trading SA* (Geneva commodities, $22B)
uploads a vendor list; the co-pilot resolves each name to a real Sayari entity,
screens it against OFAC SDN, surfaces the ownership network, and produces a
defensible, **fully source-cited** briefing — an AI that *shows its work and
traces every finding to its source*. This mirrors Sayari's own Superconductor
thesis, built independently.

## 2. The non-negotiable rule: everything is real

The old build was mostly scripted fixtures + recorded "paced-replay" traces, with
only 2 of 8 entities live. **We remove all of that.** The deterministic engine
(`sayari_ground_truth.py`) already resolves all 50 list_1 entities live and
accurately, with cached `raw/*.json`. Those cached real responses become the data
layer — real and verifiable, without re-burning API quota. Live upload also hits
the real API. No fixture ever states a fact the API didn't return.

## 3. Keep / Rebuild / Drop (from the Replit repo)

- **KEEP & port:** client persona/framing; OFAC SDN ingest + matcher
  (`services/sayari-py/app/ofac_refresh.py`, `artifacts/api-server/src/lib/ofacMatcher.ts`);
  the 6 MCP tool definitions (`services/mcp-server/src/tools.ts`); the "shows its
  work" step-observability concept; entity-detail layout; WeasyPrint PDF
  (`app/pdf.py`); visual identity/tokens (`artifacts/arclight/src/index.css`);
  the `/docs` four-gap value framing.
- **REBUILD (right idea, fake/broken before):** Compare hero (real OFAC-name-screen
  vs Sayari resolution+ownership across all 50); the agent loop (grounded +
  cited); the MCP server (clean, over the engine).
- **DROP:** all fixtures / seeded threads / synthetic traces / paced-replay;
  generated api-client+zod monorepo; 10 of 12 DB tables; Clerk/demo-token/
  internal-token auth theater; duplicate agentic module; suggestion chips, cost
  page, heatmap, integrations catalog. (14 surfaces → 4.)

## 4. Target architecture

- **Layer 0 — Engine (exists):** refactor `sayari_ground_truth.py` into an
  importable `engine/` package (resolve, get_profile, traverse, aggregate,
  pinned-IDs, retries). Source of truth. No LLM in it.
- **Layer 1 — Tools + services:** typed tools over the engine, each returning
  `{data, source:{entity_url, raw_field_path}}`: `resolve_entity`, `get_profile`,
  `traverse_ownership`, `screen_ofac`, `compare_ofac_vs_sayari`, `risk_summary`,
  `generate_briefing`. Exposed via **FastAPI** (for the web app) and an **MCP
  server** (for Claude/any LLM).
- **Layer 2 — Grounded agent:** Anthropic tool-use loop, **constrained to only
  state facts returned by tools**, every claim rendered with a citation, low
  resolution-confidence surfaced as a "⚠ verify" flag (human-in-the-loop).
- **Layer 3 — Front-end:** **Next.js + TypeScript**, 4 surfaces (§5). Re-implement
  clean; lift design patterns/tokens from arclight, not the code wholesale.
- **Layer 4 (optional wow):** eval/trust harness (score agent answers vs the
  engine → hallucination rate); Dockerize + GCP Cloud Run.

**Stack:** Next.js/TS + Tailwind (web) · FastAPI + official `sayari` SDK +
Anthropic SDK + WeasyPrint (api) · Python `mcp` SDK (MCP server, imports the
engine directly — no HTTP hop) · **thin Postgres** (3 tables only:
`ofac_sdn`, `entity_cache`, `screening_run`) for real SQL + quota-free real data.

## 5. The 4 surfaces (UX)

1. **Landing — upload → review/map/validate → run.** Upload an .xlsx (or pick the
   seeded *real* list_1), then show a preview and let the analyst **confirm/correct the
   column mapping** (name/address/country — surfaces the COLUMN_HINTS auto-detection)
   and eyeball/flag rows before the analysis runs. This pre-run human checkpoint is a
   trust moment and is what lets the tool handle messy/unfamiliar lists. (Design intent —
   build in Phase 3; keep it lightweight: preview + confirm mapping, not a data-wrangling IDE.)
2. **Co-pilot chat.** NL question ("who shouldn't we onboard, and why?") → grounded,
   cited answer + a "shows its work" panel (the tool calls, timings, sources).
3. **Compare hero.** Real OFAC name-screen vs Sayari resolution+ownership across the
   list — "OFAC name-match catches N; Sayari catches the rest via resolution +
   50%-rule ownership." This is the Aha; make it actually paint.
4. **Entity detail + ownership graph.** Briefing + risk-signal cards with source
   IDs + AI caveats; Cytoscape/force-graph ownership network; PDF briefing download.

## 6. Build phases (each is a defensible stopping point)

- **Phase 0 — Scaffold.** Clean git repo; monorepo (`apps/web`, `services/api`,
  `services/mcp`, `packages/engine`, `db/`). Port the engine. Load cached
  `output/raw/*.json` + OFAC SDN into Postgres. *Demo:* `select` queries return real data.
- **Phase 1 — Tools + FastAPI + MCP** over the engine, with source citations.
  *Demo:* Claude (or curl) calls `resolve_entity('Gazprom','RUS')` on real data.
- **Phase 2 — Grounded agent** (cited, confidence-flagged). *Demo:* NL question → grounded answer.
- **Phase 3 — Next.js 4 surfaces.** *Demo:* the full click-through, all real.
- **Phase 4 (optional) — Eval harness + Docker/Cloud Run.**

Build in order; never advance with a half-working previous phase. Each phase is
something you can show and fully explain.

## 7. Salvage map (paths in your Replit export)

- OFAC: `services/sayari-py/app/ofac_refresh.py`, `artifacts/api-server/src/lib/ofacMatcher.ts`
- MCP tools: `services/mcp-server/src/tools.ts`
- Agent + schemas: `services/sayari-py/app/{agentic.py, tool_schemas.py, tool_executors.py}`
- PDF: `services/sayari-py/app/pdf.py`
- Sayari client patterns: `services/sayari-py/app/sayari_client.py`
- Front-end design reference (patterns/tokens only): `artifacts/arclight/src/` —
  esp. `index.css` (tokens), entity-detail, `components/chat/action-sequence.tsx`, `pages/network.tsx`

## 8. Defensibility cheat-sheet (pre-write the "why")

- **Deterministic engine under the agent** → risk decisions must be reproducible +
  auditable; LLMs hallucinate. This is the "know when the AI is wrong" mechanism.
- **Removed the fixtures** → for a trustworthy-AI company, a scripted demo is a
  liability; the engine lets everything be real + cited.
- **MCP** → decouples tools from the LLM, controls token cost — "just another way
  to use the API," exactly Sayari's CRE MCP model.
- **Constrained tool-use, not free RAG** → prevents ungrounded claims.
- **Confidence / human-in-the-loop flags** → resolution is probabilistic
  (Sberbank → subsidiary); surfacing uncertainty is what makes it trustworthy.
- **Thin Postgres (3 tables)** → real SQL for the demo + quota-free real data; the
  10 other tables were persistence overhead a PoC doesn't need.
- **4 surfaces, not 14** → "readability, simplicity" is in the rubric; I scoped to
  what delivers the Aha and what I can defend.
- **With more time** → automated parent-preference resolution, deeper UBO traversal,
  broader eval coverage, real auth, Snowflake sink.

## 9. Demo script (≤5 min)

Upload list_1 → ask the co-pilot "which of these can't we onboard, and why?" →
watch it resolve + screen + cite (the work panel) → open Compare (OFAC misses the
ownership-hidden ones; Sayari catches them) → open the worst entity, show the
ownership chain to the sanctioned parent + the source IDs + the ⚠ confidence flag →
download the PDF briefing. Close: "every number traces to a Sayari source, and it
tells you where it's unsure — that's judgment infrastructure for trustworthy AI."
