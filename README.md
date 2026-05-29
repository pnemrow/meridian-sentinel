# Meridian Sentinel

A counterparty screening copilot for compliance analysts. Built as the Sayari Forward Deployed Engineer technical exercise.

The thesis is two claims, demonstrated by running this app:

First, name based OFAC screening has two structural failure modes. It silently misses entities owned ≥50% by a sanctioned party (the OFAC 50% rule, 31 CFR §501.801). It also fires noisily on entities that share a string with a sanctioned name but are otherwise legitimate. The fix in both cases is entity resolution plus an ownership graph, which is what Sayari provides.

Second, AI in compliance can be trustworthy when the analysis engine is deterministic and the LLM only narrates and orchestrates over its results. Every value rendered in this UI cites a Sayari field path and a cached JSON file on disk. The agent never produces a number.

The exercise picked Scenario 2 (analytics over list_1) and extended it with Scenario 1 (a fair OFAC baseline) to make the reconciliation explicit.

---

## Running the app

Two paths. CACHED mode requires no credentials and demonstrates the full deliverable. LIVE mode requires Sayari credentials (and optionally an Anthropic key) and exercises the engine on uploads.

### Docker (recommended)

```
cp .env.example .env
docker compose up
```

Open http://localhost:8000/ui/. About two minutes from clone to running.

### Native Python

Requires Python 3.11 or newer plus WeasyPrint system dependencies (cairo, pango, gdk pixbuf, fonts). On macOS:

```
brew install cairo pango gdk-pixbuf libffi
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn services.api.main:app --port 8000
```

Open http://localhost:8000/ui/.

If WeasyPrint's system dependencies (cairo, pango, gdk-pixbuf) are not installed on the host, the briefing endpoint serves a print-friendly HTML version instead of a PDF. Use the browser's File > Print > Save as PDF for the audit artifact. The Docker path installs the dependencies and produces a server-rendered PDF directly.

### Credentials

The badge in the top right of the UI toggles between CACHED and LIVE.

CACHED requires zero credentials. It replays four captured Anthropic tool use runs against list_1, serves cached Sayari profiles for all 49 resolved entities, and uses an OFAC SDN feed downloaded in late May 2026. The badge in the UI honestly reflects this.

LIVE needs `SAYARI_CLIENT_ID` + `SAYARI_CLIENT_SECRET` for uploads and live ownership traversals, and `ANTHROPIC_API_KEY` for freeform co-pilot questions. The four cached golden questions work without an Anthropic key.

You can supply these credentials two ways — both equivalent, pick whichever you prefer:

1. **In `.env` before starting** (classic): edit `.env.example` → `.env` with values, then `docker compose up`. The container picks them up at boot.
2. **In the app, when prompted** (quick trial): start with an empty `.env`. The first time you need a LIVE feature — switching the mode badge to LIVE, submitting a freeform co-pilot question, or opening an entity not in the pre-cached set — a modal opens and asks for exactly the credentials that feature requires. A gear icon next to the mode badge also opens the modal at any time to manage credentials.

In-app credentials live in memory only on the API process. They are cleared on container restart and never persisted to disk or to your browser. The store wins over `.env` when both are set, so an in-app entry is a clean override without restart.

I have not bundled my Sayari or Anthropic credentials in this repo. You presumably have Sayari credentials through the company; an Anthropic key is only required for the freeform co-pilot path in LIVE mode.

---

## What to look at

This is the same walkthrough the recorded demo video covers, in the same order. About ten minutes if you take it slow.

1. **Land and log in.** Demo gate, no real auth, click through. The dashboard is the team workflow home.

2. **Note the dashboard.** Four KPI cards at the top, an investigations table below. The "Procurement feed" row at the top of the table is flagged as pending review and arrived overnight via SFTP. That is the integration point Sentinel is designed for: counterparty lists flow in from procurement systems on their own schedule, screening outcomes write back to case management, no manual upload required for steady state.

3. **Start a new investigation.** Click "+ New investigation". Drop in `Sayari_Interview_Exercise_List.xlsx`. The seeded list is recognized by content hash and shorts to the cached path; click "Run screening (cached, instant)". The full results were captured from real Sayari API responses; this just replays them.

4. **The headline finding, the Compare surface.** Of 50 counterparties, 40 are OFAC exposed. A fair, transliteration aware name screen catches 33 of them. It misses 7. Three are directly on the SDN but the name differs by transliteration. Four are not on the SDN at all and are blocked under the 50 percent rule. Sayari catches all 40. The four ownership gap entities at the bottom of the funnel are the headline.

