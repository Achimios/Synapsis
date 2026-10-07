// 两个画布原型共用的外壳：左大纲（真源）、面包屑、导出、快捷键、贴图。
// 画布组件只负责「显示 view + 回报用户操作」，对比的是画布手感，不是外壳。
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parseOutline, projectView, breadcrumb, exportForLLM, withEdge, withNode, autoLayout, ROOT } from './outline.js';
import { SAMPLE } from './sample.js';
import './shell.css';

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额满/隐私模式：不持久化 */ } };

// 心跳：告诉服务「还有网页开着」（全关后服务自动退出，见 vite.config.js）
const ping = () => fetch('/__alive').catch(() => {});
ping(); setInterval(ping, 20000);

export function Shell({ name, Canvas }) {
  const [text, setText] = useState(() => load('syn.text', SAMPLE));
  const [scope, setScope] = useState(ROOT);
  const [selected, setSelected] = useState(null);
  const [positions, setPositions] = useState(() => load('syn.pos.' + name, {}));
  const [images, setImages] = useState(() => load('syn.img', {}));
  const [exportText, setExportText] = useState(null);
  // 每个范围各记一份视图（平移+缩放），返回上一级/再钻进来时还原
  const [viewports, setViewports] = useState(() => load('syn.vp.' + name, {}));
  // 导航历史：像浏览器一样 Alt+← / Alt+→
  const hist = useRef({ back: [], fwd: [] });
  const taRef = useRef(null);

  const graph = useMemo(() => parseOutline(text), [text]);
  const realScope = graph.nodes.has(scope) ? scope : ROOT;
  const view = useMemo(() => projectView(graph, realScope), [graph, realScope]);
  const layout = useMemo(() => autoLayout(view, positions), [view, positions]);
  const sel = selected && (view.nodes.some(n => n.id === selected) || view.portals.some(p => p.id === selected)) ? selected : null;

  useEffect(() => save('syn.text', text), [text]);
  useEffect(() => save('syn.pos.' + name, positions), [positions, name]);
  useEffect(() => save('syn.img', images), [images]);
  useEffect(() => save('syn.vp.' + name, viewports), [viewports, name]);
  const onViewport = useCallback((sc, vp) => setViewports(v => ({ ...v, [sc]: vp })), []);
  const go = useCallback(next => {
    if (next === realScope) return;
    hist.current.back.push(realScope); hist.current.fwd = [];
    setScope(next);
  }, [realScope]);
  const back = () => { const h = hist.current; if (!h.back.length) return; h.fwd.push(realScope); setSelected(null); setScope(h.back.pop()); };
  const fwd = () => { const h = hist.current; if (!h.fwd.length) return; h.back.push(realScope); setSelected(null); setScope(h.fwd.pop()); };

  const drill = useCallback(id => {
    if (id.startsWith('@portal:')) {
      const target = id.slice(8);
      go(graph.nodes.get(target).parent);
      setSelected(target);
    } else { go(id); setSelected(null); }
  }, [graph, go]);
  const up = () => { const p = graph.nodes.get(realScope).parent; if (p !== null) { setSelected(realScope); go(p); } };
  const connect = useCallback((from, to) => {
    const resolve = id => id.startsWith('@portal:') ? id.slice(8) : id;
    const t = withEdge(graph, resolve(from), resolve(to));
    if (t) setText(t);
  }, [graph]);
  const move = useCallback(changes => setPositions(p => ({ ...p, ...changes })), []);
  const addNode = asChild => {
    const parent = sel && asChild ? sel : sel ? graph.nodes.get(sel).parent : realScope;
    const r = withNode(graph, parent, asChild ? null : sel);
    setText(r.text);
    if (!asChild) setSelected(r.id); else go(sel);
  };

  // 画布快捷键（焦点在大纲里时不触发）
  useEffect(() => {
    const onKey = e => {
      const inText = e.target.closest && e.target.closest('textarea, input, [contenteditable="true"]');
      if (inText) return;
      if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); e.stopPropagation(); addNode(false); }
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (sel) addNode(true); }
      else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); up(); }
      else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); back(); }
      else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); fwd(); }
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // 贴图：选中节点时 Ctrl+V 图片 → 进节点
  useEffect(() => {
    const onPaste = e => {
      if (!sel || sel.startsWith('@portal:')) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault(); e.stopPropagation();
      const r = new FileReader();
      r.onload = () => setImages(m => ({ ...m, [sel]: r.result }));
      r.readAsDataURL(item.getAsFile());
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [sel]);

  // 大纲里：Tab 缩进、Shift+Tab 反缩进、回车保持缩进
  const onTaKey = e => {
    const ta = e.target, { selectionStart: s, selectionEnd: en, value: v } = ta;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (v.startsWith('  ', lineStart)) { setText(v.slice(0, lineStart) + v.slice(lineStart + 2)); requestAnimationFrame(() => ta.setSelectionRange(s - 2, en - 2)); }
      } else { setText(v.slice(0, lineStart) + '  ' + v.slice(lineStart)); requestAnimationFrame(() => ta.setSelectionRange(s + 2, en + 2)); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ind = v.slice(lineStart).match(/^ */)[0];
      setText(v.slice(0, s) + '\n' + ind + v.slice(en));
      requestAnimationFrame(() => ta.setSelectionRange(s + 1 + ind.length, s + 1 + ind.length));
    }
  };

  const crumbs = breadcrumb(graph, realScope);
  return (
    <div className="shell">
      <aside className="outline">
        <div className="bar"><b>大纲</b><span className="hint">缩进=子级　-&gt; 名称=连线　✅◐○=状态</span></div>
        <textarea ref={taRef} value={text} spellCheck={false} onChange={e => setText(e.target.value)} onKeyDown={onTaKey} />
        {graph.errors.length > 0 && <div className="errs">{graph.errors.map((er, i) => <div key={i}>第 {er.line} 行：{er.msg}</div>)}</div>}
      </aside>
      <main>
        <div className="bar top">
          <span className="crumbs">{crumbs.map((c, i) => <span key={c.id}>{i > 0 && ' › '}<a onClick={() => { go(c.id); setSelected(null); }}>{c.label}</a></span>)}</span>
          <span className="hint">双击=钻进　Alt+↑=上一层 Alt+←/→=后退/前进　Enter=同级　Tab=子级　选中+Ctrl+V=贴图　{name === 'tldraw' ? 'A=箭头工具连线 V=选择' : '从节点边缘拖=连线'}</span>
          <button onClick={() => setExportText(exportForLLM(graph, realScope))}>导出给 LLM</button>
          <button onClick={() => { if (confirm('重置大纲为样例、清空坐标与图片？')) { setText(SAMPLE); setPositions({}); setImages({}); } }}>重置</button>
          <a className="switch" href={name === 'tldraw' ? './reactflow.html' : './tldraw.html'}>换 {name === 'tldraw' ? 'React Flow' : 'tldraw'} →</a>
        </div>
        <div className="canvas">
          <Canvas key={realScope} view={view} layout={layout} selected={sel} images={images}
            onSelect={setSelected} onDrill={drill} onConnect={connect} onMove={move}
            viewport={viewports[realScope]} onViewport={vp => onViewport(realScope, vp)} />
        </div>
      </main>
      {exportText !== null && (
        <div className="modal" onClick={() => setExportText(null)}>
          <div onClick={e => e.stopPropagation()}>
            <div className="bar"><b>给 LLM 的结构化文本（当前范围）</b>
              <button onClick={() => navigator.clipboard.writeText(exportText)}>复制</button>
              <button onClick={() => setExportText(null)}>关闭</button></div>
            <pre>{exportText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// 两个画布共用的节点外观
export const STATUS_ICON = { done: '✅', partial: '◐', todo: '○' };
export const COLORS = { in: '#2b7bff', out: '#ff8a1f', idle: '#8a94a6' };
export function edgeLook(e, selected) {
  const w = 1.5 + Math.log2(e.count) * 1.5;
  if (!selected) return { color: COLORS.idle, opacity: 0.55, width: w };
  if (e.to === selected) return { color: COLORS.in, opacity: 1, width: w + 0.5 };
  if (e.from === selected) return { color: COLORS.out, opacity: 1, width: w + 0.5 };
  return { color: COLORS.idle, opacity: 0.08, width: w };
}
export function nodeDim(id, view, selected) {
  if (!selected || id === selected) return false;
  return !view.edges.some(e => (e.from === selected && e.to === id) || (e.to === selected && e.from === id));
}
export function NodeCard({ node, img, dim, isSel }) {
  return (
    <div className={'card' + (dim ? ' dim' : '') + (isSel ? ' sel' : '')}>
      <div className="title">{node.status && <span className="st">{STATUS_ICON[node.status]}</span>}{node.label}
        {node.children.length > 0 && <span className="kids" title="双击钻进">▸ {node.children.length}</span>}</div>
      {img && <img src={img} draggable={false} />}
    </div>
  );
}
export function PortalCard({ portal, dim }) {
  return <div className={'card portal' + (dim ? ' dim' : '')} title={'在别的层：' + portal.target + '（双击跳过去）'}>{portal.label}</div>;
}
