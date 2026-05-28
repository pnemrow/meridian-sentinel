/* Surface B — Investigations home (post-login default) */

function Investigations({ onOpenInvestigation, onNew, onOpenIntegrations }) {
  const investigations = window.INVESTIGATIONS || [];
  const [apiPeek, setApiPeek] = useState(null);
  const [filter, setFilter] = useState(null); // 'open' | 'pending' | 'cleared' | 'ownership_gap' | null

  // Aggregate counters — semantics deliberately broad enough to cover both the
  // design-doc vocabulary (pending_review / in_review / cleared / escalated /
  // blocked) and the real run vocabulary the backend currently writes
  // ("complete" for finished disk runs, "pending" for sftp-queued seed rows).
  const FINALISED = new Set(['cleared', 'escalated', 'blocked']);
  const PENDING   = new Set(['pending', 'pending_review']);

  const totals = useMemo(() => {
    const t = { open: 0, pending: 0, cleared: 0, ownership_gap: 0 };
    investigations.forEach(i => {
      const s = i.status || '';
      if (!FINALISED.has(s)) t.open++;          // open = anything not finalised
      if (PENDING.has(s))    t.pending++;       // pending = awaiting human
      if (s === 'cleared')   t.cleared++;
      t.ownership_gap += (i.ownership_gap_count || 0);
    });
    return t;
  }, [investigations]);

  // Filter predicates per KPI card.
  const filterPredicate = (inv) => {
    if (!filter) return true;
    const s = inv.status || '';
    if (filter === 'open')          return !FINALISED.has(s);
    if (filter === 'pending')       return PENDING.has(s);
    if (filter === 'cleared')       return s === 'cleared';
    if (filter === 'ownership_gap') return (inv.ownership_gap_count || 0) > 0;
    return true;
  };
  const visible = useMemo(() => investigations.filter(filterPredicate), [investigations, filter]);

  const toggleFilter = (key) => setFilter(prev => prev === key ? null : key);

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Heading */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
            Compliance workflow
          </div>
          <h1 style={{ fontSize: 28, margin: 0, fontWeight: 600 }}>Investigations</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Active screening runs and historical audits. Open one to review, disposition, and export.
          </div>
        </div>
        <button onClick={onNew} style={{
          background: 'var(--accent)', color: '#0A1628', border: 0,
          padding: '10px 16px', borderRadius: 4, fontWeight: 600, fontSize: 13,
        }}>+ New investigation</button>
      </div>

      {/* KPIs — clickable filters. Active card highlighted; click again to clear. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: filter ? 12 : 28 }}>
        <KPI label="open investigations" value={totals.open}          accent       active={filter === 'open'}          onClick={() => toggleFilter('open')} />
        <KPI label="pending review"      value={totals.pending}       risk="medium" active={filter === 'pending'}       onClick={() => toggleFilter('pending')} />
        <KPI label="cleared (lifetime)"  value={totals.cleared}                     active={filter === 'cleared'}       onClick={() => toggleFilter('cleared')} />
        <KPI label="ownership-gap findings" value={totals.ownership_gap} risk="critical" detail="OFAC 50% rule" active={filter === 'ownership_gap'} onClick={() => toggleFilter('ownership_gap')} />
      </div>

      {/* Active-filter bar with clear-link */}
      {filter ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span className="mono" style={{ color: 'var(--text-muted)', letterSpacing: 0.6, textTransform: 'uppercase', fontSize: 10 }}>filtering:</span>
          <span className="mono" style={{ color: 'var(--accent)' }}>{filter.replace('_', '-')}</span>
          <span className="muted">· {visible.length} of {investigations.length}</span>
          <button onClick={() => setFilter(null)} style={{
            background: 'transparent', color: 'var(--text-muted)',
            border: 'none', padding: 0, fontSize: 11, fontFamily: 'var(--font-mono)',
            textDecoration: 'underline', cursor: 'pointer',
          }}>clear filter</button>
        </div>
      ) : null}

      {/* Table OR empty-state */}
      {investigations.length === 0 ? (
        <div style={{
          background: 'var(--bg-surface)', border: '1px dashed var(--border-default)',
          borderRadius: 6, padding: '48px 32px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>No investigations yet.</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
            Upload a vendor list to get started. Sentinel will resolve, screen, and surface ownership exposure per row.
          </div>
          <button onClick={onNew} style={{
            background: 'var(--accent)', color: '#0A1628', border: 0,
            padding: '10px 18px', borderRadius: 4, fontWeight: 600, fontSize: 13,
          }}>+ New investigation</button>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1.2fr 1fr 0.9fr 1fr 1.3fr 60px',
            gap: 14,
            padding: '10px 16px',
            background: 'var(--bg-elevated)',
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
            letterSpacing: 0.8, textTransform: 'uppercase',
          }}>
            <div>investigation</div>
            <div>source</div>
            <div>created</div>
            <div>entities</div>
            <div>findings</div>
            <div>status · reviewer</div>
            <div></div>
          </div>
          {visible.length === 0 ? (
            <div className="muted" style={{ padding: '24px 16px', fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
              No investigations match the current filter.
            </div>
          ) : visible.map(inv => (
            <InvestigationRow key={inv.id} inv={inv} onOpen={() => onOpenInvestigation(inv)} onApi={() => setApiPeek(inv.id)} />
          ))}
        </div>
      )}

      <div className="muted" style={{ fontSize: 12, marginTop: 14, fontStyle: 'italic' }}>
        Status flow: <StatusChip status="pending_review" small /> → <StatusChip status="in_review" small /> → <StatusChip status="cleared" small /> · <StatusChip status="escalated" small /> · <StatusChip status="blocked" small />
      </div>

      {/* API peek slide-over */}
      {apiPeek ? <ApiPayloadPanel investigationId={apiPeek} onClose={() => setApiPeek(null)} /> : null}
    </div>
  );
}

