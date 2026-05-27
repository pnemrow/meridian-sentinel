"""
Tool: compare_ofac_vs_sayari

The Compare Hero — side-by-side comparison of:
  (A) Fair OFAC name-screen: a good-faith fuzzy match against the OFAC SDN list,
      with unidecode transliteration and multi-surface alias matching. This
      represents what a well-implemented compliance name-screening tool would find.
  (B) Sayari resolution + ownership-aware risk flags: uses the cached entity
      profiles which encode Sayari's graph-derived risk signals.

Outcome categories (mutually exclusive, structurally honest):

  both_catch       Entity is DIRECTLY named on the OFAC SDN list AND the name-
                   screen found it. Both tools agree.

  sayari_only      Entity is NOT directly named on the OFAC SDN list but has an
                   ownership-derived OFAC exposure factor (ofac_50_percent_rule,
                   controlled_by_ofac_sdn, or owned_by_sanctioned_usa_ofac_sdn_entity).
                   The name-screen correctly returns no hit because the entity's name
                   is absent from the list. Sayari finds it through ownership traversal.
                   This is the structural gap: OFAC's 50% rule (31 CFR § 501.801)
                   prohibits transacting with subsidiaries that are ≥50% owned by an
                   SDN entity, even though the subsidiary's name never appears on the list.

  matcher_miss     Entity IS directly named on the OFAC SDN list (Sayari says
                   sanctioned_usa_ofac_sdn = true) but the name-screen returned no hit
                   above the threshold. This is a matcher failure worth investigating,
                   NOT a genuine Sayari advantage. Reported honestly.

  ofac_only        Name-screen hit but Sayari shows no OFAC SDN exposure. Possible
                   false positive; flag for review.

  no_ofac          Neither screen has an OFAC SDN finding. Entity may still be
                   sanctioned on other lists (EU, UK, etc.) — shown in Sayari column.

  unresolved       Sayari could not resolve the entity at all.

All Sayari data from output/raw/{entity_id}.json (real cached API responses).
All OFAC data from the official SDN.XML feed. No fixtures; every number cited.
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


# ── Risk-factor taxonomy ──────────────────────────────────────────────────────

# Entity IS directly named on the OFAC SDN list.
# A well-implemented name-screen CAN find these.
DIRECT_SDN_FACTORS = {
    "sanctioned_usa_ofac_sdn",      # primary designation
    "psa_sanctioned_usa_ofac_sdn",  # PSA: this entity is the listed party
}

# Entity is exposed via ownership/control but its name is NOT on the SDN list.
# No name-screen can find these — this is the structural gap Sayari fills.
# Legal basis: OFAC's 50% rule (31 CFR § 501.801) and control doctrine.
OWNERSHIP_SDN_FACTORS = {
    "ofac_50_percent_rule",                        # ≥50% owned by an OFAC SDN entity
    "psa_ofac_50_percent_rule",                    # PSA version
    "owned_by_sanctioned_usa_ofac_sdn_entity",     # owned by OFAC SDN entity
    "psa_owned_by_sanctioned_usa_ofac_sdn_entity", # PSA version
    "controlled_by_ofac_sdn",                      # operationally controlled by SDN entity
}

# Excluded on purpose:
#   owner_of_sanctioned_usa_ofac_sdn_entity — entity OWNS an SDN subsidiary;
#   this does not block transactions with the parent. Different risk signal.


def _classify_exposure(risk_factors: list[str]) -> tuple[bool, bool, str | None, str | None]:
    """Return (is_directly_designated, is_ownership_exposed, direct_factor, ownership_factor)."""
    rf = set(risk_factors)
    direct_factor   = next((f for f in risk_factors if f in DIRECT_SDN_FACTORS),   None)
    ownership_factor = next((f for f in [
        "ofac_50_percent_rule", "psa_ofac_50_percent_rule",
        "controlled_by_ofac_sdn",
        "owned_by_sanctioned_usa_ofac_sdn_entity",
        "psa_owned_by_sanctioned_usa_ofac_sdn_entity",
    ] if f in rf), None)
    return bool(direct_factor), bool(ownership_factor), direct_factor, ownership_factor


def _why_screen_missed(is_direct: bool, ownership_factor: str | None, ofac_hit: bool) -> str | None:
    """Human-readable explanation for matcher_miss and sayari_only cases."""
    if not ofac_hit and not is_direct and ownership_factor:
        return (
            f"Entity name is absent from the OFAC SDN list — no name-screen can find it. "
            f"Sayari identifies OFAC exposure via '{ownership_factor}': "
            f"an SDN-designated entity owns/controls this entity (OFAC 50% rule)."
        )
    if not ofac_hit and is_direct:
        return (
            "Entity IS directly on the OFAC SDN list but the name-screen returned no match "
            "above threshold. Likely cause: name in SDN differs from input (aliasing, "
            "transliteration, or legal-form variation). Review SDN manually."
        )
    return None


def compare_ofac_vs_sayari_tool(
    cache: EntityCache,
    ofac_matcher: "OfacMatcher | None",
    threshold: float = 0.85,
) -> CitedResult:
    """
    Compare fair OFAC name-screen vs Sayari for all 49 cached entities.

    Sayari data: output/raw/{entity_id}.json (real cached GET /v1/entity/{id}).
    OFAC data:   in-memory SDN XML matcher with unidecode transliteration.
    """
    profiles = cache.all_profiles()
    rows = []

    for p in profiles:
        if not p.matched:
            rows.append({
                "input_name": p.input_name,
                "entity_id": None,
                "match_label": None,
                "outcome": "unresolved",
                "is_directly_designated": False,
                "is_ownership_exposed": False,
                "direct_factor": None,
                "ownership_factor": None,
                "ofac_hit": False,
                "ofac_match_name": None,
                "ofac_programs": [],
                "sayari_sanctioned": None,
                "why_screen_missed": None,
                "source_cache_file": None,
            })
            continue

        # ── Sayari column ─────────────────────────────────────────────────
        is_direct, is_ownership, direct_factor, ownership_factor = _classify_exposure(p.risk_factors)
        cache_file = cache.cache_file_path(p.entity_id) if p.entity_id else None

        # ── Fair OFAC name-screen column ──────────────────────────────────
        ofac_hit = False
        ofac_match_name = None
        ofac_sdn_id = None
        ofac_programs: list[str] = []

        if ofac_matcher is not None and p.input_name:
            matches = ofac_matcher.match(p.input_name, limit=1)
            good = [m for m in matches if m.match_score >= threshold]
            if good:
                ofac_hit = True
                ofac_match_name = good[0].primary_name
                ofac_sdn_id = good[0].sdn_id
                ofac_programs = good[0].programs

        # ── Outcome classification ────────────────────────────────────────
        if is_direct and ofac_hit:
            outcome = "both_catch"
        elif is_direct and not ofac_hit:
            outcome = "matcher_miss"      # screen should have found this; flag it
        elif not is_direct and is_ownership and not ofac_hit:
            outcome = "sayari_only"       # structural gap — name not on list
        elif not is_direct and is_ownership and ofac_hit:
            # Screen hit something — but entity is NOT directly on SDN.
            # The hit is almost certainly on a DIFFERENT entity (a parent, sibling
            # subsidiary, or alias of another SDN party). Classifying this as
            # "both_catch" would be dishonest: the screen didn't find THIS entity
            # by name because it's not on the list. Mark as screen_ambiguous.
            outcome = "screen_ambiguous"
        elif ofac_hit and not is_direct and not is_ownership:
            outcome = "ofac_only"         # possible false positive; investigate
        else:
            outcome = "no_ofac"           # no OFAC SDN exposure either way

        rows.append({
            "input_name": p.input_name,
            "entity_id": p.entity_id,
            "match_label": p.match_label,
            "countries": p.countries,
            "outcome": outcome,
            # Sayari
            "is_directly_designated": is_direct,
            "is_ownership_exposed": is_ownership,
            "direct_factor": direct_factor,
            "ownership_factor": ownership_factor,
            "sayari_sanctioned": bool(p.sanctioned),
            "sayari_risk_count": len(p.risk_factors),
            # OFAC screen
            "ofac_hit": ofac_hit,
            "ofac_match_name": ofac_match_name,
            "ofac_sdn_id": ofac_sdn_id,
            "ofac_programs": ofac_programs,
            # Explanation for missed / sayari-only cases
            "why_screen_missed": _why_screen_missed(is_direct, ownership_factor, ofac_hit),
            "source_cache_file": cache_file,
            "source_field": (
                f"data.risk.{direct_factor or ownership_factor}.value"
                if (direct_factor or ownership_factor) else None
            ),
        })

    # ── Aggregate counts ──────────────────────────────────────────────────────
    both_catch       = sum(1 for r in rows if r["outcome"] == "both_catch")
    sayari_only      = sum(1 for r in rows if r["outcome"] == "sayari_only")
    screen_ambiguous = sum(1 for r in rows if r["outcome"] == "screen_ambiguous")
    matcher_miss     = sum(1 for r in rows if r["outcome"] == "matcher_miss")
    ofac_only        = sum(1 for r in rows if r["outcome"] == "ofac_only")
    no_ofac          = sum(1 for r in rows if r["outcome"] == "no_ofac")
    unresolved       = sum(1 for r in rows if r["outcome"] == "unresolved")

    # All entities with any OFAC SDN exposure (direct or ownership)
    ofac_total        = both_catch + sayari_only + screen_ambiguous + matcher_miss
    # What the name-screen unambiguously caught (entity is directly on SDN + screen hit)
    ofac_screen_finds = both_catch

    # sayari_only + screen_ambiguous = entities NOT directly named on the SDN
    # that Sayari identifies via ownership traversal. The name-screen either
    # misses them entirely (sayari_only) or fires on a *different* SDN entity
    # (screen_ambiguous) — in neither case does it correctly identify THIS entity.
    ownership_gap = sayari_only + screen_ambiguous

    structural_argument = (
        f"A fair OFAC name-screen with unidecode transliteration catches {ofac_screen_finds} "
        f"of {ofac_total} OFAC-exposed entities. The remaining {ownership_gap} "
        f"({sayari_only} missed entirely, {screen_ambiguous} where screen hit a different entity) "
        f"are not named on the SDN list — they are blocked under OFAC's 50% rule "
        f"(31 CFR § 501.801) because an SDN-designated entity owns or controls them. "
        f"No name-screen can correctly identify these by the entity's own name; "
        f"Sayari identifies them through ownership graph traversal."
    )

    return CitedResult(
        data={
            "rows": rows,
            "summary": {
                "total_entities": len(rows),
                "both_catch": both_catch,
                "sayari_only": sayari_only,
                "screen_ambiguous": screen_ambiguous,
                "matcher_miss": matcher_miss,
                "ofac_only": ofac_only,
                "no_ofac": no_ofac,
                "unresolved": unresolved,
                "ofac_screen_finds": ofac_screen_finds,
                "ownership_gap": ownership_gap,
                "total_ofac_exposed": ofac_total,
                "structural_argument": structural_argument,
            },
            "ofac_matcher_ready": ofac_matcher is not None,
            "ofac_fetched_at": ofac_matcher.fetched_at if ofac_matcher else None,
        },
        source=SourceCitation(
            raw_field_path=(
                "data.risk.sanctioned_usa_ofac_sdn.value (direct), "
                "data.risk.ofac_50_percent_rule.value (ownership), "
                "data.risk.controlled_by_ofac_sdn.value (ownership)"
            ),
            cache_file="output/raw/*.json (all 49 cached entity profiles)",
            api_endpoint="cached GET /v1/entity/{id} responses + OFAC SDN.XML",
        ),
    )
