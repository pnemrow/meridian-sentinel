/* Meridian Sentinel — app shell, nav, routing */

// Default-entity resolver for in-app navigation that says "open an entity"
// without specifying which one (e.g. the left-rail "Entities" step click and
// the Entity-surface fallback when the URL is missing an entityId).
//
// Strategy:
//   1. If we've already resolved a default for this runId in-session, return it.
//   2. Otherwise call /tools/compare_ofac_vs_sayari?run_id=… and pick the
//      first sanctioned/ownership-exposed row, falling back to first resolved.
//   3. Hard fallback to Belorusskaya so callers always get *some* id.
//
// The cache is intentionally per-session — bookmarks persist via the URL, not
// this lookup.

window._SENTINEL_DEFAULT_ENTITY_CACHE = window._SENTINEL_DEFAULT_ENTITY_CACHE || {};
const _HARDCODED_FALLBACK_ENTITY = 'BSsUPVlxsICOW4GCjb4fqQ';

function _pickDefaultEntityFromRows(rows) {
  const flagged = new Set(['both_catch', 'sayari_only', 'screen_ambiguous', 'matcher_miss']);
  let row = (rows || []).find(r => r && r.entity_id && flagged.has(r.outcome));
  if (!row) row = (rows || []).find(r => r && r.entity_id);
  return row ? row.entity_id : null;
}

function defaultEntityIdSync(runId) {
  const key = runId || '__default';
  if (window._SENTINEL_DEFAULT_ENTITY_CACHE[key]) return window._SENTINEL_DEFAULT_ENTITY_CACHE[key];
  // For the default run we already have compare rows on window — use them.
  if (!runId && window.COMPARE_ROWS) {
    const eid = _pickDefaultEntityFromRows(window.COMPARE_ROWS);
    if (eid) { window._SENTINEL_DEFAULT_ENTITY_CACHE[key] = eid; return eid; }
  }
  return null;
}

async function openDefaultEntity(runId, openEntity) {
  const cached = defaultEntityIdSync(runId);
  if (cached) return openEntity(cached);
  try {
    const base = (typeof window !== 'undefined' && window.SENTINEL_API_BASE) || '';
    const qs = runId
      ? `?run_id=${encodeURIComponent(runId)}&threshold=0.85`
      : '?threshold=0.85';
    const resp = await fetch(`${base}/tools/compare_ofac_vs_sayari${qs}`);
    if (resp.ok) {
      const json = await resp.json();
      const rows = (json.data && json.data.rows) || [];
      const eid = _pickDefaultEntityFromRows(rows);
      if (eid) {
        window._SENTINEL_DEFAULT_ENTITY_CACHE[runId || '__default'] = eid;
        return openEntity(eid);
      }
    }
  } catch (_) { /* fall through */ }
  openEntity(_HARDCODED_FALLBACK_ENTITY);
}

/* App shell, nav, routing
 *
 * Routing: URL-hash-driven so refreshes preserve state. Encodings:
 *   #/investigations              workflow home
 *   #/investigations/{runId}      open that run (renders compare)
 *   #/upload                      new investigation flow
 *   #/integrations                tenant integrations
 *   #/compare/{runId?}            compare surface (runId optional)
 *   #/copilot/{runId?}            co-pilot surface
 *   #/entity/{entityId}?run={runId?}
 *
 * Auth: localStorage('sentinel.authed') === '1' survives refresh. Sign-out
 * clears it. Unauthed → landing regardless of hash.
 */

const _AUTH_KEY = 'sentinel.authed';

