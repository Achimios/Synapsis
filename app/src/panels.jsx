// 右键菜单、属性面板、文件树（外部区）、文件预览。外壳把状态和动作传进来，这里只管显示。
import { useEffect, useMemo, useRef, useState } from 'react';

import { PALETTE } from './colors.js';
import { searchNodes, filterTree } from './search.js';
const STATUS = [['done', '✅'], ['partial', '◐'], ['todo', '○'], ['dropped', '❌']];

// >v<🎨画布-右键菜单-节点：属性/改名/状态/新建/展开/钻进/删除；空白处：新建/全部展开/上一层
export function ContextMenu({ menu, node, actions, onClose }) {
  useEffect(() => {
    const close = () => onClose();
    const key = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const item = (label, fn, opts = {}) => (
    <div className={'mi' + (opts.danger ? ' danger' : '')} onPointerDown={e => e.stopPropagation()} onClick={() => { onClose(); fn(); }}>
      <span>{label}</span>{opts.key && <kbd>{opts.key}</kbd>}
    </div>
  );
  const style = { left: Math.min(menu.x, innerWidth - 220), top: Math.min(menu.y, innerHeight - 460) };
  if (menu.edge) { // 右键连线：删除（聚合的线 = 里面每一条）/ 换类型
    const pairs = menu.edge.raw.map(r => r.split('->'));
    return (
      <div className="ctx" style={style}>
        <div className="mh">{menu.edge.count > 1 ? `${menu.edge.count} 条连线（聚合）` : '连线'}</div>
        {pairs.length === 1 && actions.canEdgeKind && item('换类型：普通 → 调节 → 离散', () => actions.edgeKind(pairs[0][0], pairs[0][1]))}
        {item('🗑️ 删除' + (pairs.length > 1 ? `这 ${pairs.length} 条连线` : '这条连线'), () => actions.removeEdges(pairs), { danger: true })}
      </div>
    );
  }
  if (!node) return (
    <div className="ctx" style={style}>
      {item('＋ 在这里新建节点', actions.addHere)}
      {item(actions.allOpen ? '全部收起' : '全部展开', actions.toggleAll)}
      {actions.canUp && item('↑ 返回上一层', actions.up, { key: 'Alt+↑' })}
    </div>
  );
  return (
    <div className="ctx" style={style}>
      <div className="mh">{node.label}</div>
      {item('属性…', () => actions.props(node.id), { key: 'I' })}
      {item('重命名', () => actions.rename(node.id), { key: 'F2' })}
      <div className="mi row" onPointerDown={e => e.stopPropagation()}>
        <span>状态</span>
        {STATUS.map(([s, ic]) => <button key={s} className={node.status === s ? 'on' : ''} onClick={() => { onClose(); actions.status(node.id, s); }}>{ic}</button>)}
        <button title="清除状态（不标）" onClick={() => { onClose(); actions.status(node.id, null); }}>—</button>
      </div>
      {actions.color && <div className="mi row swatches" onPointerDown={e => e.stopPropagation()}>
        <span>颜色</span>
        {Object.entries(PALETTE).map(([k, c]) => <button key={k} title={k} className={node.colorSet === k ? 'on' : ''} style={{ background: c }} onClick={() => { onClose(); actions.color(node.id, k); }} />)}
        <button title="自动（按分组 / 名字配色，子节点跟着父节点）" className={!node.colorSet ? 'on auto' : 'auto'} onClick={() => { onClose(); actions.color(node.id, null); }}>自动</button>
        {actions.colorWords && <button title="自动配色按名字里的词认颜色：打开这个工作区的词表 __synapsis/_配色.md（没有就按默认建一份）" className="auto" onClick={() => { onClose(); actions.colorWords(); }}>词表…</button>}
      </div>}
      {item('🔗 连线到…', () => actions.linkTo(node.id), { key: 'L' })}
      {item('＋ 新建子节点', () => actions.addChild(node.id), { key: 'Tab' })}
      {item('＋ 新建同级', () => actions.addSibling(node.id), { key: 'Enter' })}
      {node.children.length > 0 && item(node.open ? '收起子级' : '原地展开子级', () => actions.toggle(node.id), { key: '空格' })}
      {node.children.length > 0 && item(actions.isFramed(node.id) ? '⊟ 收起框' : '⊞ 原地展开成框', () => actions.frame(node.id), { key: 'F' })}
      {item('钻进去', () => actions.drill(node.id), { key: '双击' })}
      {actions.hasFile(node.id) && item('看 md 原文', () => actions.openMd(node.id))}
      {actions.hasFile(node.id) && item('在资源管理器中显示', () => actions.reveal(node.id))}
      {item('贴图…', () => actions.pasteHint(node.id), { key: 'Ctrl+V' })}
      {item('🗑️ 删除' + (node.children.length ? `（含 ${countAll(node)} 个子孙）` : ''), () => actions.remove(node.id), { danger: true, key: 'Del' })}
    </div>
  );
}
const countAll = n => n.descendants ?? n.children.length;

// >v<🎨画布-属性面板-节点属性/出入边/正文（工作区模式下正文可改，失焦保存）
// >v<🎨画布-属性可编辑-值失焦保存（清空 = 删掉这个键）；底下一行加新属性；空间相关的给快捷按钮（轴 / 坐标 / 映射）
const LOCKED = new Set(['to', 'label', 'status', 'order']);
// >v<🗂️属性面板-属性表-改名 / 改值失焦就存；清空值 = 值留空（不删属性），删属性点 ✕；新行填了名字，失焦也存（👤 2026-10-08）
function MetaTable({ id, meta, editable, onMeta, hints = [] }) {
  const [k, setK] = useState(''), [v, setV] = useState('');
  const keyRef = useRef(null), addRef = useRef(null);
  useEffect(() => { setK(''); setV(''); }, [id]);
  const keys = new Set(meta.map(([key]) => key));
  const add = () => { const kk = k.trim(); if (!kk || LOCKED.has(kk) || keys.has(kk)) return; onMeta(id, { [kk]: v.trim() }); setK(''); setV(''); };
  // 焦点离开整行才存（在名字和值之间切换不算）
  const addBlur = e => { if (!addRef.current?.contains(e.relatedTarget)) add(); };
  const rows = meta.filter(([key]) => !LOCKED.has(key));
  if (!editable) return rows.length > 0 ? <table className="meta"><tbody>{rows.map(([key, val]) => <tr key={key}><td>{key}</td><td>{Array.isArray(val) ? val.join('；') : val}</td></tr>)}</tbody></table> : null;
  const keyOk = (nk, old) => nk && nk !== old && !LOCKED.has(nk) && !keys.has(nk) && !/[:\r\n]/.test(nk);
  return (
    <table className="meta edit"><tbody>
      {rows.map(([key, val]) => <tr key={key}>
        <td><input key={id + key} className="mk" defaultValue={key} disabled={Array.isArray(val)} title="属性名：改完失焦保存（不能和已有的重名）"
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = key; e.currentTarget.blur(); } }}
          onBlur={e => { const nk = e.currentTarget.value.trim(); if (keyOk(nk, key)) onMeta(id, { [key]: null, [nk]: val }); else e.currentTarget.value = key; }} /></td>
        <td><input key={id + key + val} defaultValue={Array.isArray(val) ? val.join('；') : val} disabled={Array.isArray(val)} title={Array.isArray(val) ? '列表值请在原文里改' : '失焦保存；清空 = 值留空（删属性点 ✕）'}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = val; e.currentTarget.blur(); } }}
          onBlur={e => { const nv = e.currentTarget.value.trim(); if (nv !== String(val)) onMeta(id, { [key]: nv }); }} /></td>
        <td className="mx"><button title={'删掉属性「' + key + '」'} onClick={() => onMeta(id, { [key]: null })}>✕</button></td></tr>)}
      <tr className="addrow" ref={addRef}><td><input ref={keyRef} placeholder="＋ 属性" value={k} onChange={e => setK(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} onBlur={addBlur} /></td>
        <td><input placeholder="值（回车 / 失焦添加）" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} onBlur={addBlur} /></td><td /></tr>
      {k.trim() && keys.has(k.trim()) && <tr><td colSpan={3} className="hint bad">已经有「{k.trim()}」了</td></tr>}
      {hints.length > 0 && <tr><td colSpan={3} className="metahints">{hints.map(h => <button key={h.label} title={h.title} onClick={() => { setK(h.key); setV(h.value); keyRef.current?.focus(); }}>{h.label}</button>)}</td></tr>}
    </tbody></table>
  );
}

