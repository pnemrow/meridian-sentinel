# Meridian Sentinel — Architectural Decision Records

These ADRs document the load-bearing decisions in Meridian Sentinel, a counterparty
intelligence platform built on the Sayari API for the Sayari FDE take-home. Each records
what was chosen, what was genuinely considered and rejected, the trade-off accepted, and a
link to the code that implements it. Every reference resolves at
`https://github.com/pnemrow/meridian-sentinel/blob/master/<path>`.

The guiding constraint throughout: this is a proof of concept, but it is designed as though
someone will deploy it to a regulated customer in eight weeks. The decisions below reflect
that posture — inspectability and provenance over polish, honesty over flattering numbers.

| # | Decision | Status |
|---|----------|--------|
| ADR-001 | No LLM in the data path | Accepted |
| ADR-002 | A steelmanned OFAC name-screen baseline | Accepted |
| ADR-003 | Pinned parent entity IDs with audit comments | Accepted |
| ADR-004 | File-first persistence, Postgres optional | Accepted |
| ADR-005 | Cache-first ownership traversal with per-run scoping | Accepted |
| ADR-006 | MCP server as a separate process importing the engine directly | Accepted |
| ADR-007 | In-memory credential store with contextual in-app prompts | Accepted |
| ADR-008 | CACHED mode as deterministic replay of captured real runs | Accepted |

---

## ADR-001: No LLM in the data path

**Status**: Accepted
**Date**: 2026-05-26

### Context
The product makes compliance decisions — which counterparties are blocked, and why. A
compliance officer (and, eventually, a FINMA examiner) has to be able to trace any figure
on screen back to a specific Sayari field months after the fact. An LLM that computes,
summarizes, or "interprets" risk data anywhere in that chain makes the output
non-reproducible and non-auditable.

### Decision
A deterministic Python engine produces every number rendered in the UI. The Claude agent
may only call typed tools that return a `CitedResult(data, source)` envelope — it narrates
and orchestrates over tool output, but it never originates a value.

### Alternatives Considered
- **RAG over embedded Sayari JSON** — Rejected. Embedding the entity profiles to retrieve
  them destroys the field structure that makes citations possible; you get a chunk ID, not
  `data.risk.sanctioned_usa_ofac_sdn.value`. Vector similarity is also the wrong retrieval
  model for structured graph data with exact identifiers.
- **Let the model compute the comparison / summarize risk factors directly** — Rejected.
  Faster to build, but it converts every number into something the model "said," which is
  exactly the audit liability the customer is trying to eliminate.

### Trade-offs Accepted
The agent can only answer questions the typed tools can serve. Genuinely open-ended
synthesis ("draft me a memo on emerging Eurasian ownership patterns") is out of scope by
construction. For a compliance tool, that constraint is a feature, not a cost.

### References
- Engine — single source of truth for risk-factor extraction: `packages/engine/profile.py:26-118`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/packages/engine/profile.py#L26-L118))
- Agent loop — tools are the only data source: `services/api/agent/runner.py:115-175`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/agent/runner.py#L115-L175))

---

## ADR-002: A steelmanned OFAC name-screen baseline

**Status**: Accepted
**Date**: 2026-05-27

### Context
The headline argument is that Sayari catches OFAC-exposed entities a name-screen misses.
That argument is only credible if the name-screen it is compared against is the kind a
competent compliance team would actually run. An early version of my matcher was ASCII-only
and under-counted what a real screen catches, which inflated Sayari's apparent advantage.

### Decision
Ship a fair, transliteration-aware OFAC name-screen: `unidecode` normalization (Cyrillic →
Latin) applied identically to the query and every SDN name/alias, a cascade of exact-alias →
primary-token coverage → single-token fallback, scored at the same 0.85 threshold the rest
of the comparison uses.

### Alternatives Considered
- **A weak ASCII-only matcher** — Rejected. It would have made Sayari catch ~8 more entities
  than an honest baseline, resting the whole thesis on a handicapped opponent.
