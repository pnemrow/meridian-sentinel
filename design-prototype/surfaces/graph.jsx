/* Surface 4 — Ownership force-graph component
 * Default view: GAP-COLLAPSED to sanctioned-only at depth=1.
 * - Risk filter is a tri-state: "sanctioned" | "sanctioned_pep" | "all".
 * - Depth selector: 1 / 2 / 3 (default 1) — client-side BFS from root.
 * - Search box highlights matching nodes (does not exclude).
 * - Label discipline: only sanctioned / PEP / root get a visible label;
 *   other nodes render as small dots with a hover <title> tooltip.
 * - In "All paths" mode, direct non-risk owners cluster into one chip node
 *   ("+N owners with no sanctions exposure") instead of N labelled nodes.
 * - Belorusskaya's hand-laid coordinates are preserved.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

// Strip combining diacritics (handles Latin accents); leaves Cyrillic, Arabic,
// etc. untouched — for those we fall through to node.label and rely on the
// dot-with-tooltip rendering when the label isn't easily readable. A real
// unidecode would require shipping a lookup table; that's overkill here.
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036F]', 'g');
function latinize(s) {
  return (s || '').normalize('NFKD').replace(COMBINING_DIACRITICS, '');
}

function pickDisplayLabel(node) {
  // Prefer node.translated_label, then unidecode-ish node.label, then raw label.
  // (Backend currently surfaces only `label`; the chain is future-proof.)
  return node.translated_label || latinize(node.label) || node.label || node.id?.slice(0, 12) || '';
}

function truncateLabel(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// BFS depth from root over the undirected edge graph.
function computeNodeDepths(nodes, edges, rootId) {
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source).push(e.target);
    if (adj.has(e.target)) adj.get(e.target).push(e.source);
  }
  const depths = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    const d = depths.get(id);
    for (const nb of (adj.get(id) || [])) {
      if (!depths.has(nb)) {
        depths.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return depths;
}

// Auto-fit default depth. Pick the smallest N ∈ {1,2,3} such that:
//   (i)  every sanctioned-OR-PEP node reachable anywhere in the cached
//        traversal sits at depth ≤ N, OR
//   (ii) bumping further would push the visible (sanctioned-only) node
//        count over a 25-node readability envelope.
// Applied once per entity at mount; the analyst overrides via the 1/2/3
// selector. Generic — no per-entity hardcoding.
const AUTOFIT_MAX_VISIBLE = 25;
function computeAutoFitDepth(nodes, edges, rootId) {
  if (!nodes || !nodes.length) return 1;
  const depths = computeNodeDepths(nodes, edges, rootId);
  const riskIds = nodes.filter(n => n.sanctioned || n.pep).map(n => n.id);

  // Visible-at-N count under the *default* risk filter (sanctioned-only):
  // root is always included; everything else must be sanctioned AND in depth.
  const visibleCount = (N) => {
    let c = 0;
    for (const n of nodes) {
      const d = depths.get(n.id);
      if (d == null || d > N) continue;
      if (n.id === rootId || n.sanctioned) c++;
    }
    return c;
  };

  // Are all sanctioned/PEP nodes (across the entire cache) reachable at depth ≤ N?
  const allRiskCovered = (N) => riskIds.every(id => {
    const d = depths.get(id);
    return d != null && d <= N;
  });

  let N = 1;
  while (N < 3) {
    if (allRiskCovered(N)) break;          // (i) all risk surfaced — don't bump
    if (visibleCount(N + 1) > AUTOFIT_MAX_VISIBLE) break;  // (ii) would exceed envelope
    N += 1;
  }
  return N;
}

// ── Main component ────────────────────────────────────────────────────────

const CLUSTER_ID = '__cluster_non_risk_owners';

// Collision radii — tuned to clear the existing label/halo footprints so the
// force layout doesn't overlap a sanctioned node's red halo with a neighbour's
// label, and gives the +N cluster pill (180×36) enough horizontal room.
function collisionRadius(n, rootId) {
  if (n._isCluster)     return 110;
  if (n.id === rootId)  return 56;
  if (n.sanctioned)     return 50;
  if (n.pep)            return 42;
  // Unlabeled "other" nodes render as small dots — keep their collision
  // small so the dot constellation stays dense and readable.
  return 18;
}

// Belorusskaya hand-laid initial seeds — passed to the force simulation as
// starting positions, NOT pinned. The sim refines from here, removing any
// overlap while preserving the broad spatial story (Kerimov upper-right,
// historic owners ringing the root).
const BELORUSSKAYA_SEEDS = {
  "BSsUPVlxsICOW4GCjb4fqQ":     { x: 480, y: 320 },
  "6lxsLluBad0ijzroLtLqTg":     { x: 720, y: 150 },
  "o6TuHzcOzX2jcRRIP9MQ3g":     { x: 760, y: 360 },
  "gGRzPXe6TBs4vdzSh6HFng":     { x: 700, y: 510 },
  "j7QjfVQ_BRp8srxl1eVTIQ":     { x: 220, y: 480 },
  "dn2EQBF260mfXVpfJKNfhw":     { x: 240, y: 200 },
  [CLUSTER_ID]:                 { x: 250, y: 580 },
};

function OwnershipGraph({ entityId, onOpenEntity, graphData, trail, currentLabel }) {
  // graphData must be supplied by the caller (LiveGraphFetcher in entity.jsx).
  // We no longer fall back to a window.GRAPH_BELORUSSKAYA fixture — that masked
  // missing real data and risked rendering Belorusskaya's network for every entity.
  const graph = graphData;
  if (!graph || !graph.data) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
        No graph data supplied to OwnershipGraph (this component requires a graphData prop from a real backend fetch).
      </div>
    );
  }
  const isMarquee = graph.data.root_entity_id === "BSsUPVlxsICOW4GCjb4fqQ";
  const { nodes: baseNodes, edges: baseEdges, explored_count, shown, sanction_hits } = graph.data;

  // ── State ────────────────────────────────────────────────────────────────
  // Default: gap-collapsed. Sanctioned-only filter; depth is auto-fit per
  // entity on first render (see computeAutoFitDepth above).
  const rootId = graph.data.root_entity_id;
  const [riskFilter, setRiskFilter] = useState('sanctioned');  // 'sanctioned' | 'sanctioned_pep' | 'all'
  const [depth, setDepth] = useState(() => computeAutoFitDepth(baseNodes, baseEdges, rootId));
  const [nameQuery, setNameQuery] = useState('');
  const [hoverEdge, setHoverEdge] = useState(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [focusNode, setFocusNode] = useState(null);

  // Re-run auto-fit when the entity changes (e.g. user opens a different
  // detail page and OwnershipGraph re-renders with a new graphData). The
  // analyst's prior manual override on a different entity doesn't carry over.
  useEffect(() => {
    setDepth(computeAutoFitDepth(baseNodes, baseEdges, rootId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId]);

  // ── BFS depth map (memoized — depends only on the data) ──────────────────
  const depthMap = useMemo(
    () => computeNodeDepths(baseNodes, baseEdges, rootId),
    [baseNodes, baseEdges, rootId]
  );

  // ── Risk-passes test ─────────────────────────────────────────────────────
  const nodePassesRisk = (n) => {
    if (riskFilter === 'sanctioned')      return n.sanctioned;
    if (riskFilter === 'sanctioned_pep')  return n.sanctioned || n.pep;
    return true; // 'all'
  };

  // ── Cluster: direct non-risk owners (only in 'all' mode) ─────────────────
  // Identify the set of direct-owner node ids that are NOT sanctioned and NOT
  // pep. In "All paths" mode we replace those individual nodes with a single
  // grouped chip — they otherwise dominate the layout with little signal.
  const clusteredOwnerIds = useMemo(() => {
    if (riskFilter !== 'all') return new Set();
    const set = new Set();
    for (const e of baseEdges) {
      if (e.target !== entityId) continue;
      const src = baseNodes.find(n => n.id === e.source);
      if (src && !src.sanctioned && !src.pep) set.add(e.source);
    }
    return set;
  }, [riskFilter, baseNodes, baseEdges, entityId]);

  const clusterCount = clusteredOwnerIds.size;
  const clusterNode = clusterCount > 0 ? {
    id: CLUSTER_ID,
    label: `+${clusterCount} owners with no sanctions exposure`,
    type: 'cluster',
    sanctioned: false,
    pep: false,
    _isCluster: true,
    _count: clusterCount,
  } : null;

  // ── Visible set: depth → risk → cluster substitution ─────────────────────
  // Root is always included. Cluster (if any) is always included in 'all'.
  const visibleNodes = useMemo(() => {
    const out = [];
    for (const n of baseNodes) {
      if (clusteredOwnerIds.has(n.id)) continue;        // cluster swallows them
      const d = depthMap.get(n.id);
      if (d == null || d > depth) continue;             // depth filter
      if (n.id === entityId || nodePassesRisk(n)) {
        out.push(n);
      }
    }
    if (clusterNode) out.push(clusterNode);
    return out;
  }, [baseNodes, depthMap, depth, riskFilter, clusteredOwnerIds, entityId, clusterNode]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  // ── Visible edges ────────────────────────────────────────────────────────
  // Real edges first; then synthesize one edge per cluster from cluster → root.
  // Direct edges from clustered owners → root are *replaced* by the cluster's
  // single edge (so we don't render N flat edges into one chip).
  const visibleEdges = useMemo(() => {
    const out = [];
    for (const e of baseEdges) {
      if (clusteredOwnerIds.has(e.source)) continue;    // suppressed; cluster replaces
      if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) continue;
      out.push(e);
    }
    if (clusterNode) {
      out.push({
        source: CLUSTER_ID,
        target: entityId,
        relationship: 'has_shareholders',
        percentage: null,
        former: false,
        last_observed: null,
        _isCluster: true,
      });
    }
    return out;
  }, [baseEdges, visibleNodeIds, clusteredOwnerIds, clusterNode, entityId]);

  // ── Name-search highlight set (does NOT exclude — only highlights) ───────
  const searchMatchIds = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set();
    for (const n of visibleNodes) {
      const disp = pickDisplayLabel(n).toLowerCase();
      const raw = (n.label || '').toLowerCase();
      const id = (n.id || '').toLowerCase();
      if (disp.includes(q) || raw.includes(q) || id.includes(q)) matches.add(n.id);
    }
    return matches;
  }, [nameQuery, visibleNodes]);

  // ── Position map ─────────────────────────────────────────────────────────
  // Belorusskaya keeps its hand-laid coordinates verbatim. Other entities use
  // an owner/sub arc layout against `baseEdges`; the cluster (if any) takes
  // one slot on the owners arc.
  // ── d3-force layout (replaces the old hand-laid POS map) ────────────────────
  // Positions are mutable state outside React's normal reconciliation — d3's
  // tick callback writes into positionsRef and we force re-renders via setTick.
  // viewBox is React state so we can auto-fit it as the simulation cools.
  const positionsRef = useRef({});
  const simRef       = useRef(null);
  const svgRef       = useRef(null);
  const zoomGroupRef = useRef(null);
  const zoomRef      = useRef(null);
  const [tick, setTick] = useState(0);
  const [viewBox, setViewBox] = useState("100 30 700 580");
  // Skip silently when d3 hasn't loaded (shouldn't happen in production but
  // makes hot-reload + SSR tolerant).
  const d3Ready = typeof window !== 'undefined' && !!window.d3;

  // Auto-fit current positions into the viewBox with 80px padding. Called
  // after the warmup ticks finish and when the user clicks Reset Layout —
  // NOT on every per-tick re-render (otherwise the camera would chase the
  // simulation and feel motion-sick).
  const autoFitViewBox = () => {
    const positions = Object.values(positionsRef.current);
    if (positions.length === 0) return;
    const xs = positions.map(p => p.x);
    const ys = positions.map(p => p.y);
    const minX = Math.min(...xs) - 80;
    const maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 80;
    const maxY = Math.max(...ys) + 80;
    setViewBox(`${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`);
  };

  // Build the simulation whenever the visible set changes. We re-use prior
  // positions for nodes that survived a filter/depth flip so the layout
  // doesn't jolt; new nodes seed from Belorusskaya's hand-laid coordinates
  // (if applicable) or from a jittered ring around the viewport center.
  useEffect(() => {
    if (!d3Ready || !visibleNodes.length) return;
    const d3 = window.d3;
    const centerX = 480, centerY = 320;
    const ringRadius = 220;
    const rootId = entityId;

    const simNodes = visibleNodes.map((n, i) => {
      const prior = positionsRef.current[n.id];
      const marqueeSeed = isMarquee ? BELORUSSKAYA_SEEDS[n.id] : null;
      let x, y;
      if (n.id === rootId) {
        x = prior?.x ?? centerX;
        y = prior?.y ?? centerY;
      } else if (prior) {
        x = prior.x; y = prior.y;
      } else if (marqueeSeed) {
        x = marqueeSeed.x; y = marqueeSeed.y;
      } else {
        const angle = (i / visibleNodes.length) * Math.PI * 2;
        x = centerX + Math.cos(angle) * ringRadius + (Math.random() - 0.5) * 60;
        y = centerY + Math.sin(angle) * ringRadius + (Math.random() - 0.5) * 60;
      }
      return { ...n, x, y };
    });
    const simEdges = visibleEdges.map(e => ({ source: e.source, target: e.target }));

    // Stop the prior sim cleanly to avoid leaking ticks (would burn CPU).
    if (simRef.current) {
      simRef.current.stop();
      simRef.current.on('tick', null);
    }
    const sim = d3.forceSimulation(simNodes)
      .force('charge', d3.forceManyBody().strength(-450))
      .force('link', d3.forceLink(simEdges).id(d => d.id).distance(180).strength(0.6))
      .force('collide', d3.forceCollide().radius(d => collisionRadius(d, rootId)).strength(1).iterations(2))
      .force('x', d3.forceX(centerX).strength(0.04))
      .force('y', d3.forceY(centerY).strength(0.04))
      .stop();
    simRef.current = sim;

    // Warmup synchronously so first paint already has a settled layout.
    for (let i = 0; i < 300; i++) sim.tick();
    sim.nodes().forEach(n => { positionsRef.current[n.id] = { x: n.x, y: n.y }; });
    autoFitViewBox();

    // Re-heat ticking is needed for drag re-settling — keep alphaTarget=0
    // so the sim stays quiescent until a drag bumps it.
    sim.alphaTarget(0).restart();
    sim.on('tick', () => {
      sim.nodes().forEach(n => { positionsRef.current[n.id] = { x: n.x, y: n.y }; });
      setTick(t => t + 1);
    });
    setTick(t => t + 1);

    return () => {
      sim.stop();
      sim.on('tick', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes, visibleEdges, entityId, isMarquee, d3Ready]);

  // Zoom — wired once on mount. The filter lets drag take precedence on nodes
  // so click-dragging a node doesn't also pan the canvas.
  useEffect(() => {
    if (!d3Ready || !svgRef.current) return;
    const d3 = window.d3;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.3, 4])
      .filter((event) => {
        const t = event.target;
        if (t && t.closest && t.closest('[data-graph-node]')) return false;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        if (zoomGroupRef.current) {
          d3.select(zoomGroupRef.current).attr('transform', event.transform);
        }
      });
    svg.call(zoom);
    zoomRef.current = zoom;
    return () => { svg.on('.zoom', null); };
  }, [d3Ready]);

  // Drag — re-attach when the visible set changes (new node groups appear).
  // We look up sim nodes by data-node-id rather than relying on d3's data
  // binding (which is awkward against React-managed children).
  useEffect(() => {
    if (!d3Ready || !zoomGroupRef.current || !simRef.current) return;
    const d3 = window.d3;
    // event.x / event.y come from d3.drag in the SVG's local coord system,
    // NOT the zoom-group's post-transform space. Since the simulation lives
    // in the zoom group's pre-transform space, invert the current zoom to
    // get the simulation coords the node should pin to.
    const toSimCoords = (event) => {
      const t = (svgRef.current && d3.zoomTransform(svgRef.current)) || { x: 0, y: 0, k: 1 };
      return { x: (event.x - t.x) / t.k, y: (event.y - t.y) / t.k };
    };

    const drag = d3.drag()
      .on('start', function(event) {
        const id = this.getAttribute('data-node-id');
        const node = simRef.current?.nodes().find(n => n.id === id);
        if (!node) return;
        if (!event.active) simRef.current.alphaTarget(0.3).restart();
        node.fx = node.x; node.fy = node.y;
      })
      .on('drag', function(event) {
        const id = this.getAttribute('data-node-id');
        const node = simRef.current?.nodes().find(n => n.id === id);
        if (!node) return;
        const { x, y } = toSimCoords(event);
        node.fx = x; node.fy = y;
      })
      .on('end', function(event) {
        if (!event.active) simRef.current?.alphaTarget(0);
        // INTENTIONALLY do NOT clear fx/fy — user pinning persists.
      });
    const sel = d3.select(zoomGroupRef.current).selectAll('[data-graph-node]');
    sel.call(drag);
    return () => { sel.on('.drag', null); };
  }, [visibleNodes, d3Ready]);

  // Reset Layout button: identity zoom, drop all fx/fy pins, re-heat the sim,
  // auto-fit the viewBox once it settles.
  const resetLayout = () => {
    if (!d3Ready || !svgRef.current || !zoomRef.current || !simRef.current) return;
    const d3 = window.d3;
    d3.select(svgRef.current).call(zoomRef.current.transform, d3.zoomIdentity);
    simRef.current.nodes().forEach(n => { delete n.fx; delete n.fy; });
    simRef.current.alpha(1).alphaTarget(0).restart();
    setTimeout(() => autoFitViewBox(), 700);
  };

  // ── Banner: paths in network, count touching risk ────────────────────────
  // Y = explored_count (the real "ownership paths" Sayari explored)
  // N = edges in the *risk* subset (sanctioned or PEP at least one endpoint).
  //     This is the closest honest proxy to "paths that touch a sanctioned or
  //     PEP entity" given we work with edges, not enumerated path objects.
  const totalPaths = explored_count != null ? explored_count : shown;
  const riskTouchingEdgeCount = useMemo(() => {
    let n = 0;
    for (const e of baseEdges) {
      const a = baseNodes.find(x => x.id === e.source);
      const b = baseNodes.find(x => x.id === e.target);
      if ((a && (a.sanctioned || a.pep)) || (b && (b.sanctioned || b.pep))) n++;
    }
    return n;
  }, [baseEdges, baseNodes]);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Trail: investigation navigation */}
      {trail && trail.length > 0 && window.GraphTrail
        ? <window.GraphTrail trail={trail} onOpenEntity={onOpenEntity} currentLabel={currentLabel} />
        : null}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
        gap: 14, flexWrap: 'wrap',
      }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Ownership network
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
            {riskFilter === 'sanctioned' ? 'Collapsed to sanctioned-ownership paths'
             : riskFilter === 'sanctioned_pep' ? 'Sanctioned + PEP paths'
             : 'All paths'} · depth {depth}
          </div>
        </div>
        {/* Risk filter — tri-state */}
        <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
          <SegBtn active={riskFilter === 'sanctioned'} onClick={() => setRiskFilter('sanctioned')}>Sanctioned only</SegBtn>
          <SegBtn active={riskFilter === 'sanctioned_pep'} onClick={() => setRiskFilter('sanctioned_pep')}>Sanctioned + PEP</SegBtn>
          <SegBtn active={riskFilter === 'all'} onClick={() => setRiskFilter('all')}>All</SegBtn>
        </div>
      </div>

      {/* Secondary controls: search + depth */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)',
        gap: 14, flexWrap: 'wrap',
      }}>
        <input
          type="search"
          placeholder="Search names in this network…"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          style={{
            flex: '1 1 240px', minWidth: 200, maxWidth: 380,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 4, padding: '6px 10px',
            fontSize: 12, color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
        <div
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          title="Default depth chosen to surface every sanctioned-touching path; override to explore wider."
        >
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>Depth</span>
          <div style={{ display: 'inline-flex', border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
            {[1, 2, 3].map(d => (
              <SegBtn key={d} active={depth === d} onClick={() => setDepth(d)}>{d}</SegBtn>
            ))}
          </div>
        </div>
        <button
          onClick={resetLayout}
          title="Re-fit the graph and release pinned nodes."
          style={{
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-secondary)',
            padding: '5px 10px', borderRadius: 4,
            fontSize: 11, fontFamily: 'var(--font-mono)',
            letterSpacing: 0.4,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ fontSize: 12 }}>↻</span> reset layout
        </button>
      </div>

      {/* Banner — N paths touching sanctioned/PEP */}
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
          <span className="mono">{(totalPaths || 0).toLocaleString()}</span> ownership paths in this network ·
          {riskFilter === 'all'
            ? <> showing all <span className="mono">{visibleEdges.length.toLocaleString()}</span></>
            : <> showing the <span className="mono">{riskTouchingEdgeCount.toLocaleString()}</span> that touch a sanctioned or PEP entity</>}
          {riskFilter === 'all' && clusterCount > 0
            ? <> · <span style={{ color: 'var(--text-secondary)' }}>+{clusterCount} non-risk direct owners clustered</span></>
            : null}
        </span>
      </div>

      {/* Graph SVG */}
      <div style={{ position: 'relative', background: 'radial-gradient(ellipse at center, #0E1B30 0%, var(--bg-surface) 100%)', aspectRatio: '7 / 5' }}>
        <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}>
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
          {/* zoom/pan transforms apply to this <g>; nodes opt out via data-graph-node so drag wins */}
          <g ref={zoomGroupRef}>
          <rect x="-200" y="-200" width="1400" height="1100" fill="url(#grid)" opacity="0.5" />

          {/* edges */}
          {visibleEdges.map((e, i) => {
            const a = positionsRef.current[e.source]; const b = positionsRef.current[e.target];
            if (!a || !b) return null;
            const sourceNode = visibleNodes.find(n => n.id === e.source) || baseNodes.find(n => n.id === e.source);
            const targetNode = visibleNodes.find(n => n.id === e.target) || baseNodes.find(n => n.id === e.target);
            const isSanctionPath = sourceNode?.sanctioned && targetNode?.id === entityId;
            const isCluster = !!e._isCluster;
            const isFormer = e.former;
            const isHover = hoverEdge === i;
            const color = isCluster ? 'var(--text-muted)'
                        : isSanctionPath ? 'var(--risk-critical)'
                        : (e.relationship === 'controls' || e.relationship === 'controlled_by' ? 'var(--accent)' : 'var(--text-secondary)');
            const marker = isCluster ? 'url(#arrow)'
                         : isSanctionPath ? 'url(#arrowRed)'
                         : (color === 'var(--accent)' ? 'url(#arrowGold)' : 'url(#arrow)');
            const dx = b.x - a.x, dy = b.y - a.y;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const curve = Math.min(40, Math.hypot(dx, dy) / 6);
            const nx = -dy / Math.hypot(dx, dy) * curve;
            const ny =  dx / Math.hypot(dx, dy) * curve;
            const cx2 = mid.x + nx, cy2 = mid.y + ny;
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
                  strokeOpacity={isCluster ? 0.5 : (isFormer ? 0.5 : (isHover ? 1 : 0.85))}
                  strokeWidth={isHover ? 2.5 : (isSanctionPath ? 1.8 : 1.4)}
                  strokeDasharray={isCluster ? "4 3" : (isFormer ? "5 4" : null)}
                  markerEnd={marker}
                />
                {isHover && !isCluster ? (
                  <g transform={`translate(${cx2 + 6}, ${cy2 - 6})`}>
                    <rect x="0" y="-14" width={140} height={isFormer ? 42 : 30} fill="#243149" stroke="#2A3854" rx="3" />
                    <text x="8" y="0" fill="#F0F4F8" fontFamily="JetBrains Mono, monospace" fontSize="11">
                      {e.relationship}
                    </text>
                    <text x="8" y="14" fill="#94A3B8" fontFamily="JetBrains Mono, monospace" fontSize="10">
                      {e.percentage != null ? `${e.percentage}%` : '—'} · {e.last_observed || ''}
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
          {visibleNodes.map((n) => {
            const p = positionsRef.current[n.id];
            if (!p) return null;
            const isRoot = n.id === entityId;
            const isHover = hoverNode === n.id || focusNode === n.id;
            const isCluster = !!n._isCluster;
            const hasSearch = !!searchMatchIds;
            const isSearchMatch = hasSearch && searchMatchIds.has(n.id);
            const dimmed = hasSearch && !isSearchMatch && !isRoot;

            // Label discipline: show a full label only for root, sanctioned, PEP,
            // cluster, or matched-by-search nodes. Other nodes render as dots
            // with a hover <title> tooltip carrying the full name.
            const showLabel = isRoot || n.sanctioned || n.pep || isCluster || isSearchMatch;
            const display = pickDisplayLabel(n);
            const truncated = isCluster ? n.label : truncateLabel(display, 18);

            // Cluster chip is a wider pill rather than a circle.
            if (isCluster) {
              const w = 180, h = 36;
              return (
                <g key={n.id}
                  data-graph-node="true"
                  data-node-id={n.id}
                  transform={`translate(${p.x}, ${p.y})`}
                  onMouseEnter={() => setHoverNode(n.id)}
                  onMouseLeave={() => setHoverNode(null)}
                  style={{ cursor: 'grab', opacity: dimmed ? 0.35 : 1 }}
                >
                  <title>{n.label}. Direct owners with no sanctioned and no PEP status. Switch to a different risk filter to inspect them individually.</title>
                  <rect x={-w/2} y={-h/2} width={w} height={h}
                    rx="18"
                    fill="var(--bg-elevated)"
                    stroke="var(--border-default)"
                    strokeDasharray="4 3"
                    strokeWidth="1.2"
                  />
                  <text textAnchor="middle" dy="4" fill="var(--text-secondary)" fontFamily="Inter, sans-serif" fontSize="11" fontWeight="500">
                    +{n._count} owners · no sanctions
                  </text>
                </g>
              );
            }

            const r = isRoot ? 22 : (n.sanctioned ? 16 : (n.pep ? 13 : (showLabel ? 12 : 6)));
            const baseOpacity = dimmed ? 0.32 : 1;

            return (
              <g key={n.id}
                data-graph-node="true"
                data-node-id={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                onMouseEnter={() => setHoverNode(n.id)}
                onMouseLeave={() => setHoverNode(null)}
                onClick={() => { if (!isRoot) setFocusNode(focusNode === n.id ? null : n.id); }}
                style={{ cursor: 'grab', opacity: baseOpacity }}
              >
                <title>{display}{n.country ? ` · ${n.country}` : ''}{n.sanctioned ? ' · sanctioned' : ''}{n.pep ? ' · PEP' : ''}</title>

                {n.sanctioned ? <circle r={r + 14} fill="url(#sancHalo)" /> : null}
                {n.pep && !n.sanctioned ? <circle r={r + 12} fill="url(#pepRing)" /> : null}
                {isRoot ? <circle r={r + 6} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 3" /> : null}
                {isSearchMatch ? <circle r={r + 10} fill="none" stroke="var(--accent)" strokeWidth="2" /> : null}
                <circle r={r}
                  fill={isRoot ? 'var(--bg-elevated)' : (n.type === 'person' ? '#1F2A40' : 'var(--bg-elevated)')}
                  stroke={n.sanctioned ? 'var(--risk-critical)' : (n.pep ? 'var(--risk-medium)' : 'var(--border-default)')}
                  strokeWidth={n.sanctioned ? 2 : 1.2}
                />
                {showLabel ? (
                  <text textAnchor="middle" dy="4" fill={n.sanctioned ? 'var(--risk-critical)' : (n.pep ? 'var(--risk-medium)' : 'var(--text-secondary)')} fontFamily="JetBrains Mono, monospace" fontSize={isRoot ? 16 : 13}>
                    {n.type === 'person' ? '◆' : '■'}
                  </text>
                ) : null}
                {showLabel ? (
                  <g transform={`translate(0, ${r + 18})`}>
                    <text textAnchor="middle" fill={isRoot ? 'var(--accent)' : 'var(--text-primary)'} fontSize={isRoot ? 13 : 12} fontWeight={isRoot ? 600 : 500} fontFamily="Inter, sans-serif">
                      {truncated}
                    </text>
                    {isHover || isRoot ? (
                      <text textAnchor="middle" y="14" fill="var(--text-muted)" fontFamily="JetBrains Mono, monospace" fontSize="10">
                        {n.id.slice(0, 12)}… · {n.country || '—'}
                      </text>
                    ) : null}
                  </g>
                ) : isHover ? (
                  // Unlabelled node on hover: show a small inline tooltip with the full name.
                  <g transform={`translate(0, ${r + 14})`}>
                    <text textAnchor="middle" fill="var(--text-secondary)" fontSize="11" fontFamily="Inter, sans-serif">
                      {truncateLabel(display, 28)}
                    </text>
                  </g>
                ) : null}
                {isRoot ? (
                  <g transform="translate(0, -38)">
                    <rect x="-22" y="-9" width="44" height="16" rx="2" fill="var(--accent)" />
                    <text textAnchor="middle" y="3" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#0A1628" fontWeight="700" letterSpacing="0.8">ROOT</text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* Focus card — anchored to the clicked node via foreignObject */}
          {focusNode ? (() => {
            const node = visibleNodes.find(n => n.id === focusNode) || baseNodes.find(n => n.id === focusNode);
            const p = positionsRef.current[focusNode];
            if (!node || !p || node._isCluster) return null;
            const r = node.id === entityId ? 22 : (node.sanctioned ? 16 : 14);
            const cardW = 280;
            const cardH = 210;
            const [vbX, vbY, vbW, vbH] = viewBox.split(' ').map(Number);
            const aboveY = p.y - r - 12 - cardH;
            const placeAbove = aboveY > vbY + 8;
            const y = placeAbove ? aboveY : p.y + r + 12;
            let x = p.x - cardW / 2;
            if (x < vbX + 8) x = vbX + 8;
            if (x + cardW > vbX + vbW - 8) x = vbX + vbW - 8 - cardW;
            return (
              <foreignObject x={x} y={y} width={cardW} height={cardH} style={{ overflow: 'visible' }}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: '100%' }}>
                  <NodeFocusCard
                    node={node}
                    edges={baseEdges.filter(e => e.source === focusNode || e.target === focusNode)}
                    onClose={() => setFocusNode(null)}
                    onOpenEntity={onOpenEntity}
                  />
                </div>
              </foreignObject>
            );
          })() : null}
          </g>
        </svg>
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
            <LegendDot color="var(--border-default)" label="other (dot · hover for name)" />
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

// Segmented control button used by the risk-filter + depth-selector groups.
function SegBtn({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? 'rgba(201,169,97,0.12)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
      border: 0,
      borderLeft: '1px solid var(--border-default)',
      padding: '5px 12px', fontSize: 12,
      fontWeight: active ? 600 : 400,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }}>{children}</button>
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

// Focus card for a node — quick details + jump to that entity.
function NodeFocusCard({ node, edges, onClose, onOpenEntity }) {
  if (!node) return null;
  return (
    <div style={{
      width: '100%',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 6,
      padding: 14, fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
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