export function PropsPanel({ id, graph, wsNode, edges, editable, onStatus, onBody, onMeta, metaHints, onSelect, onClose, file, tab, onTab, raw, onReveal, onRename, color, onColor, onColorWords, onEdgeKind, onEdgeRemove }) {
  const n = graph.nodes.get(id);
  const [body, setBody] = useState(wsNode?.body || '');
  useEffect(() => setBody(wsNode?.body || ''), [id, wsNode?.body]);
  if (!n) return null;
  const meta = Object.entries(wsNode?.meta || {}).filter(([k]) => k !== 'to');
  // 分组自己没有边 → 显示「经由子节点」的对外连接（子树内部的边不算）
  const sub = new Set(); const walk = x => { sub.add(x); for (const c of graph.nodes.get(x)?.children || []) walk(c); }; walk(id);
  const ins = edges.filter(e => sub.has(e.to) && !sub.has(e.from)), outs = edges.filter(e => sub.has(e.from) && !sub.has(e.to));
  const lab = id2 => graph.nodes.get(id2)?.label || id2;
  const via = (e, inner) => inner !== id ? <span className="el">经 {lab(inner)}</span> : null;
  const kindBtn = e => onEdgeKind ? <button className={'ek' + (e.kind ? ' on' : '')} title="点一下换类型：普通 → 调节（◆ 从下往上连，不算数据流）→ 离散（虚线）→ 普通" onClick={() => onEdgeKind(e.from, e.to, e.label || '', e.kind || '')}>{e.kind || '普通'}</button> : e.kind ? <span className="el">{e.kind}</span> : null;
  const edgeRow = (e, other, inner) => <li key={e.from + e.to}><a onClick={() => onSelect(other)}>{lab(other)}</a>{e.label && <span className="el">{e.label}</span>}{kindBtn(e)}{via(e, inner)}
    {onEdgeRemove && <button className="ex" title="删除这条连线" onClick={() => onEdgeRemove(e.from, e.to)}>✕</button>}</li>;
  return (
    <aside className="side">
      <div className="bar tabs"><a className={tab !== 'raw' ? 'on' : ''} onClick={() => onTab('info')}>概览</a>
        {file && <a className={tab === 'raw' ? 'on' : ''} onClick={() => onTab('raw')} title="节点 .md 原文（含 frontmatter）">原文</a>}
        <span className="hint" title={id}>{id}</span><button onClick={onClose} title="关闭（I）">✕</button></div>
      {tab === 'raw' && file ? <div className="sidebody"><h3>{n.label}</h3>
        <div className="filerow"><span className="hint" title={file}>{file}</span>
          <button onClick={() => onReveal(file, 'select')} title="在资源管理器中显示">📂</button>
          <button onClick={() => onReveal(file, 'open')} title="用默认程序打开（Obsidian / 编辑器）">↗</button></div>
        <pre className="raw">{raw ?? '读取中…'}</pre></div> :
      <div className="sidebody">
        {/* >v<🎨画布-属性面板-名字（改了回车 / 失焦 = 改名）、状态、颜色（色块 = 写 color:，自动 = 删掉）—— 👤 2026-10-08 */}
        <h3><input key={id + '|' + n.label} className="nameedit" defaultValue={n.label} title="改名：回车或点别处生效，Esc 还原"
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); else if (e.key === 'Escape') { e.target.value = n.label; e.target.blur(); } }}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== n.label) onRename(id, v); else e.target.value = n.label; }} /></h3>
        <div className="row">状态 {STATUS.map(([s, ic]) => <button key={s} className={n.status === s ? 'on' : ''} onClick={() => onStatus(id, s)}>{ic}</button>)}
          <button title="清除状态（不标）" onClick={() => onStatus(id, null)}>—</button></div>
        {onColor && <div className="row swatches">颜色 <span className="cur" style={{ background: color }} title={'现在：' + color + (wsNode?.meta?.color ? '（手动）' : '（自动）')} />
          {Object.entries(PALETTE).map(([k, c]) => <button key={k} title={k} className={wsNode?.meta?.color === k ? 'on' : ''} style={{ background: c }} onClick={() => onColor(id, k)} />)}
          <button className={'auto' + (!wsNode?.meta?.color ? ' on' : '')} title="自动（按分组 / 词表配色）" onClick={() => onColor(id, null)}>自动</button>
          {onColorWords && <button className="auto" title="自动配色按名字里的词认颜色：打开这个工作区的词表 __synapsis/_配色.md" onClick={onColorWords}>词表…</button>}</div>}
        <MetaTable id={id} meta={meta} editable={editable} onMeta={onMeta} hints={metaHints} />
        {(ins.length > 0 || outs.length > 0) && <div className="edges">
          {ins.length > 0 && <><div className="eh in">← 输入{sub.size > 1 ? '（含子节点）' : ''}</div><ul>{ins.map(e => edgeRow(e, e.from, e.to))}</ul></>}
          {outs.length > 0 && <><div className="eh out">→ 输出{sub.size > 1 ? '（含子节点）' : ''}</div><ul>{outs.map(e => edgeRow(e, e.to, e.from))}</ul></>}
        </div>}
        <div className="eh">正文{editable ? '（失焦自动保存）' : '（样例模式不可编辑）'}</div>
        <textarea className="body" value={body} readOnly={!editable} placeholder={editable ? '想法、职责、验收方式……（存进这个节点的 .md）' : ''}
          onChange={e => setBody(e.target.value)} onBlur={() => { if (editable && body !== (wsNode?.body || '')) onBody(id, body); }} />
        {file && tab !== 'raw' && <div className="filerow"><span className="hint" title={file}>{file}</span>
          <button onClick={() => onReveal(file, 'select')} title="在资源管理器中显示">📂</button>
          <button onClick={() => onReveal(file, 'open')} title="用默认程序打开（Obsidian / 编辑器）">↗</button></div>}
      </div>}
    </aside>
  );
}

