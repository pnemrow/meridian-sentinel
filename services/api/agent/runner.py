"""
Agent runner — grounded streaming compliance co-pilot.

Two modes:
  LIVE:   Calls Anthropic API (claude-sonnet-4-6) + executes real tools.
          Events are emitted as they complete.
  CACHED: Replays a captured golden-run event stream from
          output/agent_runs/{run_id}.json (deterministic, zero latency).

SSE event protocol:
  {"event": "token",       "data": "string chunk"}
  {"event": "tool_call",   "data": {"id", "name", "input"}}
  {"event": "tool_result", "data": {"id", "name", "duration_ms", "ok", "summary", "source"}}
  {"event": "citation",    "data": {"ref", "label", "source"}}
  {"event": "flag",        "data": {"kind": "verify", "entity_id", "reason"}}
  {"event": "answer_meta", "data": {"confidence", "sources_count", "tools_used"}}
  {"event": "done",        "data": {}}
  {"event": "error",       "data": {"message"}}
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

_AGENT_RUNS_DIR = _REPO / "output" / "agent_runs"

# Golden run index: question keywords → run_id
# Primary keys match design's exact chip strings; legacy keys kept for backward compat.
_GOLDEN_QUESTIONS: dict[str, str] = {
    # Design chip strings (exact substrings)
    "vendors can't we onboard": "golden_001",
    "aren't on the ofac list but are still blocked": "golden_002",
    "who actually owns belorusskaya": "golden_003",
    "single riskiest entity": "golden_004",
    # Legacy / partial-match fallbacks
    "can't we onboard": "golden_001",
    "cannot onboard": "golden_001",
    "which entities": "golden_001",
    "companies that aren't on the ofac": "golden_002",
    "ownership gap": "golden_002",
    "belorusskaya kaliynaya": "golden_003",
    "who owns": "golden_003",
    "riskiest entity": "golden_004",
    "highest risk": "golden_004",
    "worst entity": "golden_004",
}

MODEL = "claude-sonnet-4-6"


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(event: str, data: Any) -> str:
    return f"data: {json.dumps({'event': event, 'data': data}, default=str)}\n\n"


# ── CACHED mode: replay golden runs ──────────────────────────────────────────

def _find_golden_run_id(question: str) -> str | None:
    q_lower = question.lower()
    for kw, run_id in _GOLDEN_QUESTIONS.items():
        if kw in q_lower:
            return run_id
    return None


async def run_agent_cached(question: str, run_id: str | None = None) -> AsyncGenerator[str, None]:
    """Replay a captured golden-run event stream."""
    resolved_id = run_id or _find_golden_run_id(question)
    if not resolved_id:
        resolved_id = "golden_001"  # default

    path = _AGENT_RUNS_DIR / f"{resolved_id}.json"
    if not path.exists():
        yield _sse("error", {"message": f"No cached run found for '{question}'. Run in LIVE mode to generate."})
        yield _sse("done", {})
        return

    run_data = json.loads(path.read_text(encoding="utf-8"))
    events = run_data.get("events", [])

    for evt in events:
        yield _sse(evt["event"], evt["data"])
        # Small delay for visual streaming effect
        delay = 0.03 if evt["event"] == "token" else 0.08
        await asyncio.sleep(delay)

    yield _sse("done", {})


# ── LIVE mode: Anthropic tool-use loop ───────────────────────────────────────

async def run_agent_live(
    question: str,
    cache,         # EntityCache
    ofac_matcher,  # OfacMatcher | None
    capture: bool = False,  # if True, save events to output/agent_runs/
) -> AsyncGenerator[str, None]:
    """
    Run the grounded agent live: Anthropic API + real tool execution.

    Emits SSE events as they complete. If capture=True, saves the event
    stream to output/agent_runs/ for future CACHED replay.
    """
    import anthropic

    from .tools import TOOL_SCHEMAS, SYSTEM_PROMPT, execute_tool, _summarize_result

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        yield _sse("error", {"message": "ANTHROPIC_API_KEY not set."})
        yield _sse("done", {})
        return

    client = anthropic.Anthropic(api_key=api_key)

    messages: list[dict] = [{"role": "user", "content": question}]
    tools_used: list[str] = []
    sources: list[dict] = []
    captured_events: list[dict] = []

    def _emit(event: str, data: Any) -> str:
        if capture:
            captured_events.append({"event": event, "data": data})
        return _sse(event, data)

    # Anthropic calls are blocking — run in thread pool
    loop = asyncio.get_event_loop()
    max_iterations = 10

    for _ in range(max_iterations):
        # Non-streaming call (streaming + tool use requires complex buffering)
        try:
            response = await loop.run_in_executor(
                None,
                lambda: client.messages.create(
                    model=MODEL,
                    max_tokens=4096,
                    system=SYSTEM_PROMPT,
                    tools=TOOL_SCHEMAS,
                    messages=messages,
                ),
            )
        except Exception as exc:
            yield _emit("error", {"message": f"Anthropic API error: {exc}"})
            yield _emit("done", {})
            break

        # Process content blocks
        tool_use_blocks = []
        text_content = ""

        for block in response.content:
            if block.type == "text":
                text_content += block.text
            elif block.type == "tool_use":
                tool_use_blocks.append(block)

        # Stream text tokens (word-by-word for visual effect)
        if text_content:
            words = text_content.split(" ")
            for i, word in enumerate(words):
                chunk = word + (" " if i < len(words) - 1 else "")
                yield _emit("token", chunk)
                await asyncio.sleep(0.02)  # ~50 wpm visual streaming

        if response.stop_reason == "end_turn":
            # Emit answer_meta and done
            yield _emit("answer_meta", {
                "confidence": "high",
                "sources_count": len(sources),
                "tools_used": list(dict.fromkeys(tools_used)),  # preserve order, deduplicate
            })
            yield _emit("done", {})

            if capture:
                _save_golden_run(question, captured_events)
            break

        if response.stop_reason != "tool_use" or not tool_use_blocks:
            yield _emit("done", {})
            break

        # Execute tools
        tool_results = []
        for block in tool_use_blocks:
            tool_name = block.name
            tool_input = block.input
            tool_id = block.id

            yield _emit("tool_call", {"id": tool_id, "name": tool_name, "input": tool_input})

            # Execute in thread pool (tools are synchronous)
            result_dict, duration_ms = await loop.run_in_executor(
                None,
                lambda b=block: execute_tool(b.name, b.input, cache, ofac_matcher),
            )

            ok = "error" not in (result_dict.get("data") or {})
            summary = _summarize_result(tool_name, result_dict)
            source = result_dict.get("source") or {}

            yield _emit("tool_result", {
                "id": tool_id,
                "name": tool_name,
                "duration_ms": duration_ms,
                "ok": ok,
                "summary": summary,
                "source": source,
            })

            # Emit citation
            if source:
                sources.append(source)
                yield _emit("citation", {
                    "ref": tool_id,
                    "label": tool_name,
                    "source": source,
                })

            # Emit verify flag if tool signals low confidence
            data = result_dict.get("data") or {}
            if isinstance(data, dict) and data.get("warn_verify"):
                entity_id = data.get("entity_id", "")
                yield _emit("flag", {
                    "kind": "verify",
                    "entity_id": entity_id,
                    "reason": (
                        f"Low-confidence resolution for {data.get('input_name', entity_id)}. "
                        f"Match label: {data.get('match_label')}. "
                        f"Verify this is the intended entity before relying on its profile."
                    ),
                })

            tools_used.append(tool_name)

            # Trim large tool results before adding to context (keep data summary only)
            tool_content = _truncate_for_context(result_dict)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps(tool_content, default=str),
            })

        # Continue the conversation with tool results
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    else:
        yield _emit("error", {"message": "Agent reached max iterations without completing."})
        yield _emit("done", {})


def _truncate_for_context(result_dict: dict) -> dict:
    """
    Trim tool results before adding them to the Anthropic context window.

    compare_ofac_vs_sayari returns 49 rows — we keep the summary + a capped
    row list to avoid blowing the context limit.
    """
    data = result_dict.get("data")
    if not isinstance(data, dict):
        return result_dict

    # For compare: keep summary + flagged rows only
    if "rows" in data and "summary" in data:
        flagged = [r for r in data["rows"] if r.get("outcome") not in ("no_ofac", "unresolved")]
        return {
            **result_dict,
            "data": {
                "summary": data["summary"],
                "flagged_rows": flagged[:20],  # cap at 20 rows
                "total_rows": len(data["rows"]),
                "ofac_matcher_ready": data.get("ofac_matcher_ready"),
            },
        }
    return result_dict


# ── Golden run capture ────────────────────────────────────────────────────────

def _save_golden_run(question: str, events: list[dict]) -> None:
    """Save a captured agent run to output/agent_runs/."""
    _AGENT_RUNS_DIR.mkdir(parents=True, exist_ok=True)

    # Determine run_id from question
    run_id = _find_golden_run_id(question)
    if not run_id:
        # Auto-assign next ID
        existing = list(_AGENT_RUNS_DIR.glob("golden_*.json"))
        run_id = f"golden_{len(existing) + 1:03d}"

    path = _AGENT_RUNS_DIR / f"{run_id}.json"
    run_data = {
        "run_id": run_id,
        "question": question,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "events": events,
    }
    path.write_text(json.dumps(run_data, indent=2, default=str), encoding="utf-8")


async def capture_golden_runs(cache, ofac_matcher) -> None:
    """Run all golden questions live and save their event streams."""
    # These strings MUST match the chip buttons in design-prototype/data/fixtures.js COPILOT_GOLDEN_QUESTIONS
    questions = [
        ("golden_001", "Which of these vendors can't we onboard, and why?"),
        ("golden_002", "Show me the companies that aren't on the OFAC list but are still blocked."),
        ("golden_003", "Who actually owns Belorusskaya Kaliynaya Companya?"),
        ("golden_004", "What's the single riskiest entity on this list?"),
    ]

    for run_id, question in questions:
        print(f"\n[capture] Running: {run_id} — {question[:60]}...")
        events: list[dict] = []
        async for chunk in run_agent_live(question, cache, ofac_matcher, capture=False):
            # Parse the SSE payload
            if chunk.startswith("data: "):
                try:
                    payload = json.loads(chunk[6:])
                    events.append({"event": payload["event"], "data": payload["data"]})
                except Exception:
                    pass

        path = _AGENT_RUNS_DIR / f"{run_id}.json"
        run_data = {
            "run_id": run_id,
            "question": question,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "model": MODEL,
            "events": events,
        }
        path.write_text(json.dumps(run_data, indent=2, default=str), encoding="utf-8")
        print(f"[capture] Saved {len(events)} events → {path}")
        await asyncio.sleep(2)  # rate-limit between golden runs
