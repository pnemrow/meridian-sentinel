/* Surface 2 — Co-Pilot chat (streaming, grounded) §7
 * Tries live SSE from /agent/ask; falls back to COPILOT_SAMPLE_STREAM timer replay.
 */

// Backend base URL — override via window.SENTINEL_API_BASE if needed
const SENTINEL_API_BASE = (typeof window !== 'undefined' && window.SENTINEL_API_BASE) || 'http://localhost:8000';

// Normalize a backend SSE payload {event, data} → design event shape {type, data}
function normalizeBackendEvent(payload) {
  const { event, data } = payload;
  switch (event) {
    case 'token':
      return { type: 'token', data: { text: typeof data === 'string' ? data : (data?.text || '') } };
    case 'tool_call':
      return { type: 'tool_call', data: { id: data.id, name: data.name, args: data.input || data.args, started_at: 'live' } };
    default:
      return { type: event, data };
  }
}

function CoPilot({ onOpenEntity, onOpenCompare, initialState, runMode, runId = null, credentialStatus, openCredModal }) {
  // When LIVE freeform questions are submitted without an Anthropic key, show
  // an inline prompt instead of firing the SSE call (which would just error).
  // The 4 cached golden chips still work in CACHED mode — they bypass this
  // gate via the same ask() path; we only intercept LIVE submissions.
  const [needsAnthropic, setNeedsAnthropic] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState(initialState?.conversation || []);
  const [tools, setTools] = useState(initialState?.tools || []);
  const [citations, setCitations] = useState(initialState?.citations || {});
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef(null);
  const tracePaneRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
    if (tracePaneRef.current) tracePaneRef.current.scrollTop = tracePaneRef.current.scrollHeight;
  }, [conversation, tools]);

  // -------- Event handler --------
  function applyEvent(ev) {
    if (ev.type === 'token') {
      setConversation(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const segs = [...last.segments];
        const lastSeg = segs[segs.length - 1];
        if (lastSeg && lastSeg.type === 'text') {
          segs[segs.length - 1] = { ...lastSeg, text: lastSeg.text + ev.data.text };
        } else {
          segs.push({ type: 'text', text: ev.data.text });
        }
        return [...prev.slice(0, -1), { ...last, segments: segs }];
      });
    } else if (ev.type === 'citation') {
      // Tool-use IDs from Anthropic (e.g. toolu_018HBjryvzsY7C8sc6RBvmqX) are
      // 30+ char hex blobs. Map them to stable, sequential [1] [2] [3] … per
      // assistant turn so the inline markers are readable instead of opaque.
      setCitations(prev => {
        if (prev[ev.data.ref]) return prev;
        const displayRef = Object.values(prev).reduce((m, c) => Math.max(m, c.displayRef || 0), 0) + 1;
        return { ...prev, [ev.data.ref]: { ...ev.data, displayRef } };
      });
      setConversation(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, segments: [...last.segments, { type: 'cite', ref: ev.data.ref }] }];
      });
    } else if (ev.type === 'flag') {
      setConversation(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, segments: [...last.segments, { type: 'flag', reason: ev.data.reason, entity_id: ev.data.entity_id }] }];
      });
    } else if (ev.type === 'tool_call') {
      setTools(prev => [...prev, { call: ev.data, result: null, isRunning: true }]);
    } else if (ev.type === 'tool_result') {
      setTools(prev => prev.map(t => t.call.id === ev.data.id ? { ...t, result: ev.data, isRunning: false } : t));
    } else if (ev.type === 'answer_meta') {
      setConversation(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, meta: ev.data }];
      });
    } else if (ev.type === 'done') {
      setStreaming(false);
    }
  }

  // -------- Fixture-replay fallback (no backend) --------
  function replayFromStream() {
    const stream = window.COPILOT_SAMPLE_STREAM;
    let t = 0;
    const schedule = [];
    stream.forEach((ev) => {
      if (ev.type === 'tool_call') {
        schedule.push({ at: t, ev });
        t += 100;
      } else if (ev.type === 'tool_result') {
        schedule.push({ at: t + ev.data.duration_ms, ev });
        t += ev.data.duration_ms + 80;
      } else if (ev.type === 'token') {
        const words = ev.data.text.split(/(\s+)/);
        words.forEach(w => {
          schedule.push({ at: t, ev: { type: 'token', data: { text: w } } });
          t += 28;
        });
      } else if (ev.type === 'citation' || ev.type === 'flag') {
        schedule.push({ at: t, ev });
        t += 60;
      } else if (ev.type === 'answer_meta' || ev.type === 'done' || ev.type === 'error') {
        schedule.push({ at: t + 200, ev });
        t += 300;
      }
    });
    schedule.forEach(({ at, ev }) => setTimeout(() => applyEvent(ev), at));
  }

  // Whether this question is a cached golden chip (matched exactly) — those
  // never need an Anthropic key because /agent/ask in cached mode replays a
  // pre-captured event stream. Freeform questions in LIVE mode require one.
  const _isGoldenQuestion = (q) =>
    Array.isArray(window.COPILOT_GOLDEN_QUESTIONS)
    && window.COPILOT_GOLDEN_QUESTIONS.includes(q);

  // -------- Live SSE fetch → fallback to replay --------
  async function ask(q) {
    if (streaming) return;
    // LIVE + freeform + no anthropic key → intercept, surface inline prompt.
    const isLive = (runMode || 'CACHED').toUpperCase() === 'LIVE';
    if (isLive && !credentialStatus?.anthropic && !_isGoldenQuestion(q)) {
      setNeedsAnthropic(true);
      return;
    }
    setNeedsAnthropic(false);
    setConversation(prev => [...prev,
      { role: 'user', segments: [{ type: 'text', text: q }] },
      { role: 'assistant', segments: [] },
    ]);
    setTools([]);
    setCitations({});
    setStreaming(true);

    const mode = (runMode || 'CACHED').toLowerCase();
    try {
      // run_id scopes the agent's tools to a specific uploaded run when set.
      // When runId is null, the agent operates against the default list_1
      // cache, which is what CACHED golden runs were captured against.
      const body = { question: q, mode };
      if (runId) body.run_id = runId;
      const resp = await fetch(`${SENTINEL_API_BASE}/agent/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

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
            const ev = normalizeBackendEvent(payload);
            applyEvent(ev);
            if (ev.type === 'done') return;
          } catch (_) {}
        }
      }
      setStreaming(false);
    } catch (err) {
      console.warn('[copilot] backend unavailable, replaying fixture stream:', err.message);
      replayFromStream();
    }
  }

  // ---- collected source list (dedup by cache_file+entity_url) ----
  const dedupedSources = useMemo(() => {
    const seen = new Map();
    tools.forEach(t => {
      if (t.result?.source) {
        const k = `${t.result.source.entity_url || ''}|${t.result.source.cache_file || ''}`;
        if (!seen.has(k)) seen.set(k, t.result.source);
      }
    });
    Object.values(citations).forEach(c => {
      const k = `${c.source.entity_url || ''}|${c.source.cache_file || ''}`;
      if (!seen.has(k)) seen.set(k, c.source);
    });
    return Array.from(seen.values());
  }, [tools, citations]);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 420px',
      height: 'calc(100vh - 56px)', minHeight: 600,
    }}>
      {/* LEFT: Conversation */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-default)' }}>
        <div ref={messagesEndRef} style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {conversation.length === 0 ? (
            <EmptyState runMode={runMode} runId={runId} />
          ) : conversation.map((msg, i) => <MessageBubble key={i} msg={msg} citations={citations} onOpenEntity={onOpenEntity} onOpenCompare={onOpenCompare} />)}
          {streaming && conversation[conversation.length-1]?.role === 'assistant' && conversation[conversation.length-1].segments.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, fontStyle: 'italic' }}>thinking…</div>
          ) : null}
        </div>

        {/* Input */}
        <div style={{ padding: '16px 40px 24px', borderTop: '1px solid var(--border-subtle)' }}>
          {needsAnthropic ? (
            <div style={{
              background: 'rgba(201,169,97,0.06)',
              border: '1px solid var(--accent-dim)',
              borderRadius: 4, padding: '10px 14px', marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                LIVE freeform questions require an Anthropic API key. Add it to enable.
              </div>
              <button onClick={() => {
                if (typeof openCredModal === 'function') {
                  openCredModal('anthropic', () => setNeedsAnthropic(false));
                }
              }} style={{
                background: 'var(--accent)', color: '#0A1628', border: 0,
                padding: '6px 12px', borderRadius: 3, fontSize: 12, fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>Add key</button>
            </div>
          ) : null}
          <form onSubmit={(e) => { e.preventDefault(); if (question.trim()) { ask(question.trim()); setQuestion(''); } }}>
            <div style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              display: 'flex', alignItems: 'center',
              padding: '10px 14px',
            }}>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about this list…"
                style={{
                  flex: 1, background: 'transparent', border: 0, outline: 'none',
                  color: 'var(--text-primary)', fontSize: 14,
                }}
                disabled={streaming}
              />
              <button type="submit" disabled={streaming || !question.trim()} style={{
                background: streaming || !question.trim() ? 'var(--bg-elevated)' : 'var(--accent)',
                color: streaming || !question.trim() ? 'var(--text-muted)' : '#0A1628',
                border: 0, borderRadius: 4, padding: '6px 12px', fontWeight: 600,
              }}>↑</button>
            </div>
          </form>
          {/* Suggested */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <span className="mono muted" style={{ fontSize: 11, paddingTop: 5 }}>Suggested:</span>
            {window.COPILOT_GOLDEN_QUESTIONS.map(q => (
              <button key={q} onClick={() => ask(q)} disabled={streaming} style={{
                background: 'transparent',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
                padding: '4px 10px', borderRadius: 999, fontSize: 12,
                opacity: streaming ? 0.5 : 1,
              }}>▸ {truncate(q, 56)}</button>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: Shows-its-work pane */}
      <div style={{ background: 'var(--bg-terminal)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase' }}>Shows its work</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>live tool trace · {tools.length} call{tools.length === 1 ? '' : 's'}</div>
          </div>
          {streaming ? (
            <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
              <span className="pulse">● </span>streaming
            </span>
          ) : tools.length > 0 ? (
            <span className="mono" style={{ fontSize: 11, color: 'var(--risk-low)' }}>● done</span>
          ) : null}
        </div>

        <div ref={tracePaneRef} style={{ flex: 1, overflowY: 'auto' }}>
          {/* Tool trace */}
          {tools.length === 0 ? (
            <div className="muted" style={{ padding: '20px 16px', fontSize: 12, fontStyle: 'italic' }}>
              Tool calls will appear here when the co-pilot runs them.
            </div>
          ) : (
            tools.map(t => <ToolTraceRow key={t.call.id} call={t.call} result={t.result} isRunning={t.isRunning} />)
          )}

          {/* Sources */}
          {dedupedSources.length > 0 ? (
            <div>
              <div style={{ padding: '14px 16px 6px', borderTop: '1px solid var(--border-default)', marginTop: 6 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase' }}>
                  Sources ({dedupedSources.length})
                </div>
              </div>
              {dedupedSources.map((s, i) => (
                <div key={i} className="fadein" style={{
                  padding: '8px 16px',
                  borderTop: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--text-terminal)',
                }}>
                  {s.entity_url ? <div><a href={s.entity_url} style={{ color: 'var(--accent)' }}>{s.entity_url}</a></div> : null}
                  {s.cache_file ? <div style={{ color: 'var(--text-muted)' }}>{s.cache_file}</div> : null}
                  {s.api_endpoint ? <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.api_endpoint}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// -------- Empty state --------
function EmptyState({ runMode, runId }) {
  // Derive run-context line from the real summary + active investigation,
  // not a hardcoded "list_1 · 49 entities". Falls back to "Ask anything about
  // this run." when neither is loaded yet.
  const summary = window.RUN_SUMMARY && window.RUN_SUMMARY.data;
  const list = window.INVESTIGATIONS || [];
  const inv = runId
    ? list.find(i => String(i.id) === String(runId))
    : (list.find(i => i.hero) || list[0]);

  const runLabel = inv?.name || inv?.list_ref || (runId ? 'uploaded list' : 'list_1');
  const total    = inv?.counts?.total ?? summary?.total_input;
  const resolved = inv?.counts?.total ?? summary?.resolved;
  const mode     = (runMode || 'CACHED').toUpperCase();

  const pillParts = [mode, runLabel];
  if (resolved != null && total != null) pillParts.push(`${resolved} of ${total} resolved`);

  return (
    <div style={{ paddingTop: 60 }}>
      <div className="serif" style={{ fontSize: 36, lineHeight: 1.2, color: 'var(--text-primary)', maxWidth: 600, marginBottom: 16 }}>
        Ask anything about this run.
      </div>
      <div className="muted" style={{ fontSize: 15, maxWidth: 540, marginBottom: 24, lineHeight: 1.55 }}>
        Free-text questions over your screening run. Every answer cites its sources, shows the tool
        calls it made, and flags anything uncertain. Try a suggested question below, or ask your own.
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 2 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--text-muted)' }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.6 }}>
          {pillParts.join(' · ')}
        </span>
      </div>
    </div>
  );
}

// -------- Message bubble --------
function MessageBubble({ msg, citations, onOpenEntity, onOpenCompare }) {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 6, padding: '12px 16px',
          maxWidth: 600,
          fontSize: 14, lineHeight: 1.55,
        }}>{msg.segments[0]?.text}</div>
      </div>
    );
  }
  // Assistant
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{
        width: 32, height: 32, borderRadius: 4,
        background: 'rgba(201,169,97,0.1)',
        border: '1px solid var(--accent-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', fontFamily: 'var(--font-mono)', flexShrink: 0,
      }}>🛡</div>
      <div style={{ maxWidth: 700, fontSize: 14, lineHeight: 1.65 }}>
        <AssistantSegments segments={msg.segments} citations={citations} />
        {msg.meta ? <AnswerFooter meta={msg.meta} /> : null}
        {msg.meta ? <AnswerActions onOpenEntity={onOpenEntity} onOpenCompare={onOpenCompare} /> : null}
      </div>
    </div>
  );
}

// Inline action chips that hand off the analyst into the payoff (the destination).
// In Pass 2 the entity-specific "→ Open ownership graph (Belorusskaya)" chip
// was removed — it hardcoded one entity_id regardless of which run was active
// or what the answer was about. The reconciliation handoff is the one chip
// that's always honest: every answer is about the current run's compare.
function AnswerActions({ onOpenCompare }) {
  return (
    <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={onOpenCompare} style={{
        background: 'var(--accent)', color: '#0A1628',
        border: '1px solid var(--accent)',
        padding: '6px 12px', borderRadius: 4, fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>→ See the reconciliation</button>
    </div>
  );
}

function AssistantSegments({ segments, citations }) {
  // white-space: pre-wrap preserves the newlines + double-newlines + ---
  // separators the model emits, so the answer reads as paragraphs and lists
  // instead of one wall of text. (Babel-standalone can't easily ship a
  // markdown parser; this is the cheapest readability win.)
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {segments.map((s, i) => {
        if (s.type === 'text') return <span key={i}>{s.text}</span>;
        if (s.type === 'cite') {
          const c = citations[s.ref];
          // Always prefer the sequential displayRef; the raw toolu_xxx id is
          // never shown to the user.
          const ref = c?.displayRef;
          if (!c || ref == null) return null;
          return (
            <CitedValue key={i} source={c.source} refNum={ref}>
              <span style={{ display: 'none' }} />
            </CitedValue>
          );
        }
        if (s.type === 'flag') {
          return <span key={i} style={{ marginLeft: 4 }}><ConfidenceFlag reason={s.reason} inline /></span>;
        }
        return null;
      })}
      {segments.length > 0 && segments[segments.length - 1].type !== 'flag' ? <span className="caret" /> : null}
    </span>
  );
}

function AnswerFooter({ meta }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 14, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
      <span>confidence: <span style={{ color: meta.confidence === 'high' ? 'var(--risk-low)' : 'var(--risk-medium)' }}>{meta.confidence}</span></span>
      <span>·</span>
      <span>{meta.sources_count} sources</span>
      <span>·</span>
      <span>{meta.tools_used.length} tools</span>
    </div>
  );
}

Object.assign(window, { CoPilot });