function KPI({ label, value, accent, risk, detail, active, onClick }) {
  const color = risk === 'critical' ? 'var(--risk-critical)' : risk === 'medium' ? 'var(--risk-medium)' : (accent ? 'var(--accent)' : 'var(--text-primary)');
  const isInteractive = typeof onClick === 'function';
  return (
    <div
      onClick={isInteractive ? onClick : undefined}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={isInteractive ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      style={{
        background: active ? 'rgba(201,169,97,0.10)' : 'var(--bg-surface)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
        borderRadius: 4, padding: 16,
        cursor: isInteractive ? 'pointer' : 'default',
        transition: 'background 120ms, border-color 120ms',
        outline: 'none',
      }}>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 32, fontFamily: 'var(--font-mono)', fontWeight: 600, color, marginTop: 6, lineHeight: 1 }}>
        {value}
      </div>
      {detail ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{detail}</div> : null}
      {isInteractive ? (
        <div className="mono" style={{ fontSize: 9, color: active ? 'var(--accent)' : 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 8 }}>
          {active ? '● filtering' : 'click to filter'}
        </div>
      ) : null}
    </div>
  );
}

function InvestigationRow({ inv, onOpen, onApi }) {
  const sourceIcon = inv.source_kind === 'sftp' ? '⇣' : '⤓';
  return (
    <div className="clickable"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1.2fr 1fr 0.9fr 1fr 1.3fr 60px',
        gap: 14,
        padding: '14px 16px',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: 13,
        alignItems: 'center',
        background: inv.hero ? 'rgba(201,169,97,0.03)' : 'transparent',
      }}>
      <div>
        <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          {inv.name}
          {inv.just_arrived ? <span className="mono" style={{ fontSize: 9, padding: '1px 5px', background: 'var(--risk-medium)', color: '#0A1628', borderRadius: 1, letterSpacing: 0.6, fontWeight: 700 }}>NEW</span> : null}
          {inv.hero ? <span className="mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: 0.6 }}>· current</span> : null}
        </div>
        <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{inv.list_ref}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--accent-dim)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>{sourceIcon}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{inv.source}</span>
      </div>
      <div className="mono muted" style={{ fontSize: 12 }}>{inv.created_at}</div>
      <div className="mono" style={{ fontSize: 13 }}>{inv.entity_count}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        {inv.sanctioned_count > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--risk-critical)', fontSize: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--risk-critical)' }} />
            <span className="mono">{inv.sanctioned_count}</span> sanctioned
          </span>
        ) : <span className="muted" style={{ fontSize: 12 }}>none</span>}
        {inv.ownership_gap_count > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }} />
            <span className="mono">{inv.ownership_gap_count}</span> ownership-gap
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusChip status={inv.status} small />
        {inv.reviewer ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)',
            }}>{inv.reviewer.initials}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{inv.reviewer.name}</span>
          </span>
        ) : <span className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>unassigned</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onApi(); }}
          title="View API payload"
          style={{
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border-default)', padding: '3px 8px', borderRadius: 2,
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 0.6,
          }}>{'{ }'}</button>
      </div>
    </div>
  );
}