// >v<🗂️外部区-文件树-左栏「文件」页：项目根目录（__synapsis 之外），点文件右侧预览
export function FileTree({ tree, onOpen, current }) {
  const [open, setOpen] = useState({});
  if (!tree) return <div className="hint" style={{ padding: 12 }}>加载中…</div>;
  const walk = (items, depth) => items.map(it => (
    <div key={it.path}>
      <div className={'fi' + (it.path === current ? ' cur' : '')} style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => it.dir ? setOpen(o => ({ ...o, [it.path]: !o[it.path] })) : onOpen(it.path)}>
        {it.dir ? (open[it.path] ? '▾ 📁 ' : '▸ 📁 ') : '　 📄 '}{it.name}
      </div>
      {it.dir && open[it.path] && walk(it.children, depth + 1)}
    </div>
  ));
  return <div className="files">{walk(tree.tree, 0)}{tree.truncated && <div className="hint">（文件太多，只列了前 3000 个）</div>}</div>;
}

export function FilePanel({ file, onClose }) {
  return (
    <aside className="side wide">
      <div className="bar"><b>📄 {file?.path}</b><span className="hint">只读预览</span><button onClick={onClose}>✕</button></div>
      <div className="sidebody">
        {!file ? <div className="hint">加载中…</div> : file.error ? <div className="errs">{file.error}</div> : file.text === null ? <div className="hint">{file.note}</div> : <pre className="raw">{file.text}</pre>}
      </div>
    </aside>
  );
}

