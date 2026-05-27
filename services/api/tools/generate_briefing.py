"""
Tool: generate_briefing

Render a compliance PDF briefing for an entity using WeasyPrint.
Falls back to a plain HTML file if WeasyPrint is not installed.

Returns CitedResult with:
  data:
    entity_id: str
    pdf_path: str (or html_path if PDF unavailable)
    format: "pdf" | "html"
    size_bytes: int
  source: cache file path
"""
from __future__ import annotations

import datetime
import html
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from packages.engine import EntityCache, CitedResult, SourceCitation
from .risk_summary import risk_summary_tool, RISK_DESCRIPTIONS

BRIEFING_DIR = Path("/tmp/sentinel-briefings")


def _render_html(entity_id: str, cache: EntityCache) -> str:
    """Render a compliance briefing as HTML. All facts from cached API data."""
    risk_result = risk_summary_tool(entity_id, cache)
    d = risk_result.data
    if "error" in d:
        return f"<html><body><h1>Error</h1><p>{html.escape(d['error'])}</p></body></html>"

    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    entity_url = f"https://sayari.com{d.get('entity_url', '/v1/entity/' + entity_id)}"

    risk_level = d.get("risk_level", "unknown")
    risk_color = {
        "critical": "#dc2626",
        "high": "#d97706",
        "medium": "#2563eb",
        "low": "#16a34a",
    }.get(risk_level, "#6b7280")

    top_risks_html = "".join(
        f"<li><strong>{html.escape(r['factor'])}</strong>: {html.escape(r['description'])}</li>"
        for r in d.get("top_risks", [])
    )

    sanction_lists_html = "".join(
        f"<li>{html.escape(s)}</li>"
        for s in d.get("sanctioned_lists", [])
    ) or "<li>None</li>"

    countries_html = ", ".join(d.get("countries", [])) or "—"
    warn = d.get("warn_verify", False)
    warn_html = (
        '<p style="color:#d97706;border:1px solid #d97706;padding:8px;border-radius:4px;">'
        "⚠ Low-confidence resolution — verify entity identity before relying on this briefing.</p>"
        if warn else ""
    )

    all_risks = d.get("all_risk_factors", [])
    all_risks_html = ", ".join(all_risks) if all_risks else "None"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Compliance Briefing — {html.escape(d.get('input_name', entity_id))}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; }}
  .header {{ border-bottom: 2px solid #0f172a; margin-bottom: 24px; padding-bottom: 16px; }}
  .logo {{ font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }}
  h1 {{ font-size: 24px; margin: 8px 0; }}
  .risk-badge {{ display: inline-block; padding: 4px 12px; border-radius: 4px;
                 color: white; font-weight: bold; font-size: 13px;
                 background: {risk_color}; text-transform: uppercase; }}
  table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }}
  td:first-child {{ font-weight: 600; width: 35%; color: #475569; }}
  .section {{ margin-top: 24px; }}
  h2 {{ font-size: 15px; color: #0f172a; text-transform: uppercase;
         letter-spacing: 0.5px; margin-bottom: 8px; }}
  ul {{ margin: 0; padding-left: 20px; }}
  li {{ margin: 4px 0; }}
  .source {{ font-size: 11px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #e2e8f0;
             padding-top: 12px; }}
  .footer {{ font-size: 11px; color: #94a3b8; margin-top: 16px; }}
</style>
</head>
<body>
<div class="header">
  <div class="logo">Meridian Sentinel — Compliance Co-Pilot</div>
  <h1>{html.escape(d.get('input_name', entity_id))}</h1>
  <p style="color:#64748b;margin:4px 0;">{html.escape(d.get('match_label') or '')}</p>
  <span class="risk-badge">{risk_level}</span>
  {warn_html}
</div>

<table>
  <tr><td>Entity ID</td><td><code>{html.escape(entity_id)}</code></td></tr>
  <tr><td>Sayari Profile</td><td><a href="{html.escape(entity_url)}">{html.escape(entity_url)}</a></td></tr>
  <tr><td>Type</td><td>{html.escape(d.get('type') or '—')}</td></tr>
  <tr><td>Countries</td><td>{html.escape(countries_html)}</td></tr>
  <tr><td>Sanctioned</td><td>{'Yes' if d.get('sanctioned') else 'No'}</td></tr>
  <tr><td>PEP-Adjacent</td><td>{'Yes' if d.get('pep_adjacent') else 'No'}</td></tr>
  <tr><td>State-Owned</td><td>{'Yes' if d.get('state_owned') else 'No'}</td></tr>
  <tr><td>Network Degree</td><td>{d.get('degree') or '—'}</td></tr>
  <tr><td>Source Count</td><td>{d.get('source_count') or '—'}</td></tr>
  <tr><td>Resolution Confidence</td><td>{'Low — verify' if d.get('warn_verify') else 'High'}</td></tr>
</table>

<div class="section">
  <h2>Sanctions Exposure</h2>
  <ul>{sanction_lists_html}</ul>
</div>

<div class="section">
  <h2>Top Risk Signals</h2>
  <ul>{top_risks_html if top_risks_html else '<li>None identified</li>'}</ul>
</div>

<div class="section">
  <h2>All Risk Factors ({len(all_risks)})</h2>
  <p style="font-size:12px;color:#64748b;">{html.escape(all_risks_html)}</p>
</div>

<div class="source">
  <strong>Source:</strong> All data from Sayari API response cached at
  <code>output/raw/{html.escape(entity_id)}.json</code>.
  Every risk factor traceable to <code>data.risk.*</code> in that file.
</div>
<div class="footer">
  Generated {now} by Meridian Sentinel.
  Sayari entity_id: <code>{html.escape(entity_id)}</code>.
  For internal compliance use only.
</div>
</body>
</html>"""


def generate_briefing_tool(
    entity_id: str,
    cache: EntityCache,
    out_dir: Path | None = None,
) -> CitedResult:
    """Render compliance briefing. Tries PDF (WeasyPrint), falls back to HTML."""
    out_dir = out_dir or BRIEFING_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_file = f"output/raw/{entity_id}.json"
    entity_url = f"/v1/entity/{entity_id}"

    html_content = _render_html(entity_id, cache)

    # Try WeasyPrint for PDF
    try:
        from weasyprint import HTML  # type: ignore[import]
        pdf_path = out_dir / f"briefing-{entity_id}.pdf"
        HTML(string=html_content).write_pdf(str(pdf_path))
        pdf_bytes = pdf_path.read_bytes()
        return CitedResult(
            data={
                "entity_id": entity_id,
                "pdf_path": str(pdf_path),
                "format": "pdf",
                "size_bytes": len(pdf_bytes),
            },
            source=SourceCitation(
                entity_url=entity_url,
                cache_file=cache_file,
                api_endpoint="GET /v1/entity/{id} (cached)",
            ),
        )
    except ImportError:
        pass
    except Exception as exc:
        import logging
        logging.getLogger("sentinel.briefing").warning("WeasyPrint failed: %s", exc)

    # Fallback: HTML file
    html_path = out_dir / f"briefing-{entity_id}.html"
    html_path.write_text(html_content, encoding="utf-8")
    return CitedResult(
        data={
            "entity_id": entity_id,
            "html_path": str(html_path),
            "format": "html",
            "size_bytes": len(html_content.encode()),
            "note": "WeasyPrint not installed — generated HTML instead of PDF.",
        },
        source=SourceCitation(
            entity_url=entity_url,
            cache_file=cache_file,
            api_endpoint="GET /v1/entity/{id} (cached)",
        ),
    )
