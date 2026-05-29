/* Surface 3 — Compare hero: OFAC name-screen vs Sayari (§8) */

const COMPARE_API_BASE = (typeof window !== 'undefined' && window.SENTINEL_API_BASE) || '';

function Compare({ onOpenEntity, focusEntityId, runId }) {
  // When runId is set, fetch this run's compare result + /summary. Otherwise
  // use window.COMPARE_RESULT (already populated by api.js for list_1).
  const [perRunResult, setPerRunResult] = useState(null);
  const [perRunSummary, setPerRunSummary] = useState(null);
  const [perRunError, setPerRunError] = useState(null);
  // Disposition map keyed by entity_id — fetched from /api/dispositions/{run_id}
  // so the reconciliation table paints persisted decisions without window state.
  const [dispositions, setDispositions] = useState({});
  // Hooks below USED to live after the loading/error early-returns at lines
  // ~51-68, which violated React Rules-of-Hooks: the loading render ran 4
  // hooks while the post-load render ran 7, and React silently blanked the
  // component on the transition. Hoisted up here so the hook count is
  // identical on every render path.
  const [filterOutcome, setFilterOutcome] = useState(null);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  // Ref on the ownership-gap spotlight wrapper so the run-composition tree's
  // "hidden behind ownership" leaf can scroll the user to it (that leaf
  // covers two outcomes — sayari_only + screen_ambiguous — and the spotlight
  // is the canonical place those rows live, so scrolling beats filtering).
  const spotlightRef = useRef(null);

  // Per-run dispositions — reload whenever the active runId changes.
  useEffect(() => {
    let cancelled = false;
    const scope = runId || 'default';
    fetch(`${COMPARE_API_BASE}/api/dispositions/${encodeURIComponent(scope)}`)
      .then(r => r.ok ? r.json() : {})
      .then(map => { if (!cancelled) setDispositions(map || {}); })
      .catch(() => { if (!cancelled) setDispositions({}); });
    return () => { cancelled = true; };
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setPerRunResult(null);
      setPerRunSummary(null);
      setPerRunError(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`${COMPARE_API_BASE}/tools/compare_ofac_vs_sayari?threshold=0.85&run_id=${encodeURIComponent(runId)}`).then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)),
      fetch(`${COMPARE_API_BASE}/summary?run_id=${encodeURIComponent(runId)}`).then(r => r.ok ? r.json() : null),
    ]).then(([cmp, sum]) => {
      if (cancelled) return;
      setPerRunResult(cmp);
      setPerRunSummary(sum);
    }).catch(err => {
      if (cancelled) return;
      setPerRunError(String(err));
    });
    return () => { cancelled = true; };
  }, [runId]);

  // Derive view data WITH null-tolerant guards so the useMemo / useEffect
  // calls below run unconditionally on every render path (loading, error,
  // or loaded). The early returns at the end of this block consume the
  // values — they do NOT short-circuit hook execution.
  const result = perRunResult || window.COMPARE_RESULT;
  const rows = result?.data?.rows || [];
  const summary = result?.data?.summary || {};
  const ofac_fetched_at = result?.data?.ofac_fetched_at;
  // Make the per-run /summary available to the top header line (read inside
  // the existing IIFE below) without leaking into window.RUN_SUMMARY.
  const localRunSummary = perRunSummary;

  const gapRows = useMemo(
    () => rows.filter(r => r.outcome === 'sayari_only' || r.outcome === 'screen_ambiguous'),
    [rows]
  );

  const OUTCOME_ORDER = { sayari_only: 0, screen_ambiguous: 1, matcher_miss: 2, ofac_only: 3, both_catch: 4, no_ofac: 5, unresolved: 6 };
  const sortedRows = useMemo(() => [...rows].sort((a, b) => (OUTCOME_ORDER[a.outcome] ?? 9) - (OUTCOME_ORDER[b.outcome] ?? 9)), [rows]);

  const visibleRows = useMemo(
    () => filterOutcome ? sortedRows.filter(r => r.outcome === filterOutcome) : sortedRows,
    [sortedRows, filterOutcome]
  );

  useEffect(() => {
    if (!focusEntityId) {
      const main = document.querySelector('main');
      if (main) main.scrollTop = 0;
      window.scrollTo(0, 0);
      return;
    }
    setExpandedRowId(focusEntityId);
    setHighlightId(focusEntityId);
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-entity-row="${focusEntityId}"]`);
      if (!el) return;
      const main = document.querySelector('main');
      const rect = el.getBoundingClientRect();
      if (main && main.scrollHeight > main.clientHeight + 4) {
        const mainRect = main.getBoundingClientRect();
        main.scrollTop += rect.top - mainRect.top - 100;
      } else {
        window.scrollTo({ top: window.scrollY + rect.top - 100, behavior: 'smooth' });
      }
    }, 30);
    const t2 = setTimeout(() => setHighlightId(null), 1800);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [focusEntityId]);

  // ── Early returns AFTER all hooks ────────────────────────────────────────
  // While a per-run fetch is in flight, show a quiet loading state instead
  // of falling through to window.COMPARE_RESULT (which is list_1 — that'd
  // flash the wrong data).
  if (runId && !perRunResult && !perRunError) {
    return (
      <div style={{ padding: '32px 40px', color: 'var(--text-muted)', fontSize: 13 }}>
        <span className="pulse mono" style={{ color: 'var(--accent)' }}>●</span>{' '}
        Loading compare for <span className="mono" style={{ color: 'var(--text-primary)' }}>{runId}</span>…
        <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>
          GET /tools/compare_ofac_vs_sayari?run_id={runId}
        </div>
      </div>
    );
  }
  if (runId && perRunError) {
    return (
      <div style={{ padding: '32px 40px', color: 'var(--risk-critical)', fontSize: 13 }}>
        Failed to load compare for run {runId}: {perRunError}
      </div>
    );
  }
  if (!result) {
    // No data yet AND no error AND no runId — happens transiently before
    // window.COMPARE_RESULT loads. Render the same loading affordance.
    return (
      <div style={{ padding: '32px 40px', color: 'var(--text-muted)', fontSize: 13 }}>
        <span className="pulse mono" style={{ color: 'var(--accent)' }}>●</span> Loading compare…
      </div>
    );
  }

  const buckets = [
    { key: 'sayari_only',      count: summary.sayari_only },
    { key: 'screen_ambiguous', count: summary.screen_ambiguous },
    { key: 'matcher_miss',     count: summary.matcher_miss },
    { key: 'ofac_only',        count: summary.ofac_only },
    { key: 'both_catch',       count: summary.both_catch },
    { key: 'no_ofac',          count: summary.no_ofac },
  ];

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1400, margin: '0 auto' }}>

      <RunComposition
        summary={summary}
        onSelectOutcome={(o) => setFilterOutcome(o)}
        spotlightRef={spotlightRef}
      />

      {(() => {
        // Top header: bind to real /summary (input/resolved/sanctioned counts)
        // and to compare summary.ownership_gap. Per-run summary (when runId is
        // set) wins over the cached window.RUN_SUMMARY.
        const rs = (localRunSummary && localRunSummary.data)
                || (window.RUN_SUMMARY && window.RUN_SUMMARY.data)
                || {};
        const totalInput      = rs.total_input      != null ? rs.total_input      : summary.total_entities + (summary.unresolved || 0);
        const resolved        = rs.resolved         != null ? rs.resolved         : summary.total_entities;
        const sanctionedCount = rs.sanctioned_count != null ? rs.sanctioned_count : null;
        return (
          <>
            <div style={{ marginBottom: 12 }}>
              <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
                {(() => {
                  // Active investigation lookup — derive the kicker label from
                  // the run we're looking at, not a hardcoded "list_1".
                  const list = window.INVESTIGATIONS || [];
                  const inv = runId
                    ? list.find(i => String(i.id) === String(runId))
                    : (list.find(i => i.hero) || list[0]);
                  const label = inv?.name || inv?.list_ref || (runId ? 'uploaded list' : 'list_1');
                  return `${label} · threshold 0.85`;
                })()}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                <span className="mono" style={{ color: 'var(--text-primary)' }}>{totalInput}</span> vendors ·{' '}
                <span className="mono" style={{ color: 'var(--text-primary)' }}>{resolved}</span> resolved ·{' '}
                <span className="mono" style={{ color: 'var(--text-primary)' }}>{sanctionedCount != null ? sanctionedCount : '—'}</span> sanctioned
              </div>
            </div>

            <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.4, maxWidth: 940, marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--accent)' }}>{summary.ownership_gap} vendor{summary.ownership_gap === 1 ? '' : 's'} a clean name-screen would wave through</span> are actually blocked.
            </div>
          </>
        );
      })()}

      <CompareFunnel summary={summary} />

      <div style={{ marginTop: 28, marginBottom: 40, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <OutcomeBadge outcome="both_catch" count={summary.both_catch} large active={filterOutcome === null && true} onClick={() => setFilterOutcome(filterOutcome === 'both_catch' ? null : 'both_catch')} />
        {buckets.filter(b => b.key !== 'both_catch').map(b => (
          <OutcomeBadge key={b.key} outcome={b.key} count={b.count} large active={filterOutcome === b.key} onClick={() => setFilterOutcome(b.key === filterOutcome ? null : b.key)} />
        ))}
        {filterOutcome ? (
          <button onClick={() => setFilterOutcome(null)} style={{
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border-default)',
            padding: '4px 10px', borderRadius: 2, fontSize: 11,
            fontFamily: 'var(--font-mono)', letterSpacing: 0.4, alignSelf: 'center',
          }}>show all</button>
        ) : null}
      </div>

      <div ref={spotlightRef}>
      <SectionHeader
        kicker="Ownership-gap spotlight"
        title={gapRows.length === 0
          ? "No ownership-gap findings in this run"
          : `The ${gapRows.length} entit${gapRows.length === 1 ? 'y' : 'ies'} a name-screen can't catch`}
      />
      {gapRows.length === 0 ? (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 6, padding: '20px 24px', marginBottom: 48,
          fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic',
        }}>
          Every OFAC-exposed vendor in this run is caught by the name-screen directly.
          No 50% rule or screen-ambiguous cases to investigate.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 48 }}>
          {gapRows.map((row, i) => (
            <GapCard key={`${row.input_name}::${row.entity_id}`} row={row} marquee={i === 0} onOpen={() => onOpenEntity(row.entity_id)} />
          ))}
        </div>
      )}
      </div>{/* /spotlightRef wrapper */}

      <SectionHeader
        kicker="Full reconciliation"
        title={`${visibleRows.length} ${visibleRows.length === 1 ? 'entity' : 'entities'}${filterOutcome ? ' · filtered' : ''}`}
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {filterOutcome ? (
              <button onClick={() => setFilterOutcome(null)} style={{ background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 4, fontSize: 12 }}>
                clear filter
              </button>
            ) : (
              <span className="mono muted" style={{ fontSize: 11 }}>OFAC SDN feed downloaded {ofac_fetched_at?.slice(0,10)}</span>
            )}
            {/* The "↓ Export investigation report" button was removed in Pass 2 —
                it opened a modal that just set local state and never produced a
                file. Per-entity Briefing PDFs (the real, WeasyPrint-rendered
                ones) remain on the Entity surface. */}
          </div>
        }
      />
      <ReconciliationTable rows={visibleRows} expandedId={expandedRowId} onToggle={setExpandedRowId} onOpenEntity={onOpenEntity} highlightId={highlightId} dispositions={dispositions} />
    </div>
  );
}