// >v<🌳大纲模型-大纲树-左栏默认页：点一下 = 导航 + 看内容（不进编辑）；双击 / F2 = 原地改名；▸ 折叠；→ 钻进；↑↓←→ 键盘走
export function OutlineTree({ graph, selected, scope, renaming, status, onPick, onDrill, onRename, onCommit, onCancel }) {
  const [open, setOpen] = useState({});
  const [q, setQ] = useState(''); // 过滤：只留名字命中的和它们的祖先（全部展开）
  const flt = useMemo(() => filterTree(graph, q), [graph, q]);
  const box = useRef(null);
  // 默认：前两层展开；当前页和选中节点的祖先一律展开（大纲里永远看得到「我在哪」）
  const focus = new Set();
  for (const f of [scope, selected]) for (let c = f; c && graph.nodes.has(c); c = graph.nodes.get(c).parent) focus.add(c);
  const isOpen = (id, depth) => flt ? true : open[id] ?? (depth < 2 || focus.has(id));
  const rows = [];
  const walk = (id, depth) => { for (const c of graph.nodes.get(id).children) { if (flt && !flt.keep.has(c)) continue; const n = graph.nodes.get(c); rows.push({ n, depth }); if (n.children.length && isOpen(c, depth)) walk(c, depth + 1); } };
  walk('', 0);
  useEffect(() => { box.current?.querySelector('.orow.sel')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const onKey = e => {
    if (renaming) return;
    const i = rows.findIndex(r => r.n.id === selected), r = rows[i];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const j = Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1))); onPick(rows[j].n.id); }
    else if (e.key === 'ArrowRight' && r?.n.children.length) { e.preventDefault(); setOpen(o => ({ ...o, [r.n.id]: true })); }
    else if (e.key === 'ArrowLeft' && r) { e.preventDefault(); if (r.n.children.length && isOpen(r.n.id, r.depth)) setOpen(o => ({ ...o, [r.n.id]: false })); else if (r.n.parent) onPick(r.n.parent); }
  };
  return (
    <>
    <input className="ofilter" value={q} placeholder="过滤…（名字）" onChange={e => setQ(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setQ(''); else if (e.key === 'Enter' && flt?.hits.size) onPick([...flt.hits][0]); }} />
    <div className="otree" ref={box} tabIndex={0} onKeyDown={onKey}>
      {flt && !rows.length && <div className="hint" style={{ padding: 6 }}>没有名字含「{q}」的节点（Ctrl+F 可以搜属性和正文）</div>}
      {rows.map(({ n, depth }) => (
        <div key={n.id} className={'orow' + (n.id === selected ? ' sel' : '') + (n.id === scope && scope ? ' scope' : '') + (flt?.hits.has(n.id) ? ' hit' : '')} style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => { if (renaming !== n.id) onPick(n.id); }} onDoubleClick={() => onRename(n.id)} title={n.id}>
          <span className="ocaret" onClick={e => { e.stopPropagation(); if (n.children.length) setOpen(o => ({ ...o, [n.id]: !isOpen(n.id, depth) })); }}>{n.children.length ? (isOpen(n.id, depth) ? '▾' : '▸') : ''}</span>
          <span className="ost">{n.status ? status[n.status] : '·'}</span>
          {renaming === n.id
            ? <input autoFocus defaultValue={n.label} onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.target.dataset.done = 1; onCommit(n.id, e.target.value); } else if (e.key === 'Escape') { e.target.dataset.done = 1; onCancel(); } }}
                onBlur={e => { if (!e.target.dataset.done) onCommit(n.id, e.target.value); }} />
            : <span className={'olab' + (n.status === 'dropped' ? ' strike' : '')}>{n.label}</span>}
          {n.children.length > 0 && renaming !== n.id && <span className="odrill" title="钻进这一层（画布显示它的子节点）" onClick={e => { e.stopPropagation(); onDrill(n.id); }}>→</span>}
        </div>
      ))}
    </div>
    </>
  );
}

