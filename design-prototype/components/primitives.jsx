/* Meridian Sentinel — shared trust primitives (§5.2)
 * <CitedValue>, <SourcePopover>, <ConfidenceFlag>, <RiskBadge>,
 * <EntityChip>, <SanctionProgramTag>, <OutcomeBadge>, <ToolTraceRow>
 *
 * These are the visual DNA — quiet by default, citations always one hover away.
 */
const { useState, useRef, useEffect, useMemo, useCallback, Fragment } = React;

// -------- small util --------
function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
function fmtMs(n) { return (n != null ? n.toString() : '—') + 'ms'; }
function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }

// -------- RiskBadge --------
const RISK_COLOR = {
  critical: { fg: '#fff', bg: 'var(--risk-critical)', label: 'CRITICAL' },
  high:     { fg: '#fff', bg: 'var(--risk-high)',     label: 'HIGH' },
  medium:   { fg: '#0A1628', bg: 'var(--risk-medium)', label: 'MEDIUM' },
  low:      { fg: '#0A1628', bg: 'var(--risk-low)',    label: 'LOW' },
};
function RiskBadge({ level, size }) {
  const c = RISK_COLOR[level] || RISK_COLOR.low;
  const small = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: c.bg, color: c.fg,
      padding: small ? '1px 6px' : '2px 8px',
      borderRadius: 999,
      fontFamily: 'var(--font-mono)',
      fontSize: small ? 10 : 11,
      letterSpacing: 0.6,
      fontWeight: 600,
      lineHeight: 1.4,
    }}>{c.label}</span>
  );
}

// -------- SanctionProgramTag --------
function SanctionProgramTag({ code }) {
  return (
    <span className="mono" style={{
      display: 'inline-block', padding: '1px 6px',
      border: '1px solid var(--border-default)',
      background: 'rgba(248,81,73,0.06)',
      color: 'var(--risk-critical)',
      borderRadius: 2, fontSize: 11, letterSpacing: 0.3,
    }}>{code}</span>
  );
}

// -------- SourcePopover (the literal "trace every finding" surface) --------
function SourcePopover({ source, refLabel }) {
  if (!source) return null;
  const Row = ({ k, v, link, mono = true }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: 2 }}>{k}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 12, color: 'var(--text-terminal)', wordBreak: 'break-all' }}>
        {v ? (link ? <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{v}</a> : v) : <span className="muted">—</span>}
      </div>
    </div>
  );
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 4,
      padding: 12,
      width: 380,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      fontSize: 12,
    }}>
      {refLabel ? <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{refLabel}</div> : null}
      <Row k="entity_url" v={source.entity_url} link={source.entity_url ? `https://api.sayari.com${source.entity_url}` : null} />
      <Row k="field_path" v={source.raw_field_path} />
      <Row k="cache_file" v={source.cache_file} />
      <Row k="api_endpoint" v={source.api_endpoint} />
    </div>
  );
}

// -------- CitedValue (quiet by default; hover/click reveals source) --------
function CitedValue({ children, source, refNum, asBlock }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span ref={wrapRef} style={{ position: 'relative', display: asBlock ? 'block' : 'inline' }}>
      <span
        className="clickable"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          borderBottom: '1px dotted var(--text-muted)',
          paddingBottom: 1,
        }}
        title="show source"
      >{children}</span>
      {refNum != null ? (
        <sup className="mono" style={{ color: 'var(--accent)', marginLeft: 2, fontSize: 10, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>[{refNum}]</sup>
      ) : null}
      {open ? (
        <span style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50 }}>
          <SourcePopover source={source} refLabel={refNum != null ? `Source [${refNum}]` : undefined} />
        </span>
      ) : null}
    </span>
  );
}

// -------- ConfidenceFlag (⚠ verify) --------
function ConfidenceFlag({ reason, inline }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        className="clickable mono"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          color: 'var(--risk-medium)',
          fontSize: inline ? 11 : 12,
          padding: '1px 6px',
          border: '1px solid rgba(210,153,34,0.4)',
          borderRadius: 2,
          background: 'rgba(210,153,34,0.08)',
          letterSpacing: 0.3,
          whiteSpace: 'nowrap',
        }}
        title={reason || 'verify'}
      >⚠ verify</span>
      {open ? (
        <span style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          borderRadius: 4, padding: '8px 10px', width: 280, fontSize: 12, color: 'var(--text-secondary)' }}>
          <div style={{ color: 'var(--risk-medium)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 4 }}>WHY THIS IS FLAGGED</div>
          {reason}
        </span>
      ) : null}
    </span>
  );
}

// -------- EntityChip --------
function EntityChip({ entity, onOpen }) {
  // entity: { entity_id, name | input_name, type, sanctioned, pep }
  const name = entity.name || entity.input_name || entity.label;
  const glyph = entity.type === 'person' ? '◆' : '■';
  return (
    <span
      className="clickable"
      onClick={onOpen}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 8px',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        borderRadius: 4,
        fontSize: 13,
        maxWidth: 320,
      }}
    >
      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{glyph}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{name}</span>
      {entity.sanctioned ? <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--risk-critical)' }} /> : null}
      {entity.pep ? <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--risk-medium)' }} /> : null}
      {entity.entity_id ? <span className="mono muted" style={{ fontSize: 10 }}>{truncate(entity.entity_id, 10)}</span> : null}
    </span>
  );
}