// ─── Run composition tree ────────────────────────────────────────────────────
// Collapsible panel that sits above the kicker on Compare. Closes a real UX
// gap: the headline numbers ("46 sanctioned" in the header, "40 OFAC exposed"
// in the funnel below) used to appear in the same surface with no obvious
// relationship between them. The tree shows how they nest:
//
//   input rows
//   └─ resolved
//      ├─ clean (no sanctions)
//      ├─ sanctioned non-OFAC
//      └─ OFAC exposed   ← funnel scope below
//         ├─ both caught
//         ├─ ownership gap (50% rule)
//         └─ matcher miss
//   unresolved
//
// The four OFAC-subset leaves are clickable and filter the reconciliation
// table via setFilterOutcome. "Hidden behind ownership" maps to TWO outcomes
// (sayari_only + screen_ambiguous) so instead of inventing a group filter we
// scroll the user to the ownership-gap spotlight section above the table —
// the same rows live there already as cards. The two non-OFAC leaves are
// non-clickable: their filtering would require new client-side logic for a
// minor navigation aid and the spec explicitly allows skipping it.

function RunComposition({ summary, onSelectOutcome, spotlightRef }) {
  const [open, setOpen] = useState(false);
  if (!summary) return null;

  const totalInput        = summary.total_input        ?? summary.total_entities ?? 0;
  const resolved          = summary.total_entities     ?? 0;
  const unresolved        = summary.unresolved_input   ?? summary.unresolved      ?? 0;
  const totalSanctioned   = summary.total_sanctioned   ?? 0;
  const totalOfacExposed  = summary.total_ofac_exposed ?? 0;
  const sanctionedNonOfac = summary.sanctioned_non_ofac ?? Math.max(0, totalSanctioned - totalOfacExposed);
  const resolvedClean     = summary.resolved_clean     ?? Math.max(0, resolved - totalSanctioned);
  const bothCatch         = summary.both_catch         ?? 0;
  const ownershipGap      = summary.ownership_gap      ?? 0;
  const matcherMiss       = summary.matcher_miss       ?? 0;
  const pct = (resolved && totalInput) ? Math.round((resolved / totalInput) * 100) : null;

  const scrollToSpotlight = () => {
    if (spotlightRef && spotlightRef.current) {
      spotlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!open) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '8px 0', marginBottom: 14,
      }}>
        <span className="mono" style={{
          fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase',
        }}>Run composition</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>{resolved}</span> resolved
          <span className="muted" style={{ margin: '0 8px' }}>·</span>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>{totalSanctioned}</span> sanctioned
          <span className="muted" style={{ margin: '0 8px' }}>·</span>
          <span className="mono" style={{ color: 'var(--accent)' }}>{totalOfacExposed}</span> OFAC exposed
        </span>
        <button onClick={() => setOpen(true)} style={{
          background: 'transparent', color: 'var(--text-muted)',
          border: '1px solid var(--border-default)',
          padding: '3px 9px', borderRadius: 2,
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 0.6,
          cursor: 'pointer',
        }}>expand ▾</button>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
      borderRadius: 4, padding: '16px 22px', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="mono" style={{
          fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase',
        }}>Run composition</span>
        <button onClick={() => setOpen(false)} style={{
          background: 'transparent', color: 'var(--text-muted)',
          border: '1px solid var(--border-default)',
          padding: '3px 9px', borderRadius: 2,
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 0.6,
          cursor: 'pointer',
        }}>collapse ▴</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <CompositionRow indent={0} prefix=""   count={totalInput}        label="input rows" />
        <CompositionRow indent={1} prefix="└─" count={resolved}          label={`resolved${pct != null ? ` (${pct}%)` : ''}`} />
        <CompositionRow indent={5} prefix="├─" count={resolvedClean}     label="with no sanctions anywhere" />
        <CompositionRow indent={5} prefix="├─" count={sanctionedNonOfac} label="sanctioned by non OFAC regimes only" />
        <CompositionRow indent={5} prefix="└─" count={totalOfacExposed}  label="OFAC exposed"
                        leafKind="group" annotation="← funnel scope below" />
        <CompositionRow indent={9} prefix="├─" count={bothCatch}         label="caught by both"
                        leafKind="ofac" onClick={() => onSelectOutcome('both_catch')} />
        <CompositionRow indent={9} prefix="├─" count={ownershipGap}      label="hidden behind ownership (50% rule)"
                        leafKind="ofac" onClick={scrollToSpotlight}
                        clickHint="scrolls to ownership-gap spotlight" />
        <CompositionRow indent={9} prefix="└─" count={matcherMiss}       label="lost to name variation"
                        leafKind="ofac" onClick={() => onSelectOutcome('matcher_miss')} />
        <CompositionRow indent={0} prefix=""   count={unresolved}        label="unresolved" />
      </div>
      <div className="muted" style={{
        fontSize: 10, fontStyle: 'italic', marginTop: 12, paddingTop: 8,
        borderTop: '1px dashed var(--border-subtle)', lineHeight: 1.5,
      }}>
        Click an accent-coloured leaf to filter the reconciliation table below.
        The OFAC-exposed group and the two non-OFAC leaves are not directly
        clickable — they live above or in the spotlight section, not the
        outcome-bucket filter.
      </div>
    </div>
  );
}

