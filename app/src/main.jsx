import { createRoot } from 'react-dom/client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, BaseEdge, EdgeLabelRenderer, getBezierPath, ViewportPortal, useReactFlow } from '@xyflow/react';
import { dragScale } from './arrange.js';
import { expand, pathBetween } from './select.js';
import '@xyflow/react/dist/style.css';
import { Shell, cardActions, FrameCard, NodeCard, PortalCard, PicCard, AxesCard, MatrixChip, edgeLook, lengthFade, desat, nodeDim } from './shell.jsx';

// 左进右出 = 数据流；顶上 mi / 底下 mo = 调节口（kind 调节：调节源从底下连到被调节者顶上）
const ModHandles = () => (<><Handle type="target" position={Position.Top} id="mi" className="modh" title="调节口：把调节源（参数 / 修改器）连到这里" /><Handle type="source" position={Position.Bottom} id="mo" className="modh" title="从这里拖到别的节点顶上 = 调节它" /></>);
function SNode({ data }) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      {data.portal ? <PortalCard portal={data.portal} dim={data.dim} /> : <NodeCard node={data.node} img={data.img} dim={data.dim} isSel={data.isSel} />}
      <Handle type="source" position={Position.Right} />
      <ModHandles />
    </>
  );
}
const PNode = ({ data }) => <PicCard pic={data.pic} isSel={data.isSel} />;
const ANode = ({ data }) => <AxesCard S={data.S} labels={data.labels} />;
const FNode = ({ data }) => (<><Handle type="target" position={Position.Left} /><FrameCard node={data.node} dim={data.dim} isSel={data.isSel} /><Handle type="source" position={Position.Right} /><ModHandles /></>);
const nodeTypes = { s: SNode, pic: PNode, axes: ANode, frame: FNode };
// 框：子节点坐标 = 钻进分组那页的坐标 − 子节点里最小的 + 内边距（上面留标题栏）
const FP = { x: 16, y: 34 }, FMIN = { w: 180, h: 80 };
// 框的大小跟着子节点走（含嵌套：倒着算，里层的框先算好）
function sizeFrames(nodes) {
  const size = new Map();
  const dim = n => size.get(n.id) || { w: n.measured?.width || 150, h: n.measured?.height || 40 };
  for (const f of [...nodes].reverse()) {
    if (f.type !== 'frame') continue;
    const kids = nodes.filter(n => n.parentId === f.id);
    size.set(f.id, { w: Math.max(FMIN.w, ...kids.map(k => k.position.x + dim(k).w + FP.x)), h: Math.max(FMIN.h, ...kids.map(k => k.position.y + dim(k).h + 16)) });
  }
  return size.size ? nodes.map(n => size.has(n.id) ? { ...n, style: { ...n.style, width: size.get(n.id).w, height: size.get(n.id).h } } : n) : nodes;
}
// 所有边：出发节点的颜色，离散 = 虚线；没高亮时按长度变淡变灰（edgeLook / lengthFade）。空间之间的边在标签处画矩阵热力图
function FlowEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const { look, idx, text, mat } = data;
  const f = look.hl ? { opacity: 1, sat: 1 } : lengthFade(Math.hypot(targetX - sourceX, targetY - sourceY));
  const op = look.opacity * f.opacity, col = look.hl ? look.color : desat(look.color, f.sat), mid = 'em' + idx;
  return (<>
    <defs>
      {look.mod
        ? <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,5 L5,0 L10,5 L5,10 z" fill={col} /></marker>
        : <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={col} /></marker>}
    </defs>
    <BaseEdge path={path} markerEnd={`url(#${mid})`} style={{ stroke: col, strokeWidth: look.width, strokeDasharray: look.dash, opacity: op }} />
    {(mat || text) && <EdgeLabelRenderer>
      <div className={(mat ? 'matwrap' : 'elabel') + ' nodrag nopan'} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, opacity: Math.max(op, 0.35), color: look.hl ? col : 'var(--dim)' }}>
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
  // 框里的子节点 position 是相对框的：换成绝对坐标再排，写回时再减掉（off = 父框的绝对位置）
  const byId = new Map(nodes.map(n => [n.id, n]));
  const offOf = n => { let x = 0, y = 0; for (let p = byId.get(n.parentId); p; p = byId.get(p.parentId)) { x += p.position.x; y += p.position.y; } return { x, y }; };
  const rectOf = n => { const w = n.measured?.width || n.style?.width || 0, h = n.measured?.height || n.style?.height || 0, o = n.origin || [0, 0], off = offOf(n); return { id: n.id, x: n.position.x + off.x - o[0] * w, y: n.position.y + off.y - o[1] * h, w, h, o, off }; };
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
      setNodes(ns => ns.map(n => { const q = m.get(n.id); return q ? { ...n, position: { x: q.x - q.off.x + q.o[0] * q.w, y: q.y - q.off.y + q.o[1] * q.h } } : n; }));
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setMode('');
      // 松手处和按下处不是同一个元素时，浏览器会在共同祖先上补一个 click → 被当成「点空白」退出多选（👤 2026-10-08：缩放后不要退出选择）
      const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', eat, true); setTimeout(() => window.removeEventListener('click', eat, true), 300);
      onMove(Object.fromEntries(last.map(q => [q.id, { x: Math.round(q.x - q.off.x + q.o[0] * q.w), y: Math.round(q.y - q.off.y + q.o[1] * q.h) }])));
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

