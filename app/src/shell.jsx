// 外壳：左大纲（真源）、面包屑、导出、快捷键、贴图、工作区读写。
// 画布组件（main.jsx，React Flow）只负责「显示 view + 回报用户操作」。
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { parseOutline, projectView, breadcrumb, exportForLLM, withEdge, withNode, withoutNode, withStatus, autoLayout, lineOf, ROOT } from './outline.js';
import { ContextMenu, PropsPanel, FileTree, FilePanel } from './panels.jsx';
import { SAMPLE } from './sample.js';
import './shell.css';

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额满/隐私模式：不持久化 */ } };

// >v<🚀启停-心跳-页面每 20s ping，全关后服务自动退出
// 心跳：告诉服务「还有网页开着」（全关后服务自动退出，见 vite.config.js）
const ping = () => fetch('/__alive').catch(() => {});
ping(); setInterval(ping, 20000);

// >v<💾工作区-界面接入-默认读写被规划项目的 __synapsis/；?demo = 样例数据 + localStorage（自动化测试用，不碰真文件）；?ws=<目录> 指定工作区
const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo');
const WSQ = Q.get('ws') ? 'ws=' + encodeURIComponent(Q.get('ws')) : '';
const withWs = path => '/api' + path + (WSQ ? (path.includes('?') ? '&' : '?') + WSQ : '');
const api = (path, opts) => fetch(withWs(path), opts && { ...opts, headers: { 'content-type': 'application/json' } })
  .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || (j.report && j.report.errors && JSON.stringify(j.report.errors)) || r.status); return j; });