5. **Click into MiG Corporation.** A gap card. The name does not appear on the SDN. The Risk Signals panel shows sanctioned by Australia, Canada, the EU under regulation 833/2014, the US BIS Entity List, and others. Identity Evidence panel shows Russian tax registration numbers and the EU regulation reference. Every value cites a raw cache file path you can open and verify.

6. **Walk the ownership graph.** The right pane shows MiG's ownership network. Click the United Aircraft Corporation node. The focus card shows the relationship: United Aircraft owns nearly 75 percent of MiG. Click "Open entity" to navigate. United Aircraft is directly on the OFAC SDN list, with eleven sanction regimes flagged. The same node owns Sukhoi, owns Tatneft, all visible in the graph. One SDN designation produces a fully mapped corporate exposure.

7. **Set a disposition.** Open the Disposition control. Set Blocked with a one line rationale. The decision writes to disk and survives refresh.

8. **View the API payload.** Click "{ } View API payload" in the entity header. This is the structured JSON a downstream system would consume, with every value cited.

9. **Download the briefing PDF.** Click "Download briefing PDF". The PDF is rendered server side via WeasyPrint, with every fact pointing back to the same raw cache file. This is the audit artifact.

10. **Switch to the Copilot surface.** Toggle the mode badge in the top right to LIVE. Ask a freeform question (e.g. "Show me the companies that aren't on the OFAC list but are still blocked"). The trace pane on the right populates as tools fire. Every step cites a raw cache file. The system prompt forbids fabrication; the typed tools are the only data source.

11. **Run a live upload.** Back to "+ New investigation". Drop in the same xlsx. With LIVE mode active, the cached short circuit is bypassed and the engine actually hits Sayari for every row. Watch the per row trace stream in. Expand any row to see the two API calls, payloads, durations, friendly named sanction chips, and cache file paths.

12. **Open the second investigation, the list_3 run, for the false positive story.** Switch the active investigation to the list_3 run. Compare shows zero ownership gap findings but four false positives where the OFAC name screen fires on legitimate auto parts companies: Magna matches a Mexican drug trafficker (SDN 6866), Continental matches a different SDN entity (54200), NSK matches an initialism collision (47854), Mando matches a drug trafficker's alias (54225). Sayari resolves all four correctly. This is the second failure mode of name screening, and the complementary half of the headline argument.

---

## Repository map

```
packages/engine/                  Deterministic analysis engine. The heart of the trust thesis.
  resolve.py                      Entity resolution. PINNED_IDS and RETRY_NAMES with comments on each.
  profile.py                      Field extraction. Computes name_mismatch_flag.
  aggregate.py                    Summary statistics, OFAC reconciliation buckets.
  cache.py                        EntityCache, reads output/raw/.

services/api/                     FastAPI backend.
  main.py                         Tool endpoints + /agent/ask SSE stream + UI mount.
  tools/                          Seven typed tools the agent can call. Every result returns a CitedResult.
    compare_ofac_vs_sayari.py     The headline reconciliation logic.
    generate_briefing.py          Server side PDF rendering via WeasyPrint.
    traverse_ownership.py         Cache first ownership graph traversal.
  ofac/matcher.py                 OFAC SDN matcher with unidecode transliteration and alias indexing.
  agent/                          Anthropic tool use loop.
    runner.py                     LIVE mode (real API) and CACHED mode (replay golden runs).
    tools.py                      Tool schemas and the system prompt.
  routers/
    investigations.py             /api/investigations and /api/results endpoints.
    uploads.py                    /uploads and SSE /uploads/{id}/run.

design-prototype/                 Frontend. Babel standalone React, no build step.
  index.html                      Loads everything from CDN. Open this in a browser to read the app.
  surfaces/                       One file per screen.
    upload.jsx                    Validate and Run with per row expansion.
    compare.jsx                   The reconciliation table and funnel.
    entity.jsx                    Entity detail + briefing PDF.
    graph.jsx                     Ownership force graph (d3 force simulation).
    copilot.jsx                   Streaming chat with the work pane on the right.
    investigations.jsx            Dashboard.
  data/api.js                     Live API loader. Falls back to fixtures if the backend is unreachable.

output/                           Cached real data. Committed to the repo so CACHED mode works on first clone.
  raw/{entity_id}.json            49 cached Sayari profiles for list_1.
  raw/traversal/                  Cached ownership graphs for every list_1 entity.
  agent_runs/golden_*.json        Four captured Anthropic tool use streams.
  runs/run_20260528_*/            A captured list_3 run with its own raw cache.
  entities.csv, summary.json      List_1 input index and macro summary.

scripts/                          One off utilities.
  cache_traversals.py             Walks an entities.csv and caches ownership graphs.

Meridian_Sentinel_FDE_Report.docx Two page submission report.
```

