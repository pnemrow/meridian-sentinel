/* Surface 3 — Compare hero: OFAC name-screen vs Sayari (§8) */

function Compare({ onOpenEntity }) {
  const result = window.COMPARE_RESULT;
  const { rows, summary, ofac_fetched_at } = result.data;
  const [filterOutcome, setFilterOutcome] = useState(null);
  const [expandedRowId, setExpandedRowId] = useState(null);

  const gapRows = useMemo(
    () => rows.filter(r => r.outcome === 'sayari_only' || r.outcome === 'screen_ambiguous'),
    [rows]
  );

  const visibleRows = useMemo(
    () => filterOutcome ? rows.filter(r => r.outcome === filterOutcome) : rows,
    [rows, filterOutcome]
  );

  const buckets = [
    { key: 'both_catch',       count: summary.both_catch },
    { key: 'sayari_only',      count: summary.sayari_only },
    { key: 'screen_ambiguous', count: summary.screen_ambiguous },
    { key: 'matcher_miss',     count: summary.matcher_miss },
    { key: 'ofac_only',        count: summary.ofac_only },
    { key: 'no_ofac',          count: summary.no_ofac },
  ];

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1400, margin: '0 auto' }}>

      {/* Executive glance */}
      <div style={{
        padding: '20px 0 24px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 36,
      }}>
        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
          Executive glance · list_1 · threshold 0.85
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.4, maxWidth: 940 }}>
          Of <span className="mono" style={{ color: 'var(--text-primary)' }}>50</span> vendors,{' '}
          <span className="mono" style={{ color: 'var(--text-primary)' }}>45</span> are sanctioned —{' '}
          and <span style={{ color: 'var(--accent)' }}><span className="mono">4 of those</span> are blocked only because of who owns them</span>,{' '}
          invisible to a name-based screen.
        </div>
      </div>

      {/* Hero — the ownership gap */}
      <CompareHero summary={summary} />

      {/* Bucket legend */}
      <div style={{ marginTop: 28, marginBottom: 40, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <OutcomeBadge outcome="both_catch" count={summary.both_catch} large active={filterOutcome === null} onClick={() => setFilterOutcome(null)} />
        {buckets.slice(1).map(b => (
          <OutcomeBadge key={b.key} outcome={b.key} count={b.count} large active={filterOutcome === b.key} onClick={() => setFilterOutcome(b.key === filterOutcome ? null : b.key)} />
        ))}
      </div>

      {/* Ownership-gap spotlight */}
      <SectionHeader
        kicker="Ownership-gap spotlight"
        title="The 4 entities a name-screen can't catch"
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 48 }}>
        {gapRows.map((row, i) => (
          <GapCard key={row.entity_id} row={row} marquee={i === 0} onOpen={() => onOpenEntity(row.entity_id)} />
        ))}
      </div>

      {/* Full reconciliation table */}
      <SectionHeader
        kicker="Full reconciliation"
        title={`${visibleRows.length} ${visibleRows.length === 1 ? 'entity' : 'entities'}${filterOutcome ? ' · filtered' : ''}`}
        right={
          filterOutcome ? (
            <button onClick={() => setFilterOutcome(null)} style={{ background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 4, fontSize: 12 }}>
              clear filter
            </button>
          ) : (
            <span className="mono muted" style={{ fontSize: 11 }}>OFAC SDN feed downloaded {ofac_fetched_at?.slice(0,10)}</span>
          )
        }
      />
      <ReconciliationTable rows={visibleRows} expandedId={expandedRowId} onToggle={setExpandedRowId} onOpenEntity={onOpenEntity} />
    </div>
  );
}

// -------- Hero ---------
function CompareHero({ summary }) {
  return (
    <div style={{
      background: 'linear-gradient(180deg, rgba(201,169,97,0.04) 0%, rgba(201,169,97,0) 100%)',
      border: '1px solid var(--border-default)',
      borderRadius: 8,
      padding: '40px 44px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div className="mono" style={{ color: 'var(--accent-dim)', fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 16 }}>
        The Ownership Gap
      </div>
      <div className="serif" style={{ fontSize: 44, lineHeight: 1.15, letterSpacing: -0.4, maxWidth: 980, marginBottom: 12 }}>
        A fair OFAC name-screen catches{' '}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 40, color: 'var(--text-primary)' }}>33</span>{' '}
        of <span style={{ fontFamily: 'var(--font-mono)', fontSize: 40, color: 'var(--text-primary)' }}>40</span>{' '}
        OFAC-exposed entities.
      </div>
      <div className="serif" style={{ fontSize: 28, lineHeight: 1.3, color: 'var(--text-secondary)', maxWidth: 920, marginBottom: 28 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, color: 'var(--accent)' }}>4</span> are blocked under the
        50% rule — owned or controlled by a sanctioned party, never named on the SDN list.
        No name-screen can see them.
      </div>

      {/* Flow diagram */}
      <GapFlow summary={summary} />

      <div className="muted" style={{ fontSize: 12, marginTop: 24, fontStyle: 'italic', maxWidth: 800 }}>
        Reconciliation, not a scoreboard. Disagreements between sources are signals to investigate,
        not verdicts. 31 CFR § 501.801.
      </div>
    </div>
  );
}

