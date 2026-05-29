"""
Shared data types for the Meridian Sentinel engine.

The canonical structures every layer of the stack depends on.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@dataclass
class InputEntity:
    row: int
    name: str
    address: str | None = None
    country: str | None = None
    type: str | None = None
    identifier: str | None = None


# ---------------------------------------------------------------------------
# Resolved profile
# ---------------------------------------------------------------------------

@dataclass
class Profile:
    """Flat, traceable view of one entity. Every field cites its source call."""
    input_row: int
    input_name: str
    matched: bool
    entity_id: str | None = None
    match_label: str | None = None
    match_score: float | None = None
    name_mismatch_flag: bool = False
    retry_name_used: str | None = None
    type: str | None = None
    countries: list[str] = field(default_factory=list)
    sanctioned: bool | None = None
    pep: bool | None = None
    risk_factors: list[str] = field(default_factory=list)
    degree: int | None = None
    relationship_counts: dict[str, int] = field(default_factory=dict)
    source_count: int | None = None
    entity_url: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_row": self.input_row,
            "input_name": self.input_name,
            "matched": self.matched,
            "entity_id": self.entity_id,
            "match_label": self.match_label,
            "match_score": self.match_score,
            "name_mismatch_flag": self.name_mismatch_flag,
            "retry_name_used": self.retry_name_used,
            "type": self.type,
            "countries": self.countries,
            "sanctioned": self.sanctioned,
            "pep": self.pep,
            "risk_factors": self.risk_factors,
            "degree": self.degree,
            "relationship_counts": self.relationship_counts,
            "source_count": self.source_count,
            "entity_url": self.entity_url,
            "error": self.error,
        }


# ---------------------------------------------------------------------------
# Cited tool result envelope
# ---------------------------------------------------------------------------

@dataclass
class CitedResult:
    """Wraps any tool result with a source citation.

    Every tool must return one of these so the agent layer can ground
    every claim to a specific API response field path.
    """
    data: Any
    source: SourceCitation

    def to_dict(self) -> dict[str, Any]:
        return {
            "data": self.data,
            "source": {
                "entity_url": self.source.entity_url,
                "raw_field_path": self.source.raw_field_path,
                "cache_file": self.source.cache_file,
                "api_endpoint": self.source.api_endpoint,
            },
        }


@dataclass
class SourceCitation:
    entity_url: str | None = None       # e.g. /v1/entity/OWwtbp9y51OcLHJQakLaMw
    raw_field_path: str | None = None   # e.g. data.risk.sanctioned.value
    cache_file: str | None = None       # e.g. output/raw/OWwtbp9y51OcLHJQakLaMw.json
    api_endpoint: str | None = None     # e.g. GET /v1/entity/{id}
