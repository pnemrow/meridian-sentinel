"""
Tool: generate_briefing — 1-page compliance briefing (WeasyPrint → PDF).

A defensible audit-grade document, not a data dump. Every value traces to
either the cached raw Sayari profile (output/raw/{id}.json), the cached
ownership traversal (output/raw/traversal/{id}.json), or the OFAC SDN feed
metadata. Nothing is fabricated.

Layout (≤ 2 pages):
  - Header                          — tenant + generated-at + run scope
  - Title + risk badge + portfolio context line
  - Identity Evidence               — registration #, tax ID, LEI, address …
  - Sanctions Coverage              — regime grid (every direct sanctioned_*)
  - Ownership Exposure              — direct sanctioned owners + 50% rule cite
  - Top Compliance Implications     — plain-language + cited rule
  - Recommended Disposition         — disposition store (pending review today)
  - Provenance footer               — cache_file, SDN feed date, version, run
  - Appendix (7pt)                  — machine-readable factor list
"""
from __future__ import annotations

import datetime
import html
import json
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import EntityCache, CitedResult, SourceCitation
from .risk_summary import risk_summary_tool

# WeasyPrint is an optional runtime dependency. The pip install always succeeds
# (it's in requirements.txt), but `import weasyprint` raises OSError on hosts
# missing the underlying C libraries (cairo, pango, gdk-pixbuf). Docker bakes
# them in; a native install on macOS/Windows without brew/choco does not.
#
# We resolve once at module import time and branch on HAS_WEASYPRINT inside
# generate_briefing_tool. When False, we serve the HTML template directly and
# the analyst can save-to-PDF via File > Print in the browser.
try:
    from weasyprint import HTML as _WeasyHTML  # type: ignore[import]
    HAS_WEASYPRINT = True
except (ImportError, OSError):
    _WeasyHTML = None  # type: ignore[assignment]
    HAS_WEASYPRINT = False

# Bump when the template / data shape changes meaningfully — surfaced in footer.
BRIEFING_VERSION = "1.1.0"
BRIEFING_DIR = Path("/tmp/sentinel-briefings")
TRAVERSAL_DIR = _REPO / "output" / "raw" / "traversal"
SDN_META = _REPO / "services" / "api" / "data" / "sdn_meta.json"


# ── Regime grid label map ────────────────────────────────────────────────────
# Maps direct designation factor → "Region — Authority" for the 2-col grid.
REGIME_LABELS: dict[str, str] = {
    "sanctioned_usa_ofac_sdn":      "USA — OFAC SDN",
    "sanctioned_usa_ofac_non_sdn":  "USA — OFAC Non-SDN",
    "sanctioned_eu_sanctions":      "EU — Council Sanctions",
    "sanctioned_eu_dg_fisma_ec":    "EU — DG FISMA (EC)",
    "sanctioned_eu_ec_sanctions_map":     "EU — Council Sanctions Map",
    "sanctioned_eu_ec_regulation":  "EU — Council Regulation",
    "sanctioned_gbr_fcdo":          "UK — FCDO",
    "sanctioned_gbr_ofsi":          "UK — OFSI",
    "sanctioned_can_gac":           "Canada — Global Affairs (GAC)",
    "sanctioned_che_seco":          "Switzerland — SECO",
    "sanctioned_aus_dfat":          "Australia — DFAT",
    "sanctioned_jpn_mof":           "Japan — MOF",
    "sanctioned_fra_dgt_mefids":    "France — DGT MEFIDS",
    "sanctioned_nzl_mfat_rus":      "New Zealand — Russia",
    "sanctioned_nzl_russia_sanctions": "New Zealand — Russia",
    "sanctioned_ukr_nsdc":          "Ukraine — NSDC",
}