function parseHash() {
  let raw = (typeof window !== 'undefined' ? window.location.hash : '') || '';
  if (raw.startsWith('#')) raw = raw.slice(1);
  if (raw.startsWith('/')) raw = raw.slice(1);
  const [pathPart, qsPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const qs = {};
  if (qsPart) {
    qsPart.split('&').forEach(kv => {
      const [k, v] = kv.split('=');
      if (k) qs[k] = decodeURIComponent(v || '');
    });
  }

  switch (parts[0]) {
    case undefined:
    case '':
    case 'investigations': {
      // /investigations/{runId} → open the compare view of that run
      if (parts[1]) return { route: { name: 'compare', params: {} }, runId: parts[1] };
      return { route: { name: 'investigations', params: {} }, runId: null };
    }
    case 'integrations':
      return { route: { name: 'integrations', params: {} }, runId: null };
    case 'upload':
      return { route: { name: 'upload', params: {} }, runId: null };
    case 'copilot':
      return { route: { name: 'copilot', params: {} }, runId: parts[1] || null };
    case 'compare':
      return { route: { name: 'compare', params: {} }, runId: parts[1] || null };
    case 'entity':
      return {
        route: { name: 'entity', params: { entityId: parts[1] || null } },
        runId: qs.run || null,
      };
    default:
      return { route: { name: 'investigations', params: {} }, runId: null };
  }
}

function serializeHash(route, runId) {
  switch (route.name) {
    case 'investigations': return '#/investigations';
    case 'integrations':   return '#/integrations';
    case 'upload':         return '#/upload';
    case 'compare':        return runId ? `#/compare/${encodeURIComponent(runId)}` : '#/compare';
    case 'copilot':        return runId ? `#/copilot/${encodeURIComponent(runId)}` : '#/copilot';
    case 'entity': {
      const eid = route.params?.entityId || '';
      const qs = runId ? `?run=${encodeURIComponent(runId)}` : '';
      return `#/entity/${encodeURIComponent(eid)}${qs}`;
    }
    default: return '';
  }
}

function App() {
  // Auth + URL state — both initialised from persistent storage / hash on
  // first render so a refresh on any deep page comes back to the same place.
  const [authed, setAuthed] = useState(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(_AUTH_KEY) === '1'; }
    catch (_) { return false; }
  });
  const [runMode, setRunMode] = useState('CACHED'); // CACHED | LIVE

  const _initial = useMemo(() => parseHash(), []);
  const [route, setRoute] = useState(_initial.route);
  const [runId, setRunId] = useState(_initial.runId);
  const [matchesSeeded, setMatchesSeeded] = useState(true);

  // Keep window.location.hash in sync with (route, runId) whenever they change
  // while authenticated. Guarded against the trivial no-op so we don't push a
  // duplicate hashchange (which would feed back in via the listener below).
  useEffect(() => {
    if (!authed) return;
    const desired = serializeHash(route, runId);
    if (desired && window.location.hash !== desired) {
      window.location.hash = desired;
    }
  }, [authed, route.name, route.params?.entityId, runId]);

  // back/forward button + manual hash edits → re-parse and resync state.
  useEffect(() => {
    if (!authed) return;
    const onHash = () => {
      const parsed = parseHash();
      setRoute(parsed.route);
      setRunId(parsed.runId);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [authed]);

  const go = (name, params = {}) => setRoute({ name, params });

  // Called by the Upload surface after /uploads/{id}/run completes (cached or live).
  const onUploadComplete = (newRunId, isSeeded) => {
    if (!newRunId || newRunId === 'default' || isSeeded) {
      setRunId(null);
      setMatchesSeeded(true);
    } else {
      setRunId(newRunId);
      setMatchesSeeded(false);
    }
    go('compare');
  };

  const signOut = () => {
    try { localStorage.removeItem(_AUTH_KEY); } catch (_) {}
    setAuthed(false);
    setRoute({ name: 'landing', params: {} });
    setRunId(null);
    if (typeof window !== 'undefined') window.location.hash = '';
  };

  const onLogin = () => {
    try { localStorage.setItem(_AUTH_KEY, '1'); } catch (_) {}
    setAuthed(true);
    // Honor any pre-existing hash so a deep-linked bookmark survives login.
    const parsed = parseHash();
    if (parsed.route.name === 'landing' || !window.location.hash) {
      setRoute({ name: 'investigations', params: {} });
      setRunId(null);
    } else {
      setRoute(parsed.route);
      setRunId(parsed.runId);
    }
  };

  // Open an entity — push the current entity (if any) onto the trail
  const openEntity = (id, overrideTrail) => {
    let trail = overrideTrail;
    if (!trail) {
      if (route.name === 'entity' && route.params.entityId && route.params.entityId !== id) {
        const currentEntity = window.ENTITY_INDEX?.[route.params.entityId];
        const label = currentEntity?.risk_summary?.data?.input_name
                    || window.COMPARE_ROWS.find(r => r.entity_id === route.params.entityId)?.input_name
                    || route.params.entityId;
        trail = [...(route.params.trail || []), { id: route.params.entityId, label }];
      } else if (route.name === 'entity') {
        trail = route.params.trail || [];
      } else {
        trail = [];
      }
    }
    setRoute({ name: 'entity', params: { entityId: id, trail } });
  };

  // Pre-auth view (Landing)
  if (!authed) {
    return <Landing onLogin={onLogin} />;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '232px 1fr', height: '100vh', background: 'var(--bg-primary)' }}>
      <LeftRail route={route} go={go} openEntity={openEntity} runId={runId} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100vh', minHeight: 0 }}>
        <GlobalHeader runMode={runMode} setRunMode={setRunMode} route={route} go={go} runId={runId} signOut={signOut} />
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }} data-screen-label={`${route.name}`}>
          <Surfaces route={route} go={go} openEntity={openEntity} runMode={runMode}
                    runId={runId} setRunId={setRunId} onUploadComplete={onUploadComplete} />
        </main>
      </div>
    </div>
  );
}

