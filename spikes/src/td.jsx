import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Tldraw, BaseBoxShapeUtil, Rectangle2d, HTMLContainer, T, createShapeId, toRichText, atom, useValue } from 'tldraw';
import 'tldraw/tldraw.css';
import { Shell, NodeCard, PortalCard, edgeLook, nodeDim } from './shell.jsx';

// 画布外的数据经 atom 进入形状渲染（tldraw 的组件对 atom 自动响应）
const data = atom('sdata', { view: { nodes: [], portals: [], edges: [] }, images: {}, selected: null });
const cb = { drill: () => {} };
let syncing = false;

const W = 200, H = 58, IMG_H = 130;
const sid = id => createShapeId('n:' + encodeURIComponent(id));
const aid = id => createShapeId('e:' + encodeURIComponent(id));

// >v<🎨画布-tldraw节点形状-自定义 snode：实心几何、Path2D 选中框、不可编辑
class SNodeUtil extends BaseBoxShapeUtil {
  static type = 'snode';
  static props = { w: T.number, h: T.number, nid: T.string };
  getDefaultProps() { return { w: W, h: H, nid: '' }; }
  // 默认几何是空心的（只有边框可点）→ 点节点内部会被当成点画布、双击还会新建文本框
  getGeometry(shape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  canEdit() { return false; }
  canResize() { return false; }
  hideRotateHandle() { return true; }
  hideSelectionBoundsFg() { return true; }
  component(shape) {
    const d = data.get();
    const id = shape.props.nid;
    const portal = d.view.portals.find(p => p.id === id);
    const node = d.view.nodes.find(n => n.id === id);
    const dim = nodeDim(id, d.view, d.selected);
    return (
      <HTMLContainer className={'fill' + (d.images[id] ? ' has-img' : '')} style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all' }}>
        {portal ? <PortalCard portal={portal} dim={dim} /> : node ? <NodeCard node={node} img={d.images[id]} dim={dim} isSel={id === d.selected} /> : null}
      </HTMLContainer>
    );
  }
  // tldraw 5：选中框用 Path2D（旧的 indicator() 已废弃，缺它会在 pointer_down 时崩）
  getIndicatorPath(shape) { const p = new Path2D(); p.roundRect(0, 0, shape.props.w, shape.props.h, 8); return p; }
}
const shapeUtils = [SNodeUtil];
const SIZE = w => (w < 2.2 ? 's' : w < 3.5 ? 'm' : 'l');
const TL_COLOR = { '#2b7bff': 'blue', '#ff8a1f': 'orange', '#8a94a6': 'grey' };

function sync(editor, view, layout, images, selected) {
  syncing = true;
  editor.run(() => {
    const want = [...view.nodes.map(n => n.id), ...view.portals.map(p => p.id)];
    const wantSet = new Set(want.map(sid));
    for (const id of want) {
      const s = editor.getShape(sid(id));
      const vn = view.nodes.find(n => n.id === id);
      const h = (images[id] ? H + IMG_H : H) + (vn?.open ? vn.kids.length * 19 + 12 : 0); // 原地展开的子级列表
      if (!s) editor.createShape({ id: sid(id), type: 'snode', x: layout[id].x, y: layout[id].y, props: { w: W, h, nid: id } });
      else if (s.props.h !== h) editor.updateShape({ id: s.id, type: 'snode', props: { h } });
    }
    const wantArrows = new Set(view.edges.map(e => aid(e.id)));
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type === 'snode' && !wantSet.has(s.id)) editor.deleteShape(s.id);
      if (s.type === 'arrow' && s.meta.managed && !wantArrows.has(s.id)) editor.deleteShape(s.id);
    }
    for (const e of view.edges) {
      const l = edgeLook(e, selected);
      const props = { color: TL_COLOR[l.color], size: SIZE(l.width), richText: toRichText(e.text || '') };
      const ex = editor.getShape(aid(e.id));
      if (!ex) {
        editor.createShape({ id: aid(e.id), type: 'arrow', isLocked: true, opacity: l.opacity, meta: { managed: true }, props: { ...props, arrowheadEnd: 'arrow' } });
        const b = terminal => ({ type: 'arrow', fromId: aid(e.id), toId: sid(terminal === 'start' ? e.from : e.to), props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } });
        editor.createBindings([b('start'), b('end')]);
      } else editor.updateShape({ id: ex.id, type: 'arrow', opacity: l.opacity, props });
    }
  }, { history: 'ignore', ignoreShapeLock: true });
  syncing = false;
}