---

## The deterministic engine

The engine in `packages/engine/` produces every number rendered in the UI. The LLM never touches a value. The agent in `services/api/agent/` can only call typed tools that route through this engine, and tool results carry their own citations.

This separation is the trust architecture. To verify any claim in the UI, follow the citation chain back to a file in `output/raw/`.

A worked example. Click Sberbank in the Compare reconciliation. The risk summary panel shows sanctioned with 14 sanction list factors. To verify:

1. The factor list comes from `packages/engine/profile.py`, function `extract_profile`, which reads `raw_entity.data.risk` and lists keys whose value is non zero.
2. The raw response is at `output/raw/OWwtbp9y51OcLHJQakLaMw.json`. Open it. Search for `sanctioned_usa_ofac_sdn`. The value is true, with metadata including from_date 2022 02 24 and source "USA Treasury OFAC SDN List".
3. The CitedValue chip in the UI links to this exact file path. There is no place the value could be invented.

The OFAC reconciliation math is in `services/api/tools/compare_ofac_vs_sayari.py`. Two classifier helpers (`_classify_exposure` and `_why_screen_missed`) plus a sixty line outcome bucket loop. The summary fields exposed to the UI are computed from this single source. There are no hardcoded numbers in the rendering layer.

The OFAC name screen baseline is in `services/api/ofac/matcher.py`. Earlier in the build I shipped an under powered matcher that inflated Sayari's catch advantage. I rebuilt it with unidecode transliteration, alias indexing, and a stage three single token scoring threshold. The honest comparison is what produces the 33 of 40 number on Compare, not a rigged baseline.

---

## The AI copilot

The copilot uses Anthropic's tool use loop, not RAG. Six typed tools (`compare_ofac_vs_sayari`, `risk_summary`, `resolve_entity`, `get_profile`, `screen_ofac`, `traverse_ownership`) are exposed to `claude-sonnet-4-6` with strict input schemas. The system prompt enforces "only state facts that a tool returned, cite every claim, flag uncertainty explicitly."

Why tool use over RAG? The data is structured Sayari API responses, not narrative documents. Vector retrieval would force me to embed JSON, which destroys the field structure that makes citations possible. Direct tool calls let the model query specific entities, factors, and graph paths, and the citation chain is always (entity URL + field path + cache file), not a chunk id. This is the same reason MCP servers exist: the agent talks to its data through a typed interface rather than a similarity search.

CACHED mode replays four captured real runs from `output/agent_runs/`. These were generated by hitting the live Anthropic and Sayari APIs against list_1; the event streams are saved verbatim and replayed deterministically in the UI. Zero latency, zero API cost. If a question does not match a captured run, CACHED returns an honest "I don't have a cached answer for that question, switch to LIVE mode" rather than fabricate.

LIVE mode hits the Anthropic API in real time against whichever run's cache is active. The agent's tool calls are scoped by run_id so it reads from the right entity profiles.

The system prompt was tuned during build for conciseness. Early versions called the compare tool then enriched every flagged entity with a risk_summary, ending in twenty tool calls for a simple "what's the riskiest entity" question. The current prompt encourages "match tool count to question scope, two tool calls is often the right answer." Single entity questions resolve in one or two calls now.

---

## Design decisions

The questions I anticipate the live review will probe, with the actual reasoning.

**Why file based persistence instead of Postgres?** Transparency. Every artifact is a JSON file you can cat or grep. The Postgres path exists in `services/api/routers/investigations.py` and would be the production move; queries are written against a three table schema (investigation, entity_result, disposition) and the connection falls back to JSON when `DATABASE_URL` is unset. PoC chose inspectability. The tradeoff against this is concurrency (last write wins on dispositions), scale (50,000 JSON files becomes filesystem hostile), and immutable audit history. All real production gaps, none load bearing for the demo.

**Why pin entity IDs for Sberbank, VTB, Transneft, Kalashnikov?** Sayari's default resolution returned subsidiaries instead of parents. For Sberbank, the top match was an LLC back office subsidiary with degree 780; the actual parent has degree 59,632. I verified each pin via degree, tax ID (INN), and registration number, then committed the pins with comments explaining why (`packages/engine/resolve.py` lines 18 to 35). For Kalashnikov specifically, the verified parent's Sayari profile is missing the entity level OFAC factor (it appears on subsidiaries instead). The UI honestly surfaces this as a discrepancy rather than hiding it; cross referencing SDN # 16911, INN 1832090230, and registration 1111832003018 confirms the listed entity is the parent.

