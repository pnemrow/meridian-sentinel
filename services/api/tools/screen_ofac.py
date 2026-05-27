"""
Tool: screen_ofac

Screen a name against the locally cached OFAC SDN feed.

This is the "naive name match" column in the compare hero:
  - No Sayari API quota burn.
  - No ownership traversal — just string matching.
  - Shows what a compliance team would catch with OFAC name screening alone.
  - The contrast with resolve+traverse is the Aha moment.

Returns CitedResult with:
  data:
    query: str
    matches: list of {sdn_id, primary_name, sdn_type, programs, matched_via, match_score}
    top_match: best match or None
    hit: bool (any match above threshold)
    fetched_at: when the SDN data was downloaded
  source: OFAC SDN feed citation
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import CitedResult, SourceCitation

if TYPE_CHECKING:
    from services.api.ofac.matcher import OfacMatcher


def screen_ofac_tool(
    name: str,
    threshold: float = 0.7,
    limit: int = 5,
    ofac_matcher: "OfacMatcher | None" = None,
) -> CitedResult:
    """
    Screen name against OFAC SDN.

    ofac_matcher must be an initialised OfacMatcher instance (injected by the
    FastAPI app on startup so the index is built once, not per request).
    """
    source = SourceCitation(
        raw_field_path="sdn.xml: uid, firstName, lastName, akaList, programList",
        api_endpoint="OFAC SDN feed (https://www.treasury.gov/ofac/downloads/sdn.xml)",
        cache_file="services/api/data/sdn.xml",
    )

    if ofac_matcher is None:
        return CitedResult(
            data={
                "query": name,
                "matches": [],
                "top_match": None,
                "hit": False,
                "error": "OFAC matcher not initialised — SDN XML may still be downloading.",
                "fetched_at": None,
            },
            source=source,
        )

    raw_matches = ofac_matcher.match(name, limit=limit)
    filtered = [m for m in raw_matches if m.match_score >= threshold]

    matches_out = [
        {
            "sdn_id": m.sdn_id,
            "primary_name": m.primary_name,
            "sdn_type": m.sdn_type,
            "programs": m.programs,
            "matched_via": m.matched_via,
            "matched_text": m.matched_text,
            "match_score": round(m.match_score, 4),
        }
        for m in filtered
    ]

    source.entity_url = (
        f"https://sanctionssearch.ofac.treas.gov/?Id={filtered[0].sdn_id}"
        if filtered else None
    )

    return CitedResult(
        data={
            "query": name,
            "matches": matches_out,
            "top_match": matches_out[0] if matches_out else None,
            "hit": bool(matches_out),
            "fetched_at": ofac_matcher.fetched_at,
        },
        source=source,
    )