// -------- API payload slide-over (used here and from Entity) --------
function ApiPayloadPanel({ investigationId, entityId, onClose }) {
  const payload = useMemo(() => {
    if (entityId) return window.buildEntityPayload(entityId);
    const inv = window.INVESTIGATIONS.find(i => i.id === investigationId);
    const gapRows = window.COMPARE_ROWS.filter(r => r.outcome === 'sayari_only' || r.outcome === 'screen_ambiguous');
    return {
      run_id: inv?.list_ref || investigationId,
      investigation_id: investigationId,
      screened_at: "2026-05-27T08:14:00Z",
      list_source: inv?.source,
      counts: { entities: inv?.entity_count, sanctioned: inv?.sanctioned_count, ownership_gap: inv?.ownership_gap_count },
      results: gapRows.slice(0, 2).map(r => window.buildEntityPayload(r.entity_id)),
    };
  }, [investigationId, entityId]);

  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    try { navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (_) {}
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(5,11,20,0.6)', zIndex: 100,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 600, maxWidth: '90vw', height: '100%',
        background: 'var(--bg-terminal)',
        borderLeft: '1px solid var(--border-default)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase' }}>
              API · Result payload
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>
              Representative — this is what a downstream system would consume.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCopy} style={{
              background: copied ? 'var(--risk-low)' : 'var(--bg-elevated)',
              color: copied ? '#0A1628' : 'var(--text-secondary)',
              border: '1px solid var(--border-default)', padding: '5px 12px', borderRadius: 3, fontSize: 12,
              fontFamily: 'var(--font-mono)', letterSpacing: 0.4,
            }}>{copied ? '✓ copied' : 'copy'}</button>
            <button onClick={onClose} style={{
              background: 'transparent', color: 'var(--text-muted)',
              border: 'none', padding: 0, fontSize: 22, lineHeight: 1,
            }}>×</button>
          </div>
        </div>
        <pre style={{
          flex: 1, overflowY: 'auto', margin: 0,
          padding: '16px 20px',
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-terminal)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{syntaxColorJSON(JSON.stringify(payload, null, 2))}</pre>
      </div>
    </div>
  );
}

// Lightweight JSON colorizer
function syntaxColorJSON(s) {
  const tokens = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > lastIdx) tokens.push(<span key={tokens.length} style={{ color: 'var(--text-terminal)' }}>{s.slice(lastIdx, m.index)}</span>);
    if (m[1] && m[2]) {
      tokens.push(<span key={tokens.length} style={{ color: 'var(--accent)' }}>{m[1]}</span>);
      tokens.push(<span key={tokens.length} style={{ color: 'var(--text-muted)' }}>{m[2]}</span>);
    } else if (m[1]) {
      tokens.push(<span key={tokens.length} style={{ color: 'var(--risk-low)' }}>{m[1]}</span>);
    } else if (m[3]) {
      tokens.push(<span key={tokens.length} style={{ color: 'var(--risk-medium)' }}>{m[3]}</span>);
    } else if (m[4]) {
      tokens.push(<span key={tokens.length} style={{ color: 'var(--accent-hover)' }}>{m[4]}</span>);
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < s.length) tokens.push(<span key={tokens.length} style={{ color: 'var(--text-terminal)' }}>{s.slice(lastIdx)}</span>);
  return tokens;
}

Object.assign(window, { Investigations, ApiPayloadPanel });
