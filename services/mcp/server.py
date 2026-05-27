"""
Meridian Sentinel — MCP server.

Exposes the engine's tools over the Model Context Protocol so Claude (or any
MCP-compatible LLM) can call them directly — no HTTP hop, direct Python import.

Tools exposed (mirror the spec §4 Layer 1 + replit_reference/services/mcp-server/src/tools.ts):
  - resolve_entity
  - get_entity_profile
  - traverse_ownership
  - check_sanctions_exposure   (uses risk factors from cached profile)
  - compare_against_ofac       (OFAC name screen)
  - generate_briefing

Usage:
    pip install mcp
    python services/mcp/server.py

    Or from Claude Desktop config:
    {
      "mcpServers": {
        "sentinel": {
          "command": "python",
          "args": ["/path/to/services/mcp/server.py"],
          "env": {
            "OUTPUT_DIR": "/path/to/output",
            "OFAC_CACHE_DIR": "/path/to/services/api/data"
          }
        }
      }
    }
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("sentinel.mcp")

# ── Lazy singletons (loaded on first use) ─────────────────────────────────────
_cache = None
_ofac_matcher = None


def _get_cache():
    global _cache
    if _cache is None:
        from packages.engine import EntityCache
        output_dir = os.environ.get("OUTPUT_DIR", str(_REPO / "output"))
        _cache = EntityCache(output_dir)
        log.info("MCP: entity cache loaded — %d profiles", len(_cache.all_profiles()))
    return _cache


def _get_ofac():
    global _ofac_matcher
    if _ofac_matcher is None:
        from services.api.ofac.matcher import OfacMatcher
        ofac_dir = os.environ.get(
            "OFAC_CACHE_DIR",
            str(_REPO / "services" / "api" / "data"),
        )
        try:
            _ofac_matcher = OfacMatcher.load(ofac_dir)
            log.info("MCP: OFAC matcher loaded — %d entries", len(_ofac_matcher._entries))
        except Exception as exc:
            log.warning("MCP: OFAC matcher failed: %s", exc)
    return _ofac_matcher


# ── Tool implementations ──────────────────────────────────────────────────────

def _run_resolve_entity(args: dict) -> str:
    from services.api.tools.resolve_entity import resolve_entity_tool
    result = resolve_entity_tool(
        name=args["name"],
        country=args.get("country"),
        address=args.get("address"),
        identifier=args.get("identifier"),
        limit=int(args.get("limit", 5)),
        cache=_get_cache(),
    )
    return json.dumps(result.to_dict(), indent=2)


def _run_get_entity_profile(args: dict) -> str:
    from services.api.tools.get_profile import get_profile_tool
    result = get_profile_tool(
        entity_id=args["entity_id"],
        cache=_get_cache(),
    )
    return json.dumps(result.to_dict(), indent=2)


def _run_traverse_ownership(args: dict) -> str:
    from services.api.tools.traverse_ownership import traverse_ownership_tool
    result = traverse_ownership_tool(
        entity_id=args["entity_id"],
        depth=int(args.get("depth", 3)),
        direction=args.get("direction", "upstream"),
    )
    return json.dumps(result.to_dict(), indent=2)


def _run_check_sanctions_exposure(args: dict) -> str:
    """Check sanctions exposure from cached risk factors."""
    from services.api.tools.risk_summary import risk_summary_tool
    from services.api.tools.compare_ofac_vs_sayari import (
        OFAC_SDN_RISK_FACTORS, _sayari_ofac_exposure
    )
    entity_id = args["entity_id"]
    cache = _get_cache()
    result = risk_summary_tool(entity_id, cache)
    d = result.data
    if "error" in d:
        return json.dumps(result.to_dict(), indent=2)

    risk_factors = d.get("all_risk_factors", [])
    ofac_exp, ofac_factor = _sayari_ofac_exposure(risk_factors)

    exposure = {
        "entity_id": entity_id,
        "direct_sanctioned": d.get("sanctioned"),
        "ofac_sdn_exposure": ofac_exp,
        "ofac_factor": ofac_factor,
        "sanctioned_lists": d.get("sanctioned_lists", []),
        "risk_level": d.get("risk_level"),
        "top_risks": d.get("top_risks", []),
        "source": result.source.__dict__,
    }
    return json.dumps(exposure, indent=2)


def _run_compare_against_ofac(args: dict) -> str:
    from services.api.tools.screen_ofac import screen_ofac_tool
    result = screen_ofac_tool(
        name=args["name"],
        threshold=float(args.get("threshold", 0.7)),
        limit=int(args.get("limit", 5)),
        ofac_matcher=_get_ofac(),
    )
    return json.dumps(result.to_dict(), indent=2)


def _run_generate_briefing(args: dict) -> str:
    from services.api.tools.generate_briefing import generate_briefing_tool
    result = generate_briefing_tool(
        entity_id=args["entity_id"],
        cache=_get_cache(),
    )
    return json.dumps(result.to_dict(), indent=2)


TOOL_HANDLERS = {
    "resolve_entity": _run_resolve_entity,
    "get_entity_profile": _run_get_entity_profile,
    "traverse_ownership": _run_traverse_ownership,
    "check_sanctions_exposure": _run_check_sanctions_exposure,
    "compare_against_ofac": _run_compare_against_ofac,
    "generate_briefing": _run_generate_briefing,
}

# ── MCP server ────────────────────────────────────────────────────────────────

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp import types as mcp_types

    _mcp_available = True
except ImportError:
    _mcp_available = False
    log.warning("'mcp' package not installed. Install with: pip install mcp")


TOOL_DEFS = [
    {
        "name": "resolve_entity",
        "description": (
            "Resolve a raw vendor name (optionally with country/identifier) to ranked "
            "Sayari entity candidates. Always call this first when you have a name "
            "without a Sayari entity_id. Returns cached data if available."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Counterparty name as written."},
                "country": {"type": "string", "description": "ISO-2 country hint (e.g. 'RU', 'CN')."},
                "address": {"type": "string", "description": "Free-text address to disambiguate."},
                "identifier": {"type": "string", "description": "LEI, EIN, or other registry id."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
            },
            "required": ["name"],
        },
    },
    {
        "name": "get_entity_profile",
        "description": (
            "Fetch the full profile (addresses, risk factors, sanctions status, "
            "relationship counts) for a single Sayari entity_id. Returns cached data."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Sayari entity_id."},
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "traverse_ownership",
        "description": (
            "Walk the ownership graph from an entity_id up to `depth` hops. "
            "Returns nodes + edges + sanction_hits. "
            "Requires live Sayari credentials (burns API quota)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string"},
                "depth": {"type": "integer", "minimum": 1, "maximum": 5, "default": 3},
                "direction": {
                    "type": "string",
                    "enum": ["upstream", "downstream", "both"],
                    "default": "upstream",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "check_sanctions_exposure",
        "description": (
            "Determine sanctions exposure for an entity from cached Sayari risk factors. "
            "Returns direct sanctions status, OFAC SDN exposure, and all sanctioned lists. "
            "No API quota burn — uses pre-cached data."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string"},
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "compare_against_ofac",
        "description": (
            "Screen a counterparty name against the locally cached OFAC SDN feed. "
            "No Sayari quota burn. Use as a fast first-pass before deeper enrichment. "
            "Returns matches ranked by score."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Counterparty name to screen."},
                "threshold": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.7,
                    "description": "Minimum match score (0..1).",
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 5},
            },
            "required": ["name"],
        },
    },
    {
        "name": "generate_briefing",
        "description": (
            "Render a full compliance briefing for an entity. "
            "Returns the path to the rendered PDF (or HTML if WeasyPrint is unavailable). "
            "All facts in the briefing are cited to the Sayari cached API response."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "description": "Sayari entity_id."},
            },
            "required": ["entity_id"],
        },
    },
]


def run_server():
    """Start the MCP stdio server."""
    if not _mcp_available:
        print("ERROR: 'mcp' package required. pip install mcp", file=sys.stderr)
        sys.exit(1)

    server = Server("meridian-sentinel")

    @server.list_tools()
    async def list_tools():
        return [
            mcp_types.Tool(
                name=t["name"],
                description=t["description"],
                inputSchema=t["inputSchema"],
            )
            for t in TOOL_DEFS
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[mcp_types.TextContent]:
        handler = TOOL_HANDLERS.get(name)
        if handler is None:
            raise ValueError(f"Unknown tool: {name}")
        try:
            result_text = handler(arguments)
        except Exception as exc:
            log.exception("Tool %s failed", name)
            result_text = json.dumps({"error": str(exc), "tool": name})
        return [mcp_types.TextContent(type="text", text=result_text)]

    import asyncio
    asyncio.run(stdio_server(server))


if __name__ == "__main__":
    run_server()
