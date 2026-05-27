/* Surface 1 — Upload: source → map → preview → run (§6) */

function Upload({ onRunComplete, initialStep }) {
  const [step, setStep] = useState(initialStep || 'source'); // source | map | running | resolved
  const [running, setRunning] = useState(false);

  const onSelectSeeded = () => {
    setStep('map');
  };

  const onRun = () => {
    setRunning(true);
    setStep('running');
    setTimeout(() => { setStep('resolved'); setRunning(false); }, 1400);
  };

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <SectionHeader
        kicker="Surface 1 · Upload"
        title="Screen a vendor list"
      />
      <div className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 28 }}>
        Resolve every name to a real corporate entity, screen against OFAC, map ownership.
      </div>

      {/* Step 1 */}
      <StepCard num={1} label="Source" active={step === 'source'} done={step !== 'source'}>
        <SourcePicker onSeeded={onSelectSeeded} />
      </StepCard>

      {/* Step 2 */}
      <StepCard num={2} label="Map & preview" active={step === 'map'} done={step === 'running' || step === 'resolved'} disabled={step === 'source'}>
        {step !== 'source' ? <MapAndPreview onRun={onRun} canRun={step === 'map'} /> : <span className="muted">Pick a source above to begin.</span>}
      </StepCard>

      {/* Step 3 */}
      <StepCard num={3} label="Validate & run" active={step === 'running' || step === 'resolved'} done={step === 'resolved'} disabled={step === 'source' || step === 'map'}>
        {step === 'running' ? <RunningState /> : step === 'resolved' ? <ResolvedSummary onContinue={onRunComplete} /> : <span className="muted">Confirm the mapping, then run screening.</span>}
      </StepCard>
    </div>
  );
}

function StepCard({ num, label, active, done, disabled, children }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border-default)'}`,
      borderRadius: 6,
      padding: 24,
      marginBottom: 16,
      opacity: disabled ? 0.55 : 1,
      transition: 'border-color 200ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <span style={{
          width: 24, height: 24, borderRadius: 999,
          border: `1px solid ${done ? 'var(--risk-low)' : active ? 'var(--accent)' : 'var(--border-default)'}`,
          color: done ? 'var(--risk-low)' : active ? 'var(--accent)' : 'var(--text-muted)',
          background: done ? 'rgba(63,185,80,0.1)' : active ? 'rgba(201,169,97,0.1)' : 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        }}>{done ? '✓' : num}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase' }}>Step {num}</span>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function SourcePicker({ onSeeded }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div style={{
        border: '1.5px dashed var(--border-default)',
        borderRadius: 4,
        padding: '32px 24px',
        textAlign: 'center',
        background: 'var(--bg-primary)',
      }}>
        <div className="mono" style={{ fontSize: 24, color: 'var(--text-muted)', marginBottom: 10 }}>⬆</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Drop an <span className="mono">.xlsx</span> or <span className="mono">.csv</span> file
        </div>
        <div className="muted" style={{ fontSize: 12 }}>or click to browse</div>
      </div>
      <div onClick={onSeeded} className="clickable" style={{
        border: '1px solid var(--accent-dim)',
        background: 'linear-gradient(180deg, rgba(201,169,97,0.08), rgba(201,169,97,0.01))',
        borderRadius: 4,
        padding: '24px 22px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
            ▸ Use the seeded list
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>list_1 · 50 entities</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            A real vendor list captured from a prior screening run. Resolves instantly from cache.
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 13 }}>
          Load <span style={{ fontFamily: 'var(--font-mono)' }}>→</span>
        </div>
      </div>
    </div>
  );
}

function MapAndPreview({ onRun, canRun }) {
  const hints = window.COLUMN_HINTS;
  const preview = window.SEEDED_LIST_PREVIEW;
  return (
    <div>
      {/* Column mapper */}
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
        borderRadius: 4, padding: '16px 18px', marginBottom: 16,
      }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
          Column mapping · auto-detected
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {Object.entries(hints).map(([field, cfg]) => (
            <ColumnSelect key={field} field={field} cfg={cfg} />
          ))}
        </div>
      </div>

      {/* Preview table */}
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 1fr 80px 100px 1fr 160px',
          gap: 12, padding: '8px 14px',
          background: 'var(--bg-elevated)',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
          letterSpacing: 0.8, textTransform: 'uppercase',
        }}>
          <div>row</div><div>name (detected)</div><div>country</div><div>type</div><div>identifier</div><div>status</div>
        </div>
        {preview.map((r) => (
          <div key={r.row} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 80px 100px 1fr 160px',
            gap: 12, padding: '8px 14px',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: 12,
            background: r.status === 'no_name' ? 'rgba(248,81,73,0.04)' : (r.status === 'low_confidence' ? 'rgba(210,153,34,0.04)' : 'transparent'),
            color: r.status === 'no_name' ? 'var(--text-muted)' : 'var(--text-primary)',
          }}>
            <div className="mono muted">{r.row}</div>
            <div>{r.name || <span className="muted">(blank)</span>}</div>
            <div className="mono"><CountryCode code={r.country} /></div>
            <div className="mono muted">{r.type}</div>
            <div className="mono muted" style={{ fontSize: 11 }}>{r.identifier || '—'}</div>
            <div>
              {r.status === 'ready' ? <span style={{ color: 'var(--risk-low)' }}>✓ ready</span> :
               r.status === 'no_name' ? <span style={{ color: 'var(--risk-critical)' }}>⚠ no name — skip</span> :
               r.status === 'low_confidence' ? <ConfidenceFlag reason="match score < 50; resolved candidate is likely a related entity, not the input — verify before relying on results." inline /> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10, fontStyle: 'italic' }}>
        Showing 15 of 50 rows. Column detection follows backend <span className="mono">COLUMN_HINTS</span>; you can override any field above.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onRun} disabled={!canRun} style={{
          background: canRun ? 'var(--accent)' : 'transparent',
          color: canRun ? '#0A1628' : 'var(--text-muted)',
          border: canRun ? 0 : '1px solid var(--border-default)',
          padding: '10px 18px', borderRadius: 4, fontSize: 14, fontWeight: 600,
        }}>Run screening →</button>
      </div>
    </div>
  );
}

