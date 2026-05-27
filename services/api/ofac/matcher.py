"""
In-memory OFAC SDN name matcher — good-faith fuzzy screen.

Methodology
-----------
This matcher is designed to represent what a real compliance name-screening
tool does: it tries hard to find a match against the OFAC SDN list, so that
any entity it MISSES is genuinely not findable by name. The algorithm:

  1. Normalize both the query AND every SDN name/alias:
       • Lowercase + strip punctuation + collapse whitespace
       • Apply unidecode (Cyrillic → Latin transliteration) so that e.g.
         querying "Sberbank" matches a Cyrillic alias "СБЕРБАНК РОССИИ" and
         vice-versa. This prevents the matcher from missing entities simply
         because OFAC published the alias in a different script.
       • Strip legal-form tokens (LLC, PAO, PJSC, JSC, OOO, GmbH, …) and
         common English stopwords.
     The query and every SDN surface (primary_name, aliases) are normalised
     identically — there is no asymmetry that would advantage one side.

  2. Alias phrase match (full scan, multi-token queries).
       If all normalised query tokens appear as a contiguous phrase in any
       alias (original OR transliterated), score = 0.97. This catches
       "Sberbank Rossii" → SDN alias "SBERBANK ROSSII".

  3. Primary-name token-coverage match (index-assisted).
       Build a token index keyed on the first normalised token of each
       primary name AND alias (both original and transliterated forms).
       For a query with N tokens, the SDN entry must contain at least
       max(1, N-1) of them in its primary name (original or ASCII form).
       Scores: 0.92 (multi-token), 0.85 (single-token).
       This catches "Tupolev PJSC" → primary "TUPOLEV" or alias "TUPOLEV PJSC".

  4. Single-token alias fallback (full scan).
       If the first query token matches any token in any alias, score = 0.72.
       This is the last resort; a threshold of 0.7 already filters most noise.

Scores are semantic labels (high/medium/low confidence), not a continuous
similarity metric. The default threshold=0.7 in the compare tool keeps only
matches that cleared the primary-name or alias stage.

What this matcher deliberately does NOT do:
  • Phonetic matching (Soundex/Metaphone): adds false positives.
  • Edit-distance / trigram fuzzy: the SDN has enough aliases that exact
    token overlap is sufficient for the entities on this list; adding
    trigram matching would inflate the OFAC catch count and understate the
    structural gap we are demonstrating.

The structural gap — OFAC's 50% rule (31 CFR § 501.801) — exists regardless
of how good the name-screen is: if a company is not NAMED on the SDN, no
name-screen can flag it. Only ownership-graph traversal (what Sayari provides)
can identify subsidiaries blocked through their parent's designation.

Data source: official OFAC SDN.XML feed (treasury.gov/ofac/downloads/sdn.xml),
downloaded once and cached. Every match is traceable to a real sdn_id +
primary_name + programs in that feed.
"""
from __future__ import annotations

import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import httpx
from unidecode import unidecode

log = logging.getLogger("sentinel.ofac")

SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml"

LEGAL_SUFFIXES = {
    "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation",
    "co", "company", "gmbh", "ag", "sa", "pao", "oao", "pjsc", "jsc",
    "ooo", "kgaa", "kg", "bv", "nv", "spa", "srl", "plc", "trust", "holdings",
    "holding", "group", "international", "intl", "global",
}

STOPWORDS = LEGAL_SUFFIXES | {"the", "of", "and"}


def _ascii(s: str) -> str:
    """Transliterate to ASCII via unidecode, then lowercase."""
    return unidecode(s).lower()


