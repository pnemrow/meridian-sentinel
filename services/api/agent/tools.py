"""
Agent tool definitions and executor.

Defines the Anthropic tool schemas presented to the model, plus the
executor that dispatches to the real tool functions in services/api/tools/.

Every executed tool returns its full CitedResult.to_dict() so the runner
can emit citations alongside the tool_result event.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[4]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

# ── Anthropic tool schemas ────────────────────────────────────────────────────

TOOL_SCHEMAS: list[dict] = [
    {
        "name": "compare_ofac_vs_sayari",
        "description": (
            "Compare OFAC name-screen vs Sayari resolution+ownership for ALL entities "
            "in the current vendor list. Returns outcome breakdown: both_catch (directly "
            "on SDN, screen found it), sayari_only (ownership-exposed, name absent from SDN), "
            "matcher_miss (directly on SDN but screen failed), plus total_ofac_exposed and "
            "ownership_gap counts. Use this first to get the big picture."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "threshold": {
                    "type": "number",
                    "description": "OFAC match score threshold 0-1 (default 0.85)",
                },
            },
            "required": [],
        },
    },
    {
        "name": "risk_summary",
        "description": (
            "Get structured risk summary for a single entity_id: risk level "
            "(critical/high/medium/low), top risk factors, which sanction lists, "
            "confidence flag. Call this for entities flagged by compare_ofac_vs_sayari."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Sayari entity ID (from resolve_entity or compare_ofac_vs_sayari)",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "resolve_entity",
        "description": (
            "Resolve a vendor name to a Sayari entity. Returns entity_id, match label, "
            "confidence score, and name-mismatch warning. Use when you need the entity_id "
            "for a name that doesn't appear in the compare results."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Entity name to resolve"},
                "country": {"type": "string", "description": "ISO 3-letter country code (e.g. RUS, VEN)"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "get_profile",
        "description": (
            "Get full entity profile from Sayari: type, countries, risk factors, degree, "
            "source count, sanctioned/PEP flags. Use for detailed entity investigation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Sayari entity ID"},
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "traverse_ownership",
        "description": (
            "Get the ownership/UBO graph for an entity: nodes (entities), edges (ownership "
            "relationships with percentages), and sanction_hits (sanctioned nodes). Shows "
            "WHO owns this entity, revealing OFAC 50%-rule exposures."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Sayari entity ID"},
                "depth": {"type": "integer", "description": "Max ownership hops 1-3 (default 3)"},
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "screen_ofac",
        "description": (
            "Screen a specific name against the OFAC SDN list. Returns matched entries "
            "with match score and sanction programs. Use to verify or investigate a "
            "specific name match."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name to screen against OFAC SDN"},
                "threshold": {"type": "number", "description": "Match threshold 0-1 (default 0.85)"},
            },
            "required": ["name"],
        },
    },
]


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a compliance co-pilot for Meridian Energy Trading SA, a Geneva-based commodities
trading firm ($22B AUM). You help compliance officers screen vendor entities against
OFAC sanctions and assess ownership-based risk before onboarding.

MANDATORY RULES — never violate:
1. Only state facts that a tool returned. Never assert anything not grounded in tool output.
2. For every material factual claim, cite the source (entity_id, tool used, field).
3. When a resolution has low confidence or warn_verify=true, explicitly flag it with ⚠ VERIFY.
4. Never speculate about legal conclusions beyond what the tool data confirms.
5. Answer directly and concisely. Lead with the actionable answer, then support with evidence.
6. If a tool returns an error or no data, say so — do not invent alternative information.

WORKFLOW GUIDANCE:
- Start with compare_ofac_vs_sayari to get the full list picture.
- For specific entities needing detail, use risk_summary (quick) or get_profile (full).
- For ownership questions, use traverse_ownership.
- Mention outcome categories when relevant: both_catch (screen + Sayari agree),
  sayari_only / screen_ambiguous (Sayari finds via ownership graph — the key advantage),
  matcher_miss (on SDN but screen failed — name variation issue).

FORMAT:
- Use plain text, not markdown tables (UI renders these separately).
- For lists of flagged entities, use a numbered list with entity name → risk level → reason.
- Always end with a confidence statement and any ⚠ flags.\
"""


