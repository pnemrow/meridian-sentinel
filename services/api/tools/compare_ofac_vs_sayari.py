"""
Tool: compare_ofac_vs_sayari

The Compare Hero — run all cached entities through both:
  (A) OFAC naive name-screen (what name-screening tools see)
  (B) Sayari resolution + risk flags (ownership-aware)

Returns a side-by-side comparison for every entity, highlighting:
  - OFAC misses (entity not found by name but Sayari flagged sanctioned)
  - Sayari-only catches (ownership-hidden sanctions via risk factors)
  - Full agreement (both catch it)
  - Clean (both clear)

This is the Aha moment: OFAC name-screening catches N;
Sayari catches the rest via resolution + 50%-rule ownership.
All facts from real API data — nothing stated the API didn't return.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import EntityCache, CitedResult, SourceCitation

if TYPE_CHECKING:
    from services.api.ofac.matcher import OfacMatcher


# OFAC SDN-specific risk factors — if any present, Sayari flags OFAC SDN exposure
OFAC_SDN_RISK_FACTORS = {
    "sanctioned_usa_ofac_sdn",
    "controlled_by_ofac_sdn",
    "owned_by_sanctioned_usa_ofac_sdn_entity",
    "owner_of_sanctioned_usa_ofac_sdn_entity",
    "ofac_50_percent_rule",
    "psa_ofac_50_percent_rule",
    "psa_owned_by_sanctioned_usa_ofac_sdn_entity",
    "psa_owner_of_sanctioned_usa_ofac_sdn_entity",
    "psa_sanctioned_usa_ofac_sdn",
    "ofac_sdgt_sanctioned",
}


def _sayari_ofac_exposure(risk_factors: list[str]) -> tuple[bool, str | None]:
    """Return (has_ofac_exposure, most_direct_risk_factor)."""
    for rf in risk_factors:
        if rf in OFAC_SDN_RISK_FACTORS:
            return True, rf
    return False, None


def compare_ofac_vs_sayari_tool(
    cache: EntityCache,
    ofac_matcher: "OfacMatcher | None",
    threshold: float = 0.7,
) -> CitedResult:
    """
    Compare OFAC name-screen vs Sayari for all cached entities.

    Data sources:
      - Sayari column: output/raw/{entity_id}.json (real API responses, cached)
      - OFAC column: live SDN XML match (or empty if matcher not ready)
    """
    profiles = cache.all_profiles()
    rows = []

    for p in profiles:
        if not p.matched:
            rows.append({
                "input_name": p.input_name,
                "entity_id": None,
                "match_label": None,
                "ofac_hit": False,
                "ofac_match_name": None,
                "ofac_programs": [],
                "sayari_sanctioned": None,
                "sayari_ofac_exposure": False,
                "sayari_ofac_factor": None,
                "sayari_risk_factors": [],
                "outcome": "unresolved",
                "aha": False,
                "source_cache_file": None,
            })
            continue

        # ── Sayari column ─────────────────────────────────────────────
        sayari_sanctioned = bool(p.sanctioned)
        sayari_ofac_exp, sayari_ofac_factor = _sayari_ofac_exposure(p.risk_factors)
        cache_file = cache.cache_file_path(p.entity_id) if p.entity_id else None

        # ── OFAC name-screen column ───────────────────────────────────
        ofac_hit = False
        ofac_match_name = None
        ofac_programs: list[str] = []

        if ofac_matcher is not None and p.input_name:
            matches = ofac_matcher.match(p.input_name, limit=1)
            good = [m for m in matches if m.match_score >= threshold]
            if good:
                ofac_hit = True
                ofac_match_name = good[0].primary_name
                ofac_programs = good[0].programs

        # ── Outcome classification ────────────────────────────────────
        # "aha" = Sayari catches it but OFAC name-screen misses it
        aha = sayari_ofac_exp and not ofac_hit
        if sayari_ofac_exp and ofac_hit:
            outcome = "both_catch"
        elif sayari_ofac_exp and not ofac_hit:
            outcome = "sayari_only"    # ← the aha case
        elif not sayari_ofac_exp and ofac_hit:
            outcome = "ofac_only"     # unusual; flag for review
        else:
            outcome = "clean"

        rows.append({
            "input_name": p.input_name,
            "entity_id": p.entity_id,
            "match_label": p.match_label,
            "countries": p.countries,
            "ofac_hit": ofac_hit,
            "ofac_match_name": ofac_match_name,
            "ofac_programs": ofac_programs,
            "sayari_sanctioned": sayari_sanctioned,
            "sayari_ofac_exposure": sayari_ofac_exp,
            "sayari_ofac_factor": sayari_ofac_factor,
            "sayari_risk_count": len(p.risk_factors),
            "sayari_top_risks": p.risk_factors[:5],
            "outcome": outcome,
            "aha": aha,
            "source_cache_file": cache_file,
        })

    # Summary stats
    sayari_caught = sum(1 for r in rows if r.get("sayari_ofac_exposure"))
    ofac_caught = sum(1 for r in rows if r.get("ofac_hit"))
    aha_count = sum(1 for r in rows if r.get("aha"))
    both_catch = sum(1 for r in rows if r.get("outcome") == "both_catch")

    return CitedResult(
        data={
            "rows": rows,
            "summary": {
                "total_entities": len(rows),
                "sayari_ofac_exposure_count": sayari_caught,
                "ofac_name_screen_count": ofac_caught,
                "sayari_only_count": aha_count,
                "both_catch_count": both_catch,
                "aha_message": (
                    f"OFAC name-screen catches {ofac_caught} entities. "
                    f"Sayari catches {sayari_caught} via resolution + ownership — "
                    f"{aha_count} additional entities OFAC name-screen misses."
                ),
            },
            "ofac_matcher_ready": ofac_matcher is not None,
            "ofac_fetched_at": ofac_matcher.fetched_at if ofac_matcher else None,
        },
        source=SourceCitation(
            raw_field_path="data.risk.sanctioned_usa_ofac_sdn.value, data.risk.ofac_50_percent_rule.value",
            cache_file="output/raw/*.json (all cached entity profiles)",
            api_endpoint="cached GET /v1/entity/{id} responses + OFAC SDN XML",
        ),
    )
