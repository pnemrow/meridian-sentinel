"""
Tool: risk_summary

Produce a structured risk summary for an entity or the full list.

Returns CitedResult with:
  data:
    entity_id: str (or None for full-list mode)
    risk_level: "critical" | "high" | "medium" | "low"
    top_risks: list of {factor, description}
    sanctioned: bool
    sanctioned_lists: list of sanction program names
    pep_adjacent: bool
    state_owned: bool
    country_risk: list of high-risk countries
    degree: int (relationship network size)
    source_count: int
    confidence: "high" | "low"
    warn_verify: bool (True → show "verify" flag in UI)
  source: cache file + field paths
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import EntityCache, CitedResult, SourceCitation

# Human-readable descriptions for selected risk factors
RISK_DESCRIPTIONS: dict[str, str] = {
    "sanctioned": "Entity is directly sanctioned",
    "sanctioned_usa_ofac_sdn": "On OFAC SDN list",
    "sanctioned_usa_ofac_non_sdn": "On OFAC Non-SDN list",
    "sanctioned_eu_sanctions": "On EU sanctions list",
    "sanctioned_gbr_fcdo": "On UK FCDO sanctions list",
    "sanctioned_can_gac": "On Canada GAC sanctions list",
    "sanctioned_che_seco": "On Switzerland SECO sanctions list",
    "ofac_50_percent_rule": "50%+ owned by OFAC-sanctioned entity",
    "eu_50_percent_rule": "50%+ owned by EU-sanctioned entity",
    "uk_50_percent_rule": "50%+ owned by UK-sanctioned entity",
    "controlled_by_ofac_sdn": "Controlled by OFAC SDN entity",
    "owned_by_sanctioned_entity": "Owned by a sanctioned entity",
    "owner_of_sanctioned_entity": "Owns sanctioned entities",
    "state_owned": "State-owned enterprise",
    "state_owned_rus": "Russian state-owned enterprise",
    "state_owned_blr": "Belarusian state-owned enterprise",
    "pep_adjacent": "Connected to politically exposed persons",
    "export_controls": "Subject to export controls",
    "usa_bis": "On US Bureau of Industry and Security list",
    "export_controls_other": "Other export control restrictions",
    "law_enforcement_action": "Subject to law enforcement action",
    "regulatory_action": "Subject to regulatory action",
    "reputational_risk_financial_crime": "Financial crime reputational risk",
    "reputational_risk_bribery_and_corruption": "Bribery/corruption risk",
    "reputational_risk_cybercrime": "Cybercrime reputational risk",
    "forced_labor_xinjiang_origin_subtier_product_blueprint": "Xinjiang forced labor supply chain risk",
    "formerly_sanctioned": "Previously sanctioned",
    "imports_bis_high_priority_items": "Imports BIS high-priority controlled items",
}

CRITICAL_FACTORS = {
    "sanctioned", "sanctioned_usa_ofac_sdn", "ofac_50_percent_rule",
    "controlled_by_ofac_sdn", "eu_50_percent_rule", "uk_50_percent_rule",
    "sanctioned_eu_sanctions", "sanctioned_gbr_fcdo",
}

HIGH_RISK_FACTORS = {
    "owned_by_sanctioned_entity", "state_owned_rus", "state_owned_blr",
    "export_controls", "usa_bis", "law_enforcement_action",
    "owner_of_sanctioned_usa_ofac_sdn_entity",
}

HIGH_RISK_COUNTRIES = {
    "RUS", "IRN", "PRK", "SYR", "CUB", "VEN", "MMR", "BLR", "AFG", "YEM",
    "SDN", "LBY", "ZWE", "NIC", "SOM", "IRQ", "HTI",
}


def _risk_level(risk_factors: list[str], sanctioned: bool | None) -> str:
    if sanctioned or any(f in CRITICAL_FACTORS for f in risk_factors):
        return "critical"
    if any(f in HIGH_RISK_FACTORS for f in risk_factors):
        return "high"
    if risk_factors:
        return "medium"
    return "low"


def _sanctioned_lists(risk_factors: list[str]) -> list[str]:
    lists = []
    prefixes = ["sanctioned_usa_ofac_sdn", "sanctioned_eu_sanctions", "sanctioned_gbr_fcdo",
                "sanctioned_can_gac", "sanctioned_che_seco", "sanctioned_aus_dfat",
                "sanctioned_jpn_mof", "sanctioned_nzl_mfat_rus", "sanctioned_eu_dg_fisma_ec",
                "sanctioned_eu_ec_regulation", "sanctioned_ukr_nsdc", "sanctioned_other"]
    for rf in risk_factors:
        if any(rf == p or rf.startswith(p) for p in prefixes):
            lists.append(rf)
    return lists


def risk_summary_tool(
    entity_id: str,
    cache: EntityCache,
) -> CitedResult:
    """Structured risk summary for a single entity."""
    cache_file = f"output/raw/{entity_id}.json"
    entity_url = f"/v1/entity/{entity_id}"

    raw = cache.get_entity_raw(entity_id)
    if raw is None:
        return CitedResult(
            data={"error": f"Entity {entity_id} not in cache.", "entity_id": entity_id},
            source=SourceCitation(entity_url=entity_url, api_endpoint="N/A — not cached"),
        )

    input_name = cache._id_to_name.get(entity_id, entity_id)
    from packages.engine import InputEntity, extract_profile
    e = InputEntity(row=0, name=input_name)
    match = {"entity_id": entity_id}
    profile = extract_profile(e, match, raw)

    level = _risk_level(profile.risk_factors, profile.sanctioned)
    sanction_lists = _sanctioned_lists(profile.risk_factors)

    top_risks = [
        {"factor": f, "description": RISK_DESCRIPTIONS.get(f, f.replace("_", " ").title())}
        for f in profile.risk_factors
        if f in CRITICAL_FACTORS or f in HIGH_RISK_FACTORS
    ][:10]

    country_risk = [c for c in profile.countries if c in HIGH_RISK_COUNTRIES]

    # Confidence: low if name_mismatch_flag or score < 50
    warn_verify = profile.name_mismatch_flag or (
        profile.match_score is not None and profile.match_score < 50
    )

    return CitedResult(
        data={
            "entity_id": entity_id,
            "input_name": input_name,
            "match_label": profile.match_label,
            "risk_level": level,
            "top_risks": top_risks,
            "all_risk_factors": profile.risk_factors,
            "sanctioned": bool(profile.sanctioned),
            "sanctioned_lists": sanction_lists,
            "pep_adjacent": "pep_adjacent" in profile.risk_factors,
            "state_owned": "state_owned" in profile.risk_factors,
            "country_risk": country_risk,
            "countries": profile.countries,
            "degree": profile.degree,
            "source_count": profile.source_count,
            "confidence": "low" if warn_verify else "high",
            "warn_verify": warn_verify,
        },
        source=SourceCitation(
            entity_url=entity_url,
            raw_field_path="data.risk.*, data.sanctioned, data.pep, data.countries, data.degree",
            cache_file=cache_file,
            api_endpoint="GET /v1/entity/{id} (cached)",
        ),
    )


def list_risk_summary_tool(cache: EntityCache) -> CitedResult:
    """Aggregate risk summary for the full cached entity list."""
    from packages.engine import build_summary
    profiles = cache.all_profiles()
    summary = build_summary(profiles)

    return CitedResult(
        data=summary,
        source=SourceCitation(
            raw_field_path="aggregated from data.risk.*, data.sanctioned per entity",
            cache_file="output/raw/*.json",
            api_endpoint="cached GET /v1/entity/{id} responses",
        ),
    )