// 外壳要把屏幕坐标换成画布坐标（粘贴落在鼠标处）
function FlowBridge() {
  const rf = useReactFlow();
  cardActions.toFlow = p => rf.screenToFlowPosition(p);
  cardActions.centerOn = id => rf.getNode(id) && rf.fitView({ nodes: [{ id }], duration: 300, padding: 1.5, maxZoom: Math.max(1, rf.getZoom()) });
  return null;
}

// >v<🎨画布-ReactFlow-显示 view + 回报选择/拖动/连线/视图
function RFCanvas({ theme = 'dark', view, layout, selected, images, pics = [], plane, onSelect, onDrill, onConnect, onMove, onContextMenu, onEdgeMenu, onRewire, onRemoveEdges, viewport, onViewport }) {
  // >v<🎨画布-改接连线-按住 Alt 在连线身上任意处按下 = 拿起离鼠标近的那一端（👤 2026-10-08：端点处常叠着好几条线，只能从线身上挑）
  //   放到别的节点 = 改接（标签 / 类型跟过去），放到画布空白 = 删除，拖着时右键 / Esc = 取消，放到画布外（面板上）= 取消
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const k = e => setAlt(e.altKey), b = () => setAlt(false);
    window.addEventListener('keydown', k); window.addEventListener('keyup', k); window.addEventListener('blur', b);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', k); window.removeEventListener('blur', b); };
  }, []);
  const [rw, setRw] = useState(null); // 正在拖的线端：{ id, end: 'source' | 'target', fixed: [x, y], cur: [x, y] }（屏幕坐标）
  const rwRef = useRef(null); rwRef.current = rw;
  const live = useRef(); live.current = { view, onRewire, onRemoveEdges };
  useEffect(() => {
    let quiet = 0; // 刚用右键取消：吞掉随后的右键菜单 / 点击
    const edgeAt = e => e.altKey && e.button === 0 && e.target.closest?.('.react-flow__edge');
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    const down = e => {
      if (rwRef.current) { stop(e); if (e.button === 2) { quiet = Date.now(); setRw(null); } return; }
      const el = edgeAt(e); if (!el) return;
      const path = el.querySelector('.react-flow__edge-path'); if (!path) return;
      const ctm = path.getScreenCTM(), L = path.getTotalLength();
      const scr = q => { const s = new DOMPoint(q.x, q.y).matrixTransform(ctm); return [s.x, s.y]; };
      const a = scr(path.getPointAtLength(0)), b = scr(path.getPointAtLength(L));
      const d = q => Math.hypot(q[0] - e.clientX, q[1] - e.clientY);
      const end = d(a) <= d(b) ? 'source' : 'target';
      stop(e);
      setRw({ id: el.dataset.id, end, fixed: end === 'source' ? b : a, cur: [e.clientX, e.clientY] });
    };
    const mdown = e => { if (rwRef.current || edgeAt(e)) stop(e); }; // 拦住 React Flow 的平移（它听 mousedown）
    const move = e => { if (rwRef.current) setRw(r => r && { ...r, cur: [e.clientX, e.clientY] }); };
    const up = e => {
      const r = rwRef.current; if (!r || e.button !== 0) return;
      setRw(null); quiet = Date.now();
      const { view, onRewire, onRemoveEdges } = live.current;
      const ve = view.edges.find(x => x.id === r.id); if (!ve) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const node = hit?.closest('.react-flow__node');
      if (node) {
        const nid = node.dataset.id, [f, t] = ve.raw[0].split('->');
        const keep = r.end === 'target' ? ve.from : ve.to; // 不动的那端（可能是传送门 id）
        if (ve.count !== 1 || nid === keep || (nid.startsWith('@') && !nid.startsWith('@portal:'))) return;
        if (r.end === 'target') onRewire(f, t, f, nid); else onRewire(f, t, nid, t);
      } else if (hit?.closest('.react-flow') && !hit.closest('.react-flow__panel')) onRemoveEdges(ve.raw.map(x => x.split('->')));
    };
    const key = e => { if (rwRef.current && e.key === 'Escape') { stop(e); setRw(null); } };
    const menu = e => { if (rwRef.current || Date.now() - quiet < 800) { stop(e); if (rwRef.current) { quiet = Date.now(); setRw(null); } } };
    const click = e => { if (Date.now() - quiet < 300) stop(e); };
    const on = [['pointerdown', down], ['mousedown', mdown], ['pointermove', move], ['pointerup', up], ['keydown', key], ['contextmenu', menu], ['click', click]];
    for (const [t, f] of on) window.addEventListener(t, f, true);
    return () => { for (const [t, f] of on) window.removeEventListener(t, f, true); };
  }, []);
  const centered = new Set(plane?.ids || []); // 空间成员：卡片中心对准坐标点
  // >v<🎨画布-多选-选择由这里自己管（不用 React Flow 的 Ctrl 多选：两边各管一份会互相触发 → 死循环黑屏，👤 2026-10-08）：
  // 单击 = 只选它；Ctrl+单击 = 加入 / 移出；Shift+单击 = 加上它和当前选中之间路径上的节点；Shift+拖空白 = 框选；
  // Ctrl+← / → = 沿入线 / 出线扩一层，Shift+← / → = 扩到头（core/select.js）
  const [multi, setMultiRaw] = useState([]); // 多选（≥2 张）；单选仍由外壳的 selected 管
  const setMulti = ids => { const next = ids.length > 1 ? [...new Set(ids)].sort() : []; setMultiRaw(m => m.join('|') === next.join('|') ? m : next); };
  const ms = new Set(multi);
  const isSel = id => id === selected || ms.has(id);
  cardActions.multi = multi; // 外壳的 Ctrl+C 要知道多选了哪些
  // 框里子节点：画布坐标（相对框）↔ 存的坐标（钻进分组那页的坐标）
  const fmin = {};
  for (const n of view.nodes) if (n.framed) { const ks = n.children.map(c => layout[c]).filter(Boolean); fmin[n.id] = ks.length ? { x: Math.min(...ks.map(p => p.x)), y: Math.min(...ks.map(p => p.y)) } : { x: 0, y: 0 }; }
  const frameOf = new Map(view.nodes.filter(n => n.frame != null).map(n => [n.id, n.frame]));
  const posOf = n => { const p = layout[n.id], f = frameOf.get(n.id); return f != null && p && fmin[f] ? { x: p.x - fmin[f].x + FP.x, y: p.y - fmin[f].y + FP.y } : p; };
  const toLayout = (id, p) => { const f = frameOf.get(id); return f != null && fmin[f] ? { x: Math.round(p.x - FP.x + fmin[f].x), y: Math.round(p.y - FP.y + fmin[f].y) } : p; };
  const build = () => [
    ...(plane ? [{ id: '@axes', type: 'axes', position: { x: -plane.S * 1.25, y: -plane.S * 1.25 }, data: plane, draggable: false, selectable: false, focusable: false, zIndex: -1, style: { pointerEvents: 'none' } }] : []),
    ...view.nodes.map(n => ({ id: n.id, type: n.framed ? 'frame' : 's', position: posOf(n), ...(n.frame != null ? { parentId: n.frame } : {}), ...(n.framed ? { style: { width: FMIN.w, height: FMIN.h } } : {}), ...(centered.has(n.id) ? { origin: [0.5, 0.5] } : {}), data: { node: n, img: images[n.id], dim: nodeDim(n.id, view, selected), isSel: isSel(n.id) }, selected: isSel(n.id) })),
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

  // 选中一个框：框里的节点连出去的线也算「相连」
  const near = selected && view.parentOf?.size ? new Set([selected, ...view.nodes.filter(n => { for (let f = n.frame; f != null; f = view.parentOf.get(f)) if (f === selected) return true; return false; }).map(n => n.id)]) : null;
  const edges = view.edges.map((e, idx) => ({
    id: e.id, source: e.from, target: e.to, type: 'flow', selectable: false, ...(e.mod ? { sourceHandle: 'mo', targetHandle: 'mi' } : {}),
    data: { look: rw?.id === e.id ? { ...edgeLook(e, selected, near), opacity: 0.2 } : edgeLook(e, selected, near), idx, text: e.text || '', mat: e.mat || null },
  }));

  // >v<🎨画布-锁轴拖动-拖卡片时按住 Shift = 只横移或只竖移（看从起点算哪个方向挪得多；👤 2026-10-08）
  const dragStart = useRef(null), shiftDown = useRef(false);
  // 拖动时鼠标下面那张（不算被拖的）= 放进目标，高亮它
  const dropRef = useRef(null);
  const setDropAt = (e, ids) => {
    let t = null;
    if (e) for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const nd = el.closest?.('.react-flow__node'); const id = nd?.dataset.id;
      if (!id || ids.includes(id)) continue;
      if (id.startsWith('@pic:') || id === '@axes') break;
      t = id; break;
    }
    if (t === dropRef.current) return;
    document.querySelectorAll('.react-flow__node.droptarget').forEach(x => x.classList.remove('droptarget'));
    dropRef.current = t;
    if (t) document.querySelector(`.react-flow__node[data-id="${CSS.escape(t)}"]`)?.classList.add('droptarget');
  };
  useEffect(() => {
    const k = e => { shiftDown.current = e.shiftKey; }, b = () => { shiftDown.current = false; };
    window.addEventListener('keydown', k); window.addEventListener('keyup', k); window.addEventListener('blur', b);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', k); window.removeEventListener('blur', b); };
  }, []);
  const onNodesChange = useCallback(ch => {
    const st = dragStart.current;
    if (st && shiftDown.current) {
      const lead = ch.find(c => c.type === 'position' && c.dragging && c.position && st.pos[c.id]);
      if (lead) {
        const s0 = st.pos[lead.id], horiz = Math.abs(lead.position.x - s0.x) >= Math.abs(lead.position.y - s0.y);
        ch = ch.map(c => c.type === 'position' && c.position && st.pos[c.id] ? { ...c, position: horiz ? { x: c.position.x, y: st.pos[c.id].y } : { x: st.pos[c.id].x, y: c.position.y } } : c);
      }
    }
    setNodes(ns => applyNodeChanges(ch, ns));
  }, []);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  // AI 指令框用：选中一批（预览 / 执行「选中」）；量卡片（对齐 / 排列要宽高，坐标给存的那套）
  cardActions.select = ids => { setMulti(ids); onSelect(ids.length === 1 ? ids[0] : ids.at(-1) ?? null); };
  cardActions.boxes = () => Object.fromEntries(nodesRef.current.filter(n => n.measured?.width && n.type !== 'axes').map(n => {
    const p = toLayout(n.id, n.position), o = n.origin || [0, 0];
    return [n.id, { x: p.x - o[0] * n.measured.width, y: p.y - o[1] * n.measured.height, w: n.measured.width, h: n.measured.height }];
  }));
  const shown = useMemo(() => sizeFrames(nodes), [nodes]);
  // 刚展开成框：框比原来的卡大，压住的顶层卡片挪到框右边（只在展开那一刻做一次；打开页面时已经展开的不动）
  const seenFrames = useRef(null);
  useEffect(() => {
    const frames = shown.filter(n => n.type === 'frame' && !n.parentId);
    if (seenFrames.current === null) { seenFrames.current = new Set(frames.map(f => f.id)); return; }
    const kidsReady = f => shown.filter(n => n.parentId === f.id).every(n => n.measured?.width);
    const fresh = frames.filter(f => !seenFrames.current.has(f.id) && kidsReady(f));
    seenFrames.current = new Set([...[...seenFrames.current].filter(id => frames.some(f => f.id === id)), ...fresh.map(f => f.id)]);
    const ch = {};
    for (const f of fresh) {
      const fx = f.position.x, fy = f.position.y, fr = fx + f.style.width, fb = fy + f.style.height;
      for (const n of shown) {
        if (n.parentId || n.id === f.id || n.type === 'axes' || !n.measured?.width) continue;
        const x = n.position.x, y = n.position.y, w = n.measured.width, h = n.measured.height;
        if (x < fr + 12 && x + w > fx - 12 && y < fb + 12 && y + h > fy - 12) ch[n.id] = { x: Math.round(fr + 40), y: Math.round(y) };
      }
    }
    if (Object.keys(ch).length) onMove(ch);
  }, [shown]);
  // 框选结束：读 React Flow 选中的（传送门也算：它们的坐标同样存在 _layout.json）
  const onSelectionEnd = () => setTimeout(() => setMulti(nodesRef.current.filter(n => n.selected && n.id !== '@axes').map(n => n.id)), 0);
  const base = () => multi.length ? multi : selected ? [selected] : [];
  const click = (e, n) => {
    if (e.ctrlKey || e.metaKey) {
      const cur = new Set(base());
      if (cur.has(n.id)) cur.delete(n.id); else cur.add(n.id);
      const arr = [...cur];
      setMulti(arr); onSelect(cur.has(n.id) ? n.id : arr.at(-1) ?? null);
    } else if (e.shiftKey && selected && selected !== n.id) {
      setMulti([...base(), ...pathBetween(view.edges, selected, n.id)]); onSelect(n.id);
    } else { onSelect(n.id === selected && !multi.length ? null : n.id); setMulti([]); }
  };
  useEffect(() => {
    const key = e => {
      if (e.target.closest?.('textarea, input, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { setMulti([]); return; }
      if (e.altKey || !(e.ctrlKey || e.shiftKey) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const b = base(); if (!b.length) return;
      e.preventDefault(); e.stopPropagation();
      setMulti([...expand(view.edges, b, e.key === 'ArrowLeft' ? 'in' : 'out', e.shiftKey)]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (<>
    {rw && <svg className="rwline"><line x1={rw.fixed[0]} y1={rw.fixed[1]} x2={rw.cur[0]} y2={rw.cur[1]} /><circle cx={rw.cur[0]} cy={rw.cur[1]} r="5" /></svg>}
    <ReactFlow nodes={shown} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onSelectionEnd={onSelectionEnd}
      onNodeClick={click} multiSelectionKeyCode={null} disableKeyboardA11y
      onPaneClick={() => { onSelect(null); setMulti([]); }}
      onNodeContextMenu={(e, n) => { e.preventDefault(); onContextMenu(n.id, e.clientX, e.clientY); }}
      onPaneContextMenu={e => { e.preventDefault(); onContextMenu(null, e.clientX, e.clientY); }}
      onEdgeContextMenu={(e, edge) => { e.preventDefault(); onEdgeMenu?.(edge.id, e.clientX, e.clientY); }}
      onEdgeClick={() => {}} /* 有点击回调连线才接收鼠标（右键菜单、Alt 拖都要用） */
      className={alt ? 'altdown' : ''}
      onNodeDoubleClick={(_, n) => onDrill(n.id)}
      onNodeDragStart={(_, n, dragged) => { dragStart.current = { pos: Object.fromEntries((dragged || [n]).map(d => [d.id, { ...d.position }])) }; }}
      onNodeDrag={(e, n, dragged) => setDropAt(e, (dragged || [n]).map(d => d.id))}
      onNodeDragStop={(e, n, dragged) => { dragStart.current = null;
        // 放到别的卡片上 = 放进它里面；框里的卡拖出框 = 拿出来放到当前页（👤 2026-10-08）
        const ids = (dragged || [n]).map(d => d.id), t = dropRef.current; setDropAt(null);
        const framedKids = ids.filter(id => nodesRef.current.find(x => x.id === id)?.parentId);
        if (t && !t.startsWith('@') && ids.every(id => id.startsWith('@pic:'))) { cardActions.movePics?.(ids.map(id => id.slice(5)), t); return; } // 散图拖到卡片上 = 归给它
        if (t && !ids.every(id => view.parentOf?.get(id) === t || nodesRef.current.find(x => x.id === id)?.parentId === t)) { cardActions.moveInto?.(ids, t.startsWith('@portal:') ? t.slice(8) : t); return; }
        if (!t && framedKids.length === ids.length && cardActions.toFlow) { cardActions.moveInto?.(ids, null, cardActions.toFlow({ x: e.clientX, y: e.clientY })); return; } const cur = id => nodesRef.current.find(x => x.id === id)?.position; /* 用画布上的（锁轴后的）坐标 */ onMove(Object.fromEntries((dragged || [n]).map(d => [d.id, toLayout(d.id, cur(d.id) || d.position)]))); }}
      onConnect={c => onConnect(c.source, c.target, c.sourceHandle === 'mo' || c.targetHandle === 'mi')}
      zoomOnDoubleClick={false} deleteKeyCode={null} minZoom={0.1} colorMode={theme === 'light' ? 'light' : 'dark'}
      // 记住的视图优先；第一次进这个范围才 fitView
      fitView={!viewport} fitViewOptions={{ padding: 0.2 }} defaultViewport={viewport}
      onMoveEnd={(_, vp) => onViewport(vp)}>
      <Background gap={24} size={1} color={theme === 'light' ? '#dcdcdc' : '#333'} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={n => n.data?.node?.color || n.data?.portal?.color || "#444"} nodeStrokeColor="#666" maskColor={theme === 'light' ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)'} />
      <FlowBridge />
      {multi.length > 1 && <ScaleFrame nodes={shown} ids={multi} setNodes={setNodes} onMove={ch => onMove(Object.fromEntries(Object.entries(ch).map(([id, p]) => [id, toLayout(id, p)])))} />}
    </ReactFlow>
  </>);
}

createRoot(document.getElementById('root')).render(<Shell name="reactflow" Canvas={RFCanvas} />);