# ── Compliance implications: plain-language + cited rule ─────────────────────
# Keyed by risk factor. Replaces the old "code rephrased" descriptions with
# what an analyst would actually write on the briefing.
COMPLIANCE_IMPLICATIONS: dict[str, dict[str, str]] = {
    "sanctioned_usa_ofac_sdn": {
        "label": "OFAC SDN — Specially Designated National",
        "implication": "All transactions with US persons or US jurisdiction prohibited. Property within US jurisdiction blocked.",
        "rule": "50 U.S.C. § 1701 (IEEPA); 31 CFR § 501.801",
    },
    "ofac_50_percent_rule": {
        "label": "OFAC 50% Rule",
        "implication": "Entity is ≥50% owned by one or more SDN-designated parties — treated as if directly designated.",
        "rule": "31 CFR § 501.801 (50 Percent Rule)",
    },
    "controlled_by_ofac_sdn": {
        "label": "Controlled by OFAC SDN",
        "implication": "Effective control by an OFAC-designated person. Onboarding prohibited regardless of formal ownership %.",
        "rule": "31 CFR § 501.801; OFAC FAQ 401",
    },
    "owned_by_sanctioned_usa_ofac_sdn_entity": {
        "label": "Owned by OFAC SDN entity",
        "implication": "Ownership chain reaches an SDN-designated entity. Verify ≥50% threshold for automatic block; treat as blocked pending review.",
        "rule": "31 CFR § 501.801",
    },
    "owner_of_sanctioned_usa_ofac_sdn_entity": {
        "label": "Owns OFAC SDN entity",
        "implication": "Owns an SDN-designated subsidiary. Heightened DD on transactions touching the sanctioned subsidiary's business line.",
        "rule": "31 CFR § 501.801",
    },
    "sanctioned_eu_sanctions": {
        "label": "EU Council Regulation Sanctions",
        "implication": "EU persons prohibited from making funds or economic resources available to this entity.",
        "rule": "Council Reg (EU) 269/2014, 833/2014",
    },
    "sanctioned_eu_dg_fisma_ec": {
        "label": "EU DG FISMA Financial Sanctions",
        "implication": "EU asset freeze applies. Reporting to national competent authority required.",
        "rule": "EU Financial Sanctions Database",
    },
    "eu_50_percent_rule": {
        "label": "EU 50% Rule",
        "implication": "Entity ≥50% owned by an EU-sanctioned party — same restrictions apply.",
        "rule": "EU Best Practices Guidance",
    },
    "sanctioned_gbr_fcdo": {
        "label": "UK FCDO Sanctions",
        "implication": "UK persons prohibited from dealings; assets within UK frozen.",
        "rule": "Sanctions and Anti-Money Laundering Act 2018",
    },
    "uk_50_percent_rule": {
        "label": "UK 50% Rule",
        "implication": "Entity ≥50% owned by a UK-sanctioned party.",
        "rule": "OFSI Guidance",
    },
    "sanctioned_can_gac": {
        "label": "Canada Special Economic Measures",
        "implication": "Canadian persons prohibited from dealings; FINTRAC reporting may apply.",
        "rule": "Special Economic Measures Act",
    },
    "sanctioned_che_seco": {
        "label": "Switzerland SECO Sanctions",
        "implication": "Swiss financial intermediaries prohibited from dealings.",
        "rule": "Embargo Act (EmbA)",
    },
    "sanctioned_aus_dfat": {
        "label": "Australia DFAT Sanctions",
        "implication": "Australian persons prohibited from dealings; AUSTRAC reporting required.",
        "rule": "Autonomous Sanctions Act 2011",
    },
    "sanctioned_jpn_mof": {
        "label": "Japan MOF Sanctions",
        "implication": "Japanese persons prohibited from dealings.",
        "rule": "Foreign Exchange and Foreign Trade Act",
    },
    "sanctioned_fra_dgt_mefids": {
        "label": "France DGT Asset Freeze",
        "implication": "French entities prohibited from financial relations.",
        "rule": "Code monétaire et financier",
    },
    "state_owned":     {"label": "State-Owned Enterprise", "implication": "State-controlled entity — heightened DD; verify exposure to sectoral sanctions.", "rule": "Often paired with EO 14024, EU Council Reg 833/2014"},
    "state_owned_rus": {"label": "Russian State-Owned Enterprise", "implication": "Subject to sectoral sanctions under Russia-EO14024 and EU Council Reg 833/2014.", "rule": "EO 14024; Reg (EU) 833/2014"},
    "state_owned_blr": {"label": "Belarusian State-Owned Enterprise", "implication": "Subject to Belarus sectoral sanctions.", "rule": "EO 14038; Reg (EU) 765/2006"},
    "pep_adjacent":    {"label": "PEP-Adjacent", "implication": "Connected to politically exposed persons. Enhanced DD required for transactions and beneficial owners.", "rule": "FATF Rec. 12, 22"},
    "export_controls": {"label": "Export Controls", "implication": "Subject to export licensing requirements — items may not be exported without authorisation.", "rule": "EAR (15 CFR 730–774); EU Dual-Use Reg"},
    "usa_bis":         {"label": "US BIS Entity List", "implication": "Items subject to EAR require specific license. Presumption of denial typically applies.", "rule": "15 CFR Part 744"},
    "law_enforcement_action": {"label": "Law Enforcement Action", "implication": "Subject to active law enforcement investigation or order in one or more jurisdictions.", "rule": "Multiple jurisdictions — see source feeds"},
    "regulatory_action": {"label": "Regulatory Action", "implication": "Active regulatory enforcement action recorded.", "rule": "Multiple regulators — see source feeds"},
}