- **An edit-distance / trigram fuzzy matcher** — Rejected for the demo. The SDN carries
  enough alias surfaces that exact-and-token matching on normalized strings is both higher
  precision and more explainable; fuzzy scoring would add false positives that muddy the
  "two distinct failure modes" story.

### Trade-offs Accepted
Steelmanning the baseline moved Sayari's comparison number from 41 down to 33 of 40. I chose
the smaller, honest number. The structural argument — four entities blocked only via the
ownership graph, which no name-screen can see — survives at either number, and it survives
*because* of the graph, not because of a rigged baseline.

### References
- Matcher (unidecode + alias cascade): `services/api/ofac/matcher.py:76-102`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/ofac/matcher.py#L76-L102))
- Tool wrapper + threshold: `services/api/tools/screen_ofac.py:37-98`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/tools/screen_ofac.py#L37-L98))
- Outcome classifier (6 categories): `services/api/tools/compare_ofac_vs_sayari.py:112-183`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/tools/compare_ofac_vs_sayari.py#L112-L183))

---

## ADR-003: Pinned parent entity IDs with audit comments

**Status**: Accepted
**Date**: 2026-05-26

### Context
Entity resolution is the make-or-break step: every downstream signal hangs off resolving a
vendor name to the *right* Sayari entity. Sayari's default top match, when seeded with the
supplied street addresses, repeatedly returned subsidiaries instead of parents — for
"Sberbank," a degree-780 back-office LLC rather than the degree-59,632 parent.

### Decision
Pin four marquee entities (Sberbank, VTB Bank, Transneft, Kalashnikov Concern) to verified
parent IDs, applied before any API call. Each pin carries an inline comment recording the
candidate it replaced, the relationship degree, the verifying identifier, and how to
re-verify.

### Alternatives Considered
- **Accept Sayari's top match blindly** — Rejected. Demonstrably wrong for these entities,
  and silently so; the demo would show a back-office LLC's risk profile under the parent's
  name.
- **A general parent-preference heuristic (rank by degree / ownership depth)** — Considered
  and deferred. This is the right production answer, but getting it correct on unseen lists
  is real work; for the take-home I pinned the known cases with documented evidence and
  flagged the heuristic as the next step.

### Trade-offs Accepted
Pins don't generalize to a new vendor list without re-verification — they are a documented
override, not a solution. The audit comments and the `name_mismatch_flag` surfaced in the UI
keep the override honest: a reviewer can see exactly what was pinned and why, and the path to
reproduce the verification is written down.

### References
- `PINNED_IDS` with the verification table: `packages/engine/resolve.py:15-34`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/packages/engine/resolve.py#L15-L34))

---

## ADR-004: File-first persistence, Postgres optional

**Status**: Accepted
**Date**: 2026-05-25

### Context
The platform's entire value proposition is "trace every finding to its source." The
persistence layer has to make that auditability trivial, and the take-home has to run on any
reviewer's machine with zero infrastructure setup.

### Decision
Default to file-based persistence: every cached Sayari response, ownership traversal, run
summary, and captured agent stream is a JSON file under `output/`. Ship an *optional*
six-table Postgres schema; the data-serving code falls back to the file layout when
`DATABASE_URL` is unset.

### Alternatives Considered
- **Postgres as the required primary store** — Rejected for a PoC. It adds a setup step for
  every reviewer and hides the data behind a query layer, when the whole pitch is "open the
  file and grep for the field."
- **SQLite as a middle ground** — Rejected. Still opaque relative to plain JSON, and it
  buys little over files for a single-tenant demo while costing the inspectability that
  makes the trust story land.

### Trade-offs Accepted
File-first concedes real production properties: concurrency (last-write-wins on
dispositions), scale (tens of thousands of JSON files is filesystem-hostile), and immutable
audit history. All three are genuine production gaps — none is load-bearing for the demo,
and the Postgres path is already wired to take them on.

