/* Surface 4 — Entity detail + ownership force-graph (§9) */

function Entity({ entityId, onBack, onOpenEntity }) {
  // Resolve the entity: full fixture first, otherwise a stub from compare-row data.
  const entity = useMemo(() => {
    if (window.ENTITY_INDEX[entityId]) return window.ENTITY_INDEX[entityId];
    const row = window.COMPARE_ROWS.find(r => r.entity_id === entityId);
    if (row) return buildStubFromCompareRow(row);
    return window.ENTITY_BELORUSSKAYA;
  }, [entityId]);

  const { risk_summary, raw_risk_factors, identifiers, source_count } = entity;
  const rs = risk_summary.data;
  const hasCachedGraph = entityId === "BSsUPVlxsICOW4GCjb4fqQ";

  const [showBriefing, setShowBriefing] = useState(false);

  const sourceBreakdown = useMemo(() => {
    return Object.entries(source_count).map(([k, v]) => ({ key: k, ...v })).sort((a,b) => b.count - a.count);
  }, [source_count]);

  return (
    <div style={{ padding: '24px 40px 80px', maxWidth: 1500, margin: '0 auto' }}>
      {/* Back */}
      <button onClick={onBack} style={{
        background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: 0,
        fontSize: 13, marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>‹</span> back
      </button>

      <EntityHeader rs={rs} source={risk_summary.source} onDownloadBriefing={() => setShowBriefing(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, marginTop: 28 }}>
        {/* LEFT col: signals + identity + sources */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <RiskSignals topRisks={rs.top_risks} raw={raw_risk_factors} entityId={rs.entity_id} />
          <IdentityEvidence identifiers={identifiers} />
          <SourceBreakdown rows={sourceBreakdown} />
        </div>

        {/* RIGHT col: ownership graph (only cached for the marquee entity) */}
        {hasCachedGraph
          ? <OwnershipGraph entityId={rs.entity_id} onOpenEntity={onOpenEntity} />
          : <OwnershipUnavailable entityId={rs.entity_id} entityName={rs.input_name} />}
      </div>

      {showBriefing ? <BriefingModal entity={rs} onClose={() => setShowBriefing(false)} /> : null}
    </div>
  );
}

// -------- Header --------
function EntityHeader({ rs, source, onDownloadBriefing }) {
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
            <h1 style={{ fontSize: 28, margin: 0, fontWeight: 600, lineHeight: 1.2 }}>{rs.input_name}</h1>
            <RiskBadge level={rs.risk_level} />
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
            <span><span className="muted">type</span> · {rs.input_name && rs.input_name.toLowerCase().includes('kerimov') ? 'person' : 'company'}</span>
            <span><span className="muted">degree</span> · <span className="mono">{rs.degree?.toLocaleString()}</span></span>
            <span><span className="muted">sources</span> · <span className="mono">{rs.source_count?.toLocaleString()}</span></span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              {rs.countries.slice(0,6).map(c => <CountryCode key={c} code={c} />)}
              {rs.countries.length > 6 ? <span className="muted mono" style={{ fontSize: 10 }}>+{rs.countries.length - 6}</span> : null}
            </span>
          </div>

          {/* flag chips */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {rs.sanctioned ? <FlagChip color="critical" label="sanctioned" /> : null}
            {rs.sanctioned_lists?.map(l => <FlagChip key={l} color="critical" label={l} mono />)}
            {rs.pep_adjacent ? <FlagChip color="medium" label="PEP adjacent" /> : null}
            {rs.state_owned ? <FlagChip color="medium" label="state-owned" /> : null}
          </div>
        </div>

        <button onClick={onDownloadBriefing}
          style={{
            background: 'var(--accent)', color: '#0A1628', border: 0,
            padding: '10px 16px', borderRadius: 4, fontWeight: 600, fontSize: 13,
            whiteSpace: 'nowrap',
          }}>
          ↓ Download briefing PDF
        </button>
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

// -------- Risk signals (the cited core) --------
function RiskSignals({ topRisks, raw, entityId }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
        Risk signals
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {topRisks.map(r => <RiskSignalCard key={r.factor} factor={r.factor} description={r.description} meta={raw[r.factor]} entityId={entityId} />)}
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
  return (
    <div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
        Identity evidence
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 4 }}>
        {identifiers.map((id, i) => (
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

// -------- Briefing modal (lightweight summary; the real PDF is the print theme) --------
function BriefingModal({ entity, onClose }) {
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
          POST /tools/generate_briefing
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
          A source-cited PDF compliance briefing for <span style={{ color: 'var(--text-primary)' }}>{entity.input_name}</span> will
          render in the light/print theme — page-numbered, fully cited, suitable for case file attachment.
        </div>
        <div style={{
          background: 'var(--bg-terminal)', border: '1px solid var(--border-subtle)',
          padding: 12, borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-terminal)', marginBottom: 18,
        }}>
          {`{
  "entity_id": "${entity.entity_id}",
  "format": "pdf",
  "pdf_path": "output/briefings/${entity.entity_id}.pdf",
  "size_bytes": 312488
}`}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)', padding: '8px 14px', borderRadius: 4, fontSize: 13,
          }}>Cancel</button>
          <button onClick={onClose} style={{
            background: 'var(--accent)', color: '#0A1628', border: 0,
            padding: '8px 14px', borderRadius: 4, fontWeight: 600, fontSize: 13,
          }}>Generate PDF</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Entity });

// ============================================================
// Helpers — stub builder + ownership unavailable state
// ============================================================

// Build a minimal Entity-shaped object from a CompareRow.
// Used when a user clicks into an entity that doesn't have a full cached fixture.
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

// "Ownership network not yet retrieved — fetch live"
function OwnershipUnavailable({ entityId, entityName }) {
  const [fetching, setFetching] = useState(false);
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      minHeight: 720,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>Ownership network</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>not yet retrieved for this entity</div>
      </div>
      <div style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(ellipse at center, #0E1B30 0%, var(--bg-surface) 100%)',
        position: 'relative',
      }}>
        {/* Sketch of an un-retrieved graph */}
        <svg width="420" height="320" viewBox="0 0 420 320" style={{ opacity: 0.18 }}>
          <circle cx="210" cy="160" r="28" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="80"  cy="80"  r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="340" cy="80"  r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="80"  cy="240" r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <circle cx="340" cy="240" r="18" fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="3 4" />
          <line x1="100" y1="92"  x2="190" y2="148" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
          <line x1="320" y1="92"  x2="230" y2="148" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
          <line x1="100" y1="228" x2="190" y2="172" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
          <line x1="320" y1="228" x2="230" y2="172" stroke="#94A3B8" strokeWidth="0.8" strokeDasharray="2 4" />
        </svg>

        <div style={{
          position: 'absolute', textAlign: 'center', maxWidth: 380,
          padding: '0 20px',
        }}>
          <div style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 8 }}>
            Ownership network not cached
          </div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
            Sentinel hasn't yet traversed the ownership graph for{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{entityName}</span>. Fetch it live from Sayari to render the network — typically <span className="mono">300–800ms</span>.
          </div>
          <button
            onClick={() => { setFetching(true); setTimeout(() => setFetching(false), 1200); }}
            disabled={fetching}
            style={{
              background: fetching ? 'transparent' : 'var(--accent)',
              color: fetching ? 'var(--text-muted)' : '#0A1628',
              border: fetching ? '1px solid var(--border-default)' : 0,
              padding: '8px 16px', borderRadius: 4, fontWeight: 600, fontSize: 13,
            }}
          >
            {fetching ? 'fetching…' : 'Fetch ownership graph live →'}
          </button>
          <div className="mono muted" style={{ fontSize: 10, marginTop: 14, letterSpacing: 0.6 }}>
            POST /tools/traverse_ownership · entity_id={entityId.slice(0,16)}…
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { buildStubFromCompareRow, OwnershipUnavailable });