# ── Identity-field extraction ────────────────────────────────────────────────
# Common Sayari identifier types → human label. We pick the first match for
# each conceptual slot (registration number, tax id, etc.) so the briefing
# doesn't repeat "INN" three times.
IDENTITY_SLOTS: list[tuple[str, list[str]]] = [
    ("Registration #",   ["ru_ogrn", "ru_registration_number", "blr_registration_number",
                          "company_registration_number", "registration_number",
                          "ukr_egrpou", "kaz_company_id", "deu_handelsregister",
                          "jpn_corporate_number", "kor_corporate_id"]),
    ("Tax ID",           ["ru_tin", "ru_inn", "ein", "vat", "uk_vat", "deu_steuernummer",
                          "blr_unp", "ukr_inn", "jpn_corporate_tax_id"]),
    ("LEI",              ["lei"]),
    ("DUNS",             ["duns"]),
    ("OFAC SDN #",       ["usa_ofac_sdn_number"]),
    ("EU Sanctions Ref", ["eu_sanction_rn", "eu_fsd_id"]),
    ("KPP",              ["ru_kpp"]),
    ("SWIFT/BIC",        ["swift_bic_code"]),
]


# ── Filter helpers ───────────────────────────────────────────────────────────

def _is_direct_sanction_factor(factor: str) -> bool:
    """A direct sanctioned-list designation, not ownership-derived noise."""
    if not factor.startswith("sanctioned_"):
        return False
    if factor in ("sanctioned_adjacent", "sanctioned", "sanctioned_other"):
        return False
    if "_entity" in factor:  # owned_by_sanctioned_..._entity slips by .startswith above? defensively keep.
        return False
    return True


def _is_compliance_implication(factor: str) -> bool:
    """Factors that have a meaningful plain-language implication card."""
    return factor in COMPLIANCE_IMPLICATIONS


# ── Section builders ─────────────────────────────────────────────────────────

def _build_identity(raw: dict) -> dict[str, Any]:
    identifiers = raw.get("identifiers") or []
    by_type: dict[str, str] = {}
    for ident in identifiers:
        t = (ident.get("type") or "").lower()
        v = (ident.get("value") or "").strip()
        if not t or not v:
            continue
        by_type.setdefault(t, v)

    rows = []
    for label, candidates in IDENTITY_SLOTS:
        for c in candidates:
            if c in by_type:
                rows.append((label, by_type[c], c))
                break

    # Address — first one, prefer translated form if present
    addresses = raw.get("addresses") or []
    address = ""
    if addresses:
        a0 = addresses[0]
        if isinstance(a0, dict):
            address = a0.get("translated_value") or a0.get("value") or ""
        else:
            address = str(a0)

    return {
        "type":              raw.get("type") or "—",
        "countries":         raw.get("countries") or [],
        "registration_date": raw.get("registration_date") or "—",
        "address":           address or "—",
        "rows":              rows,
    }


def _build_sanctions_grid(raw: dict) -> list[dict[str, str]]:
    """Every direct sanctioned_* designation, with feed + from_date if known."""
    risk = raw.get("risk") or {}
    out: list[dict[str, str]] = []
    for factor, v in risk.items():
        if not _is_direct_sanction_factor(factor):
            continue
        if not isinstance(v, dict) or not v.get("value"):
            continue
        md = v.get("metadata") or {}
        sources = md.get("source") or []
        dates = md.get("from_date") or []
        out.append({
            "factor":     factor,
            "label":      REGIME_LABELS.get(factor) or factor.replace("sanctioned_", "").replace("_", " ").upper(),
            "level":      v.get("level") or "high",
            "source":     sources[0] if sources else "",
            "from_date":  dates[0] if dates else "",
        })
    # Stable order: OFAC SDN first, then alphabetical
    out.sort(key=lambda r: (0 if r["factor"] == "sanctioned_usa_ofac_sdn" else 1, r["label"]))
    return out


def _load_traversal(entity_id: str) -> dict | None:
    """
    Load a cached UBO traversal. Tries {id}.json then {id}_ubo.json (Sukhoi).

    Two on-disk shapes exist in the wild:
      - **UBO path-shape** (what `_build_ownership` consumes): each `data[N]`
        has a `path[]` list of entity steps + a `target` dict with full
        identifiers / sanctioned / pep details.
      - **Live-API flat-shape**: each `data[N]` has scalar `source` / `target`
        ids and edge metadata, but *no entity details* and `path` is null.
        This shape doesn't carry sanctioned/identifier data per owner, so the
        briefing's ownership block has nothing useful to surface — we treat
        it the same as "no cached traversal" and fall back to the honest
        "fetch live for full chain" line.
    """
    for candidate in (TRAVERSAL_DIR / f"{entity_id}.json", TRAVERSAL_DIR / f"{entity_id}_ubo.json"):
        if not candidate.exists():
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        items = data.get("data") or []
        if items and items[0].get("path") is None:
            # Flat live-API shape — unusable for the briefing's ownership block.
            return None
        return data
    return None