// -------- Left rail --------
function LeftRail({ route, go, openEntity, runId }) {
  const insideInvestigation = ['upload', 'copilot', 'compare', 'entity'].includes(route.name);
  // Active investigation = the one matching the current runId; if no runId is
  // set AND we're on an inside-investigation surface, fall back to the hero
  // (the seeded "current" demo investigation). Otherwise nothing — we're not
  // inside an investigation, so don't render the active-investigation card.
  const activeInvestigation = useMemo(() => {
    const list = window.INVESTIGATIONS || [];
    if (runId) return list.find(i => String(i.id) === String(runId)) || null;
    if (insideInvestigation) return list.find(i => i.hero) || list[0] || null;
    return null;
  }, [runId, insideInvestigation]);

  return (
    <aside style={{
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border-default)',
      padding: '20px 18px',
      display: 'flex', flexDirection: 'column',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      {/* Wordmark */}
      <div style={{ marginBottom: insideInvestigation ? 20 : 30 }}>
        <div className="clickable" onClick={() => go('investigations')} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
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
      </div>

      {insideInvestigation
        ? <InvestigationStepsNav route={route} go={go} openEntity={openEntity} investigation={activeInvestigation} runId={runId} />
        : <HomeNav route={route} go={go} />}

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

// Outside-an-investigation nav: just the workflow home + new
function HomeNav({ route, go }) {
  const active = route.name === 'investigations';
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button onClick={() => go('investigations')} style={{
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
          fontSize: 11, width: 18, height: 18, borderRadius: 2,
          background: active ? 'var(--accent)' : 'var(--bg-elevated)',
          color: active ? '#0A1628' : 'var(--text-muted)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
        }}>H</span>
        <span>
          <span style={{ display: 'block' }}>Investigations</span>
          <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>workflow home</span>
        </span>
      </button>
      <button onClick={() => go('upload')} style={{
        background: 'transparent',
        color: 'var(--accent)',
        border: '1px dashed var(--accent-dim)',
        borderRadius: 4,
        padding: '8px 12px',
        marginTop: 6,
        fontSize: 12, fontWeight: 600,
        textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>+</span>
        New investigation
      </button>
    </nav>
  );
}

// Inside-an-investigation nav: 4-step flow scoped to the active run.
function InvestigationStepsNav({ route, go, openEntity, investigation, runId }) {
  const steps = [
    { key: 'upload',  label: 'Upload',   num: '1', desc: 'list intake' },
    { key: 'copilot', label: 'Co-Pilot', num: '2', desc: 'ask anything' },
    { key: 'compare', label: 'Compare',  num: '3', desc: 'reconciliation' },
    { key: 'entity',  label: 'Entities', num: '4', desc: 'detail + graph' },
  ];
  return (
    <div>
      <button onClick={() => go('investigations')} style={{
        background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 0,
        fontSize: 12, marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>‹</span> All investigations
      </button>

      {/* Investigation context */}
      {investigation ? (
        <div style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 4,
          border: '1px solid var(--accent-dim)',
          marginBottom: 18,
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Active investigation
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 2, lineHeight: 1.35 }}>{investigation.name}</div>
          <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{investigation.list_ref}</div>
          <div style={{ marginTop: 8 }}>
            <StatusChip status={investigation.status} small />
          </div>
        </div>
      ) : null}

      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 }}>
        Steps
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {steps.map(it => {
          const active = route.name === it.key;
          return (
            <button key={it.key} onClick={() => {
              if (it.key === 'entity') openDefaultEntity(runId, openEntity);
              else go(it.key);
            }} style={{
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
                fontSize: 11, width: 18, height: 18, borderRadius: 2,
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
    </div>
  );
}

// -------- Active-run line (right of header "Active run" label) --------
// Derived for both runId=null (default list_1) and runId=string (uploaded run).
function ActiveRunHeader({ runId, onCustomRun }) {
  const list = window.INVESTIGATIONS || [];
  const inv = runId
    ? list.find(i => String(i.id) === String(runId))
    : (list.find(i => i.hero) || list[0]);
  const summary = window.RUN_SUMMARY && window.RUN_SUMMARY.data;

  // Display name: the investigation's own name takes priority over list_ref;
  // last-resort fallback labels the run as "uploaded list" when runId is set
  // and "list_1" otherwise (default cache).
  const displayName = inv?.name || inv?.list_ref || (onCustomRun ? 'uploaded list' : 'list_1');

  // Counts: prefer per-run /summary numbers; fall back to /api/investigations
  // counts (real per-run data from the backend, not fixtures).
  const total    = !onCustomRun && summary?.total_input != null ? summary.total_input : (inv?.counts?.total ?? inv?.entity_count);
  const resolved = !onCustomRun && summary?.resolved   != null ? summary.resolved   : (inv?.counts?.total ?? inv?.entity_count);
  const date     = inv?.created_at ? String(inv.created_at).slice(0, 10) : '';

  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono" style={{ color: onCustomRun ? 'var(--accent)' : 'var(--text-primary)' }}>
        {displayName}
      </span>
      {total != null ? <>
        <span className="muted">·</span>
        <span><span className="mono" style={{ color: 'var(--text-primary)' }}>{total}</span> entities</span>
      </> : null}
      {resolved != null && resolved !== total ? <>
        <span className="muted">·</span>
        <span><span className="mono" style={{ color: 'var(--risk-low)' }}>{resolved}</span> resolved</span>
      </> : null}
      {date ? <>
        <span className="muted">·</span>
        <span className="mono muted" style={{ fontSize: 12 }}>{date}</span>
      </> : null}
      {onCustomRun && runId ? <>
        <span className="muted">·</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }} title={runId}>{runId.slice(0, 22)}…</span>
      </> : null}
    </div>
  );
}

// -------- Global header --------
function GlobalHeader({ runMode, setRunMode, route, go, runId, signOut }) {
  const showRunContext = route.name !== 'investigations' && route.name !== 'integrations';
  const onCustomRun = !!runId;
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
        {showRunContext ? (
          <>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
              Active run
            </div>
            <ActiveRunHeader runId={runId} onCustomRun={onCustomRun} />
          </>
        ) : (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
            {route.name === 'investigations' ? 'Workflow home' : 'Tenant settings'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <RunModeBadge mode={runMode} setMode={setRunMode} />
        <SettingsMenu go={go} route={route} signOut={signOut} />
      </div>
    </header>
  );
}

// Settings menu — gear icon → popover with tenant-scope settings.
function SettingsMenu({ go, route, signOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const items = [
    { key: 'integrations', label: 'Integrations',      desc: 'Ingestion sources, write-back, SSO',   available: true,  icon: '⤓' },
    { key: 'members',      label: 'Members & roles',   desc: 'Reviewers, approvers, audit logs',     available: false, icon: '◇' },
    { key: 'api_tokens',   label: 'API tokens',        desc: 'Generate keys for the REST API',       available: false, icon: '⚷' },
    { key: 'notifications',label: 'Notification rules',desc: 'When to escalate, who to ping',        available: false, icon: '◷' },
    { key: 'tenant',       label: 'Tenant',            desc: 'Meridian Energy Trading SA · Geneva',  available: false, icon: '□' },
  ];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Settings" style={{
        background: open || route.name === 'integrations' ? 'rgba(201,169,97,0.1)' : 'var(--bg-surface)',
        border: `1px solid ${open || route.name === 'integrations' ? 'var(--accent-dim)' : 'var(--border-default)'}`,
        color: open || route.name === 'integrations' ? 'var(--accent)' : 'var(--text-secondary)',
        padding: '5px 9px', borderRadius: 4,
        fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: 1,
      }}>⚙</button>
      {open ? (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          borderRadius: 4, width: 300, padding: 6, zIndex: 50,
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', padding: '8px 10px 6px' }}>
            Settings
          </div>
          {items.map(it => (
            <button
              key={it.key}
              onClick={() => {
                if (!it.available) return;
                if (it.key === 'integrations') go('integrations');
                setOpen(false);
              }}
              disabled={!it.available}
              style={{
                width: '100%', textAlign: 'left',
                background: 'transparent',
                border: 0, padding: '8px 10px', borderRadius: 3,
                display: 'flex', gap: 10, alignItems: 'flex-start',
                opacity: it.available ? 1 : 0.5,
                cursor: it.available ? 'pointer' : 'default',
              }}
            >
              <span className="mono" style={{ color: it.available ? 'var(--accent)' : 'var(--text-muted)', fontSize: 14, width: 18, marginTop: 1 }}>{it.icon}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13, color: it.available ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {it.label}
                  {!it.available ? <span className="mono" style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.6 }}>SOON</span> : null}
                </span>
                <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{it.desc}</span>
              </span>
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 4 }}>
            <button onClick={() => { setOpen(false); if (signOut) signOut(); }} style={{
              width: '100%', textAlign: 'left',
              background: 'transparent', border: 0, padding: '10px',
              fontSize: 12, color: 'var(--text-muted)',
            }}>Sign out</button>
          </div>
        </div>
      ) : null}
    </div>
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
function Surfaces({ route, go, openEntity, runMode, runId, setRunId, onUploadComplete }) {
  if (route.name === 'investigations') {
    return (
      <Investigations
        onOpenInvestigation={(inv) => {
          // Switch the active run scope based on the chosen investigation.
          // Disk-stored runs have a string id like "run_..."; seed investigations
          // are numeric and map to the default list_1 cache.
          if (inv && typeof inv.id === 'string' && inv.id.startsWith('run_')) {
            setRunId(inv.id);
          } else {
            setRunId(null);
          }
          go('compare');
        }}
        onNew={() => go('upload')}
        onOpenIntegrations={() => go('integrations')}
      />
    );
  }
  if (route.name === 'integrations') {
    return <Integrations />;
  }
  if (route.name === 'upload') {
    return <Upload onRunComplete={onUploadComplete} onOpenEntity={(id) => openEntity(id)} />;
  }
  if (route.name === 'copilot') {
    return (
      <CoPilot
        runMode={runMode}
        runId={runId}
        onOpenEntity={(id) => openEntity(id)}
        onOpenCompare={() => go('compare')}
      />
    );
  }
  if (route.name === 'compare') {
    return <Compare runId={runId} onOpenEntity={(id) => openEntity(id)} focusEntityId={route.params.focusEntityId} />;
  }
  if (route.name === 'entity') {
    return (
      <Entity
        entityId={route.params.entityId
                   || defaultEntityIdSync(runId)
                   || _HARDCODED_FALLBACK_ENTITY}
        trail={route.params.trail || []}
        runId={runId}
        onBack={() => go('compare', { focusEntityId: route.params.entityId })}
        onOpenEntity={(id, overrideTrail) => openEntity(id, overrideTrail)}
      />
    );
  }
  return null;
}

// -------- Mount --------
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
