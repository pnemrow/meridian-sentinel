"""
In-memory OFAC SDN name matcher.

Algorithm (mirrors the TypeScript ofacMatcher.ts logic, adapted for Python):
  1. Normalize: lowercase + strip punctuation + strip legal-form suffixes.
  2. Try alias phrase match (multi-token inputs, contains full phrase).
  3. Try primary-name token coverage match (all or all-minus-1 tokens match).
  4. Try single-token alias fallback.

This matcher operates against an in-memory list built from the OFAC SDN XML.
No database required — the XML is downloaded once and cached to disk.
The XML source is the official OFAC feed; every match is traceable to
a real SDN entry (sdn_id, primary_name, programs).
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import httpx

log = logging.getLogger("sentinel.ofac")

SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml"

LEGAL_SUFFIXES = {
    "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation",
    "co", "company", "gmbh", "ag", "sa", "pao", "oao", "pjsc", "jsc",
    "ooo", "kgaa", "kg", "bv", "nv", "spa", "srl", "plc", "trust", "holdings",
    "holding", "group", "international", "intl", "global",
}

STOPWORDS = LEGAL_SUFFIXES | {"the", "of", "and"}


def normalize(name: str) -> list[str]:
    """Tokenise and strip noise — mirrors the TS normalize() function."""
    cleaned = re.sub(r"[.,;:'\"()\\/]+", " ", name.lower())
    cleaned = re.sub(r"[-_]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return [t for t in cleaned.split() if len(t) >= 2 and t not in STOPWORDS]


@dataclass
class SdnEntry:
    sdn_id: int
    primary_name: str
    primary_name_lower: str
    sdn_type: str          # "Entity" or "Individual"
    programs: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)  # lowercased alias names


@dataclass
class OfacMatch:
    sdn_id: int
    primary_name: str
    sdn_type: str
    programs: list[str]
    matched_via: str       # "primary_name" or "alias"
    matched_text: str
    match_score: float


WANTED_TYPES = {"Entity", "Individual"}


def _detect_ns(root_tag: str) -> str:
    """Extract Clark namespace prefix from the root element tag."""
    if root_tag.startswith("{"):
        return root_tag[: root_tag.index("}") + 1]
    return ""


def _text(el: ET.Element, ns: str, tag: str) -> str | None:
    child = el.find(f"{ns}{tag}")
    if child is None or not child.text:
        return None
    return child.text.strip() or None


def _primary_name(entry: ET.Element, ns: str) -> str:
    last = _text(entry, ns, "lastName") or ""
    first = _text(entry, ns, "firstName") or ""
    return (f"{first} {last}".strip()) if first else last.strip()


def _parse_aliases(entry: ET.Element, ns: str) -> list[str]:
    out: list[str] = []
    aka_list = entry.find(f"{ns}akaList")
    if aka_list is None:
        return out
    for aka in aka_list.findall(f"{ns}aka"):
        first = _text(aka, ns, "firstName") or ""
        last = _text(aka, ns, "lastName") or ""
        nm = (f"{first} {last}".strip()) if first else last.strip()
        if nm:
            out.append(nm.lower())
    return out


def _parse_programs(entry: ET.Element, ns: str) -> list[str]:
    pl = entry.find(f"{ns}programList")
    if pl is None:
        return []
    return [p.text.strip() for p in pl.findall(f"{ns}program") if p.text and p.text.strip()]


def stream_entries_from_xml(xml_path: str) -> Iterator[SdnEntry]:
    """Yield SdnEntry objects by iterparse'ing the SDN XML. Low memory."""
    # Detect namespace from root
    ns = ""
    for event, el in ET.iterparse(xml_path, events=("start",)):
        ns = _detect_ns(el.tag)
        break

    entry_tag = f"{ns}sdnEntry"
    for event, entry in ET.iterparse(xml_path, events=("end",)):
        if entry.tag != entry_tag:
            continue
        sdn_type = _text(entry, ns, "sdnType") or ""
        uid = _text(entry, ns, "uid")
        if sdn_type not in WANTED_TYPES or not uid:
            entry.clear()
            continue
        name = _primary_name(entry, ns)
        if not name:
            entry.clear()
            continue
        yield SdnEntry(
            sdn_id=int(uid),
            primary_name=name,
            primary_name_lower=name.lower(),
            sdn_type=sdn_type,
            programs=_parse_programs(entry, ns),
            aliases=_parse_aliases(entry, ns),
        )
        entry.clear()