def _build_ownership(raw: dict, traversal: dict | None, entity_id: str) -> dict[str, Any]:
    """
    Direct sanctioned/PEP owners with %, last_observed, and SDN # where
    available. Pulled from the cached traversal — never invented.
    """
    if traversal is None:
        return {"available": False, "owners": [], "exposed_factor": None}

    # Identify the relevant ownership-exposure factor (for the rule citation)
    risk = raw.get("risk") or {}
    exposed_factor = None
    for f in ("owned_by_sanctioned_usa_ofac_sdn_entity", "ofac_50_percent_rule",
              "controlled_by_ofac_sdn",
              "owned_by_sanctioned_eu_sanctions_entity", "eu_50_percent_rule",
              "owned_by_sanctioned_can_gac_entity", "uk_50_percent_rule"):
        v = risk.get(f)
        if isinstance(v, dict) and v.get("value"):
            exposed_factor = f
            break

    items = traversal.get("data") or []
    seen: set[str] = set()
    owners: list[dict] = []
    for it in items:
        path = it.get("path") or []
        tgt = it.get("target") or {}
        tid = tgt.get("id")
        # Direct owner of root only: target is one hop from root.
        if not tid or tid == entity_id or tid in seen:
            continue
        if len(path) != 1:
            continue
        if not (tgt.get("sanctioned") or tgt.get("pep")):
            continue
        seen.add(tid)
        step = path[0]
        field = step.get("field") or "has_shareholder"
        rel_data = (step.get("relationships") or {}).get(field) or {}
        sdn_no = next((i.get("value") for i in (tgt.get("identifiers") or [])
                       if i.get("type") == "usa_ofac_sdn_number"), None)
        owners.append({
            "label":      tgt.get("translated_label") or tgt.get("label") or tid,
            "id":         tid,
            "country":    (tgt.get("countries") or [None])[0],
            "sanctioned": bool(tgt.get("sanctioned")),
            "pep":        bool(tgt.get("pep")),
            "sdn_no":     sdn_no,
            "percent":    rel_data.get("most_recent_percentage"),
            "former":     bool(rel_data.get("former")),
            "last_obs":   rel_data.get("last_observed"),
            "field":      field,
        })

    # Sanctioned first, then PEP; current stakes before former; larger % first.
    def _key(o):
        return (
            0 if o["sanctioned"] else 1,
            0 if not o["former"] else 1,
            -(o["percent"] or 0),
        )
    owners.sort(key=_key)
    return {
        "available": True,
        "owners":    owners,
        "exposed_factor": exposed_factor,
        "explored_count": traversal.get("explored_count"),
        "shown":     traversal.get("limit") or len(items),
    }


def _build_implications(rs_data: dict, raw: dict) -> list[dict]:
    """Top compliance implications: take the entity's actual risk factors and
    pair each with its plain-language card. Sanctions+ownership cards first,
    other cards behind."""
    factors = rs_data.get("all_risk_factors") or []
    # Priority: direct designations → ownership exposure → state ownership → others
    priority = [
        "sanctioned_usa_ofac_sdn", "ofac_50_percent_rule", "controlled_by_ofac_sdn",
        "owned_by_sanctioned_usa_ofac_sdn_entity",
        "sanctioned_eu_sanctions", "sanctioned_eu_dg_fisma_ec", "eu_50_percent_rule",
        "sanctioned_gbr_fcdo", "uk_50_percent_rule",
        "sanctioned_can_gac", "sanctioned_che_seco",
        "sanctioned_aus_dfat", "sanctioned_jpn_mof", "sanctioned_fra_dgt_mefids",
        "state_owned_rus", "state_owned_blr", "state_owned",
        "usa_bis", "export_controls",
        "law_enforcement_action", "regulatory_action",
        "pep_adjacent",
        "owner_of_sanctioned_usa_ofac_sdn_entity",
    ]
    chosen: list[dict] = []
    factor_set = set(factors)
    for p in priority:
        if p in factor_set and _is_compliance_implication(p):
            md = (raw.get("risk", {}).get(p) or {}).get("metadata", {})
            chosen.append({
                "factor":     p,
                "level":      (raw.get("risk", {}).get(p) or {}).get("level") or "high",
                "label":      COMPLIANCE_IMPLICATIONS[p]["label"],
                "implication": COMPLIANCE_IMPLICATIONS[p]["implication"],
                "rule":       COMPLIANCE_IMPLICATIONS[p]["rule"],
                "sources":    md.get("source") or [],
                "from_date":  (md.get("from_date") or [None])[0],
            })
        if len(chosen) >= 8:
            break
    return chosen


