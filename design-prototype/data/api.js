// Meridian Sentinel — live API loader
//
// Runs after fixtures.js. Fetches real data from the FastAPI backend and
// overwrites the relevant window.* globals so components see live values.
//
// If the backend is unreachable (no server running), globals are left as-is
// (fixtures.js values), so the prototype degrades gracefully.
//
// Backend base URL — change if running on a different port.
window.SENTINEL_API_BASE = window.SENTINEL_API_BASE || 'http://localhost:8000';

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
      console.log('[sentinel/api] compare_ofac_vs_sayari loaded from backend');
    }
  } catch (_) {
    console.info('[sentinel/api] backend unavailable — using fixture COMPARE_RESULT');
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
})();
