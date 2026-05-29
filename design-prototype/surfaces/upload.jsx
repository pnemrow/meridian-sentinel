/* Surface 1 — Upload: source → (sheet pick) → map → run (§6)
 *
 * Real flow (no decorative drop zone anymore):
 *   1. User picks a file (drop or browse, hidden <input type="file"> is the
 *      single source of truth). SheetJS enumerates sheets client-side.
 *   2. If the workbook has >1 sheet, show a SHEET PICKER. Single sheets auto-pick.
 *   3. POST file + sheet_name to /uploads. Backend returns the *canonical*
 *      column_mapping + preview (engine-detected) and matches_seeded.
 *   4. POST /uploads/{id}/run streams real per-row progress via SSE.
 *      matches_seeded → instant cached path (run_id="default").
 *      Otherwise → live run, ~1s/row, new run_id is the new investigation.
 *
 * The "Use the seeded list" card is a one-click shortcut that bypasses
 * /uploads entirely and lands on the existing demo flow (run_id="default").
 */

const UPLOAD_API_BASE = (typeof window !== 'undefined' && window.SENTINEL_API_BASE) || '';

function Upload({ onRunComplete, onOpenEntity }) {
  const [step, setStep] = useState('source');      // source | sheet | map | running | resolved
  const [file, setFile] = useState(null);
  const [pendingUploadId, setPendingUploadId] = useState(null);  // when multi-sheet & still picking
  const [sheets, setSheets] = useState([]);
  const [uploadResponse, setUploadResponse] = useState(null);    // backend canonical response
  const [runEvents, setRunEvents] = useState([]);                // SSE stream
  const [runResult, setRunResult] = useState(null);              // {run_id, matches_seeded, ...}
  const [errorMsg, setErrorMsg] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // ── Source step handlers ─────────────────────────────────────────────────

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = async (f) => {
    setErrorMsg(null);
    setFile(f);
    const isXlsx = /\.(xlsx|xls)$/i.test(f.name);
    if (isXlsx && window.XLSX) {
      // Enumerate sheets client-side first. Single-sheet workbooks skip the picker.
      try {
        const buf = await f.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: 'array' });
        const names = wb.SheetNames || [];
        if (names.length > 1) {
          setSheets(names);
          setStep('sheet');
          return;
        }
        await postUpload(f, names[0] || null);
        return;
      } catch (err) {
        console.warn('[upload] SheetJS read failed, falling back to backend enumeration:', err);
      }
    }
    // CSV or SheetJS-unavailable fallback: POST without sheet_name, let backend respond.
    await postUpload(f, null);
  };

  const postUpload = async (f, sheetName) => {
    setErrorMsg(null);
    const fd = new FormData();
    fd.append('file', f);
    if (sheetName) fd.append('sheet_name', sheetName);
    try {
      const resp = await fetch(`${UPLOAD_API_BASE}/uploads`, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from /uploads`);
      const json = await resp.json();
      if (json.needs_sheet_choice) {
        setPendingUploadId(json.upload_id);
        setSheets(json.sheets);
        setStep('sheet');
        return;
      }
      setUploadResponse(json);
      setStep('map');
    } catch (err) {
      setErrorMsg(`Upload failed: ${err.message}. Is the backend running at ${UPLOAD_API_BASE || '/'}?`);
    }
  };

  const handleSheetPicked = async (sheetName) => {
    if (!file) {
      setErrorMsg("Internal: file reference lost — please re-pick the file.");
      return;
    }
    await postUpload(file, sheetName);
  };

  // The "Use the seeded list" shortcut was removed in Pass 2 — it bypassed
  // the upload flow and hardcoded {resolved: 49, total: 50}. The seeded path
  // now goes through the real upload: postUpload's matches_seeded detection
  // recognises list_1 by content hash and gives the same instant-cached
  // result, but honestly through the same SSE pipeline.

  // ── Drag / drop ───────────────────────────────────────────────────────────

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  // ── Run step ──────────────────────────────────────────────────────────────

  const onRun = async (investigationName) => {
    if (!uploadResponse?.upload_id) return;
    setStep('running');
    setRunEvents([]);
    setErrorMsg(null);
    try {
      // Send the analyst-chosen investigation name as a query param so the
      // backend can write it into output/runs/{run_id}/investigation.json
      // and surface it on the dashboard + sidebar without a follow-up call.
      const qs = investigationName ? `?name=${encodeURIComponent(investigationName)}` : '';
      const resp = await fetch(`${UPLOAD_API_BASE}/uploads/${uploadResponse.upload_id}/run${qs}`, { method: 'POST' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from /uploads/{id}/run`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            setRunEvents(prev => [...prev, payload]);
            if (payload.event === 'run_complete') {
              setRunResult(payload.data);
            }
            if (payload.event === 'done') {
              setStep('resolved');
            }
            if (payload.event === 'error') {
              setErrorMsg(payload.data?.message || 'Run failed');
            }
          } catch (_) { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      setErrorMsg(`Run failed: ${err.message}`);
      setStep('map');
    }
  };

  const onContinue = () => {
    if (typeof onRunComplete === 'function') {
      onRunComplete(
        runResult?.run_id || 'default',
        !!runResult?.matches_seeded
      );
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '32px 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <SectionHeader kicker="Surface 1 · Upload" title="Screen a vendor list" />
      <div className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 28 }}>
        Resolve every name to a real corporate entity, screen against OFAC, map ownership.
      </div>

      {/* Hidden real file input — both the drop zone and the browse link trigger it */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv,.xls"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />

      {errorMsg ? (
        <div style={{
          background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.35)',
          color: 'var(--risk-critical)', padding: '10px 14px', borderRadius: 4, marginBottom: 18, fontSize: 13,
        }}>{errorMsg}</div>
      ) : null}

      {/* Step 1 */}
      <StepCard num={1} label="Source"
        active={step === 'source' || step === 'sheet'}
        done={step !== 'source' && step !== 'sheet'}
      >
        {step === 'sheet'
          ? <SheetPicker sheets={sheets} file={file} onPick={handleSheetPicked} onBack={() => setStep('source')} />
          : <SourcePicker
              onBrowse={openFilePicker}
              dragOver={dragOver}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />}
      </StepCard>

      {/* Step 2 */}
      <StepCard num={2} label="Map & preview"
        active={step === 'map'}
        done={step === 'running' || step === 'resolved'}
        disabled={step === 'source' || step === 'sheet'}
      >
        {(step === 'map' || step === 'running' || step === 'resolved') && uploadResponse
          ? <MapAndPreview response={uploadResponse} onRun={onRun} canRun={step === 'map'} />
          : <span className="muted">Pick a source above to begin.</span>}
      </StepCard>

      {/* Step 3 */}
      <StepCard num={3} label="Validate & run"
        active={step === 'running' || step === 'resolved'}
        done={step === 'resolved'}
        disabled={step === 'source' || step === 'sheet' || step === 'map'}
      >
        {step === 'running'
          ? <RunningState events={runEvents} total={uploadResponse?.total_rows || 0} onOpenEntity={onOpenEntity} />
          : step === 'resolved'
            ? <ResolvedSummary runResult={runResult} uploadResponse={uploadResponse} runEvents={runEvents} onContinue={onContinue} onOpenEntity={onOpenEntity} />
            : <span className="muted">Confirm the mapping, then run screening.</span>}
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

// ── Source / drop zone ──────────────────────────────────────────────────────

function SourcePicker({ onBrowse, dragOver, onDragOver, onDragLeave, onDrop }) {
  return (
    <div
      onClick={onBrowse}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="clickable"
      style={{
        border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border-default)'}`,
        background: dragOver ? 'rgba(201,169,97,0.06)' : 'var(--bg-primary)',
        borderRadius: 4,
        padding: '40px 24px',
        textAlign: 'center',
        transition: 'border-color 120ms, background 120ms',
      }}>
      <div className="mono" style={{ fontSize: 28, color: dragOver ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 12 }}>⬆</div>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 6 }}>
        Drop an <span className="mono">.xlsx</span> or <span className="mono">.csv</span> file
      </div>
      <div className="muted" style={{ fontSize: 12 }}>or click to browse</div>
      <div className="muted" style={{ fontSize: 11, fontStyle: 'italic', marginTop: 14, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
        Re-uploading the seeded list_1.xlsx is recognised by content hash and short-circuits to the verified cached results.
      </div>
    </div>
  );
}