class OfacMatcher:
    """In-memory OFAC SDN matcher. Build once, query many times.

    Call OfacMatcher.load(cache_dir) to get an instance backed by a
    cached XML file; it will download on first call.
    """

    def __init__(self, entries: list[SdnEntry], fetched_at: str | None = None):
        self._entries = entries
        self.fetched_at = fetched_at
        # Build token index: first_token -> list of entries for fast pre-filtering
        self._index: dict[str, list[SdnEntry]] = {}
        for e in entries:
            tokens = normalize(e.primary_name)
            if tokens:
                self._index.setdefault(tokens[0], []).append(e)
            for alias in e.aliases:
                atokens = alias.split()
                if atokens:
                    self._index.setdefault(atokens[0], []).append(e)
        log.info("OfacMatcher: indexed %d SDN entries", len(entries))

    @classmethod
    def load(cls, cache_dir: str | Path, force_refresh: bool = False) -> "OfacMatcher":
        """Load from cached XML or download fresh if missing."""
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        xml_path = cache_dir / "sdn.xml"
        meta_path = cache_dir / "sdn_meta.json"

        if not xml_path.exists() or force_refresh:
            log.info("OfacMatcher: downloading SDN XML from %s", SDN_URL)
            _download_sdn(str(xml_path))
            meta_path.write_text(
                json.dumps({"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")}),
                encoding="utf-8",
            )

        fetched_at = None
        if meta_path.exists():
            try:
                fetched_at = json.loads(meta_path.read_text())["fetched_at"]
            except Exception:
                pass

        log.info("OfacMatcher: loading SDN XML from %s", xml_path)
        entries = list(stream_entries_from_xml(str(xml_path)))
        return cls(entries, fetched_at=fetched_at)

    def match(self, name: str, limit: int = 5) -> list[OfacMatch]:
        """Return top-N OFAC matches for the given name."""
        tokens = normalize(name)
        if not tokens:
            return []

        phrase = " ".join(tokens)
        t0 = tokens[0]
        results: list[OfacMatch] = []
        seen_ids: set[int] = set()

        # ── 1. Alias phrase match (multi-token) ───────────────────────────
        if len(tokens) >= 2:
            for entry in self._entries:
                if entry.sdn_id in seen_ids:
                    continue
                for alias in entry.aliases:
                    if phrase in alias:
                        results.append(OfacMatch(
                            sdn_id=entry.sdn_id,
                            primary_name=entry.primary_name,
                            sdn_type=entry.sdn_type,
                            programs=entry.programs,
                            matched_via="alias",
                            matched_text=alias,
                            match_score=0.97,
                        ))
                        seen_ids.add(entry.sdn_id)
                        break
                if len(results) >= limit:
                    break

        # ── 2. Primary name token-coverage match ──────────────────────────
        # Pre-filter by first token for speed
        candidates = self._index.get(t0, [])
        # Also check entries whose primary name starts with t0
        for entry in candidates:
            if entry.sdn_id in seen_ids:
                continue
            pn = entry.primary_name_lower
            coverage = sum(1 for t in tokens if t in pn)
            if coverage >= max(1, len(tokens) - 1):
                score = 0.92 if len(tokens) > 1 else 0.85
                results.append(OfacMatch(
                    sdn_id=entry.sdn_id,
                    primary_name=entry.primary_name,
                    sdn_type=entry.sdn_type,
                    programs=entry.programs,
                    matched_via="primary_name",
                    matched_text=entry.primary_name,
                    match_score=score,
                ))
                seen_ids.add(entry.sdn_id)
            if len(results) >= limit:
                break

        # ── 3. Single-token alias fallback ───────────────────────────────
        if len(results) < limit:
            for entry in self._entries:
                if entry.sdn_id in seen_ids:
                    continue
                for alias in entry.aliases:
                    if t0 in alias.split():
                        results.append(OfacMatch(
                            sdn_id=entry.sdn_id,
                            primary_name=entry.primary_name,
                            sdn_type=entry.sdn_type,
                            programs=entry.programs,
                            matched_via="alias",
                            matched_text=alias,
                            match_score=0.72,
                        ))
                        seen_ids.add(entry.sdn_id)
                        break
                if len(results) >= limit:
                    break

        # Sort by score desc, then by shorter primary name (closer to canonical)
        results.sort(key=lambda r: (-r.match_score, len(r.primary_name)))
        return results[:limit]


def _download_sdn(out_path: str, timeout: float = 60.0, attempts: int = 3) -> None:
    last_exc: Exception | None = None
    for i in range(1, attempts + 1):
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                with client.stream("GET", SDN_URL) as r:
                    r.raise_for_status()
                    with open(out_path, "wb") as fh:
                        for chunk in r.iter_bytes(chunk_size=64 * 1024):
                            if chunk:
                                fh.write(chunk)
            log.info("OfacMatcher: SDN XML downloaded to %s", out_path)
            return
        except Exception as exc:
            last_exc = exc
            log.warning("OfacMatcher: download attempt %d/%d failed: %s", i, attempts, exc)
            if i < attempts:
                time.sleep(2 * i)
    raise last_exc  # type: ignore[misc]
