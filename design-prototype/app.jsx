/* Meridian Sentinel — app shell, nav, routing */

function App() {
  // simple route state: { name, params }
  const [route, setRoute] = useState({ name: 'compare', params: {} });
  const [runMode, setRunMode] = useState('CACHED'); // CACHED | LIVE

  const go = (name, params = {}) => setRoute({ name, params });

  // keyboard shortcuts: 1-4 for nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '1') go('upload');
      if (e.key === '2') go('copilot');
      if (e.key === '3') go('compare');
      if (e.key === '4') go('entity', { entityId: 'BSsUPVlxsICOW4GCjb4fqQ' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '232px 1fr', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <LeftRail route={route} go={go} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <GlobalHeader runMode={runMode} setRunMode={setRunMode} route={route} />
        <main style={{ flex: 1, minWidth: 0, overflow: 'hidden auto' }} data-screen-label={`${route.name}`}>
          <Surfaces route={route} go={go} runMode={runMode} />
        </main>
      </div>
    </div>
  );
}

// -------- Left rail --------
function LeftRail({ route, go }) {
  const items = [
    { key: 'upload',  label: 'Upload',   num: '1', desc: 'list intake' },
    { key: 'copilot', label: 'Co-Pilot', num: '2', desc: 'ask anything' },
    { key: 'compare', label: 'Compare',  num: '3', desc: 'reconciliation' },
    { key: 'entity',  label: 'Entities', num: '4', desc: 'detail + graph' },
  ];
  return (
    <aside style={{
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border-default)',
      padding: '20px 18px',
      display: 'flex', flexDirection: 'column',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      {/* Wordmark */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          {/* simple geometric mark — not a hand-drawn logo, just three diamond bars */}
          <svg width="28" height="28" viewBox="0 0 28 28">
            <rect x="2" y="13" width="24" height="2" fill="var(--accent)" />
            <rect x="6" y="9"  width="16" height="2" fill="var(--accent)" opacity="0.65" />
            <rect x="10" y="17" width="8" height="2" fill="var(--accent)" opacity="0.85" />
            <rect x="13" y="3" width="2" height="22" fill="var(--accent-dim)" opacity="0.6" />
          </svg>
          <div>
            <div className="serif" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1 }}>Meridian</div>
            <div className="serif" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1, color: 'var(--accent)' }}>Sentinel</div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, marginLeft: 38 }}>Compliance Co-Pilot</div>
        <div style={{
          marginTop: 14, padding: '8px 10px',
          background: 'var(--bg-primary)',
          borderRadius: 4,
          border: '1px solid var(--border-subtle)',
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.6, textTransform: 'uppercase' }}>Tenant</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 2 }}>Meridian Energy</div>
          <div className="muted" style={{ fontSize: 11 }}>Trading SA · Geneva</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => {
          const active = route.name === it.key || (it.key === 'entity' && route.name === 'entity');
          return (
            <button key={it.key} onClick={() => go(it.key, it.key === 'entity' ? { entityId: 'BSsUPVlxsICOW4GCjb4fqQ' } : {})} style={{
              background: active ? 'rgba(201,169,97,0.08)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              border: 'none',
              borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 12,
              fontSize: 14, fontWeight: 500,
              textAlign: 'left',
            }}>
              <span className="mono" style={{
                fontSize: 10, width: 18, height: 18, borderRadius: 2,
                background: active ? 'var(--accent)' : 'var(--bg-elevated)',
                color: active ? '#0A1628' : 'var(--text-muted)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
              }}>{it.num}</span>
              <span>
                <span style={{ display: 'block' }}>{it.label}</span>
                <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{it.desc}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Analyst footer */}
      <div style={{
        padding: '10px 12px',
        background: 'var(--bg-primary)',
        borderRadius: 4,
        border: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 999,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)',
        }}>PV</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>P. Volkov</div>
          <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sr. Compliance Analyst</div>
        </div>
      </div>
    </aside>
  );
}

// -------- Global header --------
function GlobalHeader({ runMode, setRunMode, route }) {
  return (
    <header style={{
      borderBottom: '1px solid var(--border-default)',
      background: 'var(--bg-primary)',
      padding: '12px 28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 24,
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0, flex: 1 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
          Active run
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>list_1</span>
          <span className="muted">·</span>
          <span><span className="mono" style={{ color: 'var(--text-primary)' }}>50</span> entities</span>
          <span className="muted">·</span>
          <span><span className="mono" style={{ color: 'var(--risk-low)' }}>49</span> resolved</span>
          <span className="muted">·</span>
          <span className="mono muted" style={{ fontSize: 12 }}>run 2026-05-27</span>
        </div>
      </div>
      <RunModeBadge mode={runMode} setMode={setRunMode} />
    </header>
  );
}

function RunModeBadge({ mode, setMode }) {
  const isLive = mode === 'LIVE';
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: isLive ? 'rgba(201,169,97,0.1)' : 'var(--bg-surface)',
        border: `1px solid ${isLive ? 'var(--accent)' : 'var(--border-default)'}`,
        color: isLive ? 'var(--accent)' : 'var(--text-secondary)',
        padding: '5px 12px', borderRadius: 4,
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1.2, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: isLive ? 'var(--accent)' : 'var(--text-muted)' }} className={isLive ? 'pulse' : ''} />
        {mode}
      </button>
      {open ? (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          borderRadius: 4, width: 320, padding: 14, zIndex: 50,
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            Data source mode
          </div>
          <ModeOption
            active={mode === 'CACHED'}
            onClick={() => { setMode('CACHED'); setOpen(false); }}
            label="CACHED"
            desc="Deterministic replay of a previously-captured real run — same entities, tool calls, sources, answers."
          />
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '10px 0' }} />
          <ModeOption
            active={mode === 'LIVE'}
            onClick={() => { setMode('LIVE'); setOpen(false); }}
            label="LIVE"
            desc="Hits the Sayari API in real time for fresh uploads and open-ended questions."
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 12, fontStyle: 'italic', lineHeight: 1.5 }}>
            Recorded data is real — never simulated. The badge always reflects the current source honestly.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModeOption({ active, label, desc, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left',
      background: active ? 'rgba(201,169,97,0.06)' : 'transparent',
      border: '1px solid', borderColor: active ? 'var(--accent-dim)' : 'transparent',
      borderRadius: 3, padding: 10, display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <span style={{ width: 12, height: 12, borderRadius: 999, marginTop: 3,
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--text-muted)'}`,
        background: active ? 'var(--accent)' : 'transparent',
      }} />
      <div>
        <div className="mono" style={{ fontSize: 12, color: active ? 'var(--accent)' : 'var(--text-primary)', letterSpacing: 0.8 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </button>
  );
}

// -------- Router --------
function Surfaces({ route, go, runMode }) {
  if (route.name === 'upload') {
    return <Upload onRunComplete={() => go('copilot')} />;
  }
  if (route.name === 'copilot') {
    return <CoPilot runMode={runMode} onOpenEntity={(id) => go('entity', { entityId: id })} />;
  }
  if (route.name === 'compare') {
    return <Compare onOpenEntity={(id) => go('entity', { entityId: id })} />;
  }
  if (route.name === 'entity') {
    return (
      <Entity
        entityId={route.params.entityId || 'BSsUPVlxsICOW4GCjb4fqQ'}
        onBack={() => go('compare')}
        onOpenEntity={(id) => go('entity', { entityId: id })}
      />
    );
  }
  return null;
}

// -------- Mount --------
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