function CompositionRow({ indent, prefix, count, label, leafKind, onClick, annotation, clickHint }) {
  // leafKind: undefined/'plain' → text-primary; 'ofac' → accent (clickable);
  // 'group' → text-secondary (non-clickable structural node).
  const isClickable = typeof onClick === 'function';
  const countColor = leafKind === 'ofac'   ? 'var(--accent)'
                   : leafKind === 'group'  ? 'var(--text-secondary)'
                                           : 'var(--text-primary)';
  // Approximate 2.5 em per indent unit so the ├/└ characters align in
  // monospace without manually padding strings.
  const indentPx = indent * 8;
  return (
    <div
      onClick={isClickable ? onClick : undefined}
      title={clickHint || (isClickable ? 'click to filter the reconciliation table' : undefined)}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 0,
        fontFamily: 'var(--font-mono)', fontSize: 12,
        color: 'var(--text-secondary)',
        padding: '3px 6px',
        borderRadius: 2,
        cursor: isClickable ? 'pointer' : 'default',
        background: isClickable ? 'rgba(201,169,97,0.04)' : 'transparent',
        border: '1px solid', borderColor: isClickable ? 'var(--accent-dim)' : 'transparent',
        transition: 'background 100ms',
      }}
    >
      <span style={{ width: indentPx, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ color: 'var(--text-muted)', minWidth: 28 }}>{prefix}</span>
      <span style={{ color: countColor, fontWeight: 600, marginRight: 6, minWidth: 24, textAlign: 'right' }}>{count}</span>
      <span>{label}</span>
      {annotation ? (
        <span className="muted" style={{ fontStyle: 'italic', marginLeft: 12, fontSize: 11 }}>{annotation}</span>
      ) : null}
    </div>
  );
}