// ── Sheet picker ────────────────────────────────────────────────────────────

function SheetPicker({ sheets, file, onPick, onBack }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          <span className="mono" style={{ color: 'var(--text-primary)' }}>{file?.name || 'workbook'}</span> contains{' '}
          <span className="mono" style={{ color: 'var(--text-primary)' }}>{sheets.length}</span> sheets — pick one to screen.
        </div>
        <button onClick={onBack} style={{
          background: 'transparent', color: 'var(--text-muted)',
          border: '1px solid var(--border-default)',
          padding: '4px 10px', borderRadius: 3, fontSize: 11,
        }}>← change file</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {sheets.map((name, i) => (
          <button key={name} onClick={() => onPick(name)} className="clickable" style={{
            textAlign: 'left',
            background: i === 0 ? 'rgba(201,169,97,0.08)' : 'var(--bg-primary)',
            border: `1px solid ${i === 0 ? 'var(--accent-dim)' : 'var(--border-default)'}`,
            borderRadius: 4,
            padding: '12px 14px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}>
            <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {i === 0 ? 'first sheet · default' : 'click to use this sheet'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Map & preview (driven by /uploads response) ─────────────────────────────

function MapAndPreview({ response, onRun, canRun }) {
  const mapping = response.column_mapping || {};
  const preview = response.preview || [];

  // Investigation name: defaults to "<filename stem> · <sheet>" so it lands as
  // a sensible label without manual typing. Editable inline before Run.
  const _defaultName = (() => {
    const stem = (response.filename || '').replace(/\.(xlsx|xls|csv)$/i, '').trim();
    return stem ? `${stem} · ${response.sheet || ''}`.replace(/ · $/, '') : (response.sheet || 'New investigation');
  })();
  const [investigationName, setInvestigationName] = useState(_defaultName);

  return (
    <div>
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
        borderRadius: 4, padding: '16px 18px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Column mapping · auto-detected from headers
          </span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            sheet: <span style={{ color: 'var(--text-primary)' }}>{response.sheet || '—'}</span>
            {response.matches_seeded ? <span style={{ color: 'var(--accent)', marginLeft: 12 }}>★ matches seeded list_1</span> : null}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {Object.entries(mapping).map(([field, cfg]) => (
            <ColumnSelect key={field} field={field} cfg={cfg} required={field === 'name'} />
          ))}
        </div>
      </div>

      {preview.length > 0 ? (
        <div style={{ border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 80px 100px 1fr 120px',
            gap: 12, padding: '8px 14px',
            background: 'var(--bg-elevated)',
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
            letterSpacing: 0.8, textTransform: 'uppercase',
          }}>
            <div>row</div><div>name</div><div>country</div><div>type</div><div>identifier</div><div>status</div>
          </div>
          {preview.map((r) => (
            <div key={r.row} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 80px 100px 1fr 120px',
              gap: 12, padding: '8px 14px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 12,
              background: r.status === 'no_name' ? 'rgba(248,81,73,0.04)' : 'transparent',
              color: r.status === 'no_name' ? 'var(--text-muted)' : 'var(--text-primary)',
            }}>
              <div className="mono muted">{r.row}</div>
              <div>{r.name || <span className="muted">(blank)</span>}</div>
              <div className="mono">{r.country ? <CountryCode code={r.country} /> : <span className="muted">—</span>}</div>
              <div className="mono muted">{r.type || '—'}</div>
              <div className="mono muted" style={{ fontSize: 11 }}>{r.identifier || '—'}</div>
              <div>
                {r.status === 'ready'
                  ? <span style={{ color: 'var(--risk-low)' }}>✓ ready</span>
                  : <span style={{ color: 'var(--risk-critical)' }}>⚠ no name — skip</span>}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="muted" style={{ fontSize: 12, marginTop: 10, fontStyle: 'italic' }}>
        Showing {preview.length} of {response.total_rows} rows. Column detection uses the backend's COLUMN_HINTS
        against the actual file headers.
      </div>

      {/* Investigation name input — surfaces on the dashboard + sidebar after the run completes */}
      <div style={{
        background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)',
        borderRadius: 4, padding: '12px 14px', marginTop: 18,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ flex: '0 0 180px' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Investigation name
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 2, fontStyle: 'italic' }}>
            shown on dashboard + sidebar
          </div>
        </div>
        <input
          value={investigationName}
          onChange={(e) => setInvestigationName(e.target.value)}
          maxLength={120}
          style={{
            flex: 1,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 3, padding: '7px 10px',
            fontSize: 13, color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
        <span className="mono muted" style={{ fontSize: 11 }}>POST /uploads/{response.upload_id}/run</span>
        <button onClick={() => onRun(investigationName.trim() || _defaultName)} disabled={!canRun} style={{
          background: canRun ? 'var(--accent)' : 'transparent',
          color: canRun ? '#0A1628' : 'var(--text-muted)',
          border: canRun ? 0 : '1px solid var(--border-default)',
          padding: '10px 18px', borderRadius: 4, fontSize: 14, fontWeight: 600,
        }}>{response.matches_seeded ? 'Run screening (cached) →' : 'Run screening live →'}</button>
      </div>
    </div>
  );
}

function ColumnSelect({ field, cfg, required }) {
  const detected = cfg?.detected_header;
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="mono">{field}</span>
        {required ? <span style={{ color: 'var(--accent)' }}>•</span> : null}
      </div>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
        borderRadius: 3, padding: '6px 10px', display: 'flex', justifyContent: 'space-between',
        fontSize: 12, alignItems: 'center',
      }}>
        <span style={{ color: detected ? 'var(--text-primary)' : 'var(--text-muted)' }}>{detected || '— none —'}</span>
        <span className="muted" style={{ fontSize: 10 }}>▾</span>
      </div>
      {detected ? (
        <div className="mono" style={{ fontSize: 9, color: 'var(--accent-dim)', marginTop: 4, letterSpacing: 0.5 }}>
          auto-detected
        </div>
      ) : null}
    </div>
  );
}

// ── Running state — real SSE-driven progress ────────────────────────────────

function RunningState({ events, total, onOpenEntity }) {
  const cachedEvent = events.find(e => e.event === 'matched_seeded');
  if (cachedEvent) {
    return (
      <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 18, height: 18, borderRadius: 999,
            background: 'var(--risk-low)', color: '#0A1628',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
          }}>✓</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{cachedEvent.data.message}</span>
        </div>
      </div>
    );
  }

  const rowEvents = events.filter(e => e.event === 'row_resolved' || e.event === 'row_unresolved' || e.event === 'row_error');
  const resolved = events.filter(e => e.event === 'row_resolved').length;
  const unresolved = events.filter(e => e.event === 'row_unresolved').length;
  const errored = events.filter(e => e.event === 'row_error').length;
  const processed = resolved + unresolved + errored;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Resolving live from Sayari · ~1 req/sec
          </span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>{processed} / {total}</span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))',
            transition: 'width 240ms',
          }} />
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span><span className="mono" style={{ color: 'var(--risk-low)' }}>{resolved}</span> resolved</span>
          <span><span className="mono" style={{ color: 'var(--text-muted)' }}>{unresolved}</span> unresolved</span>
          {errored ? <span><span className="mono" style={{ color: 'var(--risk-critical)' }}>{errored}</span> errored</span> : null}
        </div>
      </div>

      <RunTrace
        rowEvents={rowEvents}
        title="Live trace · grows as rows resolve"
        maxHeight={360}
        autoScroll
        onOpenEntity={onOpenEntity}
      />
    </div>
  );
}

// ── RunTrace: growing scrollable per-row audit ──────────────────────────────
// One component for both streaming (autoScroll on, maxHeight=360) and post-
// run (autoScroll off, no maxHeight). Auto-scroll pauses when the user has
// scrolled up or has a row expanded; a "↓ jump to latest" pill appears when
// new rows arrive in that state.

function RunTrace({ rowEvents, title, maxHeight, autoScroll, onOpenEntity }) {
  const [expanded, setExpanded] = useState(null);     // row index used as key
  const scrollRef = useRef(null);
  // Whether auto-scroll should follow new events.
  const [follow, setFollow] = useState(true);
  // Number of new events that arrived while we were NOT following — drives
  // the "↓ jump to latest" pill.
  const [unseen, setUnseen] = useState(0);
  const prevCountRef = useRef(rowEvents.length);
  const isPaused = expanded != null || !follow;

  // Auto-scroll handler — fires on every event-list change while autoScroll
  // is on. If we're following, snap to bottom; otherwise count the unseen.
  useEffect(() => {
    if (!autoScroll) return;
    const grew = rowEvents.length > prevCountRef.current;
    prevCountRef.current = rowEvents.length;
    if (!grew) return;
    const el = scrollRef.current;
    if (!el) return;
    if (isPaused) {
      setUnseen((n) => n + 1);
      return;
    }
    // Use requestAnimationFrame so the new row is in the DOM before we scroll.
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [rowEvents.length, autoScroll, isPaused]);

  // Reset follow + unseen when the user collapses the row that was pausing.
  useEffect(() => {
    if (expanded == null && follow) setUnseen(0);
  }, [expanded, follow]);

  const onScroll = (e) => {
    if (!autoScroll) return;
    const el = e.currentTarget;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
    if (atBottom && !follow) {
      setFollow(true);
      setUnseen(0);
    } else if (!atBottom && follow) {
      setFollow(false);
    }
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollow(true);
    setUnseen(0);
  };

  if (rowEvents.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      {title ? (
        <div className="mono" style={{
          fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.2,
          textTransform: 'uppercase', marginBottom: 6, padding: '0 4px',
        }}>{title}</div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          background: 'var(--bg-terminal)', border: '1px solid var(--border-subtle)',
          borderRadius: 4, padding: '8px 4px',
          maxHeight: maxHeight || undefined,
          overflowY: maxHeight ? 'auto' : 'visible',
        }}
      >
        {rowEvents.map((e) => {
          const key = e.data.index ?? e.data.row;
          const open = expanded === key;
          return (
            <TraceRow
              key={key}
              ev={e}
              open={open}
              onToggle={() => setExpanded(open ? null : key)}
              onOpenEntity={onOpenEntity}
            />
          );
        })}
      </div>
      {/* ↓ jump-to-latest pill — only shown while paused and new events arrived */}
      {autoScroll && isPaused && unseen > 0 ? (
        <button
          onClick={jumpToLatest}
          style={{
            position: 'absolute', right: 14, bottom: 12,
            background: 'var(--accent)', color: '#0A1628',
            border: 0, padding: '4px 10px', borderRadius: 999,
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >↓ jump to latest · {unseen}</button>
      ) : null}
    </div>
  );
}

function TraceRow({ ev, open, onToggle, onOpenEntity }) {
  const d = ev.data || {};
  const kind = ev.event;
  const dotColor =
    kind === 'row_resolved' ? 'var(--risk-low)' :
    kind === 'row_error'    ? 'var(--risk-critical)' :
    'var(--text-muted)';
  return (
    <div style={{ borderTop: '1px solid transparent' }}>
      <button
        onClick={onToggle}
        className="clickable"
        style={{
          width: '100%', textAlign: 'left',
          background: open ? 'rgba(201,169,97,0.04)' : 'transparent',
          border: 0, padding: '4px 8px',
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-terminal)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ color: 'var(--text-muted)', width: 12, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: dotColor }}>●</span>
        <span>row {d.row}</span>
        <span style={{ color: 'var(--text-primary)' }}>{(d.name || '').slice(0, 44)}</span>
        {d.sanctioned ? <span style={{ color: 'var(--risk-critical)' }}>sanctioned</span> : null}
        {d.pep ? <span style={{ color: 'var(--risk-medium)' }}>PEP</span> : null}
        {d.warn_verify ? (
          <span onClick={(e) => e.stopPropagation()}>
            <ConfidenceFlag
              reason={(typeof buildVerifyReason === 'function')
                ? buildVerifyReason(d.name, d.findings?.match_label || d.match_label)
                : 'matched label differs from input name — verify identity'}
              inline
            />
          </span>
        ) : null}
        {d.entity_id ? <span style={{ color: 'var(--text-muted)' }}>{d.entity_id.slice(0, 12)}…</span> : null}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{d.duration_ms != null ? `${d.duration_ms}ms` : ''}</span>
      </button>
      {open ? <TraceDetail ev={ev} onOpenEntity={onOpenEntity} /> : null}
    </div>
  );
}

function _whyThisRowMatters(d) {
  const f = d.findings || {};
  const outcome = f.outcome;
  const ownFactor = f.ownership_factor;
  const ownFriendly = ownFactor && typeof sanctionDisplayName === 'function'
    ? sanctionDisplayName(ownFactor)
    : (ownFactor || 'ownership exposure');
  if (!outcome) return null; // in-flight or missing — omit the banner
  switch (outcome) {
    case 'both_catch':
      return "Name-screen and Sayari agree — directly sanctioned by name. Block.";
    case 'sayari_only':
      return `Name-screen would miss this. Sayari catches it via ${ownFriendly} (OFAC 50% Rule).`;
    case 'screen_ambiguous':
      return "Name-screen fires on a related but different entity. Sayari resolves the correct one.";
    case 'matcher_miss':
      return "Sayari catches this; the name-screen missed it (likely transliteration or aliasing).";
    case 'ofac_only':
      return "Name-screen flagged this; Sayari finds no risk factor — review as possible false positive.";
    case 'no_ofac':
      if (f.name_mismatch_flag) return "Resolution match has low lexical overlap with input — verify entity identity before clearing.";
      return "Clean of OFAC SDN exposure on both sides.";
    default:
      return null;
  }
}

function TraceDetail({ ev, onOpenEntity }) {
  const d = ev.data || {};
  const steps = d.steps || [];
  const findings = d.findings || null;
  const sources = d.sources || null;
  const reason = d.reason;
  const banner = _whyThisRowMatters(d);
  const identifiers = (findings && findings.identifiers) || [];
  const entityId = d.entity_id;

  return (
    <div style={{
      background: 'rgba(5,11,20,0.55)',
      borderTop: '1px solid var(--border-subtle)',
      borderLeft: '2px solid var(--accent-dim)',
      padding: '8px 12px 10px 18px',
      margin: '2px 8px 6px',
      fontFamily: 'var(--font-mono)', fontSize: 11,
      color: 'var(--text-terminal)',
    }}>
      {/* WHY THIS ROW MATTERS — demo-narrative banner. Top of the expansion. */}
      {banner ? (
        <>
          <TraceSection label="Why this row matters" />
          <div style={{
            color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.5,
            padding: '4px 0',
          }}>{banner}</div>
        </>
      ) : null}

      {/* STEPS */}
      <TraceSection label="Steps" />
      {steps.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(no steps recorded)</div>
      ) : steps.map((s, i) => <TraceStep key={i} index={i + 1} step={s} />)}

      {/* REASON (unresolved only) */}
      {reason ? (
        <>
          <TraceSection label="Reason" />
          <div style={{ color: 'var(--risk-critical)' }}>{reason}</div>
        </>
      ) : null}

      {/* FINDINGS */}
      {findings ? (
        <>
          <TraceSection label="Findings" />
          <TraceFindings findings={findings} inputName={d.name} />
        </>
      ) : null}

      {/* IDENTIFIERS — top 5 prioritized from the raw entity profile */}
      {identifiers.length > 0 ? (
        <>
          <TraceSection label="Identifiers" />
          {identifiers.map((id, i) => (
            <div key={i} style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ color: 'var(--text-muted)', width: 180, flexShrink: 0 }}>{id.type}:</span>
              <span style={{ color: 'var(--text-primary)' }}>{id.value}</span>
            </div>
          ))}
        </>
      ) : null}

      {/* SOURCES */}
      {sources ? (
        <>
          <TraceSection label="Sources" />
          {Object.entries(sources).filter(([_, v]) => !!v).map(([k, path]) => (
            <div key={k} style={{ marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)' }}>{k.padEnd(18, ' ')}</span>
              {' '}
              <a
                href={`/${path}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px dotted var(--accent-dim)' }}
              >{path}</a>
            </div>
          ))}
        </>
      ) : null}

      {/* Open full entity detail — navigates to the Entity surface for this entity_id */}
      {entityId && typeof onOpenEntity === 'function' ? (
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border-subtle)', display: 'flex' }}>
          <button
            onClick={() => onOpenEntity(entityId)}
            style={{
              background: 'transparent', color: 'var(--accent)',
              border: '1px solid var(--accent-dim)', borderRadius: 3,
              padding: '4px 10px', fontFamily: 'var(--font-mono)', fontSize: 11,
              cursor: 'pointer', letterSpacing: 0.2,
            }}
          >→ Open full entity detail</button>
        </div>
      ) : null}
    </div>
  );
}

function TraceSection({ label }) {
  return (
    <div style={{
      fontSize: 9, color: 'var(--accent-dim)', letterSpacing: 1.4,
      textTransform: 'uppercase', marginTop: 10, marginBottom: 4, fontWeight: 600,
    }}>{label}</div>
  );
}

function TraceStep({ index, step }) {
  const r = step.response_summary || {};
  const isResolve = step.step === 'resolve_entity';
  const isFetch   = step.step === 'fetch_profile';
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-muted)' }}>[{index}]</span>
        <span style={{ color: 'var(--accent)' }}>{step.endpoint}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{step.duration_ms}ms</span>
      </div>
      <div style={{ paddingLeft: 18, color: 'var(--text-muted)' }}>
        payload: <span style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(step.request)}</span>
      </div>
      <div style={{ paddingLeft: 18 }}>
        {isResolve ? (
          <span style={{ color: 'var(--text-secondary)' }}>
            → <span style={{ color: 'var(--text-primary)' }}>{r.candidate_count ?? 0}</span> candidate{r.candidate_count === 1 ? '' : 's'}
            {r.best_label ? <> · best: <span style={{ color: 'var(--text-primary)' }}>"{(r.best_label || '').slice(0, 40)}"</span></> : null}
            {r.best_score != null ? <> · score <span style={{ color: 'var(--text-primary)' }}>{Number(r.best_score).toFixed(2)}</span></> : null}
            {r.pinned ? <span style={{ marginLeft: 6, color: 'var(--accent)' }}>[{r.retry_name || 'pinned'}]</span> : null}
            {!r.pinned && r.retry_name ? <span style={{ marginLeft: 6, color: 'var(--risk-medium)' }}>[retry: {r.retry_name}]</span> : null}
          </span>
        ) : isFetch ? (
          <span style={{ color: 'var(--text-secondary)' }}>
            → degree <span style={{ color: 'var(--text-primary)' }}>{(r.degree ?? 0).toLocaleString()}</span>
            {' · '}source_count <span style={{ color: 'var(--text-primary)' }}>{r.source_count ?? '—'}</span>
            {' · '}<span style={{ color: 'var(--text-primary)' }}>{r.risk_factor_count ?? 0}</span> risk factors
          </span>
        ) : (
          <span style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(r)}</span>
        )}
      </div>
    </div>
  );
}

function TraceFindings({ findings, inputName }) {
  const f = findings;
  const friendly = (code) => (typeof sanctionDisplayName === 'function')
    ? sanctionDisplayName(code) : code;
  const lvlColor = {
    critical: 'var(--risk-critical)',
    high:     'var(--risk-high)',
    medium:   'var(--risk-medium)',
    low:      'var(--risk-low)',
  }[f.risk_level] || 'var(--text-secondary)';
  return (
    <div>
      <FindRow k="match_label" v={f.match_label} />
      <FindRow k="match_score" v={f.match_score != null ? (
        <>
          <span style={{ color: 'var(--text-primary)' }}>{Number(f.match_score).toFixed(2)}</span>
          {f.name_mismatch_flag ? (
            <span style={{ marginLeft: 8, display: 'inline-block' }}>
              <ConfidenceFlag
                reason={(typeof buildVerifyReason === 'function')
                  ? buildVerifyReason(inputName, f.match_label)
                  : 'matched label differs from input name — verify identity'}
                inline
              />
            </span>
          ) : null}
        </>
      ) : '—'} />
      {f.name_mismatch_flag ? (
        <div style={{
          paddingLeft: 122, color: 'var(--risk-medium)',
          fontStyle: 'italic', fontSize: 10.5, marginTop: 2,
        }}>
          Low lexical overlap between input and match label — human verification recommended.
        </div>
      ) : null}
      <FindRow k="type" v={
        <>
          <span style={{ color: 'var(--text-primary)' }}>{f.type || '—'}</span>
          {(f.countries && f.countries.length) ? (
            <> · countries: <span style={{ color: 'var(--text-primary)' }}>
              {(f.countries.slice(0, 4) || []).join(', ')}
              {f.countries.length > 4 ? ` +${f.countries.length - 4}` : ''}
            </span></>
          ) : null}
        </>
      } />
      <FindRow k="risk_level" v={<span style={{ color: lvlColor, fontWeight: 600 }}>{(f.risk_level || '').toUpperCase()}</span>} />
      <FindRow k="sanctioned" v={
        f.sanctioned ? (
          <>
            <span style={{ color: 'var(--risk-critical)' }}>✓</span>
            {(f.sanctioned_lists || []).length ? (
              <span style={{ marginLeft: 6, display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                {f.sanctioned_lists.slice(0, 4).map(l => (
                  <span key={l} title={l /* raw factor code on hover so citations resolve */}>
                    <Chip text={friendly(l)} kind="critical" />
                  </span>
                ))}
                {f.sanctioned_lists.length > 4 ? <span style={{ color: 'var(--text-muted)' }}>+{f.sanctioned_lists.length - 4}</span> : null}
              </span>
            ) : null}
          </>
        ) : <span style={{ color: 'var(--text-muted)' }}>false</span>
      } />
      <FindRow k="pep" v={f.pep ? <span style={{ color: 'var(--risk-medium)' }}>true</span> : <span style={{ color: 'var(--text-muted)' }}>false</span>} />
      {(f.top_risks || []).length ? (
        <FindRow k="top_risks" v={
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {f.top_risks.slice(0, 5).map(r => (
              <span key={r} title={r}>
                <Chip text={friendly(r)} kind="muted" />
              </span>
            ))}
          </span>
        } />
      ) : null}
    </div>
  );
}

function FindRow({ k, v }) {
  return (
    <div style={{ marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ color: 'var(--text-muted)', width: 116, flexShrink: 0 }}>{k}:</span>
      <span style={{ color: 'var(--text-secondary)' }}>{v ?? '—'}</span>
    </div>
  );
}

function Chip({ text, kind }) {
  const palette = kind === 'critical'
    ? { bg: 'rgba(248,81,73,0.08)', border: 'rgba(248,81,73,0.35)', fg: 'var(--risk-critical)' }
    : { bg: 'var(--bg-elevated)', border: 'var(--border-default)', fg: 'var(--text-secondary)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 6px', borderRadius: 2,
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.fg, fontSize: 10, letterSpacing: 0.2,
    }}>{text}</span>
  );
}

// ── Resolved summary ────────────────────────────────────────────────────────

function ResolvedSummary({ runResult, uploadResponse, runEvents = [], onContinue }) {
  const matchedSeeded = !!runResult?.matches_seeded;
  // Full post-run trace: every row, expandable. Streaming cap doesn't apply.
  const allRows = (runEvents || []).filter(e =>
    e.event === 'row_resolved' || e.event === 'row_unresolved' || e.event === 'row_error'
  );
  const resolved = runResult?.resolved ?? 0;
  // total = parsed-rows that the engine actually attempted to resolve.
  // The full sheet may have had more rows — blank-name rows are dropped
  // at parse time (Pass 1 confusion: a 52-row sheet showed "48 of 48").
  const parsed = runResult?.total ?? uploadResponse?.total_rows ?? 0;
  const skipped = uploadResponse?.skipped_rows ?? 0;
  const inputRows = parsed + skipped;
  const sanctioned = runResult?.sanctioned_count;

  return (
    <div>
      {matchedSeeded ? (
        <div style={{
          background: 'rgba(201,169,97,0.06)',
          border: '1px solid var(--accent-dim)',
          borderRadius: 4, padding: '14px 16px', marginBottom: 18,
        }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>
            ★ Matched seeded list_1
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            The uploaded sheet hashes identically to the seeded list_1. Skipping the live re-run
            and serving the verified cached results: <span className="mono">49</span> resolved of <span className="mono">50</span>, <span className="mono">45</span> sanctioned.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 }}>
            <Stat label="input rows" value={inputRows} mono />
            <Stat label="parsed"     value={parsed} mono />
            <Stat label="resolved"   value={resolved} mono accent />
          </div>
          {skipped > 0 ? (
            <div className="muted" style={{ fontSize: 11, fontStyle: 'italic', marginBottom: 14, paddingLeft: 4 }}>
              <span className="mono">{skipped}</span> row{skipped === 1 ? '' : 's'} skipped (blank name)
            </div>
          ) : <div style={{ marginBottom: 14 }} />}
          {sanctioned != null ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 18 }}>
              <Stat label="unresolved" value={parsed - resolved} mono />
              <Stat label="sanctioned" value={sanctioned} mono risk={sanctioned ? 'critical' : null} />
            </div>
          ) : null}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 11 }}>
          run_id: <span style={{ color: 'var(--text-primary)' }}>{runResult?.run_id || 'default'}</span>
        </span>
        <button onClick={onContinue} style={{
          background: 'var(--accent)', color: '#0A1628', border: 0,
          padding: '10px 18px', borderRadius: 4, fontWeight: 600, fontSize: 14,
        }}>Continue to Compare →</button>
      </div>

      {/* Full post-run audit trace — every row, expandable, no streaming cap. */}
      {!matchedSeeded && allRows.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase' }}>
                Audit log
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                Run trace · <span className="mono">{allRows.length}</span> rows
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>
              click any row to expand · cache files open in a new tab
            </div>
          </div>
          <RunTrace rowEvents={allRows} title={null} onOpenEntity={onOpenEntity} />
        </div>
      ) : null}
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
