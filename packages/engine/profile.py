"""
Entity profile fetching and extraction.

Handles both live API responses and pre cached raw JSON dictionaries
with the same shape (the cache files are saved API responses verbatim).
"""
from __future__ import annotations

from typing import Any

from .types import InputEntity, Profile
from .helpers import to_dict, first_present, deep_get

try:
    from unidecode import unidecode
except ImportError:
    def unidecode(s: str) -> str:  # type: ignore[misc]
        return s


def fetch_profile(client, entity_id: str) -> dict:
    """Call get_entity for the full profile. Returns raw response as a dict."""
    return to_dict(client.entity.get_entity(id=entity_id))


def extract_profile(
    e: InputEntity,
    match: dict | None,
    raw_entity: dict | None,
    effective_name: str | None = None,
) -> Profile:
    """Flatten resolution + entity responses into a traceable Profile record.

    Works identically whether raw_entity came from a live API call or from
    a cached output/raw/{id}.json file — the shape is the same.
    """
    p = Profile(input_row=e.row, input_name=e.name, matched=match is not None)
    if match is None:
        return p

    p.entity_id = first_present(match, "entity_id", "id")
    raw_label = first_present(match, "label", "name") or ""
    p.match_label = raw_label if not raw_label.startswith("[pinned]") else None
    p.match_score = (
        first_present(match, "score")
        or deep_get(match, "match_strength", "value")
    )

    if p.match_label:
        stop_words = {
            "the", "of", "and", "for", "a", "an", "in", "co", "ltd", "llc", "inc",
            "jsc", "ojsc", "pjsc", "pao", "oao", "ooo", "ao", "sa",
        }
        check_name = effective_name or e.name
        input_words = {
            w.lower() for w in check_name.split()
            if w.lower() not in stop_words and len(w) > 2
        }
        label_lower = p.match_label.lower()
        label_ascii = unidecode(p.match_label).lower()
        translated = ""
        if raw_entity:
            _d = raw_entity.get("data") if isinstance(raw_entity.get("data"), dict) else raw_entity
            translated = (_d.get("translated_label") or "").lower()
        p.name_mismatch_flag = bool(input_words) and not any(
            w in label_lower or w in label_ascii or w in translated
            for w in input_words
        )

    if not raw_entity:
        return p

    data = raw_entity.get("data") if isinstance(raw_entity.get("data"), dict) else raw_entity

    if not p.match_label:
        p.match_label = first_present(data, "label", "translated_label")

    p.type = first_present(data, "type", "entity_type")
    countries = first_present(data, "countries", "country", default=[])
    p.countries = countries if isinstance(countries, list) else [countries]

    risk = data.get("risk") or {}
    p.sanctioned = (
        first_present(data, "sanctioned")
        if "sanctioned" in data
        else risk.get("sanctioned")
    )
    p.pep = (
        first_present(data, "pep")
        if "pep" in data
        else risk.get("pep")
    )
    if isinstance(risk, dict):
        p.risk_factors = sorted(
            k for k, v in risk.items()
            if (
                v.get("value") not in (None, False, 0, "", [], {})
                if isinstance(v, dict)
                else v not in (None, False, 0, "", [], {})
            )
        )

    p.degree = first_present(data, "degree")
    rc = first_present(data, "relationship_count", "relationship_counts", default={})
    p.relationship_counts = (
        {k: v for k, v in rc.items() if isinstance(v, int)}
        if isinstance(rc, dict)
        else {}
    )
    sc = first_present(data, "source_count", "sources_count")
    p.source_count = (
        len(sc) if isinstance(sc, dict)
        else sc if isinstance(sc, int)
        else len(data["sources"]) if isinstance(data.get("sources"), list)
        else None
    )
    p.entity_url = first_present(data, "entity_url", "url", "sayari_url")
    return p
