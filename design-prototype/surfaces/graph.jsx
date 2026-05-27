/* Surface 4 — Ownership force-graph component
 * Default state: collapsed to the gap (root + sanctioned owners). Expandable.
 * SVG-based; hand-positioned for control. Hover edges/nodes for detail.
 */

function OwnershipGraph({ entityId, onOpenEntity }) {
  const graph = window.GRAPH_BELORUSSKAYA;
  const { nodes: baseNodes, edges: baseEdges, explored_count, shown, next, sanction_hits } = graph.data;

  const [expanded, setExpanded] = useState(false);
  const [filterSanctionedOnly, setFilterSanctionedOnly] = useState(false);
  const [hoverEdge, setHoverEdge] = useState(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [focusNode, setFocusNode] = useState(null);

  // Deterministic positions for the marquee graph
  const POS = {
    "BSsUPVlxsICOW4GCjb4fqQ":     { x: 480, y: 320 }, // root (center)
    "6lxsLluBad0ijzroLtLqTg":     { x: 720, y: 150 }, // Kerimov (current — top-right)
    "o6TuHzcOzX2jcRRIP9MQ3g":     { x: 760, y: 360 }, // Skurov
    "gGRzPXe6TBs4vdzSh6HFng":     { x: 700, y: 510 }, // Prokhorov
    "j7QjfVQ_BRp8srxl1eVTIQ":     { x: 220, y: 480 }, // Mutsoev
    "dn2EQBF260mfXVpfJKNfhw":     { x: 240, y: 200 }, // Metafrax
    // expanded
    "blk_belaruskali_xxxxxxxQ":   { x: 480, y: 80  },
    "blr_minpotash_xxxxxxxxxxQ":  { x: 480, y: -40 },
    "ru_uralkali_xxxxxxxxxxxQ":   { x: 120, y: 100 },
    "cy_potashco_holding_xxxQ":   { x: 840, y: 230 },
    "cy_belintershop_xxxxxxxQ":   { x: 360, y: 560 },
    "che_bpcfin_xxxxxxxxxxxxQ":   { x: 600, y: 580 },
    "kerimov_holding_grp_xxxQ":   { x: 880, y: 60  },
    "rt01RTCxxxxxxxxxxxxxxxxxQ":  { x: 100, y: 320 },
    "ua01UACxxxxxxxxxxxxxxxxxQ":  { x: -10, y: 230 },
    "ru_lukoil_xxxxxxxxxxxxxQ":   { x: 60,  y: 600 },
  };

  const allNodes = useMemo(() => {
    return expanded ? [...baseNodes, ...window.GRAPH_BELORUSSKAYA_EXPANDED_NODES] : baseNodes;
  }, [expanded, baseNodes]);
  const allEdges = useMemo(() => {
    return expanded ? [...baseEdges, ...window.GRAPH_BELORUSSKAYA_EXPANDED_EDGES] : baseEdges;
  }, [expanded, baseEdges]);

  const visibleNodes = useMemo(() => {
    if (!filterSanctionedOnly) return allNodes;
    const sancIds = new Set(allNodes.filter(n => n.sanctioned).map(n => n.id));
    // include root + all sanctioned-path nodes (and any node on the direct path)
    sancIds.add(entityId);
    return allNodes.filter(n => sancIds.has(n.id));
  }, [allNodes, filterSanctionedOnly, entityId]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => allEdges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
    [allEdges, visibleNodeIds]
  );

  // viewBox stretches when expanded
  const viewBox = expanded ? "-80 -80 1000 740" : "100 30 700 580";

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      minHeight: 720,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Ownership network
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
            {expanded ? 'Full network' : 'Collapsed to the sanctioned-ownership path'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ToggleBtn active={filterSanctionedOnly} onClick={() => setFilterSanctionedOnly(v => !v)}>only sanctioned paths</ToggleBtn>
          <ToggleBtn active={expanded} onClick={() => setExpanded(v => !v)} primary>
            {expanded ? 'collapse to gap' : 'expand to full network'}
          </ToggleBtn>
        </div>
      </div>

      {/* Partial-network banner */}
      <div style={{
        padding: '10px 18px',
        background: 'rgba(210,153,34,0.06)',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 12,
        color: 'var(--risk-medium)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>⚠</span>
        <span>
          partial network — showing <span className="mono">{shown}</span> of <span className="mono">{explored_count.toLocaleString()}</span> paths
        </span>
        <button style={{
          marginLeft: 'auto',
          background: 'transparent', color: 'var(--text-secondary)',
          border: '1px solid var(--border-default)', padding: '4px 10px', borderRadius: 2, fontSize: 11,
        }}>load more</button>
      </div>

      {/* Graph SVG */}
      <div style={{ flex: 1, position: 'relative', background: 'radial-gradient(ellipse at center, #0E1B30 0%, var(--bg-surface) 100%)', minHeight: 480 }}>
        <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
          {/* faint grid */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#152339" strokeWidth="0.5" />
            </pattern>
            <radialGradient id="sancHalo" cx="50%" cy="50%" r="50%">
              <stop offset="60%" stopColor="rgba(248,81,73,0)" />
              <stop offset="100%" stopColor="rgba(248,81,73,0.5)" />
            </radialGradient>
            <radialGradient id="pepRing" cx="50%" cy="50%" r="50%">
              <stop offset="70%" stopColor="rgba(210,153,34,0)" />
              <stop offset="100%" stopColor="rgba(210,153,34,0.45)" />
            </radialGradient>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" />
            </marker>
            <marker id="arrowGold" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#C9A961" />
            </marker>
            <marker id="arrowRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#F85149" />
            </marker>
          </defs>
          <rect x="-200" y="-200" width="1400" height="1100" fill="url(#grid)" opacity="0.5" />

          {/* edges */}
          {visibleEdges.map((e, i) => {
            const a = POS[e.source]; const b = POS[e.target];
            if (!a || !b) return null;
            const sourceNode = allNodes.find(n => n.id === e.source);
            const targetNode = allNodes.find(n => n.id === e.target);
            const isSanctionPath = sourceNode?.sanctioned && targetNode?.id === entityId;
            const isFormer = e.former;
            const isHover = hoverEdge === i;
            const color = isSanctionPath ? 'var(--risk-critical)' : (e.relationship === 'controls' || e.relationship === 'controlled_by' ? 'var(--accent)' : 'var(--text-secondary)');
            const marker = isSanctionPath ? 'url(#arrowRed)' : (color === 'var(--accent)' ? 'url(#arrowGold)' : 'url(#arrow)');
            const dx = b.x - a.x, dy = b.y - a.y;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            // gentle curve
            const curve = Math.min(40, Math.hypot(dx, dy) / 6);
            const nx = -dy / Math.hypot(dx, dy) * curve;
            const ny =  dx / Math.hypot(dx, dy) * curve;
            const cx2 = mid.x + nx, cy2 = mid.y + ny;
            // shorten endpoints so the arrow head doesn't overlap the node
            const offset = 26;
            const len = Math.hypot(dx, dy);
            const ux = dx / len, uy = dy / len;
            const ax = a.x + ux * offset, ay = a.y + uy * offset;
            const bx = b.x - ux * offset, by = b.y - uy * offset;
            const d = `M ${ax} ${ay} Q ${cx2} ${cy2} ${bx} ${by}`;
            return (
              <g key={i} onMouseEnter={() => setHoverEdge(i)} onMouseLeave={() => setHoverEdge(null)}>
                <path d={d}
                  fill="none"
                  stroke={color}
                  strokeOpacity={isFormer ? 0.5 : (isHover ? 1 : 0.85)}
                  strokeWidth={isHover ? 2.5 : (isSanctionPath ? 1.8 : 1.4)}
                  strokeDasharray={isFormer ? "5 4" : null}
                  markerEnd={marker}
                />
                {/* edge label on hover */}
                {isHover ? (
                  <g transform={`translate(${cx2 + 6}, ${cy2 - 6})`}>
                    <rect x="0" y="-14" width={140} height={isFormer ? 42 : 30} fill="#243149" stroke="#2A3854" rx="3" />
                    <text x="8" y="0" fill="#F0F4F8" fontFamily="JetBrains Mono, monospace" fontSize="11">
                      {e.relationship}
                    </text>
                    <text x="8" y="14" fill="#94A3B8" fontFamily="JetBrains Mono, monospace" fontSize="10">
                      {e.percentage != null ? `${e.percentage}%` : '—'} · {e.last_observed}
                    </text>
                    {isFormer ? (
                      <text x="8" y="28" fill="#D29922" fontFamily="JetBrains Mono, monospace" fontSize="10">⚠ FORMER</text>
                    ) : null}
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* nodes */}
          {visibleNodes.map((n, i) => {
            const p = POS[n.id];
            if (!p) return null;
            const isRoot = n.id === entityId;
            const isHover = hoverNode === n.id || focusNode === n.id;
            const r = isRoot ? 22 : (n.sanctioned ? 16 : 14);
            return (
              <g key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                onMouseEnter={() => setHoverNode(n.id)}
                onMouseLeave={() => setHoverNode(null)}
                onClick={() => { if (!isRoot && n.country) setFocusNode(focusNode === n.id ? null : n.id); }}
                style={{ cursor: isRoot ? 'default' : 'pointer' }}
              >
                {/* halo */}
                {n.sanctioned ? <circle r={r + 14} fill="url(#sancHalo)" /> : null}
                {n.pep && !n.sanctioned ? <circle r={r + 12} fill="url(#pepRing)" /> : null}
                {/* outer ring */}
                {isRoot ? <circle r={r + 6} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 3" /> : null}
                {/* node body */}
                <circle r={r}
                  fill={isRoot ? 'var(--bg-elevated)' : (n.type === 'person' ? '#1F2A40' : 'var(--bg-elevated)')}
                  stroke={n.sanctioned ? 'var(--risk-critical)' : (n.pep ? 'var(--risk-medium)' : 'var(--border-default)')}
                  strokeWidth={n.sanctioned ? 2 : 1.2}
                />
                {/* glyph */}
                <text textAnchor="middle" dy="4" fill={n.sanctioned ? 'var(--risk-critical)' : (n.pep ? 'var(--risk-medium)' : 'var(--text-secondary)')} fontFamily="JetBrains Mono, monospace" fontSize={isRoot ? 16 : 13}>
                  {n.type === 'person' ? '◆' : '■'}
                </text>
                {/* label */}
                <g transform={`translate(0, ${r + 18})`}>
                  <text textAnchor="middle" fill={isRoot ? 'var(--accent)' : 'var(--text-primary)'} fontSize={isRoot ? 13 : 12} fontWeight={isRoot ? 600 : 500} fontFamily="Inter, sans-serif">
                    {truncate(n.label, 24)}
                  </text>
                  {isHover || isRoot ? (
                    <text textAnchor="middle" y="14" fill="var(--text-muted)" fontFamily="JetBrains Mono, monospace" fontSize="10">
                      {n.id.slice(0,12)}… · {n.country || '—'}
                    </text>
                  ) : null}
                </g>
                {/* root flag */}
                {isRoot ? (
                  <g transform="translate(0, -38)">
                    <rect x="-22" y="-9" width="44" height="16" rx="2" fill="var(--accent)" />
                    <text textAnchor="middle" y="3" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#0A1628" fontWeight="700" letterSpacing="0.8">ROOT</text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>

        {/* Focus card overlay */}
        {focusNode ? <NodeFocusCard
          node={allNodes.find(n => n.id === focusNode)}
          edges={allEdges.filter(e => e.source === focusNode || e.target === focusNode)}
          onClose={() => setFocusNode(null)}
          onOpenEntity={onOpenEntity}
        /> : null}
      </div>

      {/* Footer: legend + sanction-hits */}
      <div style={{
        padding: '14px 18px',
        borderTop: '1px solid var(--border-subtle)',
        display: 'grid',
        gridTemplateColumns: '1.2fr 1.6fr',
        gap: 20,
      }}>
        <div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Legend</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
            <LegendDot color="var(--risk-critical)" label="sanctioned" halo />
            <LegendDot color="var(--risk-medium)" label="PEP" />
            <LegendDot color="var(--border-default)" label="other" />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#94A3B8" strokeDasharray="3 3" strokeWidth="1.4" /></svg>
              former stake
            </div>
          </div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Sanction hits ({sanction_hits.length})
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sanction_hits.map(h => (
              <span key={h.id} onClick={() => setFocusNode(h.id)} className="clickable" style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 8px', border: '1px solid rgba(248,81,73,0.35)',
                background: 'rgba(248,81,73,0.08)', borderRadius: 2,
                fontSize: 11, color: 'var(--text-primary)',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--risk-critical)' }} />
                {truncate(h.label, 28)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleBtn({ children, active, onClick, primary }) {
  return (
    <button onClick={onClick} style={{
      background: active ? (primary ? 'var(--accent)' : 'rgba(201,169,97,0.1)') : 'transparent',
      color: active && primary ? '#0A1628' : (active ? 'var(--accent)' : 'var(--text-secondary)'),
      border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border-default)'}`,
      padding: '6px 12px', borderRadius: 4, fontSize: 12,
      fontWeight: primary ? 600 : 400,
    }}>{children}</button>
  );
}

function LegendDot({ color, label, halo }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 999,
        background: 'var(--bg-elevated)',
        border: `1.5px solid ${color}`,
        boxShadow: halo ? `0 0 0 3px ${color}33` : 'none',
        display: 'inline-block',
      }} />
      {label}
    </div>
  );
}

// Focus card for a node — quick details + jump to that entity
function NodeFocusCard({ node, edges, onClose, onOpenEntity }) {
  if (!node) return null;
  return (
    <div style={{
      position: 'absolute', right: 16, top: 16,
      width: 280,
      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 6,
      padding: 14, fontSize: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{node.label}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {node.id.slice(0,16)}… · {node.country}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 0, color: 'var(--text-muted)', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {node.sanctioned ? <FlagChip color="critical" label="sanctioned" /> : null}
        {node.pep ? <FlagChip color="medium" label="PEP" /> : null}
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>
        Relationships ({edges.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {edges.slice(0, 6).map((e, i) => (
          <div key={i} className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ color: e.former ? 'var(--risk-medium)' : 'var(--accent)' }}>{e.relationship}</span>
            {e.percentage != null ? <span> · {e.percentage}%</span> : null}
            {e.former ? <span style={{ color: 'var(--risk-medium)' }}> · former</span> : null}
          </div>
        ))}
      </div>
      <button style={{
        background: 'var(--accent)', color: '#0A1628', border: 0,
        padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600, width: '100%',
      }} onClick={() => onOpenEntity && onOpenEntity(node.id)}>
        Open entity →
      </button>
    </div>
  );
}

Object.assign(window, { OwnershipGraph });
