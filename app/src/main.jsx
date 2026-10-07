import { createRoot } from 'react-dom/client';
import { useEffect, useState, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, BaseEdge, EdgeLabelRenderer, getBezierPath, ViewportPortal, useReactFlow } from '@xyflow/react';
import { dragScale } from './arrange.js';
import '@xyflow/react/dist/style.css';
import { Shell, NodeCard, PortalCard, PicCard, AxesCard, MatrixChip, edgeLook, lengthFade, desat, COLORS, nodeDim } from './shell.jsx';

function SNode({ data }) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {data.portal ? <PortalCard portal={data.portal} dim={data.dim} /> : <NodeCard node={data.node} img={data.img} dim={data.dim} isSel={data.isSel} />}
      <Handle type="source" position={Position.Right} />
    </>
  );
}
const PNode = ({ data }) => <PicCard pic={data.pic} isSel={data.isSel} />;
const ANode = ({ data }) => <AxesCard S={data.S} labels={data.labels} />;
const nodeTypes = { s: SNode, pic: PNode, axes: ANode };
// 所有边：高亮 = 实色；没高亮 = 出橙→入蓝渐变，按长度变淡变灰（edgeLook / lengthFade）。空间之间的边在标签处画矩阵热力图
function FlowEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const { look, idx, text, mat } = data;
  const f = look.hl ? { opacity: 1, sat: 1 } : lengthFade(Math.hypot(targetX - sourceX, targetY - sourceY));
  const op = look.opacity * f.opacity;
  const cOut = look.hl ? look.color : desat(COLORS.out, f.sat), cIn = look.hl ? look.color : desat(COLORS.in, f.sat);
  const gid = 'eg' + idx, mid = 'em' + idx;
  return (<>
    <defs>
      {!look.hl && <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}><stop offset="0" stopColor={cOut} /><stop offset="1" stopColor={cIn} /></linearGradient>}
      <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={cIn} /></marker>
    </defs>
    <BaseEdge path={path} markerEnd={`url(#${mid})`} style={{ stroke: look.hl ? look.color : `url(#${gid})`, strokeWidth: look.width, opacity: op }} />
    {(mat || text) && <EdgeLabelRenderer>
      <div className={(mat ? 'matwrap' : 'elabel') + ' nodrag nopan'} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, opacity: Math.max(op, 0.35), color: look.hl ? look.color : 'var(--dim)' }}>
        {mat ? <MatrixChip mat={mat} /> : text}</div>
    </EdgeLabelRenderer>}
  </>);
}
const edgeTypes = { flow: FlowEdge };

