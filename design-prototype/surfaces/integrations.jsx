/* Surface C — Integrations catalog */

function Integrations() {
  const cat = window.INTEGRATIONS;
  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1200, margin: '0 auto' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
        Pipeline
      </div>
      <h1 style={{ fontSize: 28, margin: 0, fontWeight: 600 }}>Integrations</h1>
      <div className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 32, maxWidth: 720 }}>
        Sentinel reads vendor lists from your existing systems and writes outcomes back. Most connectors are
        catalogued, available, and not yet connected — turn one on to wire the flow end-to-end.
      </div>

      <Section title="Ingestion" subtitle="Where vendor + counterparty lists come from">
        <Grid items={cat.ingestion} />
      </Section>

      <Section title="Outbound · persistence" subtitle="Where outcomes go after disposition">
        <Grid items={cat.outbound} />
      </Section>

      <Section title="Identity · SSO" subtitle="Authentication and reviewer roles">
        <Grid items={cat.identity} />
      </Section>

      <div style={{
        background: 'rgba(201,169,97,0.04)',
        border: '1px dashed var(--accent-dim)',
        borderRadius: 4, padding: 18, marginTop: 28,
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>Note</div>
        Only the <span className="mono" style={{ color: 'var(--text-primary)' }}>SFTP</span> ingestion connector is wired in this build — it's what brings in
        the "Procurement feed · 2026-05-27" investigation on the home page. The remaining cards are catalogued
        but not connected; nothing in this demo will write to your warehouse or Jira.
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Grid({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {items.map(it => <IntegrationCard key={it.id} item={it} />)}
    </div>
  );
}

function IntegrationCard({ item }) {
  const active = item.status === 'active';
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border-default)'}`,
      borderRadius: 4, padding: 16,
      opacity: active ? 1 : 0.85,
      display: 'flex', flexDirection: 'column', gap: 10,
      minHeight: 140,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div className="mono" style={{ fontSize: 13, color: 'var(--text-primary)', letterSpacing: 0.2 }}>{item.name}</div>
        <StatusPill active={active} label={active ? 'ACTIVE' : 'AVAILABLE'} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, flex: 1 }}>
        {item.purpose}
      </div>
      {item.note ? (
        <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: 0.4 }}>
          {item.note}
        </div>
      ) : null}
      <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
        {/* The previous "configure →" / "connect →" buttons looked clickable
            but did nothing — removed in Pass 2. Inactive cards now show a
            "CATALOG" pill (honest: the integration exists in the catalog but
            isn't wired). The active card surfaces its real status via the
            page-level note. */}
        <span className="mono" style={{
          fontSize: 10, padding: '2px 9px',
          borderRadius: 2,
          background: active ? 'rgba(201,169,97,0.06)' : 'var(--bg-elevated)',
          color: active ? 'var(--accent)' : 'var(--text-muted)',
          border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border-default)'}`,
          letterSpacing: 0.8, fontWeight: 600,
        }}
        title={active ? 'Connected to a live SFTP source — see page note.' : 'Catalog only — connect via API.'}>
          {active ? 'WIRED' : 'CATALOG'}
        </span>
      </div>
    </div>
  );
}

function StatusPill({ active, label }) {
  return (
    <span className="mono" style={{
      fontSize: 10, padding: '2px 7px',
      borderRadius: 999,
      background: active ? 'rgba(63,185,80,0.1)' : 'var(--bg-elevated)',
      color: active ? 'var(--risk-low)' : 'var(--text-muted)',
      border: `1px solid ${active ? 'rgba(63,185,80,0.3)' : 'var(--border-default)'}`,
      letterSpacing: 0.8, fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: active ? 'var(--risk-low)' : 'var(--text-muted)', marginRight: 5, verticalAlign: 1 }} />
      {label}
    </span>
  );
}

Object.assign(window, { Integrations });