def _build_portfolio_context(compare_data: dict | None, entity_id: str, run_id: str | None) -> str:
    if compare_data is None:
        return ""
    rows = compare_data.get("rows") or []
    summary = compare_data.get("summary") or {}
    total = summary.get("total_entities", len(rows))
    this_row = next((r for r in rows if r.get("entity_id") == entity_id), None)
    if this_row is None:
        return f"{total}-entity screening run."

    outcome = this_row.get("outcome") or "screened"
    designated = bool(this_row.get("is_directly_designated"))
    directly_total = summary.get("both_catch", 0) + summary.get("matcher_miss", 0)

    # Outcome-specific phrasing so the line stays meaningful for non-directly-
    # designated entities (sayari_only, screen_ambiguous, etc.).
    if designated:
        bucket_count = directly_total
        label = "directly designated on OFAC SDN"
    elif outcome == "sayari_only":
        bucket_count = summary.get("sayari_only", 0)
        label = "blocked only via ownership exposure (Sayari only)"
    elif outcome == "screen_ambiguous":
        bucket_count = summary.get("screen_ambiguous", 0)
        label = "where the OFAC name-screen hit a related but different entity"
    elif outcome == "matcher_miss":
        bucket_count = summary.get("matcher_miss", 0)
        label = "directly designated but missed by the OFAC name-screen"
    elif outcome == "ofac_only":
        bucket_count = summary.get("ofac_only", 0)
        label = "flagged by OFAC name-screen with no matching direct factor in Sayari"
    elif outcome == "no_ofac":
        bucket_count = summary.get("no_ofac", 0)
        label = "with no OFAC SDN exposure"
    else:
        bucket_count = 1
        label = outcome

    scope = f" (run_id {run_id})" if run_id else " (default list_1 cache)"
    return f"1 of {bucket_count} {label} in this {total}-entity screening run{scope}."


def _get_sdn_feed_date() -> str | None:
    if not SDN_META.exists():
        return None
    try:
        meta = json.loads(SDN_META.read_text(encoding="utf-8"))
        return (meta.get("fetched_at") or "").split("T")[0] or None
    except Exception:
        return None


# ── HTML / CSS template ──────────────────────────────────────────────────────

def _esc(s: Any) -> str:
    if s is None:
        return ""
    return html.escape(str(s))


_CSS = """
@page { size: letter; margin: 0.55in 0.65in; }
body { font: 10px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; }

.doc-header { display: flex; justify-content: space-between; align-items: flex-end;
              border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 12px; }
.doc-header .logo { font-size: 9px; color: #64748b; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; }
.doc-header .tenant { font-size: 9px; color: #64748b; margin-top: 1px; }
.doc-header .ts { font-size: 8px; color: #94a3b8; text-align: right; line-height: 1.5; font-family: 'JetBrains Mono', ui-monospace, monospace; }

.title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
.title-row h1 { font-size: 19px; margin: 0; font-weight: 700; line-height: 1.15; }
.title-row .sub { font-size: 9px; color: #94a3b8; font-family: 'JetBrains Mono', ui-monospace, monospace; margin-top: 3px; }
.title-row .lbl { font-size: 10px; color: #64748b; margin-top: 2px; max-width: 380px; }

.risk-badge { display: inline-block; padding: 3px 10px; border-radius: 3px; color: white;
              font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.risk-badge.critical { background: #dc2626; }
.risk-badge.high     { background: #d97706; }
.risk-badge.medium   { background: #2563eb; }
.risk-badge.low      { background: #16a34a; }

.warn-bar { background: #fffbeb; border-left: 3px solid #d97706; color: #92400e;
            padding: 5px 9px; font-size: 10px; margin: 6px 0 10px; border-radius: 2px; }

.portfolio { font-size: 10px; color: #475569; font-style: italic; margin: 0 0 10px; }

h2 { font-size: 9px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px;
     font-weight: 700; margin: 10px 0 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }

.kv-table { width: 100%; border-collapse: collapse; font-size: 10px; }
.kv-table td { padding: 2.5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
.kv-table td.k { font-weight: 600; color: #475569; width: 32%; }
.kv-table td.v { color: #1e293b; }
.kv-table td.v .src { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; color: #94a3b8; margin-left: 6px; }

.regime-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
.regime { display: flex; justify-content: space-between; align-items: baseline;
          padding: 3px 7px; background: #fef2f2; border-left: 3px solid #dc2626;
          border-radius: 1px; font-size: 10px; }
.regime .name { color: #1e293b; }
.regime .meta { color: #64748b; font-family: 'JetBrains Mono', ui-monospace, monospace;
                font-size: 8.5px; margin-left: 6px; white-space: nowrap; }

.owner-row { display: grid; grid-template-columns: 1.5fr 0.5fr 0.7fr 0.5fr; gap: 8px;
             padding: 3px 0; border-bottom: 1px solid #f1f5f9; font-size: 10px; align-items: baseline; }
.owner-row .name { color: #1e293b; }
.owner-row .name .sub { display: block; font-family: 'JetBrains Mono', ui-monospace, monospace;
                         font-size: 8px; color: #94a3b8; margin-top: 1px; }
.owner-row .pct { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.owner-row .meta { color: #64748b; font-size: 9px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
.owner-row .tag { font-size: 8px; padding: 1px 6px; border-radius: 2px; }
.owner-row .tag.former { background: #fef3c7; color: #92400e; }
.owner-row .tag.sanc   { background: #fee2e2; color: #991b1b; }
.owner-row .tag.pep    { background: #fef3c7; color: #92400e; }

.rule-bar { font-size: 9px; color: #475569; background: #f8fafc; padding: 5px 8px;
            border-left: 2px solid #475569; margin-top: 6px; }
.rule-bar .citation { font-style: italic; }

.impl { padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
.impl:last-child { border-bottom: 0; }
.impl .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.impl .label { font-weight: 600; font-size: 11px; color: #1e293b; }
.impl .factor { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8px; color: #94a3b8; }
.impl .body { font-size: 10px; color: #475569; margin-top: 2px; }
.impl .rule { font-size: 9px; color: #64748b; font-style: italic; margin-top: 1px; }

.disp { padding: 7px 10px; background: #fffbeb; border: 1px solid #fcd34d;
        border-radius: 3px; font-size: 10px; }
.disp .status { font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #92400e; }
.disp .meta { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px;
              color: #64748b; margin-left: 6px; }

.empty-line { font-size: 10px; color: #64748b; font-style: italic; padding: 6px 0; }

.footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 6px;
          font-size: 8px; color: #94a3b8; line-height: 1.55; }
.footer .row { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.footer .note { font-size: 8px; margin-top: 4px; font-style: italic; }

.appendix { margin-top: 16px; padding-top: 6px; border-top: 1px dashed #cbd5e1; }
.appendix h3 { font-size: 8px; color: #64748b; margin: 0 0 3px;
                text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; }
.appendix .factors { font-family: 'JetBrains Mono', ui-monospace, monospace;
                      font-size: 7pt; color: #64748b; line-height: 1.4; word-break: break-all; }
"""