// >v<🎨画布-框选缩放排列-框选后的外框带 8 个柄：拖边 / 角 = 拉开或收紧间距，收到底 = 对齐，会重叠的依次排开（core/arrange.js）
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function ScaleFrame({ nodes, ids, setNodes, onMove }) {
  const rf = useReactFlow();
  const [mode, setMode] = useState('');
  const set = new Set(ids);
  const rectOf = n => { const w = n.measured?.width || 0, h = n.measured?.height || 0, o = n.origin || [0, 0]; return { id: n.id, x: n.position.x - o[0] * w, y: n.position.y - o[1] * h, w, h, o }; };
  const rects = nodes.filter(n => set.has(n.id) && n.measured?.width).map(rectOf);
  if (rects.length < 2) return null;
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
  const start = (e, h) => {
    e.stopPropagation(); e.preventDefault();
    const z = rf.getZoom(), cx = e.clientX, cy = e.clientY, base = rects;
    let last = base;
    const mv = ev => {
      const r = dragScale(base, h, (ev.clientX - cx) / z, (ev.clientY - cy) / z);
      last = r.rects; setMode(r.mode.includes('align') ? '对齐' : r.mode.includes('hold') ? '再拖就对齐' : r.mode.includes('spread') ? '摊开' : '');
      const m = new Map(last.map(q => [q.id, q]));
      setNodes(ns => ns.map(n => { const q = m.get(n.id); return q ? { ...n, position: { x: q.x + q.o[0] * q.w, y: q.y + q.o[1] * q.h } } : n; }));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setMode('');
      onMove(Object.fromEntries(last.map(q => [q.id, { x: Math.round(q.x + q.o[0] * q.w), y: Math.round(q.y + q.o[1] * q.h) }])));
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const P = 10;
  return (
    <ViewportPortal>
      <div className="scaleframe" style={{ transform: `translate(${x0 - P}px, ${y0 - P}px)`, width: x1 - x0 + 2 * P, height: y1 - y0 + 2 * P }}>
        {HANDLES.map(h => <span key={h} className={'sh sh-' + h + ' nodrag nopan'} title="拖动 = 拉开 / 收紧间距；收到底 = 对齐" onPointerDown={e => start(e, h)} />)}
        {mode && <span className="shmode">{mode}</span>}
      </div>
    </ViewportPortal>
  );
}

// >v<🎨画布-ReactFlow-显示 view + 回报选择/拖动/连线/视图
function RFCanvas({ view, layout, selected, images, pics = [], plane, onSelect, onDrill, onConnect, onMove, onContextMenu, viewport, onViewport }) {
  const centered = new Set(plane?.ids || []); // 空间成员：卡片中心对准坐标点
  const [multi, setMulti] = useState([]); // Shift 框选的多张卡（单选仍由外壳的 selected 管）
  const ms = new Set(multi);
  const isSel = id => id === selected || ms.has(id);
  const build = () => [
    ...(plane ? [{ id: '@axes', type: 'axes', position: { x: -plane.S * 1.25, y: -plane.S * 1.25 }, data: plane, draggable: false, selectable: false, focusable: false, zIndex: -1, style: { pointerEvents: 'none' } }] : []),
    ...view.nodes.map(n => ({ id: n.id, type: 's', position: layout[n.id], ...(centered.has(n.id) ? { origin: [0.5, 0.5] } : {}), data: { node: n, img: images[n.id], dim: nodeDim(n.id, view, selected), isSel: isSel(n.id) }, selected: isSel(n.id) })),
    ...view.portals.map(p => ({ id: p.id, type: 's', position: layout[p.id], data: { portal: p, dim: nodeDim(p.id, view, selected) }, selected: isSel(p.id) })),
    ...pics.map(p => ({ id: p.id, type: 'pic', position: layout[p.id] || { x: 0, y: 0 }, data: { pic: p, isSel: isSel(p.id) }, selected: isSel(p.id) })),
  ];
  const [nodes, setNodes] = useState(build);
  // 外部数据变 → 重建，但保留本地坐标与 RF 的测量结果（丢了 measured 节点会被隐藏到重新测量完）
  useEffect(() => {
    setNodes(prev => {
      const old = new Map(prev.map(n => [n.id, n]));
      // 坐标以外壳的 layout 为准；只有正在拖的节点用本地坐标（否则旧坐标会和自动布局打架，新节点压住老节点）
      return build().map(n => { const o = old.get(n.id); return o ? { ...o, ...n, position: o.dragging ? o.position : n.position } : n; });
    });
  }, [view, layout, selected, images, pics, plane, multi]);

  const edges = view.edges.map((e, idx) => ({
    id: e.id, source: e.from, target: e.to, type: 'flow', selectable: false,
    data: { look: edgeLook(e, selected), idx, text: e.text || '', mat: e.mat || null },
  }));

  const onNodesChange = useCallback(ch => setNodes(ns => applyNodeChanges(ch, ns)), []);
  const onSelectionChange = useCallback(({ nodes: sel }) => {
    const ids = sel.map(n => n.id).filter(id => id !== '@axes'); // 传送门（↗ 别处的节点）也能框选排列：它们的坐标同样存在 _layout.json
    const next = ids.length > 1 ? ids : [];
    setMulti(m => m.join('|') === next.join('|') ? m : next);
  }, []);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onSelectionChange={onSelectionChange}
      onNodeClick={(_, n) => onSelect(n.id === selected ? null : n.id)}
      onPaneClick={() => onSelect(null)}
      onNodeContextMenu={(e, n) => { e.preventDefault(); onContextMenu(n.id, e.clientX, e.clientY); }}
      onPaneContextMenu={e => { e.preventDefault(); onContextMenu(null, e.clientX, e.clientY); }}
      onNodeDoubleClick={(_, n) => onDrill(n.id)}
      onNodeDragStop={(_, n, dragged) => onMove(Object.fromEntries((dragged || [n]).map(d => [d.id, d.position])))}
      onConnect={c => onConnect(c.source, c.target)}
      zoomOnDoubleClick={false} deleteKeyCode={null} minZoom={0.1} colorMode="dark"
      // 记住的视图优先；第一次进这个范围才 fitView
      fitView={!viewport} fitViewOptions={{ padding: 0.2 }} defaultViewport={viewport}
      onMoveEnd={(_, vp) => onViewport(vp)}>
      <Background gap={24} size={1} color="#333" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor="#444" nodeStrokeColor="#666" maskColor="rgba(0,0,0,.55)" />
      {multi.length > 1 && <ScaleFrame nodes={nodes} ids={multi} setNodes={setNodes} onMove={onMove} />}
    </ReactFlow>
  );
}

createRoot(document.getElementById('root')).render(<Shell name="reactflow" Canvas={RFCanvas} />);