// -------- Flow diagram ---------
function GapFlow({ summary }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 60px 1.4fr',
      gap: 16,
      alignItems: 'stretch',
      marginTop: 8,
    }}>
      {/* Left: OFAC name-screen */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 4,
        padding: '20px 22px',
      }}>
        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
          OFAC name-screen
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div className="serif" style={{ fontSize: 56, lineHeight: 1, color: 'var(--text-primary)' }}>33</div>
          <div className="muted">caught</div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Catches everything listed by name. Cannot see ownership.
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          <Bar label="caught" value={33} max={40} color="var(--risk-low)" />
          <Bar label="missed" value={3} max={40} color="var(--risk-high)" />
          <Bar label="hit wrong party" value={2} max={40} color="var(--accent-dim)" />
          <Bar label="50%-rule entities (invisible)" value={2} max={40} color="var(--accent)" muted />
        </div>
      </div>

      {/* Arrow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <svg width="48" height="60" viewBox="0 0 48 60" fill="none">
          <path d="M4 30 H 38" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="2 3" />
          <path d="M34 24 L 42 30 L 34 36" stroke="var(--text-muted)" strokeWidth="1" fill="none" />
        </svg>
      </div>

      {/* Right: Sayari */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(201,169,97,0.08) 0%, rgba(201,169,97,0.02) 100%)',
        border: '1px solid var(--accent-dim)',
        borderRadius: 4,
        padding: '20px 22px',
      }}>
        <div className="mono" style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
          Sayari resolution + ownership
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div className="serif" style={{ fontSize: 56, lineHeight: 1, color: 'var(--text-primary)' }}>37</div>
          <div className="muted">of 40 OFAC-exposed</div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Resolves names against corporate registries, then traverses the ownership graph.
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          <Bar label="caught directly (both)" value={33} max={40} color="var(--risk-low)" />
          <Bar label="caught via ownership gap" value={4} max={40} color="var(--accent)" highlight />
          <Bar label="screen-only ambiguity" value={3} max={40} color="var(--risk-high)" muted />
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, max, color, highlight, muted }) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div style={{ marginBottom: 8, opacity: muted ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: highlight ? 'var(--accent)' : 'var(--text-secondary)' }}>{label}</span>
        <span className="mono" style={{ color: highlight ? 'var(--accent)' : 'var(--text-secondary)' }}>{value}</span>
      </div>
      <div style={{ height: 4, background: 'var(--border-subtle)', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 200ms' }} />
      </div>
    </div>
  );
}

// -------- Gap card --------
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
          {marquee
            ? <>5 sanctioned owners incl. <span style={{ color: 'var(--text-primary)' }}>Suleyman Kerimov</span>; name absent from SDN.</>
            : (row.outcome === 'sayari_only' ? 'Not on SDN by name; ownership/control exposure.' : `Screen fired on “${row.ofac_match_name}” — a different SDN entity.`)
          }
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 10 }}>{row.entity_id?.slice(0,12)}…</span>
        <span style={{ fontSize: 12, color: 'var(--accent)' }}>→ graph</span>
      </div>
    </div>
  );
}

// -------- Reconciliation table --------
function ReconciliationTable({ rows, expandedId, onToggle, onOpenEntity }) {
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
        return (
          <div key={row.entity_id} style={{ display: 'contents' }}>
            <div
              className="clickable"
              onClick={() => onToggle(expanded ? null : row.entity_id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1.8fr 1.4fr 1fr 22px',
                gap: 16,
                padding: '12px 16px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: 13,
                alignItems: 'center',
                background: expanded ? 'rgba(201,169,97,0.03)' : 'transparent',
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{row.input_name}</div>
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
