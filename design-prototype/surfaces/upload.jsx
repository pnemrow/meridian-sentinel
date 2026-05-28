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

function Upload({ onRunComplete }) {
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
          ? <RunningState events={runEvents} total={uploadResponse?.total_rows || 0} />
          : step === 'resolved'
            ? <ResolvedSummary runResult={runResult} uploadResponse={uploadResponse} onContinue={onContinue} />
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

function RunningState({ events, total }) {
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

  const resolved = events.filter(e => e.event === 'row_resolved').length;
  const unresolved = events.filter(e => e.event === 'row_unresolved').length;
  const errored = events.filter(e => e.event === 'row_error').length;
  const processed = resolved + unresolved + errored;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  // Recent activity: last 6 row_* events
  const recent = events
    .filter(e => e.event === 'row_resolved' || e.event === 'row_unresolved' || e.event === 'row_error')
    .slice(-6);

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

      {recent.length > 0 ? (
        <div style={{
          background: 'var(--bg-terminal)', border: '1px solid var(--border-subtle)',
          borderRadius: 4, padding: '10px 12px', maxHeight: 180, overflow: 'auto',
        }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>
            Recent rows
          </div>
          {recent.map((e, i) => (
            <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-terminal)', padding: '2px 0' }}>
              <span style={{ color: e.event === 'row_resolved' ? 'var(--risk-low)' : e.event === 'row_error' ? 'var(--risk-critical)' : 'var(--text-muted)' }}>●</span>
              {' '}row {e.data.row} · {(e.data.name || '').slice(0, 40)}
              {e.data.sanctioned ? <span style={{ color: 'var(--risk-critical)', marginLeft: 8 }}>sanctioned</span> : null}
              {e.data.pep ? <span style={{ color: 'var(--risk-medium)', marginLeft: 8 }}>PEP</span> : null}
              {e.data.entity_id ? <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{e.data.entity_id.slice(0, 12)}…</span> : null}
              {e.data.duration_ms != null ? <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{e.data.duration_ms}ms</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Resolved summary ────────────────────────────────────────────────────────

function ResolvedSummary({ runResult, uploadResponse, onContinue }) {
  const matchedSeeded = !!runResult?.matches_seeded;
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