function CompareFunnel({ summary }) {
  // All funnel numbers bind to the live /tools/compare_ofac_vs_sayari?threshold=0.85
  // summary — no hardcoded JSX values. `total_ofac_exposed` is the universe;
  // `ofac_screen_finds` is the name-screen catch; the gap is the rest.
  const exposed      = summary.total_ofac_exposed;
  const screenFinds  = summary.ofac_screen_finds;
  const missedByName = (exposed != null && screenFinds != null) ? (exposed - screenFinds) : null;
  const ownershipGap = summary.ownership_gap;
  const nameMissed   = summary.matcher_miss;

  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(201,169,97,0.04) 0%, rgba(201,169,97,0) 100%)',
      border: '1px solid var(--border-default)',
      borderRadius: 8,
      padding: '40px 44px',
    }}>
      <div className="mono" style={{ color: 'var(--accent-dim)', fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 16 }}>
        The Ownership Gap · funnel
      </div>

      <div className="serif" style={{ fontSize: 32, lineHeight: 1.3, letterSpacing: -0.2, maxWidth: 1000, marginBottom: 36 }}>
        A fair OFAC name-screen catches{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{screenFinds}</span> of{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{exposed}</span> OFAC-exposed entities. It misses{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--risk-high)' }}>{missedByName}</span> —{' '}
        <span style={{ color: 'var(--accent)' }}><span style={{ fontFamily: 'var(--font-mono)' }}>{ownershipGap}</span> hidden behind ownership</span>,{' '}
        <span style={{ color: 'var(--text-secondary)' }}><span style={{ fontFamily: 'var(--font-mono)' }}>{nameMissed}</span> lost to name variations</span>.{' '}
        <span style={{ color: 'var(--text-primary)' }}>Sayari catches all {exposed}.</span>
      </div>

      <FunnelDiagram
        exposed={exposed}
        screenFinds={screenFinds}
        missedByName={missedByName}
        ownershipGap={ownershipGap}
        nameMissed={nameMissed}
      />

      <div className="muted" style={{ fontSize: 12, marginTop: 24, fontStyle: 'italic', maxWidth: 800 }}>
        Reconciliation, not a scoreboard. Disagreements between sources are signals to investigate,
        not verdicts. 31 CFR § 501.801.
      </div>
    </div>
  );
}