def _render_html(
    *, entity_id: str, rs: dict, raw: dict,
    identity: dict, sanctions_grid: list[dict], ownership: dict,
    implications: list[dict], portfolio_line: str,
    run_id: str | None, sdn_feed_date: str | None,
    disposition: dict | None,
) -> str:
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    risk_level = rs.get("risk_level") or "medium"
    input_name = rs.get("input_name") or entity_id
    match_label = rs.get("match_label") or ""

    # Header right column — run + generated-at
    run_label = run_id or "default (list_1 cache)"

    # ── Identity table rows ──
    id_rows = [
        ("Type",            identity["type"],                   "data.type"),
        ("Jurisdiction",    ", ".join(identity["countries"][:6]) + (f" +{len(identity['countries'])-6}" if len(identity['countries']) > 6 else ""), "data.countries"),
        ("Incorporated",    identity["registration_date"],      "data.registration_date"),
        ("Address",         identity["address"][:120],          "data.addresses[0]"),
    ]
    for label, value, field in identity["rows"]:
        id_rows.append((label, value, f"data.identifiers[type={field}]"))
    id_table_html = "".join(
        f"<tr><td class='k'>{_esc(k)}</td><td class='v'>{_esc(v)}<span class='src'>{_esc(f)}</span></td></tr>"
        for (k, v, f) in id_rows
    )

    # ── Regime grid ──
    if sanctions_grid:
        cells = []
        for r in sanctions_grid:
            meta_parts = []
            if r.get("from_date"): meta_parts.append(r["from_date"])
            if r.get("source"):    meta_parts.append(r["source"][:28])
            meta = " · ".join(meta_parts) if meta_parts else "—"
            cells.append(
                f"<div class='regime' title='{_esc(r['factor'])}'>"
                f"<span class='name'>{_esc(r['label'])}</span>"
                f"<span class='meta'>{_esc(meta)}</span>"
                f"</div>"
            )
        regime_html = f"<div class='regime-grid'>{''.join(cells)}</div>"
    else:
        regime_html = "<div class='empty-line'>No direct sanctions-list designations recorded for this entity.</div>"

    # ── Ownership block ──
    if not ownership["available"]:
        ownership_html = (
            "<div class='empty-line'>Ownership chain not in cached traversal — "
            "fetch live for full chain. (Marquee entities have a pre-cached ownership graph; "
            "others are fetched on demand.)</div>"
        )
    elif not ownership["owners"]:
        ownership_html = (
            "<div class='empty-line'>No direct sanctioned or PEP owners found in the "
            f"cached traversal ({_esc(ownership.get('explored_count'))} paths explored). "
            "Indirect exposure may exist deeper in the chain — see Top Compliance Implications.</div>"
        )
    else:
        rows = []
        for o in ownership["owners"][:8]:
            pct = f"{o['percent']:.4f}%" if isinstance(o["percent"], (int, float)) and o["percent"] is not None and o["percent"] >= 0.0001 else (f"{o['percent']}%" if o["percent"] is not None else "—")
            sub_bits = [o["id"][:14] + "…"]
            if o["country"]: sub_bits.append(o["country"])
            if o["sdn_no"]:  sub_bits.append(f"SDN #{o['sdn_no']}")
            tags = []
            if o["sanctioned"]: tags.append("<span class='tag sanc'>SANCTIONED</span>")
            if o["pep"]:        tags.append("<span class='tag pep'>PEP</span>")
            if o["former"]:     tags.append("<span class='tag former'>FORMER</span>")
            rows.append(
                f"<div class='owner-row'>"
                f"<div class='name'>{_esc(o['label'])}<span class='sub'>{_esc(' · '.join(sub_bits))}</span></div>"
                f"<div class='pct'>{_esc(pct)}</div>"
                f"<div class='meta'>{_esc(o['field'])} · {_esc(o['last_obs'] or '—')}</div>"
                f"<div>{''.join(tags)}</div>"
                f"</div>"
            )
        rows_html = "".join(rows)
        # Rule citation derived from the recorded exposure factor
        if ownership["exposed_factor"] and ownership["exposed_factor"] in COMPLIANCE_IMPLICATIONS:
            ci = COMPLIANCE_IMPLICATIONS[ownership["exposed_factor"]]
            rule_html = f"<div class='rule-bar'><strong>{_esc(ci['label'])}</strong> — {_esc(ci['implication'])} <span class='citation'>{_esc(ci['rule'])}</span></div>"
        else:
            rule_html = ""
        ownership_html = rows_html + rule_html

    # ── Implications cards ──
    if implications:
        impl_html = "".join(
            f"<div class='impl'>"
            f"<div class='head'><span class='label'>{_esc(i['label'])}</span><span class='factor'>{_esc(i['factor'])}</span></div>"
            f"<div class='body'>{_esc(i['implication'])}</div>"
            f"<div class='rule'>{_esc(i['rule'])}"
            + (f" · from {_esc(i['from_date'])}" if i.get('from_date') else "")
            + (f" · source: {_esc((i['sources'] or [''])[0][:60])}" if i.get('sources') else "")
            + "</div></div>"
            for i in implications
        )
    else:
        impl_html = "<div class='empty-line'>No critical/high compliance implications recorded.</div>"

    # ── Portfolio context ──
    portfolio_html = f"<div class='portfolio'>{_esc(portfolio_line)}</div>" if portfolio_line else ""

    # ── Disposition ──
    if disposition and disposition.get("status") and disposition.get("status") != "pending":
        ds = disposition["status"].upper()
        meta_bits = []
        if disposition.get("reviewer"):   meta_bits.append(disposition["reviewer"])
        if disposition.get("decided_at"): meta_bits.append(disposition["decided_at"])
        rationale = disposition.get("rationale") or ""
        disp_html = (
            f"<div class='disp'><span class='status'>{_esc(ds)}</span>"
            f"<span class='meta'>{_esc(' · '.join(meta_bits))}</span>"
            f"<div style='margin-top:4px;'>{_esc(rationale)}</div></div>"
        )
    else:
        disp_html = (
            "<div class='disp'><span class='status'>Pending Review</span>"
            "<span class='meta'>no analyst decision recorded</span>"
            "<div style='margin-top:4px; font-size:9px; color:#64748b;'>"
            "Server-side disposition persistence not yet wired — set via the front-end maker-checker control on this entity's detail page."
            "</div></div>"
        )

    # ── Warn-verify banner if low confidence ──
    warn_html = ""
    if rs.get("warn_verify"):
        warn_html = "<div class='warn-bar'>⚠ Low-confidence resolution — matched label differs from input name. Verify entity identity before relying on this briefing.</div>"

    # ── Appendix: machine-readable factor list ──
    all_factors = sorted(rs.get("all_risk_factors") or [])
    appendix_html = (
        f"<div class='appendix'>"
        f"<h3>Appendix — Machine-readable factor list ({len(all_factors)})</h3>"
        f"<div class='factors'>{_esc(', '.join(all_factors))}</div>"
        f"</div>"
        if all_factors else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Compliance Briefing — {_esc(input_name)}</title>
<style>{_CSS}</style>
</head>
<body>

<div class="doc-header">
  <div>
    <div class="logo">Meridian Sentinel — Compliance Briefing</div>
    <div class="tenant">Meridian Energy Trading SA · Geneva</div>
  </div>
  <div class="ts">
    Generated {_esc(now)}<br/>
    run_id: {_esc(run_label)}
  </div>
</div>

<div class="title-row">
  <div>
    <h1>{_esc(input_name)}</h1>
    {f'<div class="lbl">{_esc(match_label)}</div>' if match_label else ''}
    <div class="sub">{_esc(entity_id)}</div>
  </div>
  <span class="risk-badge {_esc(risk_level)}">{_esc(risk_level)}</span>
</div>

{warn_html}
{portfolio_html}

<h2>Identity Evidence</h2>
<table class="kv-table">{id_table_html}</table>

<h2>Sanctions Coverage <span style="font-weight:400; color:#94a3b8;">— {len(sanctions_grid)} direct designation{'' if len(sanctions_grid)==1 else 's'}</span></h2>
{regime_html}

<h2>Ownership Exposure</h2>
{ownership_html}

<h2>Top Compliance Implications</h2>
{impl_html}

<h2>Recommended Disposition</h2>
{disp_html}

<div class="footer">
  <div class="row">
    cache_file: output/raw/{_esc(entity_id)}.json{
      f" + output/raw/traversal/{_esc(entity_id)}.json" if ownership['available'] else ''
    }
  </div>
  <div class="row">
    OFAC SDN feed: downloaded {_esc(sdn_feed_date or 'unknown')} · Generator: Meridian Sentinel briefing v{BRIEFING_VERSION} · run_id={_esc(run_label)}
  </div>
  <div class="note">
    Every risk signal traces to data.risk.* in the cached Sayari API response. Every owner traces to
    a path in the cached UBO traversal. No values fabricated. For internal compliance use only.
  </div>
</div>

{appendix_html}

</body>
</html>"""


# ── Public entry point ───────────────────────────────────────────────────────

def generate_briefing_tool(
    entity_id: str,
    cache: EntityCache,
    ofac_matcher=None,
    run_id: str | None = None,
    disposition: dict | None = None,
    out_dir: Path | None = None,
) -> CitedResult:
    """Render compliance briefing. Tries PDF (WeasyPrint), falls back to HTML."""
    out_dir = out_dir or BRIEFING_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_file = f"output/raw/{entity_id}.json"
    entity_url = f"/v1/entity/{entity_id}"

    raw = cache.get_entity_raw(entity_id)
    if raw is None:
        # 1-paragraph error HTML — still produces a valid PDF for the analyst.
        html_content = f"<html><body><h1>Entity {html.escape(entity_id)} not in cache.</h1><p>Cannot render briefing.</p></body></html>"
    else:
        rs = risk_summary_tool(entity_id, cache).data
        identity = _build_identity(raw)
        sanctions_grid = _build_sanctions_grid(raw)
        traversal = _load_traversal(entity_id)
        ownership = _build_ownership(raw, traversal, entity_id)
        implications = _build_implications(rs, raw)

        # Optional portfolio context (needs OFAC matcher)
        compare_data = None
        if ofac_matcher is not None:
            try:
                from .compare_ofac_vs_sayari import compare_ofac_vs_sayari_tool
                compare_data = compare_ofac_vs_sayari_tool(cache, ofac_matcher).data
            except Exception:
                compare_data = None
        portfolio_line = _build_portfolio_context(compare_data, entity_id, run_id)

        html_content = _render_html(
            entity_id=entity_id,
            rs=rs,
            raw=raw,
            identity=identity,
            sanctions_grid=sanctions_grid,
            ownership=ownership,
            implications=implications,
            portfolio_line=portfolio_line,
            run_id=run_id,
            sdn_feed_date=_get_sdn_feed_date(),
            disposition=disposition,
        )

    # PDF path — WeasyPrint installed AND cairo/pango/gdk-pixbuf available.
    # The HAS_WEASYPRINT flag is resolved once at module load. If the render
    # itself blows up at runtime (template bug, font issue, etc.) we still
    # fall through to the HTML response rather than crashing the request.
    if HAS_WEASYPRINT:
        try:
            pdf_path = out_dir / f"briefing-{entity_id}.pdf"
            _WeasyHTML(string=html_content).write_pdf(str(pdf_path))
            pdf_bytes = pdf_path.read_bytes()
            return CitedResult(
                data={
                    "entity_id": entity_id,
                    "pdf_path": str(pdf_path),
                    "format": "pdf",
                    "size_bytes": len(pdf_bytes),
                    "version": BRIEFING_VERSION,
                },
                source=SourceCitation(
                    entity_url=entity_url,
                    cache_file=cache_file,
                    api_endpoint="GET /v1/entity/{id} (cached) + cached UBO traversal",
                ),
            )
        except Exception as exc:
            import logging
            logging.getLogger("sentinel.briefing").warning(
                "WeasyPrint render failed (falling back to HTML): %s", exc
            )

    # HTML fallback — WeasyPrint either not installed or render failed.
    # The analyst saves to PDF via the browser's File > Print > Save as PDF.
    html_path = out_dir / f"briefing-{entity_id}.html"
    html_path.write_text(html_content, encoding="utf-8")
    return CitedResult(
        data={
            "entity_id": entity_id,
            "html_path": str(html_path),
            "format": "html",
            "size_bytes": len(html_content.encode()),
            "version": BRIEFING_VERSION,
            "note": (
                "WeasyPrint not installed on this host — serving print-friendly HTML. "
                "Use File > Print > Save as PDF in the browser for the audit artifact."
            ) if not HAS_WEASYPRINT else (
                "WeasyPrint render failed at runtime — serving the HTML template directly."
            ),
        },
        source=SourceCitation(
            entity_url=entity_url,
            cache_file=cache_file,
            api_endpoint="GET /v1/entity/{id} (cached)",
        ),
    )