// >v<🧭导航-快捷键页-? 或 F1 弹出；键位只在这张表里写一次（以后要自定义就从这里长出来）
// >v<🏗️构建引导-项目文档对话框-先检测：已存在的灰掉；有同类中文名文件的默认不勾；其余默认勾上。只创建勾上的
export function ScaffoldModal({ items, root, onCreate, onClose }) {
  const [pick, setPick] = useState(() => new Set(items.filter(i => !i.exists && !i.alike.length).map(i => i.rel)));
  const flip = rel => setPick(s => { const t = new Set(s); t.has(rel) ? t.delete(rel) : t.add(rel); return t; });
  const missing = items.filter(i => !i.exists);
  return (
    <div className="modal" onClick={onClose}>
      <div className="scaffold" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>项目文档骨架</b><span className="hint" style={{ flex: 1 }} title={root}>{root}</span><button onClick={onClose}>✕</button></div>
        <div className="sidebody">
          <p className="hint">开发进度、待办、规矩那一套（和新项目引导同一套模板）。<b>已有的不会覆盖</b>；只是做规划 / 研究的话可以都不要。</p>
          <ul className="scaflist">{items.map(i => (
            <li key={i.rel} className={i.exists ? 'has' : ''}>
              <label><input type="checkbox" disabled={i.exists} checked={i.exists || pick.has(i.rel)} onChange={() => flip(i.rel)} />{i.rel}</label>
              {i.exists ? <span className="hint">已存在</span> : i.alike.length ? <span className="warn">已有同类：{i.alike.join('、')}</span> : null}
            </li>))}</ul>
        </div>
        <div className="bar"><span className="grow" /><button onClick={onClose}>取消</button>
          <button disabled={!pick.size} onClick={() => onCreate([...pick])}>{missing.length ? `创建勾选的 ${pick.size} 个` : '都已存在'}</button></div>
      </div>
    </div>
  );
}