function ColumnSelect({ field, cfg }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="mono">{field}</span>
        {cfg.required ? <span style={{ color: 'var(--accent)' }}>•</span> : null}
      </div>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
        borderRadius: 3, padding: '6px 10px', display: 'flex', justifyContent: 'space-between',
        fontSize: 12, alignItems: 'center',
      }}>
        <span style={{ color: cfg.detected ? 'var(--text-primary)' : 'var(--text-muted)' }}>{cfg.detected || '— none —'}</span>
        <span className="muted" style={{ fontSize: 10 }}>▾</span>
      </div>
      {cfg.detected ? (
        <div className="mono" style={{ fontSize: 9, color: 'var(--accent-dim)', marginTop: 4, letterSpacing: 0.5 }}>
          auto-detected
        </div>
      ) : null}
    </div>
  );
}

function RunningState() {
  return (
    <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[
        ['Parsing rows', 'done'],
        ['Resolving names to Sayari entities', 'running'],
        ['Screening against OFAC SDN feed', 'pending'],
        ['Traversing ownership graphs', 'pending'],
      ].map(([label, state], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 16, height: 16, borderRadius: 999,
            border: '1px solid var(--border-default)',
            background: state === 'done' ? 'var(--risk-low)' : 'transparent',
            color: state === 'done' ? '#0A1628' : 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
          }} className={state === 'running' ? 'pulse' : ''}>
            {state === 'done' ? '✓' : state === 'running' ? '⋯' : ''}
          </span>
          <span style={{ fontSize: 13, color: state === 'pending' ? 'var(--text-muted)' : 'var(--text-secondary)' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function ResolvedSummary({ onContinue }) {
  const sum = window.UPLOAD_SUMMARY.data;
  const source = window.UPLOAD_SUMMARY.source;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <Stat label="rows" value={sum.total_input} mono />
        <Stat label="resolved" value={sum.resolved} mono accent />
        <Stat label="unresolved" value={sum.unresolved} mono />
        <Stat label="rate" value={(sum.resolution_rate * 100).toFixed(0) + '%'} mono />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <Stat label="sanctioned" value={sum.sanctioned_count} risk="critical" />
        <Stat label="PEPs" value={sum.pep_count} />
        <Stat label="countries" value={Object.keys(sum.country_breakdown).length} />
        <Stat label="low-conf" value={sum.low_confidence_matches.length} risk="medium" />
      </div>

      {/* Low-confidence call-out */}
      <div style={{
        background: 'rgba(210,153,34,0.05)',
        border: '1px solid rgba(210,153,34,0.3)',
        borderRadius: 4, padding: 14, marginBottom: 20,
      }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--risk-medium)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
          ⚠ 2 entities matched with low confidence — verify before relying on results
        </div>
        {sum.low_confidence_matches.map(m => (
          <CitedValue key={m.input_name} source={source}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <span>{m.input_name}</span>
              <span className="mono muted">score {m.score} · {m.reason}</span>
            </div>
          </CitedValue>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 11 }}>GET /summary</span>
        <button onClick={onContinue} style={{
          background: 'var(--accent)', color: '#0A1628', border: 0,
          padding: '10px 18px', borderRadius: 4, fontWeight: 600, fontSize: 14,
        }}>Continue to Co-Pilot →</button>
      </div>
    </div>
  );
}

function Stat({ label, value, mono, accent, risk }) {
  const color = risk === 'critical' ? 'var(--risk-critical)' : risk === 'medium' ? 'var(--risk-medium)' : (accent ? 'var(--accent)' : 'var(--text-primary)');
  return (
    <div style={{
      background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
      borderRadius: 4, padding: 12,
    }}>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', fontWeight: 600, color, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

Object.assign(window, { Upload });