// -------- OutcomeBadge --------
const OUTCOMES = {
  both_catch:        { label: 'Both caught',          dot: 'var(--risk-low)',    fg: 'var(--text-secondary)',  border: 'var(--border-default)' },
  sayari_only:       { label: 'Sayari only (ownership)', dot: 'var(--accent)',   fg: 'var(--accent)',          border: 'var(--accent-dim)', emphasis: true },
  screen_ambiguous:  { label: 'Screen hit wrong party',  dot: 'var(--accent-dim)', fg: 'var(--accent-hover)',  border: 'var(--accent-dim)', emphasis: true },
  matcher_miss:      { label: 'Screen missed',        dot: 'var(--risk-high)',   fg: 'var(--risk-high)',       border: 'var(--risk-high)' },
  ofac_only:         { label: 'OFAC only (review)',   dot: 'var(--risk-medium)', fg: 'var(--risk-medium)',     border: 'var(--risk-medium)' },
  no_ofac:           { label: 'No OFAC exposure',     dot: 'var(--text-muted)',  fg: 'var(--text-muted)',      border: 'var(--border-default)' },
  unresolved:        { label: 'Unresolved',           dot: 'var(--text-muted)',  fg: 'var(--text-muted)',      border: 'var(--border-default)' },
};
function OutcomeBadge({ outcome, count, large, active, onClick }) {
  const c = OUTCOMES[outcome] || OUTCOMES.unresolved;
  return (
    <span
      onClick={onClick}
      className={onClick ? 'clickable' : ''}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: large ? '8px 12px' : '3px 8px',
        borderRadius: 2,
        border: `1px solid ${active ? c.fg : c.border}`,
        background: c.emphasis && !active ? 'rgba(201,169,97,0.06)' : (active ? 'rgba(201,169,97,0.12)' : 'transparent'),
        color: c.fg,
        fontSize: large ? 13 : 12,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: c.dot, display: 'inline-block' }} />
      <span>{c.label}</span>
      {count != null ? <span className="mono" style={{ marginLeft: 2, color: c.fg, opacity: 0.95 }}>{count}</span> : null}
    </span>
  );
}

// -------- ToolTraceRow --------
function ToolTraceRow({ call, result, isRunning }) {
  const [open, setOpen] = useState(false);
  const ok = result?.ok;
  const status = isRunning ? 'running' : (ok ? 'done' : (result ? 'error' : 'pending'));
  return (
    <div className="fadein" style={{
      borderTop: '1px solid var(--border-subtle)',
      padding: '10px 12px',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
    }}>
      <div className="clickable" onClick={() => result && setOpen(o => !o)} style={{ display: 'grid', gridTemplateColumns: '14px 1fr auto auto', gap: 10, alignItems: 'center' }}>
        <span style={{ color: status === 'done' ? 'var(--risk-low)' : status === 'error' ? 'var(--risk-critical)' : 'var(--accent)' }} className={status === 'running' ? 'pulse' : ''}>
          {status === 'done' ? '✓' : status === 'error' ? '✕' : '▸'}
        </span>
        <span style={{ color: 'var(--text-terminal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{call.name}</span>
        <span style={{ color: 'var(--text-muted)' }}>{result ? fmtMs(result.duration_ms) : '…'}</span>
        <span style={{ color: 'var(--text-muted)' }}>{result ? (open ? '▾' : '▸') : ''}</span>
      </div>
      {result?.summary ? (
        <div style={{ paddingLeft: 24, paddingTop: 4, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
          {result.summary}
        </div>
      ) : null}
      {open && result ? (
        <div style={{ paddingLeft: 24, paddingTop: 8, color: 'var(--text-terminal)', fontSize: 11 }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>args</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-terminal)' }}>{JSON.stringify(call.args, null, 2)}</pre>
          <div style={{ color: 'var(--text-muted)', marginTop: 8, marginBottom: 2 }}>source</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(result.source, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

// -------- Card primitive --------
function Card({ children, padding, style }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      padding: padding != null ? padding : 20,
      ...(style || {}),
    }}>{children}</div>
  );
}

// -------- Section header --------
function SectionHeader({ kicker, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
      <div>
        {kicker ? <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{kicker}</div> : null}
        {title ? <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div> : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

// -------- Country flag (text-only fallback — we never invent imagery) --------
function CountryCode({ code }) {
  return (
    <span className="mono" style={{
      display: 'inline-block', padding: '0 5px',
      border: '1px solid var(--border-default)',
      color: 'var(--text-secondary)', fontSize: 10, letterSpacing: 0.4,
      borderRadius: 2, marginRight: 4,
    }}>{code}</span>
  );
}

Object.assign(window, {
  cx, fmtMs, truncate,
  RiskBadge, SanctionProgramTag, SourcePopover, CitedValue, ConfidenceFlag,
  EntityChip, OutcomeBadge, OUTCOMES, ToolTraceRow, Card, SectionHeader, CountryCode,
});