export function Shell({ name, Canvas }) {
  const [mode, setMode] = useState(DEMO ? 'demo' : 'loading'); // demo | loading | ws | offline
  const [wsData, setWsData] = useState(null);
  const [saveState, setSaveState] = useState('');
  const lastSaved = useRef(null);
  const local = mode === 'demo' || mode === 'offline';
  const [text, setText] = useState(() => DEMO ? load('syn.text', SAMPLE) : '');
  const [scope, setScope] = useState(ROOT);
  const [selected, setSelected] = useState(null);
  const [positions, setPositions] = useState(() => DEMO ? load('syn.pos.' + name, {}) : {});
  const [localImages, setImages] = useState(() => load('syn.img', {}));
  const [exportText, setExportText] = useState(null);
  // >v<🧭导航-视图记忆-每个范围各存平移+缩放
  // 每个范围各记一份视图（平移+缩放），返回上一级/再钻进来时还原
  const [viewports, setViewports] = useState(() => load('syn.vp.' + name, {}));
  // >v<🧭导航-历史-Alt+←/→ 后退前进，Alt+↑ 上一层
  // 导航历史：像浏览器一样 Alt+← / Alt+→
  const hist = useRef({ back: [], fwd: [] });
  const taRef = useRef(null);
  // >v<🔭视图投影-原地展开-不钻进去也能看子级：卡片里列出子节点（▸N 点一下 / 空格），双击子项跳进去并选中
  const [expanded, setExpanded] = useState(() => load('syn.exp', {}));

  const graph = useMemo(() => parseOutline(text), [text]);
  const realScope = graph.nodes.has(scope) ? scope : ROOT;
  // 边标签 / 节点副标题来自工作区文件（大纲里没有）
  const view = useMemo(() => {
    const v = projectView(graph, realScope);
    const lab = new Map((wsData?.edges || []).map(e => [e.from + '->' + e.to, e.label]));
    return {
      ...v,
      nodes: v.nodes.map(n => ({
        ...n, sub: wsData?.nodes[n.id]?.meta?.rate || '',
        open: !!expanded[n.id] && n.children.length > 0,
        kids: n.children.map(c => { const k = graph.nodes.get(c); return { id: c, label: k.label, status: k.status, n: k.children.length }; }),
      })),
      edges: v.edges.map(e => ({ ...e, text: e.count > 1 ? '×' + e.count : lab.get(e.raw[0]) || '' })),
    };
  }, [graph, realScope, wsData, expanded]);
  const images = useMemo(() => {
    if (local) return localImages;
    const m = {};
    for (const [id, n] of Object.entries(wsData?.nodes || {})) if (n.meta.img) m[id] = withWs('/file?p=' + encodeURIComponent(n.meta.img));
    return m;
  }, [local, localImages, wsData]);

  // 启动：从工作区加载；失败 → 离线（localStorage）
  useEffect(() => {
    if (DEMO) return;
    api('/ws').then(d => { lastSaved.current = d.outline; setText(d.outline); setPositions(d.layout || {}); setWsData(d); setMode('ws'); setSaveState(d.errors.length ? '⚠️ 文件里有 ' + d.errors.length + ' 处解析错误（跑 check）' : '已加载'); })
      .catch(e => { setMode('offline'); setText(load('syn.text', SAMPLE)); setPositions(load('syn.pos.' + name, {})); setSaveState('⚠️ 没连上工作区（' + e.message + '），本地离线模式'); });
  }, []);
  // 自动保存：大纲停手 0.7s 且无错误 → 写回文件
  useEffect(() => {
    if (mode !== 'ws' || text === lastSaved.current) return;
    if (graph.errors.length) { setSaveState('大纲有错，暂不保存'); return; }
    const t = setTimeout(() => {
      setSaveState('保存中…');
      api('/outline', { method: 'PUT', body: JSON.stringify({ outline: text }) })
        .then(d => { lastSaved.current = text; setWsData(d); const r = d.report; setSaveState('已保存 ' + new Date().toLocaleTimeString() + (r.removed.length ? '（' + r.removed.length + ' 个节点移进 _过期的/）' : '')); })
        .catch(e => setSaveState('❌ 保存失败：' + e.message));
    }, 700);
    return () => clearTimeout(t);
  }, [text, mode]);
  const layout = useMemo(() => autoLayout(view, positions), [view, positions]);
  // 自动排出来的位置立刻固定（存起来），之后加节点别的节点不会跟着跳
  useEffect(() => {
    const missing = Object.fromEntries(Object.entries(layout).filter(([id]) => !positions[id]));
    if (Object.keys(missing).length) move(missing);
  }, [layout]);
  const sel = selected && (view.nodes.some(n => n.id === selected) || view.portals.some(p => p.id === selected)) ? selected : null;

  useEffect(() => { if (local) save('syn.text', text); }, [text, local]);
  useEffect(() => { if (local) save('syn.pos.' + name, positions); }, [positions, name, local]);
  useEffect(() => save('syn.img', localImages), [localImages]);
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
  const move = useCallback(changes => {
    setPositions(p => ({ ...p, ...changes }));
    if (mode === 'ws') api('/layout', { method: 'PUT', body: JSON.stringify({ positions: changes }) }).catch(e => setSaveState('❌ 坐标保存失败：' + e.message));
  }, [mode]);
  // >v<🌳大纲模型-新建节点-Enter 同级 / Tab 子级（父节点原地展开）/ 工具栏＋；建完光标跳到大纲那一行、名字选中，直接打字改名
  const pendingRename = useRef(null);
  const addNode = asChild => {
    const s = sel && !sel.startsWith('@portal:') ? sel : null;
    const parent = s && asChild ? s : s ? graph.nodes.get(s).parent : realScope;
    const r = withNode(graph, parent, asChild ? null : s);
    pendingRename.current = r.id;
    setText(r.text);
    if (asChild) setExpanded(x => ({ ...x, [s]: true })); else setSelected(r.id);
  };
  useEffect(() => {
    const id = pendingRename.current;
    if (!id || !graph.nodes.has(id)) return;
    pendingRename.current = null;
    focusLabel(id);
  }, [graph]);
  // 大纲里选中某节点的名字（改名 = 直接打字）
  const focusLabel = id => {
    setLeftTab('outline');
    const ta = taRef.current, line = lineOf(graph, id);
    if (!ta || line < 0) return;
    const lines = text.split('\n');
    const start = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
    const lab = graph.nodes.get(id).label, at = lines[line].indexOf(lab);
    ta.focus();
    ta.setSelectionRange(start + at, start + at + lab.length);
    // 让选中的那行滚到可见处
    ta.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(ta).lineHeight) - ta.clientHeight / 2);
  };

  // >v<🎨画布-右键菜单-动作：删除（工作区里 = 移进 _过期的/）、改状态、改名、属性
  const [menu, setMenu] = useState(null);       // {x, y, id|null}
  const [propsOpen, setPropsOpen] = useState(false);
  const [leftTab, setLeftTab] = useState('outline'); // outline | files
  const [tree, setTree] = useState(null);
  const [fileView, setFileView] = useState(null); // {path, text|null, note, error}
  const remove = id => {
    const n = graph.nodes.get(id);
    if (!n || id.startsWith('@portal:')) return;
    let k = 0; const cnt = x => { for (const c of graph.nodes.get(x).children) { k++; cnt(c); } }; cnt(id);
    if (k && !confirm(`删除「${n.label}」和它下面 ${k} 个子孙？${mode === 'ws' ? '\n（文件会移进 __synapsis/_过期的/，不会真删）' : ''}`)) return;
    setText(withoutNode(graph, id));
    if (sel === id) setSelected(null);
    setSaveState(`已删除「${n.label}」` + (mode === 'ws' ? '（移进 _过期的/）' : ''));
  };
  const setStatus = (id, s) => setText(withStatus(graph, id, s));
  const menuActions = {
    props: id => { setSelected(id); setPropsOpen(true); setFileView(null); },
    rename: id => focusLabel(id),
    status: setStatus,
    addChild: id => { setSelected(id); const r = withNode(graph, id, null); pendingRename.current = r.id; setText(r.text); setExpanded(x => ({ ...x, [id]: true })); },
    addSibling: id => { const r = withNode(graph, graph.nodes.get(id).parent, id); pendingRename.current = r.id; setText(r.text); setSelected(r.id); },
    addHere: () => { const r = withNode(graph, realScope, null); pendingRename.current = r.id; setText(r.text); setSelected(r.id); },
    toggle: id => toggle(id), drill: id => drill(id), remove,
    up: () => up(), canUp: realScope !== ROOT,
    toggleAll: () => setExpanded(x => { const y = { ...x }; for (const n of view.nodes) if (n.children.length) y[n.id] = !allOpen; return y; }),
  };
  const onContextMenu = useCallback((id, x, y) => { if (id && !id.startsWith('@portal:')) setSelected(id); setMenu({ id: id && !id.startsWith('@portal:') ? id : null, x, y }); }, []);
  // 文件页：切过去时取文件树；点文件 → 右侧预览
  useEffect(() => { if (leftTab === 'files' && mode === 'ws' && !tree) api('/tree').then(setTree).catch(e => setTree({ tree: [], error: e.message })); }, [leftTab, mode]);
  const openFile = p => { setPropsOpen(false); setFileView({ path: p }); api('/raw?p=' + encodeURIComponent(p)).then(setFileView).catch(e => setFileView({ path: p, error: e.message })); };
  const saveBody = (id, body) => api('/node', { method: 'PATCH', body: JSON.stringify({ id, body }) }).then(d => { setWsData(d); setSaveState('正文已保存 ' + new Date().toLocaleTimeString()); }).catch(e => setSaveState('❌ 正文保存失败：' + e.message));

  useEffect(() => save('syn.exp', expanded), [expanded]);
  const toggle = id => setExpanded(x => ({ ...x, [id]: !x[id] }));
  cardActions.toggle = toggle;
  cardActions.openChild = child => { const p = graph.nodes.get(child)?.parent; if (p == null) return; go(p); setSelected(child); };
  const allOpen = view.nodes.filter(n => n.children.length).every(n => expanded[n.id]);

  // >v<🧭导航-快捷键-Enter 同级 / Tab 子级 / Esc / Alt+方向
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
      else if (e.key === ' ' && sel && !sel.startsWith('@portal:')) { e.preventDefault(); e.stopPropagation(); toggle(sel); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); e.stopPropagation(); remove(sel); }
      else if (e.key === 'F2' && sel) { e.preventDefault(); focusLabel(sel); }
      else if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFileView(null); setPropsOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // >v<🎨画布-贴图-选中节点 Ctrl+V 图片进节点
  // 贴图：选中节点时 Ctrl+V 图片 → 进节点
  useEffect(() => {
    const onPaste = e => {
      if (!sel || sel.startsWith('@portal:')) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault(); e.stopPropagation();
      const r = new FileReader();
      r.onload = () => {
        if (mode !== 'ws') return setImages(m => ({ ...m, [sel]: r.result }));
        api('/asset', { method: 'POST', body: JSON.stringify({ id: sel, dataUrl: r.result }) }).then(() => api('/ws')).then(setWsData).catch(e => setSaveState('❌ 贴图失败：' + e.message));
      };
      r.readAsDataURL(item.getAsFile());
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [sel, mode]);

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
        <div className="bar tabs">
          <a className={leftTab === 'outline' ? 'on' : ''} onClick={() => setLeftTab('outline')}>大纲</a>
          <a className={leftTab === 'files' ? 'on' : ''} onClick={() => setLeftTab('files')} title="项目根目录里 __synapsis 之外的文件（只读）">文件</a>
          <span className="hint">{leftTab === 'outline' ? '缩进=子级　-> 名称=连线　✅◐○=状态' : mode === 'ws' ? '点文件 → 右侧预览' : '样例模式没有项目文件'}</span>
        </div>
        <textarea ref={taRef} value={text} spellCheck={false} onChange={e => setText(e.target.value)} onKeyDown={onTaKey} style={{ display: leftTab === 'outline' ? '' : 'none' }} />
        {leftTab === 'files' && mode === 'ws' && <FileTree tree={tree} onOpen={openFile} current={fileView?.path} />}
        {leftTab === 'outline' && graph.errors.length > 0 && <div className="errs">{graph.errors.map((er, i) => <div key={i}>第 {er.line} 行：{er.msg}</div>)}</div>}
      </aside>
      <main>
        <div className="bar top">
          <span className="crumbs">{crumbs.map((c, i) => <span key={c.id}>{i > 0 && ' › '}<a onClick={() => { go(c.id); setSelected(null); }}>{c.label}</a></span>)}</span>
          <span className="hint">右键=菜单　双击=钻进　▸N/空格=展开　Del=删除　F2=改名　I=属性　Enter/Tab=新建　Alt+↑←→=导航　边缘拖=连线</span>
          <button onClick={() => addNode(false)} title="在当前层新建（选中节点时建在它后面）；建完直接打字改名">＋ 节点</button>
          <button onClick={() => setExpanded(x => { const y = { ...x }; for (const n of view.nodes) if (n.children.length) y[n.id] = !allOpen; return y; })}>{allOpen ? '全部收起' : '全部展开'}</button>
          <button onClick={() => setExportText(exportForLLM(graph, realScope))}>导出给 LLM</button>
          {local && <button onClick={() => { if (confirm('重置大纲为样例、清空坐标与图片？')) { setText(SAMPLE); setPositions({}); setImages({}); } }}>重置</button>}
          <span className={'save' + (saveState.startsWith('❌') || saveState.startsWith('⚠') ? ' bad' : '')} title={wsData?.root || ''}>{mode === 'ws' ? '📁 ' + (wsData?.root || '').split(/[\\/]/).slice(-2).join('/') + '　' : mode === 'demo' ? '🧪 样例　' : ''}{saveState}</span>
        </div>
        {mode === 'loading' ? <div className="canvas"><div className="hint" style={{ padding: 20 }}>加载工作区…</div></div> : <div className="canvas">
          <Canvas key={realScope} view={view} layout={layout} selected={sel} images={images}
            onSelect={setSelected} onDrill={drill} onConnect={connect} onMove={move} onContextMenu={onContextMenu}
            viewport={viewports[realScope]} onViewport={vp => onViewport(realScope, vp)} />
        </div>}
      </main>
      {propsOpen && sel && !sel.startsWith('@portal:') && graph.nodes.has(sel) && (
        <PropsPanel id={sel} graph={graph} wsNode={wsData?.nodes[sel]} edges={mode === 'ws' ? (wsData?.edges || []) : graph.edges}
          editable={mode === 'ws'} onStatus={setStatus} onBody={saveBody} onSelect={id => { const p = graph.nodes.get(id)?.parent; if (p != null && p !== realScope) go(p); setSelected(id); }} onClose={() => setPropsOpen(false)} />
      )}
      {propsOpen && !sel && <aside className="side"><div className="bar"><b>属性</b><button onClick={() => setPropsOpen(false)}>✕</button></div><div className="sidebody hint">选中一个节点看它的属性（I 开关）</div></aside>}
      {fileView && <FilePanel file={fileView.text !== undefined || fileView.error || fileView.note ? fileView : null} onClose={() => setFileView(null)} />}
      {menu && <ContextMenu menu={menu} node={menu.id ? { ...graph.nodes.get(menu.id), open: !!expanded[menu.id], descendants: (() => { let k = 0; const c = x => { for (const y of graph.nodes.get(x).children) { k++; c(y); } }; c(menu.id); return k; })() } : null}
        actions={{ ...menuActions, allOpen }} onClose={() => setMenu(null)} />}
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
// 卡片上的交互回调（外壳每次渲染时填好；画布组件不用逐层传）
export const cardActions = { toggle: () => {}, openChild: () => {} };
// pointerdown 也要拦住，否则 React Flow 会把它当成选中或拖动的开始
const stop = e => e.stopPropagation();
export function NodeCard({ node, img, dim, isSel }) {
  return (
    <div className={'card' + (dim ? ' dim' : '') + (isSel ? ' sel' : '')}>
      <div className="title">{node.status && <span className="st">{STATUS_ICON[node.status]}</span>}{node.label}
        {node.children.length > 0 && <span className="kids" title="展开/收起子级（空格）；双击卡片钻进" onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.toggle(node.id); }}>{node.open ? '▾' : '▸'} {node.children.length}</span>}</div>
      {node.sub && <div className="sub">{node.sub}</div>}
      {node.open && node.kids && <ul className="kidlist">{node.kids.map(k => (
        <li key={k.id} title="双击跳进去" onPointerDown={stop} onMouseDown={stop} onDoubleClick={e => { e.stopPropagation(); cardActions.openChild(k.id); }}>
          <span className="st">{k.status ? STATUS_ICON[k.status] : '·'}</span>{k.label}{k.n > 0 && <span className="kn">▸{k.n}</span>}
        </li>))}</ul>}
      {img && <img src={img} draggable={false} />}
    </div>
  );
}
export function PortalCard({ portal, dim }) {
  return <div className={'card portal' + (dim ? ' dim' : '')} title={'在别的层：' + portal.target + '（双击跳过去）'}>{portal.label}</div>;
}