# ── Tool executor ─────────────────────────────────────────────────────────────

def execute_tool(
    name: str,
    inputs: dict[str, Any],
    cache,        # EntityCache
    ofac_matcher,  # OfacMatcher | None
) -> tuple[dict, int]:
    """
    Execute a named tool and return (result_dict, duration_ms).

    result_dict has the CitedResult.to_dict() shape: {data: ..., source: {...}}.
    duration_ms is wall-clock execution time for the tool_result event.
    """
    from services.api.tools.resolve_entity import resolve_entity_tool
    from services.api.tools.get_profile import get_profile_tool
    from services.api.tools.screen_ofac import screen_ofac_tool
    from services.api.tools.risk_summary import risk_summary_tool
    from services.api.tools.traverse_ownership import traverse_ownership_tool
    from services.api.tools.compare_ofac_vs_sayari import compare_ofac_vs_sayari_tool

    t0 = time.perf_counter()
    try:
        if name == "compare_ofac_vs_sayari":
            r = compare_ofac_vs_sayari_tool(
                cache=cache,
                ofac_matcher=ofac_matcher,
                threshold=float(inputs.get("threshold", 0.85)),
            )
        elif name == "risk_summary":
            r = risk_summary_tool(entity_id=inputs["entity_id"], cache=cache)
        elif name == "resolve_entity":
            r = resolve_entity_tool(
                name=inputs["name"],
                country=inputs.get("country"),
                cache=cache,
            )
        elif name == "get_profile":
            r = get_profile_tool(entity_id=inputs["entity_id"], cache=cache)
        elif name == "traverse_ownership":
            r = traverse_ownership_tool(
                entity_id=inputs["entity_id"],
                depth=int(inputs.get("depth", 3)),
            )
        elif name == "screen_ofac":
            r = screen_ofac_tool(
                name=inputs["name"],
                threshold=float(inputs.get("threshold", 0.85)),
                ofac_matcher=ofac_matcher,
            )
        else:
            return {"error": f"Unknown tool: {name}"}, 0
    except Exception as exc:
        duration_ms = int((time.perf_counter() - t0) * 1000)
        return {"error": str(exc)}, duration_ms

    duration_ms = int((time.perf_counter() - t0) * 1000)
    return r.to_dict(), duration_ms


def _summarize_result(name: str, result: dict) -> str:
    """Short human-readable summary of a tool result for the tool_result event."""
    data = result.get("data") or {}
    if isinstance(data, dict) and data.get("error"):
        return f"Error: {data['error']}"

    if name == "compare_ofac_vs_sayari":
        s = (data.get("summary") or {})
        return (
            f"{s.get('both_catch', '?')} both_catch, "
            f"{s.get('ownership_gap', '?')} ownership_gap, "
            f"{s.get('matcher_miss', '?')} matcher_miss — "
            f"{s.get('total_ofac_exposed', '?')} total OFAC exposed"
        )
    if name == "risk_summary":
        return (
            f"{data.get('input_name', '')} — {data.get('risk_level', '?').upper()}, "
            f"sanctioned={data.get('sanctioned')}, "
            f"warn_verify={data.get('warn_verify')}"
        )
    if name == "resolve_entity":
        matches = data.get("matches") or []
        if matches:
            top = matches[0]
            return f"Resolved: {top.get('label')} [{top.get('entity_id')}] score={top.get('match_score')}"
        return "No match found"
    if name == "get_profile":
        return (
            f"{data.get('match_label', '')} [{data.get('entity_id', '')}] "
            f"sanctioned={data.get('sanctioned')} risks={len(data.get('risk_factors', []))}"
        )
    if name == "traverse_ownership":
        return (
            f"{len(data.get('nodes', []))} nodes, {len(data.get('edges', []))} edges, "
            f"{len(data.get('sanction_hits', []))} sanction hits"
        )
    if name == "screen_ofac":
        matches = data.get("matches") or []
        if matches:
            top = matches[0]
            return f"Hit: {top.get('primary_name')} [SDN {top.get('sdn_id')}] score={top.get('match_score'):.2f}"
        return "No OFAC SDN hit above threshold"
    return "OK"