**Why steelman the OFAC matcher rather than ship a weaker baseline?** Earlier I shipped a screen without Cyrillic transliteration, which made Sayari look like it caught eight more entities than a fair comparison would show. I rebuilt the matcher to be honest, which moved the number from 41 to 33 finds. The structural argument (Sayari catches the ownership gap, period) survives at either number, and the honest comparison is what compliance teams would actually run.

**Why Babel standalone for the frontend instead of Next.js?** Zero build step. Every JSX file is readable as text and runnable in a browser without compilation. Made iteration during the time budget feasible, and means the code you read is the code the browser runs. Production move would be a real bundler, but for an interview deliverable the lower abstraction is the point.

**Why the four golden copilot runs?** Each is a real captured Anthropic tool use run against list_1, generated by `/agent/capture` and saved as the verbatim event stream. They are not scripted. CACHED replays them so a reviewer with no API keys can still see the full copilot demonstration. Off script questions in CACHED mode return an honest "no cached answer" rather than play a wrong recording.

**Why two list runs (list_1 and list_3) and not list_2?** List_1 demonstrates the silent miss failure mode (ownership gap). List_3 demonstrates the noisy false positive failure mode. List_2 does not add a third distinct failure mode worth narrating, so I omitted it from the demo path while leaving the engine able to handle it via upload.

**Why server side PDF generation with WeasyPrint?** The briefing is a compliance artifact; analysts need to download a static document, not view a styled web page. WeasyPrint reads the same HTML template the entity surface uses, but produces a PDF with consistent typography, page breaks, and citation footnotes. Tradeoff: requires system level cairo and pango deps, which is why the Docker path is the recommended run mode.

**Why streaming SSE for the copilot and the validate run instead of polling?** Visual evidence of work. The right pane updates as tool calls complete, the validate trace updates as rows resolve. Both convey "real things are happening" in a way that polling cannot. Costs are minor (SSE works on Cloud Run, Render, Fly).

---

## What is real, what is representative, what is next

**Real and verifiable.**

The deterministic engine and all reconciliation math. Resolution with pinned parent IDs verified via degree and INN. The fair OFAC name screen and the 40 / 33 / 7 funnel. The ownership graph data, sourced from cached Sayari traversals. The grounded copilot in both modes. File based persistence with per run scoping. Briefing PDF generation. Disposition writes to disk and round trips across refreshes. The list_3 false positive findings (Magna, Continental, NSK, Mando).

**Representative (designed, not wired).**

Authentication: the landing page accepts any input. Session persistence works via localStorage but there is no real identity provider behind it. Integrations catalog: only the SFTP card is described as wired, the rest are catalog placeholders. Postgres: the code path exists and falls back to file storage. There is no schema migration committed, that would be production work. The reviewer name on dispositions is hardcoded to "P. Volkov" because there is no auth context to source it from.

**What is next given more time.**

Generalize the parent preference resolution heuristic so future lists do not need pinning. Scheduled OFAC SDN refresh (currently loaded once at startup from a cached XML). Immutable disposition history table. A real auth layer (Okta or Entra SSO) with role based maker / checker. A hallucination rate evaluation harness for the copilot.

---

## The submission package

This repo is the primary deliverable. Two supplementary files:

`Meridian_Sentinel_FDE_Report.docx` is a two page narrative covering the engagement, approach, headline finding, assumptions, challenges, and what is real versus representative. It is the document to read before the live review.

`demo.mp4` is a roughly six minute walkthrough covering the list_1 ownership gap story, the list_3 false positive story, the entity detail flow, the copilot, and a brief live upload demonstration.

The two lists from the original exercise are included as `Sayari_Interview_Exercise_List.xlsx`. Tab 1 is the seeded list_1. Tab 3 is the list_3 used for the false positive story.

---

## Acknowledgments

This work used Anthropic's Claude (Sonnet) as my pair programming partner via Claude Code. AI assistance is consistent with how I expect to work in the FDE role and consistent with the conversation about AI velocity that came up in the interview. Where Claude suggested an approach I disagreed with (a smoke test gap on hook ordering, an early canned default in the CACHED copilot fallback, a depth selector that conflated thesis consistency with UI uniformity), I pushed back and we corrected. The engineering judgment in this submission is mine, the velocity is shared.