// >v<🎨画布-tldraw-受管箭头同步、用户箭头翻译成连线、双击钻进、相机记忆
function TDCanvas({ view, layout, selected, images, onSelect, onDrill, onConnect, onMove, viewport, onViewport }) {
  const [editor, setEditor] = useState(null);
  cb.drill = onDrill;
  useEffect(() => { data.set({ view, images, selected }); }, [view, images, selected]);
  useEffect(() => { if (editor) sync(editor, view, layout, images, selected); }, [editor, view, layout, images, selected]);

  // tldraw 选择 → 外壳
  const tdSel = useValue('sel', () => {
    if (!editor) return null;
    const s = editor.getOnlySelectedShape();
    return s && s.type === 'snode' ? s.props.nid : null;
  }, [editor]);
  useEffect(() => { if (editor && tdSel !== selected) onSelect(tdSel); }, [tdSel]);
  // 外壳 → tldraw 选择（比如从 portal 跳过来）
  useEffect(() => {
    if (!editor) return;
    const cur = editor.getOnlySelectedShape();
    if (selected && (!cur || cur.props?.nid !== selected)) editor.select(sid(selected));
    if (!selected && cur?.type === 'snode') editor.selectNone();
  }, [selected, editor]);

  useEffect(() => {
    if (!editor) return;
    // 不让用户删掉节点（大纲才是真源）
    const off = editor.sideEffects.registerBeforeDeleteHandler('shape', s => (!syncing && s.type === 'snode' ? false : undefined));
    // 松开鼠标：回报拖动坐标；把用户画的箭头翻译成连线
    const onEvent = ev => {
      // 双击：tldraw 按目标（shape/selection/canvas）分流，ShapeUtil.onDoubleClick 在已选中时不触发 → 自己按坐标找
      if (ev.name === 'double_click' && ev.phase === 'down') {
        const hit = editor.getShapesAtPoint(editor.inputs.getCurrentPagePoint(), { hitInside: true }).find(s => s.type === 'snode');
        if (hit?.type === 'snode') { const nid = hit.props.nid; setTimeout(() => cb.drill(nid), 0); }
        return;
      }
      if (ev.name !== 'pointer_up') return;
      setTimeout(() => {
        const moved = {};
        for (const s of editor.getCurrentPageShapes()) {
          if (s.type === 'snode') {
            const p = layout[s.props.nid];
            if (!p || p.x !== s.x || p.y !== s.y) moved[s.props.nid] = { x: s.x, y: s.y };
          }
          if (s.type === 'arrow' && !s.meta.managed && !editor.isIn('arrow.pointing') && !editor.isIn('select.dragging_handle')) {
            const bs = editor.getBindingsFromShape(s, 'arrow');
            const end = t => { const b = bs.find(b => b.props.terminal === t); const to = b && editor.getShape(b.toId); return to?.type === 'snode' ? to.props.nid : null; };
            const a = end('start'), z = end('end');
            syncing = true; editor.deleteShape(s.id); syncing = false;
            if (a && z) onConnect(a, z);
          }
        }
        if (Object.keys(moved).length) onMove(moved);
      }, 0);
    };
    editor.on('event', onEvent);
    // 相机变化（平移/缩放）→ 防抖后回报，返回上一级再进来时还原
    let t = 0;
    const offCam = editor.store.listen(() => {
      clearTimeout(t);
      t = setTimeout(() => { const c = editor.getCamera(); onViewport({ x: c.x, y: c.y, zoom: c.z }); }, 250);
    }, { scope: 'session' });
    return () => { off(); offCam(); clearTimeout(t); editor.off('event', onEvent); };
  }, [editor, layout, onConnect, onMove, onViewport]);

  return (
    <Tldraw shapeUtils={shapeUtils} onMount={ed => {
      setEditor(ed);
      window.__ed = ed; // 只给 test/ui.test.js 用
      sync(ed, view, layout, images, selected);
      if (viewport) ed.setCamera({ x: viewport.x, y: viewport.y, z: viewport.zoom });
      else ed.zoomToFit({ animation: { duration: 0 } });
    }} />
  );
}

createRoot(document.getElementById('root')).render(<Shell name="tldraw" Canvas={TDCanvas} />);