function FunnelDiagram({ exposed, screenFinds, missedByName, ownershipGap, nameMissed }) {
  return (
    <div style={{ position: 'relative' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} preserveAspectRatio="none">
        <defs>
          <marker id="fnArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, rowGap: 36 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <FunnelCell label="OFAC-exposed entities" value={exposed} tone="neutral" anchor />
        </div>

        <div style={{ gridColumn: '1 / 3' }}>
          <FunnelCell label="OFAC name-screen catches" value={screenFinds} tone="low" sub="agreement — both sources flag" />
        </div>
        <div style={{ gridColumn: '3 / 5' }}>
          <FunnelCell label="missed by name-screen" value={missedByName} tone="warn" sub="invisible to string-matching" />
        </div>

        <div style={{ gridColumn: '1 / 3', minHeight: 70 }}>
          <FunnelGhost label="(also caught by Sayari)" />
        </div>
        <div style={{ gridColumn: '3 / 4' }}>
          <FunnelCell label="hidden behind ownership" value={ownershipGap} tone="gold" sub="OFAC 50% rule · 31 CFR §501.801" emphasis />
        </div>
        <div style={{ gridColumn: '4 / 5' }}>
          <FunnelCell label="lost to name variation" value={nameMissed} tone="muted" sub="resolution beats string-match" />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <FunnelCell label="Sayari catches all" value={exposed} tone="accent-strong" anchor sub="resolved identity + ownership graph traversal" />
        </div>
      </div>
    </div>
  );
}

function FunnelCell({ label, value, tone, sub, emphasis, anchor }) {
  const palette = {
    neutral:        { bg: 'var(--bg-surface)',             border: 'var(--border-default)', fg: 'var(--text-primary)',  accent: 'var(--text-secondary)' },
    low:            { bg: 'rgba(63,185,80,0.04)',           border: 'rgba(63,185,80,0.25)',  fg: 'var(--text-primary)',  accent: 'var(--risk-low)' },
    warn:           { bg: 'rgba(219,109,40,0.04)',          border: 'rgba(219,109,40,0.3)',  fg: 'var(--risk-high)',     accent: 'var(--risk-high)' },
    gold:           { bg: 'rgba(201,169,97,0.1)',           border: 'var(--accent)',         fg: 'var(--accent)',        accent: 'var(--accent)' },
    muted:          { bg: 'rgba(100,116,139,0.05)',         border: 'var(--border-default)', fg: 'var(--text-secondary)',accent: 'var(--text-muted)' },
    'accent-strong':{ bg: 'rgba(201,169,97,0.04)',          border: 'var(--accent-dim)',     fg: 'var(--text-primary)',  accent: 'var(--accent)' },
  }[tone || 'neutral'];
  return (
    <div style={{
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      borderRadius: 3,
      padding: anchor ? '18px 22px' : '14px 16px',
      margin: '0 6px',
      minHeight: 84,
      position: 'relative', zIndex: 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: 'var(--font-mono)' }}>{label}</div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: anchor ? 40 : (emphasis ? 36 : 30),
          fontWeight: 600,
          color: palette.fg,
          lineHeight: 1,
        }}>{value}</div>
      </div>
      {sub ? (
        <div style={{ fontSize: 11, color: palette.accent, marginTop: 6, lineHeight: 1.5 }}>{sub}</div>
      ) : null}
    </div>
  );
}