### References
- Schema (6 `CREATE TABLE` statements): `db/schema.sql:22-165`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/db/schema.sql#L22-L165))
- Postgres-primary / JSON-fallback router: `services/api/routers/investigations.py`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/routers/investigations.py))

---

## ADR-005: Cache-first ownership traversal with per-run scoping

**Status**: Accepted
**Date**: 2026-05-29

### Context
The ownership graph is the most expensive thing to fetch (multi-second UBO traversals) and
the most demo-load-bearing. A reviewer with no Sayari credentials still needs the full
graph experience for every entity on the seeded lists, and uploaded runs need their own
traversal data without colliding with the default cache.

### Decision
Make `traverse_ownership` cache-first: the loader checks a run-scoped
`output/runs/{run_id}/raw/traversal/{id}.json` first, then falls back to the default
`output/raw/traversal/`. On a live miss, the freshly-fetched raw Sayari payload is persisted
to the appropriate run-scoped directory verbatim, so the next read is a cache hit producing
identical nodes and edges.

### Alternatives Considered
- **Always traverse live** — Rejected. Breaks the credential-free demo entirely and burns
  Sayari quota on every graph view.
- **One global traversal cache** — Rejected. Uploaded runs would write into the shared
  default directory and pollute the marquee list_1 data; per-run scoping keeps each
  investigation's graph data self-contained.
- **Persist the normalized nodes/edges instead of the raw payload** — Rejected (and
  actively fixed). Persisting normalized output meant the re-read couldn't reproduce the
  same transform; storing the raw upstream payload makes the cache a faithful replay of the
  API response.

### Trade-offs Accepted
Pre-caching every list entity's traversal adds ~90 seconds of one-time scripted fetching and
commits a few MB of JSON to the repo. In exchange, the entire demo — including the ownership
graph for non-marquee entities — runs offline and reproducibly.

### References
- Run-scoped cache loader with fallback: `services/api/tools/traverse_ownership.py:113-137`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/tools/traverse_ownership.py#L113-L137))
- Live traversal persists raw payload to per-run dir: `services/api/tools/traverse_ownership.py:222-250`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/tools/traverse_ownership.py#L222-L250))

---

## ADR-006: MCP server as a separate process importing the engine directly

**Status**: Accepted
**Date**: 2026-05-24

### Context
Sayari's product domain is exactly the kind of capability set agents want to call. Exposing
the engine over the Model Context Protocol demonstrates platform thinking — the same
capabilities serving a human UI and any MCP client (Claude Desktop, Cursor, etc.) — not just
app thinking.

### Decision
Run the MCP server as a separate Python stdio process that imports the engine package
directly (`packages.engine`), rather than calling the FastAPI HTTP service. Six tools are
exposed, mirroring the core capabilities: resolve, profile, traverse, sanctions exposure,
OFAC compare, and briefing.

### Alternatives Considered
- **MCP server calls the FastAPI HTTP endpoints** — Rejected for this PoC. It adds a network
  hop and a serialization round-trip for no benefit when the engine is importable in-process;
  the HTTP layer exists for the browser, which needs it, while the MCP server runs alongside
  the engine and doesn't.
- **A multi-transport MCP server (stdio + SSE + HTTP)** — Rejected as over-scoped. Claude
  Desktop integration is stdio; building three transports for a take-home is polish that
  doesn't change the architectural story.

### Trade-offs Accepted
Importing the engine directly means the MCP process doesn't inherit any HTTP-layer auth,
rate limiting, or audit middleware. For a production multi-client deployment that matters,
and the right answer there is likely to route MCP through the same gateway as human traffic —
a deliberate next-step, not a regression, since the current demo runs locally and single-user.

### References
- MCP tool registration (`list_tools` / `call_tool`): `services/mcp/server.py:305-333`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/mcp/server.py#L305-L333))
- The six exposed tools (documented): `services/mcp/server.py:7-13`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/mcp/server.py#L7-L13))