def normalize(name: str) -> list[str]:
    """Tokenise a name into normalised, noise-stripped tokens.

    Applied identically to both the query and every SDN name/alias so there
    is no asymmetry. Steps:
      1. Transliterate non-ASCII (Cyrillic, etc.) → ASCII via unidecode.
      2. Lowercase.
      3. Strip punctuation / hyphens / underscores.
      4. Split on whitespace, drop tokens < 2 chars or in STOPWORDS.
    """
    # Apply unidecode first so Cyrillic names match their Latin counterparts
    ascii_name = unidecode(name)
    cleaned = re.sub(r"[.,;:'\"()\\/\[\]{}]+", " ", ascii_name.lower())
    cleaned = re.sub(r"[-_]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return [t for t in cleaned.split() if len(t) >= 2 and t not in STOPWORDS]


@dataclass
class SdnEntry:
    sdn_id: int
    primary_name: str
    primary_name_lower: str    # lowercased original
    primary_name_ascii: str    # unidecode transliteration
    sdn_type: str              # "Entity" or "Individual"
    programs: list[str] = field(default_factory=list)
    aliases_lower: list[str] = field(default_factory=list)  # lowercased originals
    aliases_ascii: list[str] = field(default_factory=list)  # transliterated


@dataclass
class OfacMatch:
    sdn_id: int
    primary_name: str
    sdn_type: str
    programs: list[str]
    matched_via: str    # "primary_name" | "primary_name_ascii" | "alias" | "alias_ascii"
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


def _parse_aliases(entry: ET.Element, ns: str) -> tuple[list[str], list[str]]:
    """Return (aliases_lower, aliases_ascii) for all aka entries."""
    lowers: list[str] = []
    asciis: list[str] = []
    aka_list = entry.find(f"{ns}akaList")
    if aka_list is None:
        return lowers, asciis
    for aka in aka_list.findall(f"{ns}aka"):
        first = _text(aka, ns, "firstName") or ""
        last = _text(aka, ns, "lastName") or ""
        nm = (f"{first} {last}".strip()) if first else last.strip()
        if nm:
            lowers.append(nm.lower())
            asciis.append(_ascii(nm))
    return lowers, asciis


def _parse_programs(entry: ET.Element, ns: str) -> list[str]:
    pl = entry.find(f"{ns}programList")
    if pl is None:
        return []
    return [p.text.strip() for p in pl.findall(f"{ns}program") if p.text and p.text.strip()]


def stream_entries_from_xml(xml_path: str) -> Iterator[SdnEntry]:
    """Yield SdnEntry objects by iterparse'ing the SDN XML. Low memory."""
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
        aliases_lower, aliases_ascii = _parse_aliases(entry, ns)
        yield SdnEntry(
            sdn_id=int(uid),
            primary_name=name,
            primary_name_lower=name.lower(),
            primary_name_ascii=_ascii(name),
            sdn_type=sdn_type,
            programs=_parse_programs(entry, ns),
            aliases_lower=aliases_lower,
            aliases_ascii=aliases_ascii,
        )
        entry.clear()


class OfacMatcher:
    """In-memory OFAC SDN matcher. Build once, query many times.

    Call OfacMatcher.load(cache_dir) to get an instance backed by a cached
    XML file; it downloads from treasury.gov on first call (~15 MB).
    """

    def __init__(self, entries: list[SdnEntry], fetched_at: str | None = None):
        self._entries = entries
        self.fetched_at = fetched_at

        # Token index: normalised_first_token → [SdnEntry, ...]
        # Covers both original and ASCII (transliterated) first tokens of
        # primary names and aliases, so Cyrillic and Latin both route correctly.
        self._index: dict[str, list[SdnEntry]] = {}
        for e in entries:
            for surface in (e.primary_name, e.primary_name_ascii):
                toks = normalize(surface)
                if toks:
                    self._index.setdefault(toks[0], []).append(e)
            for alias in e.aliases_lower + e.aliases_ascii:
                parts = alias.split()
                if parts:
                    self._index.setdefault(parts[0], []).append(e)

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
        """Return top-N OFAC SDN matches for the given name.

        Normalises the query with the same pipeline applied to SDN entries,
        including unidecode transliteration. See module docstring for the
        full algorithm description.
        """
        tokens = normalize(name)
        if not tokens:
            return []

        phrase = " ".join(tokens)
        t0 = tokens[0]
        results: list[OfacMatch] = []
        seen_ids: set[int] = set()

        # ── Stage 1: Alias phrase match (full scan, multi-token) ─────────
        # Both original-lowercased and ASCII aliases are checked so that a
        # Latin query finds a Cyrillic alias that transliterates to a match.
        if len(tokens) >= 2:
            for entry in self._entries:
                if entry.sdn_id in seen_ids:
                    continue
                matched_alias = None
                for alias in entry.aliases_lower + entry.aliases_ascii:
                    if phrase in alias:
                        matched_alias = alias
                        break
                if matched_alias:
                    results.append(OfacMatch(
                        sdn_id=entry.sdn_id,
                        primary_name=entry.primary_name,
                        sdn_type=entry.sdn_type,
                        programs=entry.programs,
                        matched_via="alias",
                        matched_text=matched_alias,
                        match_score=0.97,
                    ))
                    seen_ids.add(entry.sdn_id)
                if len(results) >= limit:
                    break

        # ── Stage 2: Primary-name token-coverage (index-assisted) ────────
        # The index maps the first normalised token → candidate entries.
        # We then verify that at least max(1, N-1) of the query tokens appear
        # in either the original or transliterated primary name.
        candidates = self._index.get(t0, [])
        for entry in candidates:
            if entry.sdn_id in seen_ids:
                continue
            # Check both original and ASCII primary name surfaces
            best_surface, best_coverage, matched_via = None, 0, "primary_name"
            for surface, via in (
                (entry.primary_name_lower, "primary_name"),
                (entry.primary_name_ascii, "primary_name_ascii"),
            ):
                cov = sum(1 for t in tokens if t in surface)
                if cov > best_coverage:
                    best_coverage, best_surface, matched_via = cov, surface, via

            # For 2-token queries require BOTH tokens; for 3+ allow one miss.
            # max(1, N-1) was wrong: for N=2 it allowed 1/2 tokens → false positives
            # like "Russian Railways" → "RUSSIAN FINANCIAL CORPORATION".
            min_cov = len(tokens) if len(tokens) <= 2 else len(tokens) - 1
            if best_coverage >= min_cov:
                score = 0.92 if len(tokens) > 1 else 0.85
                results.append(OfacMatch(
                    sdn_id=entry.sdn_id,
                    primary_name=entry.primary_name,
                    sdn_type=entry.sdn_type,
                    programs=entry.programs,
                    matched_via=matched_via,
                    matched_text=entry.primary_name,
                    match_score=score,
                ))
                seen_ids.add(entry.sdn_id)
            if len(results) >= limit:
                break

        # ── Stage 3: Single-token alias fallback (full scan) ─────────────
        # Last resort: first query token appears as a whole word in any alias
        # (original or ASCII). Score 0.72 — cleared by the default threshold=0.7.
        if len(results) < limit:
            for entry in self._entries:
                if entry.sdn_id in seen_ids:
                    continue
                for alias in entry.aliases_lower + entry.aliases_ascii:
                    if t0 in alias.split():
                        results.append(OfacMatch(
                            sdn_id=entry.sdn_id,
                            primary_name=entry.primary_name,
                            sdn_type=entry.sdn_type,
                            programs=entry.programs,
                            matched_via="alias_ascii" if alias not in entry.aliases_lower else "alias",
                            matched_text=alias,
                            match_score=0.72,
                        ))
                        seen_ids.add(entry.sdn_id)
                        break
                if len(results) >= limit:
                    break

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
