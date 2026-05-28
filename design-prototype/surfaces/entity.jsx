/* Surface 4 — Entity detail + ownership force-graph (§9) */

// IDs the backend has cached ownership traversal data for (output/raw/traversal/*).
// Used to decide whether the ownership graph auto-loads or sits behind an explicit
// "fetch live" button (cost-transparency).
const CACHED_TRAVERSAL_IDS = new Set([
  "OWwtbp9y51OcLHJQakLaMw",  // Sberbank
  "dy-rh2g0QtzUN_jC_e9S_A",  // VTB Bank
  "9-IuyJoA08bELHrSY3mXXA",  // Transneft
  "RZAPsBRdYXTToVqy4ZuNow",  // Gazprom
  "uKGj1Dx23piV16B7oVDwoQ",  // Rosneft
  "9LtTGZXn_LlN05C47cwZ5w",  // Rosoboronexport
  "BSsUPVlxsICOW4GCjb4fqQ",  // Belorusskaya Kaliynaya
  "RqBOnCZOD5pWG-tCf8wr8A",  // Russian Railways
  "5wVHdujAfKLkHO7efPnAjQ",  // Sukhoi (UBO file)
]);

const SENTINEL_BASE = () => (typeof window !== 'undefined' && window.SENTINEL_API_BASE) || '';

