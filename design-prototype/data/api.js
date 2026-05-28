// Meridian Sentinel — live API loader
//
// Runs after fixtures.js. Fetches real data from the FastAPI backend and
// overwrites the relevant window.* globals so components see live values.
//
// If the backend is unreachable (no server running), globals are left as-is
// (fixtures.js values), so the prototype degrades gracefully.
//
// Backend base URL — same origin when served by FastAPI at /ui/. Override
// via window.SENTINEL_API_BASE before this script loads if needed.
window.SENTINEL_API_BASE = window.SENTINEL_API_BASE || 'http://localhost:8000';

// Track which window.* globals have been replaced by real backend data so
// downstream UI can label "real vs fixture" honestly if it ever needs to.
window.SENTINEL_LIVE_FETCHED = window.SENTINEL_LIVE_FETCHED || {};

(async function initSentinelData() {
  const base = window.SENTINEL_API_BASE;

  // ── 1. Compare result ────────────────────────────────────────────────────
  try {
    const resp = await fetch(`${base}/tools/compare_ofac_vs_sayari?threshold=0.85`);
    if (resp.ok) {
      const json = await resp.json();
      // Backend returns CitedResult shape: {data: {rows, summary, ...}, source: {...}}
      window.COMPARE_RESULT = json;
      // Some surfaces read COMPARE_ROWS directly
      if (json.data && json.data.rows) {
        window.COMPARE_ROWS = json.data.rows;
      }
      window.SENTINEL_LIVE_FETCHED.COMPARE_RESULT = true;
      console.log('[sentinel/api] compare_ofac_vs_sayari loaded from backend');
    }
  } catch (_) {
    console.info('[sentinel/api] backend unavailable — using fixture COMPARE_RESULT');
  }

  // ── 1b. Run summary (input total, resolved, sanctioned_count, etc.) ──────
  // Used by Compare's top header line so "50 vendors · 49 resolved · 45 sanctioned"
  // is bound to real data, not hardcoded JSX.
  try {
    const resp = await fetch(`${base}/summary`);
    if (resp.ok) {
      const json = await resp.json();
      window.RUN_SUMMARY = json;
      window.SENTINEL_LIVE_FETCHED.RUN_SUMMARY = true;
      console.log('[sentinel/api] /summary loaded from backend');
    }
  } catch (_) {
    console.info('[sentinel/api] backend unavailable — no RUN_SUMMARY');
  }

  // ── 2. Ownership graph for Belorusskaya (marquee entity) ─────────────────
  try {
    const resp = await fetch(`${base}/tools/traverse_ownership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: 'BSsUPVlxsICOW4GCjb4fqQ', depth: 3 }),
    });
    if (resp.ok) {
      const json = await resp.json();
      window.GRAPH_BELORUSSKAYA = json;
      console.log('[sentinel/api] traverse_ownership (Belorusskaya) loaded from backend');
    }
  } catch (_) {
    console.info('[sentinel/api] backend unavailable — using fixture GRAPH_BELORUSSKAYA');
  }

  // ── 3. Investigations list ────────────────────────────────────────────────
  // Backend returns {"investigations": [{ id, name, list_ref, source,
  // source_detail, status, created_at, counts:{total,flagged,cleared,
  // escalated,blocked,pending}, ownership_gap_count }, …]}.
  try {
    const resp = await fetch(`${base}/api/investigations`);
    if (resp.ok) {
      const json = await resp.json();
      const list = Array.isArray(json) ? json : (json && json.investigations);
      if (Array.isArray(list) && list.length > 0) {
        window.INVESTIGATIONS = list.map((inv, i) => {
          const sourceLabel = inv.source_detail || inv.source || 'Manual upload';
          const sourceLower = (inv.source || '').toLowerCase();
          const detailLower = (inv.source_detail || '').toLowerCase();
          const isSftp = sourceLower.includes('sftp') || detailLower.includes('sftp');
          const counts = inv.counts || {};
          return {
            id: inv.id,
            name: inv.name || inv.list_ref || sourceLabel,
            list_ref: inv.list_ref || sourceLabel,
            source: sourceLabel,
            source_kind: isSftp ? 'sftp' : 'manual',
            created_at: inv.created_at ? String(inv.created_at).slice(0, 10) : '',
            entity_count: counts.total ?? 0,
            // "Findings" semantics: flagged maps to sanctioned-style findings.
            sanctioned_count: counts.flagged ?? 0,
            ownership_gap_count: inv.ownership_gap_count ?? 0,
            status: inv.status || 'pending_review',
            reviewer: inv.reviewer || null,
            // counts surfaced as nested for components that prefer the
            // backend shape directly:
            counts,
            // First entry (newest from the backend ordering) is the active hero
            // when the user is inside an investigation without an explicit runId.
            hero: i === 0,
          };
        });
        window.SENTINEL_LIVE_FETCHED.INVESTIGATIONS = true;
        console.log('[sentinel/api] investigations loaded from backend:', window.INVESTIGATIONS.length);
      }
    }
  } catch (_) {
    console.info('[sentinel/api] backend unavailable — using fixture INVESTIGATIONS');
  }
})();