function FunnelGhost({ label }) {
  return (
    <div style={{
      padding: '14px 16px', margin: '0 6px', minHeight: 84,
      border: '1px dashed var(--border-subtle)',
      borderRadius: 3,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)',
      letterSpacing: 0.4,
      position: 'relative', zIndex: 1,
    }}>{label}</div>
  );
}

// InvestigationReportModal + ReportOption removed in Pass 2 — they rendered
// a confident modal listing fictitious counts ("~14 pages / 6 sections / 62
// cited sources") and a "Generate report" button that only toggled local
// state. The per-entity Briefing PDF on Entity surface (real, WeasyPrint-
// backed) is the honest report path.

function GapCard({ row, marquee, onOpen }) {
  return (
    <div
      onClick={onOpen}
      className="clickable"
      style={{
        background: marquee ? 'linear-gradient(180deg, rgba(201,169,97,0.08), rgba(201,169,97,0.01))' : 'var(--bg-surface)',
        border: `1px solid ${marquee ? 'var(--accent-dim)' : 'var(--border-default)'}`,
        borderRadius: 6,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        transition: 'transform 120ms, border-color 120ms',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{row.input_name}</div>
        <OutcomeBadge outcome={row.outcome} />
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {row.match_label}
      </div>
      <div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 6, letterSpacing: 0.2 }}>
          {row.ownership_factor}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {row.outcome === 'sayari_only'
            ? 'Not named on SDN; blocked by ownership/control exposure (OFAC 50% rule).'
            : row.outcome === 'screen_ambiguous'
              ? <>Screen fired on <span style={{ color: 'var(--text-primary)' }}>{row.ofac_match_name || 'a different SDN entity'}</span> — not this entity. Sayari confirms exposure via the ownership graph.</>
              : 'Investigate via the ownership graph.'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 10 }}>{row.entity_id?.slice(0,12)}…</span>
        <span style={{ fontSize: 12, color: 'var(--accent)' }}>→ graph</span>
      </div>
    </div>
  );
}

