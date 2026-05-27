"""
Macro-level aggregation over a list of profiles.

Ported directly from sayari_ground_truth.py::build_summary.
"""
from __future__ import annotations

from collections import Counter

from .types import Profile


def build_summary(profiles: list[Profile]) -> dict:
    matched = [p for p in profiles if p.matched]
    countries: Counter = Counter()
    for p in matched:
        for c in p.countries:
            if c:
                countries[c] += 1
    risk_factor_freq: Counter = Counter()
    for p in matched:
        risk_factor_freq.update(p.risk_factors)

    sanctioned = sum(1 for p in matched if p.sanctioned)
    pep = sum(1 for p in matched if p.pep)

    return {
        "total_input": len(profiles),
        "resolved": len(matched),
        "unresolved": len(profiles) - len(matched),
        "resolution_rate": round(len(matched) / len(profiles), 3) if profiles else 0,
        "sanctioned_count": sanctioned,
        "pep_count": pep,
        "sanctioned_pct": round(sanctioned / len(matched), 3) if matched else 0,
        "pep_pct": round(pep / len(matched), 3) if matched else 0,
        "country_breakdown": dict(countries.most_common()),
        "entity_type_breakdown": dict(
            Counter(p.type for p in matched if p.type).most_common()
        ),
        "risk_factor_frequency": dict(risk_factor_freq.most_common()),
        "low_confidence_matches": [
            {
                "input_name": p.input_name,
                "matched": p.match_label,
                "score": p.match_score,
                "reason": (
                    "low_score"
                    if isinstance(p.match_score, (int, float)) and p.match_score < 50
                    else "name_mismatch"
                ),
            }
            for p in matched
            if (isinstance(p.match_score, (int, float)) and p.match_score < 50)
               or p.name_mismatch_flag
        ],
    }