// Append ?run_id=… to a URL when runId is set. Default behavior unchanged.
function withRun(url, runId) {
  if (!runId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}run_id=${encodeURIComponent(runId)}`;
}

// A sentinel error subclass so the catch can render an honest "not in cache"
// state instead of mis-rendering with another entity's data.
class EntityNotCachedError extends Error {
  constructor(entityId, msg) {
    super(msg || `Entity ${entityId} not in cache`);
    this.entityId = entityId;
    this.notCached = true;
  }
}

// Fetch the three real backend payloads for an entity. Returns the same shape
// the rest of the surface expects (risk_summary, raw_risk_factors, identifiers,
// source_count) so we don't have to refactor downstream components.
//
// Throws EntityNotCachedError when the engine reports the entity as missing
// (e.g. a graph node the user clicked that isn't in any cache yet).
async function fetchEntityFromBackend(entityId, runId) {
  const base = SENTINEL_BASE();
  const [rsResp, profResp, rawResp] = await Promise.all([
    fetch(withRun(`${base}/tools/risk_summary/${entityId}`, runId)),
    fetch(withRun(`${base}/tools/get_profile/${entityId}`, runId)),
    fetch(withRun(`${base}/tools/raw_profile/${entityId}`, runId)),
  ]);
  if (!rsResp.ok)   throw new EntityNotCachedError(entityId, `risk_summary HTTP ${rsResp.status}`);
  if (!profResp.ok) throw new EntityNotCachedError(entityId, `get_profile HTTP ${profResp.status}`);

  const [rs, prof] = await Promise.all([rsResp.json(), profResp.json()]);

  // The engine returns 200 with {data: {error: "...", entity_id: ...}} when
  // the entity is unknown — treat that the same as a 404.
  if (rs?.data?.error) {
    throw new EntityNotCachedError(entityId, rs.data.error);
  }
  if (prof?.data?.error) {
    throw new EntityNotCachedError(entityId, prof.data.error);
  }

  // raw_profile is optional — if it 404s we render without identifiers/feed map
  // rather than inventing them.
  const raw = rawResp.ok ? (await rawResp.json()).data : null;

  const rsData = { ...rs.data };
  const profData = prof.data || {};
  // Surface entity type from the real Profile (not a name-substring guess).
  rsData.type = profData.type || rsData.type || null;

  return {
    risk_summary: { data: rsData, source: rs.source },
    raw_risk_factors: (raw && raw.risk) || {},
    identifiers: (raw && Array.isArray(raw.identifiers)) ? raw.identifiers : [],
    // Raw entity has source_count as a {id: {count,label,country,source_type}} map.
    source_count: (raw && raw.source_count && typeof raw.source_count === 'object' && !Array.isArray(raw.source_count))
      ? raw.source_count
      : {},
    _live: true,
  };
}

function Entity({ entityId, onBack, onOpenEntity, trail = [], runId = null }) {
  const [entity, setEntity] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notCached, setNotCached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntity(null);
    setLoadError(null);
    setNotCached(false);
    fetchEntityFromBackend(entityId, runId).then(payload => {
      if (cancelled) return;
      setEntity(payload);
    }).catch(err => {
      if (cancelled) return;
      // "Entity not in this run's cache" is the common case for graph nodes
      // the user clicked — render an honest empty state rather than another
      // entity's fixture data (which would mislabel everything on screen).
      if (err && err.notCached) {
        console.info('[entity] not in cache:', err.message);
        setNotCached(true);
        setLoadError(err.message);
        return;
      }
      // Backend unreachable (network error): fall back to fixture so the demo
      // page still renders something — but only for entities we actually have
      // a fixture for.
      console.warn('[entity] backend fetch failed, using fixture fallback:', err.message);
      const row = (window.COMPARE_ROWS || []).find(r => r.entity_id === entityId);
      const fixtureMatch = window.ENTITY_INDEX?.[entityId] || (row ? buildStubFromCompareRow(row) : null);
      if (fixtureMatch) {
        setEntity({ ...fixtureMatch, _live: false });
      } else {
        setNotCached(true);
      }
      setLoadError(err.message);
    });
    return () => { cancelled = true; };
  }, [entityId, runId]);

  const [showBriefing, setShowBriefing] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [tick, setTick] = useState(0);
  const disposition = (window.DISPOSITIONS && window.DISPOSITIONS[entityId]) || null;

  // Hooks must run unconditionally before any early return. sourceBreakdown
  // tolerates a null entity (source_count → {}) and the scroll-reset effect
  // is harmless during loading.
  const sourceBreakdown = useMemo(() => {
    const sc = entity?.source_count || {};
    return Object.entries(sc).map(([k, v]) => ({ key: k, ...v })).sort((a,b) => (b.count || 0) - (a.count || 0));
  }, [entity]);

  useEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [entityId]);

  if (notCached) {
    return <EntityNotCached entityId={entityId} runId={runId} reason={loadError} onBack={onBack} />;
  }
  if (!entity) {
    return <EntityLoading entityId={entityId} onBack={onBack} />;
  }

  const { risk_summary, raw_risk_factors, identifiers, source_count } = entity;
  const rs = risk_summary.data;
  const hasCachedGraph = CACHED_TRAVERSAL_IDS.has(entityId);

  const setDisposition = (status, rationale) => {
    window.DISPOSITIONS[entityId] = {
      status,
      reviewer: { initials: "PV", name: "P. Volkov" },
      decided_at: new Date().toISOString(),
      rationale,
    };
    setTick(t => t + 1);
  };

  return (
    <div style={{ padding: '24px 40px 80px', maxWidth: 1500, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 0,
        fontSize: 13, marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>‹</span> back to Compare
      </button>

      <EntityHeader
        rs={rs}
        source={risk_summary.source}
        disposition={disposition}
        onDownloadBriefing={() => setShowBriefing(true)}
        onOpenApi={() => setShowApi(true)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, marginTop: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <DispositionControl disposition={disposition} onSet={setDisposition} />
          <RiskSignals topRisks={rs.top_risks} raw={raw_risk_factors} entityId={rs.entity_id} />
          <IdentityEvidence identifiers={identifiers} />
          <SourceBreakdown rows={sourceBreakdown} />
        </div>

        {/* LiveGraphFetcher routes ALL entities through POST /tools/traverse_ownership:
             cached marquee IDs auto-fetch on mount; others sit behind a click-gated
             "fetch live" button. Either way the nodes/edges come from the backend —
             never from a procedural generator. runId scopes the call to the active run. */}
        <LiveGraphFetcher entityId={rs.entity_id} entityName={rs.input_name} runId={runId} onOpenEntity={onOpenEntity} trail={trail} currentLabel={rs.input_name} />
        {/* hasCachedGraph kept in scope for future use (e.g. graph header badge) */}
        {hasCachedGraph ? null : null}
      </div>

      {showBriefing ? <BriefingModal entity={rs} runId={runId} onClose={() => setShowBriefing(false)} /> : null}
      {showApi ? <window.ApiPayloadPanel entityId={rs.entity_id} onClose={() => setShowApi(false)} /> : null}
    </div>
  );
}

// -------- Trail row --------
function GraphTrail({ trail, onOpenEntity, currentLabel }) {
  if (!trail || trail.length === 0) return null;
  return (
    <div style={{
      padding: '10px 18px',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      fontSize: 12,
      background: 'rgba(201,169,97,0.03)',
    }}>
      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', marginRight: 4 }}>Trail</span>
      {trail.map((t, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => onOpenEntity(t.id, trail.slice(0, i))}
            style={{ background: 'transparent', border: 0, color: 'var(--text-secondary)', padding: 0, fontSize: 12 }}
          >{window.truncate ? window.truncate(t.label, 26) : t.label}</button>
          <span style={{ color: 'var(--text-muted)' }}>›</span>
        </span>
      ))}
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{window.truncate ? window.truncate(currentLabel, 32) : currentLabel}</span>
    </div>
  );
}
window.GraphTrail = GraphTrail;

// -------- Header --------
function EntityHeader({ rs, source, disposition, onDownloadBriefing, onOpenApi }) {
  // Defensive: backend may return partial profiles for entities reached via
  // graph navigation (no countries array, no sanctioned_lists, etc.).
  const countries = Array.isArray(rs.countries) ? rs.countries : [];
  const sanctionedLists = Array.isArray(rs.sanctioned_lists) ? rs.sanctioned_lists : [];
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 8,
      padding: '24px 28px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{ fontSize: 28, margin: 0, fontWeight: 600, lineHeight: 1.2 }}>{rs.input_name || rs.match_label || rs.entity_id}</h1>
            <RiskBadge level={rs.risk_level} />
            {disposition ? <StatusChip status={disposition.status} /> : <StatusChip status="pending_review" />}
            {rs.warn_verify ? <ConfidenceFlag reason="matched label differs from input name — verify identity" /> : null}
          </div>
          {rs.match_label ? (
            <div className="mono" style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>
              {rs.match_label}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)', alignItems: 'center' }}>
            <CitedValue source={source}>
              <span className="mono" style={{ fontSize: 11 }}>{rs.entity_id}</span>
            </CitedValue>
            <span><span className="muted">type</span> · {rs.type || '—'}</span>
            <span><span className="muted">degree</span> · <span className="mono">{rs.degree != null ? rs.degree.toLocaleString() : '—'}</span></span>
            <span><span className="muted">sources</span> · <span className="mono">{rs.source_count != null ? rs.source_count.toLocaleString() : '—'}</span></span>
            {countries.length > 0 ? (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                {countries.slice(0,6).map(c => <CountryCode key={c} code={c} />)}
                {countries.length > 6 ? <span className="muted mono" style={{ fontSize: 10 }}>+{countries.length - 6}</span> : null}
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {rs.sanctioned ? <FlagChip color="critical" label="sanctioned" /> : null}
            {sanctionedLists.map(l => <FlagChip key={l} color="critical" label={l} mono />)}
            {rs.pep_adjacent ? <FlagChip color="medium" label="PEP adjacent" /> : null}
            {rs.state_owned ? <FlagChip color="medium" label="state-owned" /> : null}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <button onClick={onDownloadBriefing}
            style={{
              background: 'var(--accent)', color: '#0A1628', border: 0,
              padding: '10px 16px', borderRadius: 4, fontWeight: 600, fontSize: 13,
              whiteSpace: 'nowrap',
            }}>
            ↓ Download briefing PDF
          </button>
          <button onClick={onOpenApi}
            style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              padding: '8px 16px', borderRadius: 4, fontSize: 12,
              fontFamily: 'var(--font-mono)', letterSpacing: 0.4,
              whiteSpace: 'nowrap',
            }}>
            {'{ }'} View API payload
          </button>
        </div>
      </div>
    </div>
  );
}

function FlagChip({ color, label, mono }) {
  const palette = {
    critical: { bg: 'rgba(248,81,73,0.08)', border: 'rgba(248,81,73,0.35)', fg: 'var(--risk-critical)' },
    medium:   { bg: 'rgba(210,153,34,0.08)', border: 'rgba(210,153,34,0.4)', fg: 'var(--risk-medium)' },
  }[color];
  return (
    <span className={mono ? 'mono' : ''} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 2,
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.fg, fontSize: mono ? 11 : 12,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: palette.fg }} />
      {label}
    </span>
  );
}

// -------- Risk signals --------
function RiskSignals({ topRisks, raw, entityId }) {
  const risks = Array.isArray(topRisks) ? topRisks : [];
  const rawMap = raw && typeof raw === 'object' ? raw : {};
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
        Risk signals
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {risks.length > 0
          ? risks.map(r => <RiskSignalCard key={r.factor} factor={r.factor} description={r.description} meta={rawMap[r.factor]} entityId={entityId} />)
          : <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>No risk signals on file for this entity.</div>}
      </div>
    </div>
  );
}

function RiskSignalCard({ factor, description, meta, entityId }) {
  const level = meta?.level || 'medium';
  const sources = meta?.metadata?.source || [];
  const dates = meta?.metadata?.from_date || [];
  const isGraphDerived = sources.length === 0;
  const source = {
    entity_url: `/v1/entity/${entityId}`,
    raw_field_path: `data.risk.${factor}`,
    cache_file: `output/raw/${entityId}.json`,
    api_endpoint: 'GET /v1/entity/{id} (cached)',
  };

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderLeft: `3px solid ${level === 'critical' ? 'var(--risk-critical)' : level === 'high' ? 'var(--risk-high)' : level === 'medium' ? 'var(--risk-medium)' : 'var(--risk-low)'}`,
      borderRadius: 4,
      padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <CitedValue source={source}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{factor}</span>
        </CitedValue>
        <RiskBadge level={level} size="sm" />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
        {description}
      </div>
      {isGraphDerived ? (
        <div style={{
          paddingTop: 8, borderTop: '1px solid var(--border-subtle)',
          display: 'flex', gap: 6, alignItems: 'center',
          fontSize: 11, color: 'var(--accent)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>◐</span>
          <span>derived from ownership graph (no direct source feed)</span>
        </div>
      ) : (
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          {sources.map(s => (
            <div key={s} style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
              <span style={{ color: 'var(--accent-dim)' }}>◦</span> {s}
            </div>
          ))}
          {dates.length ? (
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              from {dates.join(', ')}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// -------- Identity Evidence --------
function IdentityEvidence({ identifiers }) {
  const ids = Array.isArray(identifiers) ? identifiers : [];
  if (ids.length === 0) {
    return (
      <div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
          Identity evidence
        </div>
        <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>No identifiers on file for this entity.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
        Identity evidence
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4 }}>
        {ids.map((id, i) => (
          <div key={id.type} style={{
            display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12,
            padding: '10px 14px',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
            fontSize: 12,
          }}>
            <div className="mono" style={{ color: 'var(--text-muted)' }}>{id.type}</div>
            <div className="mono" style={{ color: 'var(--text-primary)' }}>{id.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------- Source breakdown --------
function SourceBreakdown({ rows }) {
  const max = rows[0]?.count || 1;
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
        Sources by feed
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4, padding: 14 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{r.label}</span>
              <span className="mono" style={{ color: 'var(--text-primary)' }}>{r.count.toLocaleString()}</span>
            </div>
            <div style={{ height: 3, background: 'var(--border-subtle)', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.max(2, (r.count / max) * 100)}%`,
                height: '100%',
                background: r.source_type === 'sanctions' ? 'var(--risk-critical)' : 'var(--accent-dim)',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------- Briefing modal --------
// Real flow: clicking "Generate PDF" hits GET /tools/generate_briefing/{id}/download
// which streams a WeasyPrint-rendered PDF with Content-Disposition: attachment.
function BriefingModal({ entity, onClose, runId = null }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'generating' | 'done' | 'error'
  const [errMsg, setErrMsg] = useState(null);

  const downloadUrl = runId
    ? `${SENTINEL_BASE()}/tools/generate_briefing/${entity.entity_id}/download?run_id=${encodeURIComponent(runId)}`
    : `${SENTINEL_BASE()}/tools/generate_briefing/${entity.entity_id}/download`;

  const generate = async () => {
    setStatus('generating');
    setErrMsg(null);
    try {
      // Use fetch first to surface a meaningful error if the backend is down,
      // then convert to a Blob + anchor click so the file lands as a download
      // without navigating away from the SPA.
      const resp = await fetch(downloadUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const filename = `meridian-sentinel-briefing-${entity.entity_id}.pdf`;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setStatus('done');
      setTimeout(onClose, 900);
    } catch (err) {
      setStatus('error');
      setErrMsg(err.message);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(5,11,20,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
        borderRadius: 8, maxWidth: 520, width: '100%', padding: 28,
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Generate briefing</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          GET /tools/generate_briefing/{entity.entity_id}/download
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
          A source-cited PDF compliance briefing for <span style={{ color: 'var(--text-primary)' }}>{entity.input_name}</span> —
          rendered server-side via WeasyPrint in the light/print theme, with every fact tied to
          its <span className="mono" style={{ fontSize: 11 }}>output/raw/{entity.entity_id}.json</span> field path.
        </div>
        <div style={{
          background: 'var(--bg-terminal)', border: '1px solid var(--border-subtle)',
          padding: 12, borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-terminal)', marginBottom: 18,
        }}>
          {`Content-Type: application/pdf
Content-Disposition: attachment;
  filename="meridian-sentinel-briefing-${entity.entity_id}.pdf"`}
        </div>
        {status === 'error' ? (
          <div style={{
            background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.35)',
            color: 'var(--risk-critical)', padding: '8px 12px', borderRadius: 4, fontSize: 12, marginBottom: 12,
          }}>
            Download failed: {errMsg || 'unknown error'}. Is the backend running on {SENTINEL_BASE() || '/'}?
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={status === 'generating'} style={{
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)', padding: '8px 14px', borderRadius: 4, fontSize: 13,
            opacity: status === 'generating' ? 0.5 : 1,
          }}>Cancel</button>
          <button onClick={generate} disabled={status === 'generating' || status === 'done'} style={{
            background: status === 'done' ? 'var(--risk-low)' : 'var(--accent)',
            color: '#0A1628', border: 0,
            padding: '8px 14px', borderRadius: 4, fontWeight: 600, fontSize: 13,
            opacity: status === 'generating' ? 0.7 : 1,
          }}>
            {status === 'generating' ? 'Generating…'
             : status === 'done' ? '✓ Downloaded'
             : 'Generate PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Entity });

// ============================================================
// DispositionControl — maker-checker 4-eyes review
// ============================================================
function DispositionControl({ disposition, onSet }) {
  const [drafting, setDrafting] = useState(false);
  const [draftStatus, setDraftStatus] = useState(disposition?.status || 'in_review');
  const [draftRationale, setDraftRationale] = useState(disposition?.rationale || '');

  const submit = () => {
    onSet(draftStatus, draftRationale);
    setDrafting(false);
  };

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${disposition ? 'var(--border-default)' : 'var(--accent-dim)'}`,
      borderRadius: 6,
      padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
          Disposition
        </div>
        {disposition ? (
          <StatusChip status={disposition.status} />
        ) : (
          <StatusChip status="pending_review" />
        )}
      </div>

      {disposition && !drafting ? (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 12 }}>
            {disposition.rationale}
          </div>
          <div style={{
            paddingTop: 10, borderTop: '1px solid var(--border-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, color: 'var(--text-muted)',
          }}>
            <span className="mono">
              {disposition.reviewer.name} · {new Date(disposition.decided_at).toISOString().slice(0,10)}
            </span>
            <button onClick={() => setDrafting(true)} style={{
              background: 'transparent', color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)', padding: '3px 10px', borderRadius: 2, fontSize: 11,
            }}>change</button>
          </div>
        </div>
      ) : !disposition && !drafting ? (
        <div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
            No decision recorded yet. Capture a maker-checker rationale before clearing or blocking.
          </div>
          <button onClick={() => setDrafting(true)} style={{
            background: 'var(--accent)', color: '#0A1628', border: 0,
            padding: '7px 12px', borderRadius: 4, fontWeight: 600, fontSize: 12,
          }}>Set disposition →</button>
        </div>
      ) : (
        <div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {['in_review','cleared','escalated','blocked'].map(s => (
              <button key={s} onClick={() => setDraftStatus(s)} style={{
                background: draftStatus === s ? 'rgba(201,169,97,0.1)' : 'transparent',
                border: `1px solid ${draftStatus === s ? 'var(--accent)' : 'var(--border-default)'}`,
                padding: '4px 0', borderRadius: 2,
                flex: '1 1 calc(50% - 3px)', minWidth: 0,
              }}>
                <StatusChip status={s} small />
              </button>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            Rationale (cited)
          </div>
          <textarea
            value={draftRationale}
            onChange={(e) => setDraftRationale(e.target.value)}
            placeholder="e.g. Confirmed SDN designation + ownership path via Kerimov. Reject onboarding."
            style={{
              width: '100%', minHeight: 70,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 3, padding: '8px 10px',
              fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setDrafting(false)} style={{
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border-default)', padding: '6px 12px', borderRadius: 4, fontSize: 12,
            }}>Cancel</button>
            <button onClick={submit} disabled={!draftRationale.trim()} style={{
              background: draftRationale.trim() ? 'var(--accent)' : 'transparent',
              color: draftRationale.trim() ? '#0A1628' : 'var(--text-muted)',
              border: draftRationale.trim() ? 0 : '1px solid var(--border-default)',
              padding: '6px 12px', borderRadius: 4, fontWeight: 600, fontSize: 12,
            }}>Record</button>
          </div>
          <div className="mono muted" style={{ fontSize: 10, marginTop: 8, fontStyle: 'italic' }}>
            Logged with reviewer + timestamp · 4-eyes maker-checker
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// EntityNotCached — honest empty state for an entity we can't render.
// Triggered when the engine reports "not in cache" (typically because the
// user clicked a non-root ownership-graph node whose profile we haven't
// fetched). Renders the entity_id, the run scope, and the back link — no
// invented data, no mis-rendered other-entity fixture.
// ============================================================
function EntityNotCached({ entityId, runId, reason, onBack }) {
  return (
    <div style={{ padding: '24px 40px 80px', maxWidth: 1500, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 0,
        fontSize: 13, marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>‹</span> back
      </button>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--accent-dim)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 8,
        padding: '24px 28px',
      }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
          Entity not in this run's cache
        </div>
        <h2 style={{ fontSize: 20, margin: '0 0 12px', fontWeight: 600 }}>
          <span className="mono" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{entityId}</span>
        </h2>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 14, maxWidth: 720 }}>
          This entity appears in an ownership graph but its full profile hasn't been retrieved
          for the active run. The screening pipeline only caches the root entities of an
          uploaded list; deeper graph neighbours are fetched on demand and aren't yet wired
          to a one-click "live fetch" affordance.
        </div>
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 4,
          padding: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-terminal)',
          marginBottom: 14,
        }}>
          run_id:        <span style={{ color: 'var(--text-primary)' }}>{runId || 'default (list_1)'}</span>{"\n"}
          entity_id:     <span style={{ color: 'var(--text-primary)' }}>{entityId}</span>{"\n"}
          reason:        <span style={{ color: 'var(--text-muted)' }}>{reason || 'no cached profile'}</span>{"\n"}
          would resolve: <span style={{ color: 'var(--text-muted)' }}>GET /v1/entity/{entityId}</span>{" (live Sayari call)"}
        </div>
        <div className="muted" style={{ fontSize: 11, fontStyle: 'italic', maxWidth: 720 }}>
          Honestly representative: nothing on this page is being invented. Return to the
          parent entity and use the ownership graph's "fetch live" path to investigate
          adjacent nodes, or upload a list that includes this entity by name.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EntityLoading — quiet placeholder while the three backend calls land.
// ============================================================
function EntityLoading({ entityId, onBack }) {
  return (
    <div style={{ padding: '24px 40px 80px', maxWidth: 1500, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 0,
        fontSize: 13, marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>‹</span> back to Compare
      </button>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 8, padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <span className="pulse mono" style={{ color: 'var(--accent)', fontSize: 18 }}>●</span>
        <div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>Loading entity…</div>
          <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>
            GET /tools/risk_summary/{entityId}, /tools/get_profile/{entityId}, /tools/raw_profile/{entityId}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LiveGraphFetcher — real-API ownership network loader.
// Cached marquee entities auto-fetch on mount; others sit behind an explicit
// "fetch live" button (cost-transparency) and call the same real endpoint.
// Either way: the nodes/edges come from POST /tools/traverse_ownership — never
// from a procedural generator.
// ============================================================
function LiveGraphFetcher({ entityId, entityName, onOpenEntity, trail, currentLabel, runId = null }) {
  const isCached = CACHED_TRAVERSAL_IDS.has(entityId);
  const [state, setState] = useState(isCached ? 'fetching' : 'idle'); // 'idle' | 'fetching' | 'loaded' | 'error'
  const [graphData, setGraphData] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  const startFetch = async () => {
    setState('fetching');
    setErrMsg(null);
    try {
      // traverse_ownership takes run_id as a query (not body) for consistency
      // with the other ?run_id= endpoints.
      const qs = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
      const resp = await fetch(`${SENTINEL_BASE()}/tools/traverse_ownership${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: entityId, depth: 3 }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      // The backend returns {data: {nodes, edges, ...}, source: {...}}.
      // OwnershipGraph expects graph.data.* — pass the envelope through.
      // Normalize node fields (backend may emit name/entity_id rather than label/id).
      const data = json.data || {};
      const nodes = (data.nodes || []).map(n => ({
        id: n.id || n.entity_id,
        label: n.label || n.name || (n.id || n.entity_id || '').slice(0,16),
        translated_label: n.translated_label || null,
        type: n.type || 'company',
        country: n.country || (Array.isArray(n.countries) ? n.countries[0] : null),
        sanctioned: !!n.sanctioned,
        pep: !!n.pep,
        degree: n.degree,
      }));
      const edges = (data.edges || []).map(e => ({
        source: e.source || e.parent_id,
        target: e.target || e.child_id,
        relationship: e.relationship || e.relationship_type,
        percentage: e.percentage,
        former: !!e.former,
        last_observed: e.last_observed,
      }));
      setGraphData({
        data: {
          root_entity_id: data.root_entity_id || entityId,
          nodes,
          edges,
          explored_count: data.explored_count || nodes.length,
          shown: data.shown != null ? data.shown : edges.length,
          next: !!data.next,
          offset: data.offset || 0,
          partial_results: !!data.partial_results,
          sanction_hits: data.sanction_hits || nodes.filter(n => n.sanctioned && n.id !== entityId).map(n => ({ id: n.id, label: n.label })),
        },
        source: json.source || {},
      });
      setState('loaded');
    } catch (err) {
      console.warn('[graph] traverse_ownership failed:', err.message);
      setErrMsg(err.message);
      setState('error');
    }
  };

  // Auto-fire for cached marquee IDs the moment we mount.
  useEffect(() => {
    if (isCached) startFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  if (state === 'loaded' && graphData) {
    return <OwnershipGraph entityId={entityId} onOpenEntity={onOpenEntity} graphData={graphData} trail={trail} currentLabel={currentLabel} />;
  }

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      display: 'flex', flexDirection: 'column',
    }}>
      {trail && trail.length > 0 && window.GraphTrail
        ? <window.GraphTrail trail={trail} onOpenEntity={onOpenEntity} currentLabel={currentLabel} />
        : null}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>Ownership network</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
          {state === 'fetching' ? (isCached ? 'loading cached traversal…' : 'fetching live from Sayari…')
           : state === 'error' ? 'fetch failed'
           : 'not yet cached — fetch live'}
        </div>
      </div>
      <div style={{
        aspectRatio: '7 / 5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(ellipse at center, #0E1B30 0%, var(--bg-surface) 100%)',
        position: 'relative',
      }}>
        <svg width="420" height="320" viewBox="0 0 420 320" style={{ opacity: state === 'fetching' ? 0.4 : 0.18 }}>
          <circle cx="210" cy="160" r="28" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 4" className={state === 'fetching' ? 'pulse' : ''} />
          <circle cx="80"  cy="80"  r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="340" cy="80"  r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="80"  cy="240" r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="340" cy="240" r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <line x1="100" y1="92"  x2="190" y2="148" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
          <line x1="320" y1="92"  x2="230" y2="148" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
          <line x1="100" y1="228" x2="190" y2="172" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
          <line x1="320" y1="228" x2="230" y2="172" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
        </svg>

        <div style={{ position: 'absolute', textAlign: 'center', maxWidth: 380, padding: '0 20px' }}>
          {state === 'fetching' ? (
            <>
              <div className="mono" style={{ fontSize: 12, color: 'var(--accent)', letterSpacing: 1, marginBottom: 8 }}>
                <span className="pulse">●</span> {isCached ? 'reading cached traversal' : 'fetching ownership traversal'}
              </div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                POST <span className="mono">/tools/traverse_ownership</span> · entity_id={entityId.slice(0,16)}…
              </div>
            </>
          ) : state === 'error' ? (
            <>
              <div style={{ fontSize: 16, color: 'var(--risk-critical)', marginBottom: 8 }}>
                Ownership fetch failed
              </div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
                <span className="mono">{errMsg || 'unknown error'}</span> — backend reachable at <span className="mono">{SENTINEL_BASE() || '/'}</span>?
                <br />No graph data is being invented to fill the gap.
              </div>
              <button onClick={startFetch} style={{
                background: 'var(--accent)', color: '#0A1628', border: 0,
                padding: '8px 16px', borderRadius: 4, fontWeight: 600, fontSize: 13,
              }}>retry →</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
                Ownership network not yet retrieved
              </div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
                Sentinel hasn't traversed the ownership graph for{' '}
                <span style={{ color: 'var(--text-secondary)' }}>{entityName}</span> yet. Fetch it live from Sayari — typically <span className="mono">300–800ms</span>.
              </div>
              <button onClick={startFetch} style={{
                background: 'var(--accent)', color: '#0A1628', border: 0,
                padding: '8px 16px', borderRadius: 4, fontWeight: 600, fontSize: 13,
              }}>Fetch ownership graph live →</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.DispositionControl = DispositionControl;
window.LiveGraphFetcher = LiveGraphFetcher;
window.EntityLoading = EntityLoading;

// ============================================================
// Helpers
// ============================================================
function buildStubFromCompareRow(row) {
  const isOwnershipExposed = row.is_ownership_exposed && row.ownership_factor;
  const isDirect = row.is_directly_designated && row.direct_factor;
  const factors = [
    ...(isDirect ? [{ factor: row.direct_factor, description: "Directly designated on the OFAC SDN list." }] : []),
    ...(isOwnershipExposed ? [{ factor: row.ownership_factor, description: "Exposed via ownership/control under OFAC's 50% rule." }] : []),
  ];
  if (!factors.length) factors.push({ factor: "no_ofac_sdn_factor", description: "No OFAC SDN factor on this profile — review only." });

  return {
    risk_summary: {
      data: {
        entity_id: row.entity_id,
        input_name: row.input_name,
        match_label: row.match_label,
        risk_level: isDirect ? "critical" : (isOwnershipExposed ? "high" : "medium"),
        top_risks: factors,
        all_risk_factors: factors.map(f => f.factor),
        sanctioned: row.sayari_sanctioned,
        sanctioned_lists: isDirect ? [row.direct_factor] : [],
        pep_adjacent: false,
        state_owned: row.ownership_factor === "controlled_by_ofac_sdn",
        country_risk: row.countries.slice(0,2),
        countries: row.countries,
        degree: null,
        source_count: null,
        confidence: "high",
        warn_verify: false,
      },
      source: { entity_url: `/v1/entity/${row.entity_id}`, raw_field_path: "data", cache_file: `output/raw/${row.entity_id}.json`, api_endpoint: "GET /v1/entity/{id} (cached)" },
    },
    raw_risk_factors: {
      ...(isDirect ? { [row.direct_factor]: { value: true, level: "critical", metadata: { source: ["USA Treasury OFAC SDN List"], from_date: ["2022-02-24"] } } } : {}),
      ...(isOwnershipExposed ? { [row.ownership_factor]: { value: 1.0, level: "high", metadata: { source: [] } } } : {}),
    },
    identifiers: [
      { type: "sayari_entity_id", value: row.entity_id, label: "Sayari Entity Id" },
      ...(row.ofac_sdn_id ? [{ type: "usa_ofac_sdn_number", value: String(row.ofac_sdn_id), label: "Usa Ofac Sdn Number" }] : []),
    ],
    source_count: row.ofac_sdn_id
      ? { "usa_treasury_ofac_sdn": { count: 1, label: "USA Treasury OFAC SDN List", country: "USA", source_type: "sanctions" } }
      : {},
  };
}

Object.assign(window, { buildStubFromCompareRow });
