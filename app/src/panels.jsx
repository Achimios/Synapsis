// 右键菜单、属性面板、文件树（外部区）、文件预览。外壳把状态和动作传进来，这里只管显示。
import { useEffect, useState } from 'react';

const STATUS = [['done', '✅'], ['partial', '◐'], ['todo', '○']];

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
  const style = { left: Math.min(menu.x, innerWidth - 220), top: Math.min(menu.y, innerHeight - 330) };
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
        <button title="清除" onClick={() => { onClose(); actions.status(node.id, null); }}>✕</button>
      </div>
      {item('＋ 新建子节点', () => actions.addChild(node.id), { key: 'Tab' })}
      {item('＋ 新建同级', () => actions.addSibling(node.id), { key: 'Enter' })}
      {node.children.length > 0 && item(node.open ? '收起子级' : '原地展开子级', () => actions.toggle(node.id), { key: '空格' })}
      {item('钻进去', () => actions.drill(node.id), { key: '双击' })}
      {item('删除' + (node.children.length ? `（含 ${countAll(node)} 个子孙）` : ''), () => actions.remove(node.id), { danger: true, key: 'Del' })}
    </div>
  );
}
const countAll = n => n.descendants ?? n.children.length;

// >v<🎨画布-属性面板-节点属性/出入边/正文（工作区模式下正文可改，失焦保存）
export function PropsPanel({ id, graph, wsNode, edges, editable, onStatus, onBody, onSelect, onClose }) {
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
  const edgeRow = (e, other, inner) => <li key={e.from + e.to}><a onClick={() => onSelect(other)}>{lab(other)}</a>{e.label && <span className="el">{e.label}{e.kind ? '·' + e.kind : ''}</span>}{via(e, inner)}</li>;
  return (
    <aside className="side">
      <div className="bar"><b>属性</b><span className="hint" title={id}>{id}</span><button onClick={onClose}>✕</button></div>
      <div className="sidebody">
        <h3>{n.label}</h3>
        <div className="row">状态 {STATUS.map(([s, ic]) => <button key={s} className={n.status === s ? 'on' : ''} onClick={() => onStatus(id, s)}>{ic}</button>)}</div>
        {meta.length > 0 && <table className="meta"><tbody>{meta.map(([k, v]) => <tr key={k}><td>{k}</td><td>{Array.isArray(v) ? v.join('；') : v}</td></tr>)}</tbody></table>}
        {(ins.length > 0 || outs.length > 0) && <div className="edges">
          {ins.length > 0 && <><div className="eh in">← 输入{sub.size > 1 ? '（含子节点）' : ''}</div><ul>{ins.map(e => edgeRow(e, e.from, e.to))}</ul></>}
          {outs.length > 0 && <><div className="eh out">→ 输出{sub.size > 1 ? '（含子节点）' : ''}</div><ul>{outs.map(e => edgeRow(e, e.to, e.from))}</ul></>}
        </div>}
        <div className="eh">正文{editable ? '（失焦自动保存）' : '（样例模式不可编辑）'}</div>
        <textarea className="body" value={body} readOnly={!editable} placeholder={editable ? '想法、职责、验收方式……（存进这个节点的 .md）' : ''}
          onChange={e => setBody(e.target.value)} onBlur={() => { if (editable && body !== (wsNode?.body || '')) onBody(id, body); }} />
        {wsNode && n.children.length === 0 && <div className="hint">文件：__synapsis/…/{n.label}.md（Obsidian 里也能改）</div>}
      </div>
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