export const KEYMAP = [
  ['选择与查看', [['单击卡片 / 大纲行', '选中，右侧显示概览'], ['I', '属性面板开关'], ['Tab', '左栏开关'], ['? / F1', '这一页']]],
  ['AI', [['Ctrl+J', 'AI 指令框：一句话让本地模型在当前页做事（先预览，Enter 执行，Esc 不要）'], ['顶栏 🤖 AI', '连 LM Studio、选模型、语义配色、生成词表'], ['选中节点 → 右边「🔗 潜在关联」', '可能有关但还没连上的节点 / 文档']]],
  ['搜索', [['Ctrl+F', '全局搜索（名字 / 属性 / 正文）→ 跳过去'], ['大纲顶上的过滤框', '只看名字含这些字的节点']]],
  ['导航', [['双击卡片 / 大纲行的 →', '钻进去'], ['Alt+↑', '上一层'], ['鼠标侧键 / Alt+← →', '后退 / 前进'], ['大纲树里 ↑↓←→', '上下走 / 折叠展开'], ['▸N / 空格', '卡片里原地展开子级'], ['⊞ / F', '分组原地展开成框（子节点画在框里、线直连）']]],
  ['编辑', [['Enter', '新建同级'], ['Insert / Ctrl+Enter', '新建子级'], ['F2 / 双击大纲行', '改名'], ['Del', '删除（进 _过期的/）'], ['卡片边缘拖到另一张', '连线'], ['卡片底下 ◆ 拖到另一张顶上', '调节线（参数 / 修改器，不算数据流）'], ['L / 右键「连线到…」', '搜索目标连线（可以连到别的页）'], ['右键连线 / 属性面板 ✕', '删除连线'], ['Alt + 拖连线', '在线身上任意处按下，拿起离鼠标近的那端：放到别的节点 = 改接，放到空白 = 删除，拖着时右键 / Esc = 取消'], ['右键', '菜单：状态（❌ = 弃用）、颜色、属性、原文……'], ['Ctrl+Z', '撤销（结构、连线、拖动；删除也能撤回）'], ['Ctrl+Shift+Z / Ctrl+Y', '重做']]],
  ['复制', [['Ctrl+C', '复制选中的卡（连同子孙、属性、正文、图片、它们之间的边）'], ['Ctrl+V', '粘到当前页、鼠标处（同名加「 2」）；剪贴板里是图片 = 贴图']]],
  ['选择', [['Ctrl+单击', '加入 / 移出选择'], ['Shift+单击', '加上它和已选之间连线路径上的所有节点'], ['Ctrl+← / →', '沿入线 / 出线扩选一层'], ['Shift+← / →', '沿入线 / 出线一直扩到头']]],
  ['排列', [['Shift+拖空白', '框选多张卡'], ['拖框的边 / 角', '整体拉开或收紧间距'], ['收到底', '对齐；会重叠的依次排开']]],
  ['图片', [['Ctrl+V', '贴进选中的卡；没选中 = 散图'], ['拖文件 / 网页图', '落在卡片上 = 进那张；空白处 = 散图'], ['图片右下角拖', '调大小'], ['🖼 / 工具栏', '收起这张 / 全部收起']]],
];
// >v<🔎搜索-搜索框-Ctrl+F 跳到节点 / 右键「连线到…」选目标：同一个框（↑↓ 选，Enter 确定，Esc 关）
export function SearchModal({ title, items, exclude, onPick, onClose }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0);
  const res = useMemo(() => searchNodes(items, q).filter(r => r.id !== exclude), [items, q, exclude]);
  useEffect(() => setI(0), [q]);
  const pick = r => r && (onClose(), onPick(r.id));
  return (
    <div className="modal" onPointerDown={onClose}>
      <div className="finder" onPointerDown={e => e.stopPropagation()}>
        <div className="bar"><b>{title}</b><span className="hint">名字 / 属性 / 正文，空格分开多个词 · ↑↓ Enter · Esc</span></div>
        <input autoFocus value={q} placeholder="搜索节点…" onChange={e => setQ(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(res.length - 1, x + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)); } else if (e.key === 'Enter') pick(res[i]); }} />
        <ul>{res.map((r, k) => (
          <li key={r.id} className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => pick(r)}>
            <b>{r.label}</b><span className="fp">{r.path.split('/').slice(0, -1).join(' / ')}</span>{r.where !== '名字' && <span className="fw">{r.where}</span>}
            {r.snippet && <div className="fs">{r.snippet}</div>}
          </li>))}
          {q.trim() && !res.length && <li className="hint">没找到</li>}</ul>
      </div>
    </div>
  );
}

export function HelpModal({ onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="help" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>快捷键</b><span className="hint" style={{ flex: 1 }}>暂不可改；以后要改从这张表接配置</span><button onClick={onClose}>✕</button></div>
        <div className="helpgrid">{KEYMAP.map(([g, rows]) => (
          <section key={g}><h4>{g}</h4><table><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table></section>
        ))}</div>
      </div>
    </div>
  );
}