function ReconciliationTable({ rows, expandedId, onToggle, onOpenEntity, highlightId, dispositions = {} }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.5fr 1.8fr 1.4fr 1fr 22px',
        gap: 16,
        padding: '10px 16px',
        background: 'var(--bg-elevated)',
        fontSize: 11,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        fontFamily: 'var(--font-mono)',
      }}>
        <div>Entity</div>
        <div>OFAC name-screen</div>
        <div>Sayari resolution</div>
        <div>Outcome</div>
        <div />
      </div>
      {rows.map((row) => {
        const expanded = expandedId === row.entity_id;
        const highlighted = highlightId === row.entity_id;
        return (
          <div key={`${row.input_name}::${row.entity_id}`} style={{ display: 'contents' }}>
            <div
              data-entity-row={row.entity_id}
              className="clickable"
              onClick={() => onToggle(expanded ? null : row.entity_id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1.8fr 1.4fr 1fr 22px',
                gap: 16,
                padding: '12px 16px',
                borderTop: '1px solid var(--border-subtle)',
                borderLeft: highlighted ? '2px solid var(--accent)' : '2px solid transparent',
                fontSize: 13,
                alignItems: 'center',
                background: highlighted ? 'rgba(201,169,97,0.10)' : (expanded ? 'rgba(201,169,97,0.03)' : 'transparent'),
                transition: 'background 600ms ease, border-color 600ms ease',
              }}
            >
              <div>
                <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{row.input_name}</span>
                  {dispositions[row.entity_id] ? <StatusChip status={dispositions[row.entity_id].status} small /> : null}
                </div>
                <div className="mono muted" style={{ fontSize: 10 }}>{row.match_label ? truncate(row.match_label, 36) : '—'}</div>
              </div>
              <div>
                {row.ofac_hit ? (
                  <>
                    <div style={{ color: 'var(--text-primary)' }}>
                      <span style={{ color: 'var(--risk-low)' }}>✓</span> {truncate(row.ofac_match_name, 38)}
                    </div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <span className="mono muted" style={{ fontSize: 10 }}>sdn {row.ofac_sdn_id}</span>
                      {row.ofac_programs.slice(0,2).map(p => <SanctionProgramTag key={p} code={p} />)}
                    </div>
                  </>
                ) : (
                  <span className="muted"><span style={{ color: 'var(--text-muted)' }}>✕</span> no match</span>
                )}
              </div>
              <div>
                {row.is_directly_designated ? (
                  <div>
                    <span style={{ color: 'var(--risk-critical)' }}>● </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{row.direct_factor}</span>
                  </div>
                ) : row.is_ownership_exposed ? (
                  <div>
                    <span style={{ color: 'var(--accent)' }}>◐ </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{row.ownership_factor}</span>
                  </div>
                ) : (
                  <span className="muted">no OFAC SDN factor</span>
                )}
              </div>
              <div><OutcomeBadge outcome={row.outcome} /></div>
              <div style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{expanded ? '▾' : '▸'}</div>
            </div>
            {expanded ? (
              <div style={{
                padding: '16px 24px 20px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-primary)',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
              }}>
                <div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.8, marginBottom: 6 }}>WHY THIS OUTCOME</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                    {row.why_screen_missed || 'Both sources agree — entity is directly designated on the OFAC SDN list and name-screen found it.'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                  <CitedValue source={{
                    entity_url: row.entity_id ? `/v1/entity/${row.entity_id}` : null,
                    raw_field_path: row.source_field,
                    cache_file: row.source_cache_file,
                    api_endpoint: 'GET /v1/entity/{id} (cached)',
                  }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{row.source_field}</span>
                  </CitedValue>
                  <button onClick={(e) => { e.stopPropagation(); onOpenEntity(row.entity_id); }}
                    style={{ background: 'var(--accent)', color: '#0A1628', border: 0, padding: '8px 14px', borderRadius: 4, fontWeight: 600, fontSize: 13 }}>
                    Open entity →
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { Compare });
