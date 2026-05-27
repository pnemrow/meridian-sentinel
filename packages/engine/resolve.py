"""
Entity resolution logic.

Ported from sayari_ground_truth.py, refactored into an importable module.
Pinned IDs and retry-name overrides live here as the single authoritative source.
"""
from __future__ import annotations

import re
from typing import Any

from .types import InputEntity
from .helpers import to_dict, first_present


# ---------------------------------------------------------------------------
# Verified parent entity IDs — applied before any API call
# ---------------------------------------------------------------------------
# To re-verify: delete an entry, re-run resolution, inspect
# output/raw/row{n}_resolution.json, check degree via get_entity for each
# candidate, and restore the correct ID.
#
# Entity                 | Pinned ID                  | Degree  | Why pinned
# Sberbank               | OWwtbp9y51OcLHJQakLaMw     | 59,632  | [0] was LLC Sberbank Service (degree 780)
# VTB Bank               | dy-rh2g0QtzUN_jC_e9S_A     | 15,509  | [0] was VTB Capital Holdings (degree 208)
# Transneft              | 9-IuyJoA08bELHrSY3mXXA     |  1,526  | [0] was TRANSNEFT (degree 464, stub)
# Kalashnikov Concern    | zqpMddadf94y39RfB3AgcA     |     60  | [0] was Innovation Center subsidiary SyiWoXAi7JAAOfdzOWpBDQ
#                        |                            |         | Parent confirmed = SDN 16911 via INN 1832090230 + reg 1111832003018
#                        |                            |         | NOTE: parent lacks sanctioned_usa_ofac_sdn in Sayari (data gap)
PINNED_IDS: dict[str, str] = {
    "Sberbank":             "OWwtbp9y51OcLHJQakLaMw",
    "VTB Bank":             "dy-rh2g0QtzUN_jC_e9S_A",
    "Transneft":            "9-IuyJoA08bELHrSY3mXXA",
    "Kalashnikov Concern":  "zqpMddadf94y39RfB3AgcA",
}

RETRY_NAMES: dict[str, list[str]] = {
    "Venezuelan State-Owned Oil Company (PDVSA)": [
        "PDVSA", "Petroleos de Venezuela", "Petróleos de Venezuela SA",
    ],
    "State Development Bank VEB.RF": [
        "Vnesheconombank", "VEB.RF", "VEB Bank",
        "Bank for Development and Foreign Economic Affairs",
    ],
    "Belnauchcompositit": ["Belnauchkomposit", "Belnaukcomposit"],
    "Belorusskaya Kaliynaya Companya": [
        "Belarusian Potash Company", "Belarusian Potash Corporation", "BPC",
    ],
}


def resolve_entity(client, e: InputEntity) -> tuple[dict | None, dict]:
    """Call the Sayari resolution endpoint. Returns (best_match_dict, raw_response)."""
    kwargs: dict[str, Any] = {"name": [e.name]}
    if e.address:
        kwargs["address"] = [e.address]
    if e.country:
        kwargs["country"] = [e.country]
    if e.type:
        kwargs["type"] = [e.type]

    raw = to_dict(client.resolution.resolution(**kwargs))
    candidates = raw.get("data") or []
    best = candidates[0] if candidates else None
    return best, raw


def resolve_with_fallback(
    client, e: InputEntity
) -> tuple[dict | None, dict, str | None]:
    """Try primary name first; fall back through RETRY_NAMES and auto-extracted acronyms.

    Returns (best_match_dict, raw_resolution, retry_name_used).
    PINNED_IDS short-circuit the API call and return a synthetic match dict.
    """
    pinned_id = PINNED_IDS.get(e.name)
    if pinned_id:
        synthetic_match = {
            "entity_id": pinned_id,
            "label": f"[pinned] {e.name}",
            "score": None,
        }
        synthetic_raw = {
            "pinned": True,
            "entity_id": pinned_id,
            "input_name": e.name,
        }
        return synthetic_match, synthetic_raw, f"[pinned:{pinned_id}]"

    match, raw = resolve_entity(client, e)
    if match:
        return match, raw, None

    alternates: list[str] = list(RETRY_NAMES.get(e.name, []))
    m = re.search(r'\(([A-Z]{2,})\)', e.name)
    if m:
        acronym = m.group(1)
        if acronym not in alternates:
            alternates.insert(0, acronym)

    for alt in alternates:
        e_alt = InputEntity(row=e.row, name=alt, country=e.country)
        match, raw = resolve_entity(client, e_alt)
        if match:
            return match, raw, alt

    return None, raw, None