---

## ADR-007: In-memory credential store with contextual in-app prompts

**Status**: Accepted
**Date**: 2026-05-29

### Context
LIVE mode needs Sayari and Anthropic credentials, but requiring a reviewer to edit `.env`
before the first run is friction, and storing credentials anywhere persistent (disk, browser
localStorage) is a liability for a compliance-adjacent tool.

### Decision
Hold credentials in a process-local in-memory store, cleared on restart by design. The store
takes priority over environment variables, so an in-app entry overrides `.env` without a
restart. Contextual modals surface exactly when a LIVE feature needs a credential — at the
mode toggle, the co-pilot input, and the live graph fetch. Status endpoints return booleans
only; values are never sent back to the browser.

### Alternatives Considered
- **`.env`-only configuration** — Rejected as the sole path. It works (and remains a
  supported fallback), but it forces upfront setup and makes quick LIVE trials awkward.
- **Persist credentials to browser localStorage** — Rejected outright. Convenient, but
  storing API keys in the browser is the wrong default for any tool touching sanctions data.
- **A secrets manager (Vault / Secret Manager)** — Right for production, over-scoped for the
  take-home; the in-memory store is the demo-appropriate analogue and the production swap is
  a known boundary.

### Trade-offs Accepted
Credentials don't survive a container restart — intentional. The store gives no durable
audit of who entered what; that's acceptable for a single-user local demo and would be
replaced by a real IdP + secret manager in production.

### References
- Credential store (`set` / `get` / `status` / `clear`): `services/api/credentials.py:1-68`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/credentials.py#L1-L68))
- Store-over-env lookup with lazy import: `packages/engine/client.py:17-23`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/packages/engine/client.py#L17-L23))
- Endpoints (`POST`/`GET`/`DELETE /api/credentials`): `services/api/main.py:545-566`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/main.py#L545-L566))

---

## ADR-008: CACHED mode as deterministic replay of captured real runs

**Status**: Accepted
**Date**: 2026-05-28

### Context
The co-pilot is the highest-latency, highest-cost surface (a multi-step Claude tool-use
loop). A reviewer with no Anthropic key still needs to see the full grounded-agent
experience, and the demo can't depend on live API spend or non-determinism.

### Decision
Capture four real agent runs against the seeded list — generated by hitting the live
Anthropic and Sayari APIs — and save the verbatim SSE event streams to
`output/agent_runs/golden_00{1-4}.json`. CACHED mode maps a question to its golden run and
replays the recorded stream deterministically. Questions with no matching capture return an
honest "no cached answer — switch to LIVE," never a fabricated one.

### Alternatives Considered
- **Scripted / hand-authored mock responses** — Rejected. They wouldn't be real agent
  behavior, and the entire credibility of the demo rests on "this is a recording of the real
  thing, not a simulation."
- **Always run live** — Rejected. Requires an Anthropic key for every reviewer and makes the
  demo non-deterministic and slow.
- **A generic "I can't answer that in cached mode" for everything** — Rejected. The four
  golden runs cover the load-bearing questions; falling back to honesty only for
  *unmatched* questions preserves both the demo and the integrity of the mode badge.

### Trade-offs Accepted
CACHED mode only answers the four captured questions; anything else routes to the honest
fallback. That's the correct boundary — a recorded demo should never pretend to answer a
question it didn't actually run.

### References
- Cached replay + golden-run mapping: `services/api/agent/runner.py:69-113`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/agent/runner.py#L69-L113))
- Live agent loop (the captured source): `services/api/agent/runner.py:115-175`
  ([link](https://github.com/pnemrow/meridian-sentinel/blob/master/services/api/agent/runner.py#L115-L175))

---

*Generated for the Sayari FDE take-home review · June 2026 · Peter Nemrow*
*Every reference above resolves against the `master` branch at the time of writing.*
