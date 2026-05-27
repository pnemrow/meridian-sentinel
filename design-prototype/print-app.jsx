/* Print walkthrough — renders all four surfaces as page-broken sections.
 * Dark theme preserved via print-color-adjust: exact.
 */

// --- Build CoPilot's final state by reducing through the sample stream ---
function buildCoPilotFinalState() {
  const conversation = [
    { role: 'user', segments: [{ type: 'text', text: window.COPILOT_GOLDEN_QUESTIONS[1] }] },
    { role: 'assistant', segments: [], meta: null },
  ];
  const tools = [];
  const citations = {};

  window.COPILOT_SAMPLE_STREAM.forEach(ev => {
    if (ev.type === 'token') {
      const last = conversation[conversation.length - 1];
      const segs = last.segments;
      const lastSeg = segs[segs.length - 1];
      if (lastSeg && lastSeg.type === 'text') {
        lastSeg.text = lastSeg.text + ev.data.text;
      } else {
        segs.push({ type: 'text', text: ev.data.text });
      }
    } else if (ev.type === 'citation') {
      citations[ev.data.ref] = ev.data;
      conversation[conversation.length - 1].segments.push({ type: 'cite', ref: ev.data.ref });
    } else if (ev.type === 'flag') {
      conversation[conversation.length - 1].segments.push({ type: 'flag', reason: ev.data.reason });
    } else if (ev.type === 'tool_call') {
      tools.push({ call: ev.data, result: null, isRunning: false });
    } else if (ev.type === 'tool_result') {
      const t = tools.find(x => x.call.id === ev.data.id);
      if (t) { t.result = ev.data; t.isRunning = false; }
    } else if (ev.type === 'answer_meta') {
      conversation[conversation.length - 1].meta = ev.data;
    }
  });

  return { conversation, tools, citations };
}

// --- A page header strip ---
function PageHeader({ num, title, subtitle, badge }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      borderBottom: '1px solid var(--border-default)',
      padding: '14px 32px',
      background: 'var(--bg-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="mono" style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 2,
          background: 'var(--accent)', color: '#0A1628',
          letterSpacing: 1, fontWeight: 700,
        }}>{num}</span>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 11, letterSpacing: 0.6 }}>list_1 · 50 entities · 49 resolved</span>
        <span style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          color: 'var(--text-secondary)', padding: '4px 10px', borderRadius: 4,
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 1.2, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--text-muted)' }} />
          CACHED
        </span>
        {badge}
      </div>
    </div>
  );
}

function PrintCover() {
  return (
    <section className="print-page print-cover">
      <div style={{ padding: '90px 80px 60px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 80 }}>
            <svg width="36" height="36" viewBox="0 0 28 28">
              <rect x="2" y="13" width="24" height="2" fill="var(--accent)" />
              <rect x="6" y="9"  width="16" height="2" fill="var(--accent)" opacity="0.65" />
              <rect x="10" y="17" width="8" height="2" fill="var(--accent)" opacity="0.85" />
              <rect x="13" y="3" width="2" height="22" fill="var(--accent-dim)" opacity="0.6" />
            </svg>
            <div className="mono" style={{ color: 'var(--text-muted)', letterSpacing: 1.4, fontSize: 11, textTransform: 'uppercase' }}>
              Compliance Co-Pilot · Prototype Walkthrough
            </div>
          </div>
          <h1 className="serif" style={{ fontSize: 80, lineHeight: 1, margin: 0, fontWeight: 600, letterSpacing: -1 }}>
            Meridian
          </h1>
          <h1 className="serif" style={{ fontSize: 80, lineHeight: 1, margin: 0, fontWeight: 600, letterSpacing: -1, color: 'var(--accent)' }}>
            Sentinel
          </h1>
          <div className="serif" style={{ fontSize: 28, color: 'var(--text-secondary)', marginTop: 32, lineHeight: 1.35, maxWidth: 760 }}>
            A name-only sanctions screen catches what's <em>on the list</em>. It can't catch
            an unlisted company that's <span style={{ color: 'var(--accent)' }}>≥50%-owned or controlled by a sanctioned party</span>.
            Sentinel closes that gap.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Tenant</div>
            <div style={{ fontSize: 15 }}>Meridian Energy Trading SA</div>
            <div className="muted" style={{ fontSize: 13 }}>Geneva · Sr. Compliance Analyst, P. Volkov</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Run</div>
            <div className="mono" style={{ fontSize: 13 }}>list_1 · 50 entities · 2026-05-27</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PrintApp() {
  const coPilotState = useMemo(() => buildCoPilotFinalState(), []);
  const noop = () => {};

  return (
    <div>
      <PrintCover />

      <section className="print-page">
        <PageHeader num="01" title="Upload" subtitle="list intake · resolved" />
        <div className="print-body">
          <Upload onRunComplete={noop} initialStep="resolved" />
        </div>
      </section>

      <section className="print-page">
        <PageHeader num="02" title="Co-Pilot" subtitle="streamed, grounded answer to a golden question" />
        <div className="print-body" style={{ height: 'calc(100% - 60px)' }}>
          <CoPilot onOpenEntity={noop} initialState={coPilotState} />
        </div>
      </section>

      <section className="print-page">
        <PageHeader num="03" title="Compare" subtitle="OFAC name-screen vs Sayari · the ownership gap" />
        <div className="print-body">
          <Compare onOpenEntity={noop} />
        </div>
      </section>

      <section className="print-page">
        <PageHeader num="04" title="Entity · Belorusskaya Kaliynaya Companya" subtitle="risk signals, identity, sources, ownership graph" />
        <div className="print-body">
          <Entity entityId="BSsUPVlxsICOW4GCjb4fqQ" onBack={noop} onOpenEntity={noop} />
        </div>
      </section>
    </div>
  );
}

const printRoot = ReactDOM.createRoot(document.getElementById('root'));
printRoot.render(<PrintApp />);

// --- Auto-print after fonts + a small settle delay ---
(async function autoPrint() {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}
  await new Promise(r => setTimeout(r, 800));
  window.print();
})();
