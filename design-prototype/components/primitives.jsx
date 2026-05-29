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

// -------- SourcePopover --------
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

// -------- CitedValue --------
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

// -------- ConfidenceFlag --------
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

// -------- Country flag (text-only fallback) --------
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

// -------- StatusChip (workflow disposition) --------
function StatusChip({ status, small }) {
  const cfg = (window.DISPOSITION_STATUSES || {})[status] || { label: status, color: 'var(--text-muted)', bg: 'transparent' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: small ? '2px 8px' : '3px 10px',
      borderRadius: 2,
      border: `1px solid ${cfg.color}`,
      background: cfg.bg,
      color: cfg.color,
      fontSize: small ? 10 : 11,
      fontFamily: 'var(--font-mono)',
      letterSpacing: 0.4,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: cfg.color }} />
      {cfg.label}
    </span>
  );
}

// -------- CredentialsModal (contextual LIVE-mode key entry) ----------------
// Opens from three entry points: the LIVE mode-badge intercept, the co-pilot
// freeform-question intercept, and the ownership-graph no-credentials error.
// `focusOn` (sayari | anthropic | both) drives which section gets the accent
// border + a contextual explainer so the user understands *why* they were
// asked. On save the modal POSTs /api/credentials and calls onSaved with the
// fresh status booleans so the caller can complete the action that triggered
// the prompt (e.g. actually switch into LIVE mode).
function CredentialsModal({ focusOn = 'both', onClose, onSaved, apiBase }) {
  const [sayariId, setSayariId] = useState('');
  const [sayariSecret, setSayariSecret] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const base = apiBase || (typeof window !== 'undefined' && window.SENTINEL_API_BASE) || '';

  const wantSayari    = focusOn === 'sayari' || focusOn === 'both';
  const wantAnthropic = focusOn === 'anthropic' || focusOn === 'both';

  const headline = focusOn === 'sayari'
    ? "LIVE mode needs Sayari credentials"
    : focusOn === 'anthropic'
      ? "Freeform LIVE questions need an Anthropic key"
      : "Credentials";
  const explainer = focusOn === 'sayari'
    ? "Live uploads and ownership traversals for entities not in cache call the Sayari API directly. Add your client id and secret to continue."
    : focusOn === 'anthropic'
      ? "The freeform co-pilot calls Claude Sonnet over a strict tool-use loop. The four cached golden questions still work without a key — only freeform input needs one."
      : "Manage credentials for LIVE-mode features. Leave a section blank to skip it.";

  const save = async () => {
    setSaving(true); setErr(null);
    const body = {};
    if (sayariId.trim())     body.sayari_client_id     = sayariId.trim();
    if (sayariSecret.trim()) body.sayari_client_secret = sayariSecret.trim();
    if (anthropicKey.trim()) body.anthropic_api_key    = anthropicKey.trim();
    if (Object.keys(body).length === 0) {
      setErr("Enter at least one value, or hit Cancel.");
      setSaving(false); return;
    }
    try {
      const resp = await fetch(`${base}/api/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const status = await resp.json();
      if (typeof onSaved === 'function') onSaved(status);
      if (typeof onClose === 'function') onClose();
    } catch (e) {
      setErr(`Save failed: ${e.message}. Is the backend reachable at ${base || '/'}?`);
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true); setErr(null);
    try {
      const resp = await fetch(`${base}/api/credentials`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const status = await resp.json();
      if (typeof onSaved === 'function') onSaved(status);
      if (typeof onClose === 'function') onClose();
    } catch (e) {
      setErr(`Clear failed: ${e.message}.`);
      setSaving(false);
    }
  };

  // Per-section styling: focusOn highlights the requested section with the
  // accent border; the other section gets a quiet border to indicate it's
  // available but not the reason this modal opened.
  const sectionStyle = (focused) => ({
    border: `1px solid ${focused ? 'var(--accent)' : 'var(--border-default)'}`,
    background: focused ? 'rgba(201,169,97,0.04)' : 'var(--bg-primary)',
    borderRadius: 4, padding: 14, marginBottom: 12,
  });

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(5,11,20,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
        borderRadius: 8, maxWidth: 540, width: '100%', padding: 28,
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{headline}</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>{explainer}</div>

        {wantSayari ? (
          <div style={sectionStyle(focusOn === 'sayari' || focusOn === 'both')}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              Sayari API
            </div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Client ID</label>
            <input
              value={sayariId}
              onChange={(e) => setSayariId(e.target.value)}
              placeholder="SAYARI_CLIENT_ID"
              style={_credInputStyle}
            />
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 10, marginBottom: 4 }}>Client Secret</label>
            <input
              type="password"
              value={sayariSecret}
              onChange={(e) => setSayariSecret(e.target.value)}
              placeholder="SAYARI_CLIENT_SECRET"
              style={_credInputStyle}
            />
          </div>
        ) : null}

        {wantAnthropic ? (
          <div style={sectionStyle(focusOn === 'anthropic' || focusOn === 'both')}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              Anthropic API
            </div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>API Key</label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-…"
              style={_credInputStyle}
            />
          </div>
        ) : null}

        <div className="muted" style={{
          fontSize: 11, fontStyle: 'italic', lineHeight: 1.5, marginTop: 4, marginBottom: 14,
        }}>
          Credentials are stored in memory only and cleared on container restart. They
          are never persisted to disk or to your browser.
        </div>

        {err ? (
          <div style={{
            background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.35)',
            color: 'var(--risk-critical)', padding: '8px 12px', borderRadius: 4, fontSize: 12, marginBottom: 12,
          }}>{err}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={clear} disabled={saving} style={{
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border-default)',
            padding: '6px 10px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--font-mono)',
            opacity: saving ? 0.5 : 1,
          }}>Clear stored</button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)', padding: '8px 14px', borderRadius: 4, fontSize: 13,
              opacity: saving ? 0.5 : 1,
            }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{
              background: 'var(--accent)', color: '#0A1628',
              border: 0, padding: '8px 14px', borderRadius: 4, fontWeight: 600, fontSize: 13,
              opacity: saving ? 0.7 : 1,
            }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
const _credInputStyle = {
  width: '100%',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 3, padding: '7px 10px',
  color: 'var(--text-primary)',
  fontSize: 13, fontFamily: 'var(--font-mono)',
  outline: 'none',
  boxSizing: 'border-box',
};

Object.assign(window, {
  cx, fmtMs, truncate,
  RiskBadge, SanctionProgramTag, SourcePopover, CitedValue, ConfidenceFlag,
  EntityChip, OutcomeBadge, OUTCOMES, ToolTraceRow, Card, SectionHeader, CountryCode,
  StatusChip, CredentialsModal,
});
