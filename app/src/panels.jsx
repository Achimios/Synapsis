// 右键菜单、属性面板、文件树（外部区）、文件预览。外壳把状态和动作传进来，这里只管显示。
import { useStash } from './stash.js';
import { MdLite } from './mdlite.jsx';
import { SrcArea } from './mdsrc.jsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, Children } from 'react';

import { PALETTE, parseColor, satHex } from './colors.js';
import { PATTERNS, PATTERN_HINT } from './patterns.js';
import { searchNodes, filterTree } from './search.js';
import { groupSiblings } from './outline.js';
import { KEYMAP, comboFromKeyEvent, comboText, matchKey } from './keymap.js';
const STATUS = [['done', '✅'], ['partial', '◐'], ['todo', '○'], ['dropped', '❌']];

// >v<🎨画布-右键菜单-节点：属性/改名/状态/新建/展开/钻进/删除；空白处：新建/全部展开/上一层
// >v<⌨快捷键-右键菜单键盘操作（👤 2026-10-12）：E 弹出（选中的卡旁边；没选中 = 画布中间的空白菜单），WASD 在菜单里走，E 确定，Esc 关。
//   W / S 上下一项；一排按钮（状态 / 颜色 / 饱和 / 图案 / 连线）里 A / D 左右；带 ▸ 的 D 进二级、二级里 A 退回；Shift = 一次走 4 格（只管同一层）
//   直接读菜单的 DOM 走（.mi = 一项；一项里有 button / a = 一排），菜单长什么样这里不用跟着改
function kbStart(root, pg = 0) {
  const rows = [...root.children].filter(el => el.classList.contains('mi')); if (!rows.length) return;
  root._kb = { level: root, row: 0, col: rows[0].classList.contains('pages') ? pg : 0 };
  root.querySelectorAll('.kb').forEach(x => x.classList.remove('kb'));
  const cs = [...rows[0].querySelectorAll(':scope > button, :scope > a')];
  (cs.length ? cs[Math.min(root._kb.col, cs.length - 1)] : rows[0]).classList.add('kb');
}
function menuNav(e, onClose) {
  const root = document.querySelector('.ctx:not(.submenu)'); if (!root) return false;
  const K = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyE: 'ok' }[e.code];
  if (!K || e.ctrlKey || e.altKey || e.metaKey) return false;
  e.preventDefault(); e.stopPropagation();
  const st = root._kb || (root._kb = { level: root, row: -1, col: 0 });
  if (!st.level.isConnected) Object.assign(st, { level: root, row: -1, col: 0 });
  const rows = [...st.level.children].filter(el => el.classList.contains('mi'));
  if (!rows.length) return true;
  const ctrls = el => el ? [...el.querySelectorAll(':scope > button, :scope > a')] : [];
  const n = e.shiftKey ? 4 : 1, cur = rows[st.row];
  const mark = () => {
    root.querySelectorAll('.kb').forEach(x => x.classList.remove('kb'));
    const r = rows[st.row]; if (!r) return;
    const cs = ctrls(r); (cs.length ? cs[Math.min(st.col, cs.length - 1)] : r).classList.add('kb');
    r.scrollIntoView?.({ block: 'nearest' });
  };
  if (K === 'up' || K === 'down') { st.row = st.row < 0 ? (K === 'down' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, st.row + (K === 'down' ? n : -n))); st.col = Math.max(0, ctrls(rows[st.row]).findIndex(c => c.classList.contains('on'))); mark(); return true; }
  if (!cur) { st.row = 0; mark(); return true; }
  const cs = ctrls(cur);
  if ((K === 'left' || K === 'right') && cur.classList.contains('pages')) { // 页签行：A / D = 翻页（点相邻那个页签；翻完光标还在页签行）
    const i = cs.findIndex(c => c.classList.contains('on')), j = Math.max(0, Math.min(cs.length - 1, i + (K === 'right' ? 1 : -1)));
    if (j !== i) cs[j].click();
    return true;
  }
  if (K === 'left' || K === 'right') {
    if (cs.length) { st.col = Math.max(0, Math.min(cs.length - 1, Math.min(st.col, cs.length - 1) + (K === 'right' ? n : -n))); mark(); return true; }
    if (K === 'right' && cur.classList.contains('sub')) { const sub = cur.querySelector(':scope > .submenu'); cur.classList.add('open'); st.parent = { level: st.level, row: st.row }; Object.assign(st, { level: sub, row: 0, col: 0 }); const r2 = [...sub.children].filter(el => el.classList.contains('mi')); root.querySelectorAll('.kb').forEach(x => x.classList.remove('kb')); r2[0]?.classList.add('kb'); return true; }
    if (K === 'left' && st.level !== root && st.parent) { st.level.parentElement?.classList.remove('open'); Object.assign(st, { level: st.parent.level, row: st.parent.row, col: 0, parent: null }); const r0 = [...st.level.children].filter(el => el.classList.contains('mi')); root.querySelectorAll('.kb').forEach(x => x.classList.remove('kb')); r0[st.row]?.classList.add('kb'); return true; }
    return true;
  }
  // E = 确定：一排里点那个按钮（改颜色 / 状态这类不关菜单）；▸ = 进二级；其余 = 点这一项
  if (cs.length) cs[Math.min(st.col, cs.length - 1)].click();
  else if (cur.classList.contains('sub')) menuNav({ code: 'KeyD', preventDefault() {}, stopPropagation() {} }, onClose);
  else cur.click();
  return true;
}
export function ContextMenu({ menu, node, actions, onClose }) {
  useEffect(() => {
    const close = () => onClose();
    const key = e => { if (e.key === 'Escape') { onClose(); return; } if (!e.target.closest?.('input, textarea, [contenteditable="true"]')) menuNav(e, onClose); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key, true); // 抢在画布的 WASD / E 前面
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  const [pg, setPg] = useState(0);
  useEffect(() => setPg(0), [menu]); // 每次右键都是新的 menu 对象（同一处再右键也回「常用」）
  // 👤 2026-10-17 菜单一开就能用键盘：光标先停在第一行（分页菜单 = 页签行的当前页），不用先按一下 WASD 才「进」菜单
  useEffect(() => { const root = document.querySelector('.ctx:not(.submenu)'); if (root) kbStart(root, pg); }, [pg, menu]);
  const item = (label, fn, opts = {}) => (
    <div className={'mi' + (opts.danger ? ' danger' : '') + (opts.quiet ? ' quiet' : '')} onPointerDown={e => e.stopPropagation()} onClick={() => { onClose(); fn(); }}>
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
  if (menu.sel) { // 📌 在正文 / 原文 / 文件预览里选中一段文字后右键：钉到哪一组（当前组最好点）
    const h = actions.pinsSelMenu(menu.sel), picked = menu.sel.text.slice(menu.sel.start, menu.sel.end);
    return (
      <div className="ctx" style={style}>
        <div className="mh">选中的文字</div>
        {h.cur ? item(`📌 钉到「${h.cur.name}」`, () => h.pin(h.cur.id)) : item('📌 钉到新组', () => h.pin('new'))}
        {h.others.slice(0, 6).map(g => item(`↳ 钉到「${g.name}」`, () => h.pin(g.id), { quiet: true }))}
        {h.cur && item('＋ 钉到新组', () => h.pin('new'), { quiet: true })}
        <div className="msep" />
        {item('复制', () => navigator.clipboard?.writeText(picked))}
      </div>
    );
  }
  if (!node) return (
    <div className="ctx" style={style}>
      {item('＋ 在这里新建节点', actions.addHere)}
      {actions.addUiHere && item('▭ 新建 UI 框', actions.addUiHere)}
      {actions.pickFile && item('📎 引入…', actions.pickFile)}
      {actions.aiImageHere && item('🎨 AI 配图…', actions.aiImageHere)}
      {actions.canUp && item('↑ 返回上一层', actions.up, { key: 'Alt+W', quiet: true })}
    </div>
  );
  // 👤 2026-10-17 分页：常用 / 外观 / 更多。菜单一开光标就在页签行（A / D 翻页，S 往下进项目；按钮行里 A / D 仍是左右挑）
  const looks = !!(actions.sat || actions.color || actions.pattern);
  const pages = [['常用', true], ['外观', looks], ['更多', true]].filter(p => p[1]).map(p => p[0]), page = pages[Math.min(pg, pages.length - 1)];
  return (
    <div className="ctx paged" style={style}>
      <div className="mh">{node.label}</div>
      <div className="mi row pages" onPointerDown={e => e.stopPropagation()}>
        {pages.map((p, i) => <a key={p} className={page === p ? 'on' : ''} onClick={() => setPg(i)}>{p}</a>)}
      </div>
      {page === '常用' && <>
        {item('属性…', () => actions.props(node.id), { key: 'Shift+Tab' })}
        {item('重命名', () => actions.rename(node.id), { key: 'R' })}
        {actions.editBody && !node.ref && item('编辑正文', () => actions.editBody(node.id))}
        {node.file && item('📎 打开引用的文件', () => actions.openProjectFile(node.file))}
        {node.ref && item('↗ 跳到它指的节点', () => actions.gotoRef(node.id))}
        <div className="mi row" onPointerDown={e => e.stopPropagation()}>
          <span>状态</span>
          {STATUS.map(([s, ic]) => <button key={s} className={node.status === s ? 'on' : ''} onClick={() => { actions.status(node.id, s); }}>{ic}</button>)}
          <button title="清除状态（不标）" onClick={() => { actions.status(node.id, null); }}>—</button>
        </div>
        <div className="mi row2" onPointerDown={e => e.stopPropagation()}>
          <a title="选一个别的节点，从它连到这个节点" onClick={() => { onClose(); actions.linkFrom(node.id); }}>← 从…连过来</a>
          <a title="选一个别的节点，从这个节点连过去" onClick={() => { onClose(); actions.linkTo(node.id); }}>🔗 连线到…</a>
        </div>
        {actions.pinsMenu && (() => { // 📌 钉到钉子组：当前（高亮）组最好点，其余组和新组灰色小字（👤 2026-10-09）
          const h = actions.pinsMenu(node.id), many = h.n > 1 ? `（${h.n} 个）` : '';
          return <>
            {h.cur ? item(`📌 钉到「${h.cur.name}」${many}`, () => h.pin(h.cur.id)) : item(`📌 钉到新组${many}`, () => h.pin('new'))}
            {h.others.slice(0, 6).map(g => item(`↳ 钉到「${g.name}」`, () => h.pin(g.id), { quiet: true }))}
            {h.cur && item('＋ 钉到新组', () => h.pin('new'), { quiet: true })}
          </>;
        })()}
        {item('＋ 新建子节点', () => actions.addChild(node.id), { key: 'T' })}
        <div className="msep" />
        {item('🗑️ 删除' + (node.children.length ? `（含 ${countAll(node)} 个子孙）` : ''), () => actions.remove(node.id), { danger: true, key: 'Del' })}
      </>}
      {page === '外观' && <>
        {actions.sat && <div className="mi row swatches sat" onPointerDown={e => e.stopPropagation()}><span>饱和</span><SatButtons base={node.baseColor} cur={node.satNow} onSat={p => actions.sat(node.id, p)} /></div>}
        {actions.tint && <div className="mi row swatches tints" onPointerDown={e => e.stopPropagation()} title="卡片底色 / 框里面叠多少节点色；跟随 = 默认"><span>不透</span><TintButtons cur={node.tintNow} onTint={t => actions.tint(node.id, t)} /></div>}
        {actions.sat && <div className="tintsep" />}
        {actions.color && <div className="mi row swatches" onPointerDown={e => e.stopPropagation()}>
          <span>颜色</span>
          {Object.entries(PALETTE).map(([k, c]) => <button key={k} title={k} className={String(node.colorSet || '').split('/')[0] === k ? 'on' : ''} style={{ background: c }} onClick={() => { actions.color(node.id, k); }} />)}
          <button title="自动（按分组 / 名字配色，子节点跟着父节点）" className={!node.colorSet ? 'on auto' : 'auto'} onClick={() => { actions.color(node.id, null); }}>自动</button>
        </div>}
        {actions.pattern && <div className="mi row swatches pats" onPointerDown={e => e.stopPropagation()}>
          <span>图案</span>
          {Object.entries(PATTERNS).map(([k, c]) => <button key={k} title={k + '：' + PATTERN_HINT[k]} className={'patsw pat-' + c + (node.patternSet === k ? ' on' : !node.patternSet && node.pattern === k ? ' auto-on' : '')} style={{ '--c': node.color }} onClick={() => { actions.pattern(node.id, k); }} />)}
          <button title="自动（按图案词表 / AI 归类）" className={!node.patternSet ? 'on auto' : 'auto'} onClick={() => { actions.pattern(node.id, null); }}>自动</button>
          <button title="不要底纹" className={node.patternSet === '无' ? 'on auto' : 'auto'} onClick={() => { actions.pattern(node.id, '无'); }}>无</button>
        </div>}
      </>}
      {page === '更多' && <>
        {node.ui && item('▭ 复制 UI 布局', () => actions.copyUiLayout(node.id))}
        {actions.convert && !node.ref && !node.file && <div className="mi sub" onPointerDown={e => e.stopPropagation()}><span>转为 ▸</span>
          <div className={'ctx submenu' + (menu.x > innerWidth - 420 ? ' flip' : '')}>{/* 👤 2026-10-11 常建错类型：普通节点 ⇄ UI 框，只改 ui / w / h，名字、子级、正文都不动 */}
            {node.ui ? item('▢ 普通节点', () => actions.convert(node.id, 'node')) : item('▭ UI 框', () => actions.convert(node.id, 'ui'))}
          </div></div>}
        {actions.hasFile(node.id) && item('看 md 原文', () => actions.openMd(node.id))}
        {actions.hasFile(node.id) && item('在资源管理器中显示', () => actions.reveal(node.id))}
        {item('贴图…', () => actions.pasteHint(node.id), { key: 'Ctrl+V' })}
        {actions.aiImage && !node.ref && item('🎨 AI 配图…', () => actions.aiImage(node.id))}
      </>}
    </div>
  );
}
const countAll = n => n.descendants ?? n.children.length;

// >v<🎨画布-属性面板-节点属性/出入边/正文（工作区模式下正文可改，失焦保存）
// >v<🎨画布-属性可编辑-值失焦保存（清空 = 删掉这个键）；底下一行加新属性；空间相关的给快捷按钮（轴 / 坐标 / 映射）
const LOCKED = new Set(['to', 'label', 'status', 'order']);
const OWN_UI = new Set(['color', 'pattern', 'sat', 'tint', 'ui', 'w', 'h']); // ui / w / h：UI 框的尺寸在上面「尺寸」一行（👤 2026-10-16 和手写属性分开） // 👤 2026-10-12 系统属性和手写属性分开：这几个在上面有按钮
// >v<🗂️属性面板-属性表-改名 / 改值失焦就存；清空值 = 值留空（不删属性），删属性点 ✕；新行填了名字，失焦也存（👤 2026-10-08）
function MetaTable({ id, meta, editable, onMeta, hints = [] }) {
  const [k, setK] = useState(''), [v, setV] = useState('');
  const keyRef = useRef(null), addRef = useRef(null);
  useEffect(() => { setK(''); setV(''); }, [id]);
  const keys = new Set(meta.map(([key]) => key));
  const add = () => { const kk = k.trim(); if (!kk || LOCKED.has(kk) || keys.has(kk)) return; onMeta(id, { [kk]: v.trim() }); setK(''); setV(''); };
  // 焦点离开整行才存（在名字和值之间切换不算）
  const addBlur = e => { if (!addRef.current?.contains(e.relatedTarget)) add(); };
  const rows = meta.filter(([key]) => !LOCKED.has(key) && !OWN_UI.has(key)); // 有专门按钮的系统属性不在这里列（这张表 = 人自己加的标签，比如「小队长」）
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

// >v<📌钉子-原文视图-md 原文 / 文件预览：一行一个 span（data-ln = 行号），能高亮「跳过来的那一行」、能算选中文字在第几行（右键 → 钉到…）
//   hl = { file, line, n }：n 每次跳转 +1，同一行再跳一次也会重新滚到
export function RawText({ text, hl, file, onSelMenu }) {
  const ref = useRef(null);
  const lines = useMemo(() => text.split('\n'), [text]);
  useEffect(() => { if (hl && ref.current) ref.current.querySelector(`[data-ln="${hl.line}"]`)?.scrollIntoView({ block: 'center' }); }, [hl, text]);
  const menu = e => {
    const sel = window.getSelection();
    if (!onSelMenu || !sel || sel.isCollapsed || !ref.current?.contains(sel.anchorNode)) return; // 没选中文字 = 浏览器自己的菜单
    const r = sel.getRangeAt(0), pre = document.createRange();
    pre.selectNodeContents(ref.current); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    e.preventDefault(); onSelMenu(e, { from: 'raw', file, text, start, end: start + r.toString().length });
  };
  return <pre className="raw" ref={ref} onContextMenu={menu}>{lines.map((l, i) => <span key={i} data-ln={i + 1} className={hl?.line === i + 1 ? 'ln hl' : 'ln'}>{l}{i < lines.length - 1 ? '\n' : ''}</span>)}</pre>;
}

// >v<📝右栏-正文-预览 / 源码（👤 2026-10-17，Ctrl+E 切换；顶替原来的「原文」页签）
//   预览 = MdLite 渲染（粗体、斜体、表格…），双击某一块 = 进源码、光标落在那一行；
//   源码 = 上面灰着的 frontmatter（只读，属性在上面的表里改）+ 正文框（失焦保存）。切换时按行对齐：看到的第一行（光标在框里 = 光标那行）在原来的高度。
//   源码框背后垫一层同样排版的镜像（一行一个 span，data-ln = 文件里的行号）：量行的位置、钉子跳过来时高亮那一行
const fmOf = raw => { const m = /^---\r?\n[\s\S]*?\r?\n---[^\n]*(\n|$)/.exec(raw || ''); return m ? m[0].replace(/\r?\n$/, '') : ''; };
function topLine(box) { // 容器里看得到的第一行 → {line, dy}
  const top = box.getBoundingClientRect().top;
  for (const el of box.querySelectorAll('[data-ln]')) { const r = el.getBoundingClientRect(); if (r.bottom > top + 2 && r.height) return { line: +el.dataset.ln, dy: r.top - top }; }
  return null;
}
function scrollToLine(box, a) { // 把第 a.line 行（没有就往前找最近的一块）摆回 a.dy 的高度
  let best = null;
  for (const el of box.querySelectorAll('[data-ln]')) if (+el.dataset.ln <= a.line && el.getBoundingClientRect().height) best = el;
  if (!best) { box.scrollTop = 0; return; }
  box.scrollTop += best.getBoundingClientRect().top - box.getBoundingClientRect().top - a.dy;
}
export function MdBody({ id, body, setBody, onSave, raw, editable, mode, onMode, hl, file, onSelMenu }) {
  const box = useRef(null), ta = useRef(null), anchor = useRef(null), caret = useRef(null);
  const fm = useMemo(() => fmOf(raw), [raw]);
  // 正文第一行在文件里是第几行：文件行数 − 正文行数（和 pinSelection 一个算法）；还没读到文件就按 frontmatter 行数算
  const off = useMemo(() => { const rl = raw ? raw.split('\n').length : 0, bl = String(body).split('\n').length; return raw && rl >= bl ? rl - bl + 1 : (fm ? fm.split('\n').length + 1 : 1); }, [raw, body, fm]);
  const remember = () => { if (!box.current) return; const t = ta.current; if (mode === 'src' && t && document.activeElement === t) { const ln = off + t.value.slice(0, t.selectionStart).split('\n').length - 1, el = box.current.querySelector(`.mirror [data-ln="${ln}"]`); if (el) { anchor.current = { line: ln, dy: el.getBoundingClientRect().top - box.current.getBoundingClientRect().top }; return; } } anchor.current = topLine(box.current); };
  // 切过来以后（新 DOM）：把对齐行摆回原来的高度。对齐行是切之前随手记的（滚动 / 光标动 / 双击时），所以外面 Ctrl+E 切也对得上。
  //   进源码 = 光标放到对齐行、可以直接打字；回预览 = 先存（框被拿掉不会触发失焦）
  const first = useRef(true);
  useLayoutEffect(() => {
    const b = box.current; if (!b) return;
    if (first.current) { first.current = false; anchor.current = topLine(b); return; }
    if (anchor.current) scrollToLine(b, anchor.current);
    if (mode === 'prev') onSave();
    else if (editable && ta.current && !(hl && Date.now() - hl.n < 1500)) { // 钉子刚跳过来 = 只看，不抢焦点
      const t = ta.current, lines = t.value.split('\n'), k = Math.max(0, Math.min(lines.length - 1, (caret.current ?? anchor.current?.line ?? off) - off)), pos = lines.slice(0, k).join('\n').length + (k ? 1 : 0);
      t.focus({ preventScroll: true }); t.setSelectionRange(pos, pos);
    }
    caret.current = null;
  }, [mode]);
  useLayoutEffect(() => { anchor.current = box.current && topLine(box.current); }, [id]);
  // 钉子跳过来：滚到那一行（居中）
  useEffect(() => { if (!hl || mode !== 'src') return; const t = setTimeout(() => box.current?.querySelector(`[data-ln="${hl.line}"]`)?.scrollIntoView({ block: 'center' }), 30); return () => clearTimeout(t); }, [hl, mode, raw]);
  const prevMenu = e => { // 预览里选中文字右键 → 钉到…（行号按那一块的 data-ln）
    const s = window.getSelection(); if (!onSelMenu || !file || !s || s.isCollapsed || !box.current?.contains(s.anchorNode)) return;
    const el = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('[data-ln]'); if (!el) return;
    const lines = String(body).split('\n'), k = +el.dataset.ln - off; if (k < 0 || k >= lines.length) return;
    const start = lines.slice(0, k).join('\n').length + (k ? 1 : 0), txt = s.toString().split('\n')[0], j = Math.max(0, lines[k].indexOf(txt.slice(0, 12)));
    e.preventDefault(); onSelMenu(e, { from: 'body', file, text: body, start: start + j, end: start + j + Math.min(txt.length, lines[k].length - j) });
  };
  const fl = fm ? fm.split('\n') : [];
  return <div className={'mdbody ' + mode} ref={box} onScroll={() => { if (document.activeElement !== ta.current) anchor.current = topLine(box.current); }}>
    {mode === 'prev' ? <div className="mdprev" title={editable ? '双击进源码（光标落在那一行）· Ctrl+E 切换' : ''} onContextMenu={prevMenu}
        onDoubleClick={e => { if (!editable) return; const el = e.target.closest('[data-ln]'); remember(); caret.current = el ? +el.dataset.ln : off; if (el) anchor.current = { line: +el.dataset.ln, dy: el.getBoundingClientRect().top - box.current.getBoundingClientRect().top }; onMode('src'); }}>
        {body.trim() ? <MdLite text={body} ln={off} /> : <div className="hint">{editable ? '（空）双击或 Ctrl+E 开始写' : '（空）'}</div>}</div>
      : <>
        {fl.length > 0 && <pre className="fm" title="frontmatter（只读：状态、颜色、属性在上面改）">{fl.map((l, i) => <span key={i} data-ln={i + 1} className={hl?.line === i + 1 ? 'ln hl' : 'ln'}>{l}{'\n'}</span>)}</pre>}
        <SrcArea taRef={ta} taClass="body" ln={off} hl={hl?.line ?? null} value={body} readOnly={!editable} placeholder={editable ? '想法、职责、验收方式……（存进这个节点的 .md）' : ''}
          onChange={e => setBody(e.target.value)} onBlur={onSave} onKeyUp={remember} onClick={remember}
          onContextMenu={e => { const t = e.target; if (!onSelMenu || !file || t.selectionStart === t.selectionEnd) return; e.preventDefault(); onSelMenu(e, { from: 'body', file, text: t.value, start: t.selectionStart, end: t.selectionEnd }); }} /></>}
  </div>;
}

// >v<🎨画布-饱和度档-25 / 50 / 75 / 100（👤 2026-10-12：单独的 sat: 键，叠在自动色 / 手动色上，不把自动色变成手动；手动标注用）
function TintButtons({ cur = 0, onTint }) { // 框里的「不透」（不透明度）= 叠多少节点色：跟随 / 12 / 25 / 50 / 75 / 100（👤 2026-10-12）
  return [12, 25, 50, 75, 100, 0].map(t => <button key={t} className={'tint' + (cur === t ? ' on' : '')} onClick={() => onTint(t)}>{t || '跟随'}</button>);
}
function SatButtons({ base, cur = 100, onSat }) {
  return [12, 25, 50, 75, 100].map(p => <button key={p} title={p + '%（只改深浅，颜色还是自动 / 手动不变）'} className={cur === p ? 'on' : ''} style={{ background: base ? satHex(base, p) : 'var(--line2)' }} onClick={() => onSat(p)}>{p}</button>);
}
export function PropsPanel({ id, graph, wsNode, edges, editable, onStatus, onBody, onMeta, metaHints, onSelect, onClose, file, bodyMode = 'prev', onBodyMode, raw, onReveal, onRename, color, onColor, baseColor, satNow, onSat, pattern, onPattern, words, onWords, onEdgeKind, onEdgeRemove, hl, onSelMenu }) {
  // 自动色 / 底纹是哪一层词表的哪个词给的（👤 2026-10-11 层级词表）：点 = 打开那份词表
  const why = k => { const w = words?.[k]?.why; return w ? <a className="why" title={`自动${k === 'color' ? '颜色' : '底纹'}来自「${w.fromLabel}」的词表，命中「${w.word}」；点 = 打开那份词表`} onClick={() => onWords?.(w.from)}>词：{w.word}（{w.fromLabel}）</a> : null; };
  const n = graph.nodes.get(id);
  const [body, setBody] = useState(wsNode?.body || '');
  useEffect(() => setBody(wsNode?.body || ''), [id, wsNode?.body]);
  if (!n) return null;
  const meta = Object.entries(wsNode?.meta || {}).filter(([k]) => k !== 'to' && k !== 'evidence_hash'); // evidence_hash = 实测快照，机器记的，不给人改
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
      <div className="bar tabs"><a className="on">概览</a>
        <span className="hint" title={id}>{id}</span><button onClick={onClose} title="关闭（I）">✕</button></div>
      <div className="sidebody">
        {/* >v<🎨画布-属性面板-名字（改了回车 / 失焦 = 改名）、状态、颜色（色块 = 写 color:，自动 = 删掉）—— 👤 2026-10-08 */}
        <h3><input key={id + '|' + n.label} className="nameedit" defaultValue={n.label} title="改名：回车或点别处生效，Esc 还原"
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); else if (e.key === 'Escape') { e.target.value = n.label; e.target.blur(); } }}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== n.label) onRename(id, v); else e.target.value = n.label; }} /></h3>
        {onSat && <div className="row swatches sat"><span className="rl">饱和</span><SatButtons base={baseColor} cur={satNow} onSat={p => onSat(id, p)} /></div>}
        {onSat && editable && <div className="row swatches tints" title="卡片底色 / 框里面（UI 框 / 展开的子图）叠多少节点色。跟随 = 默认（框的默认在 ⚙ 外观）"><span className="rl">不透</span><TintButtons cur={+wsNode?.meta?.tint || 0} onTint={t => onMeta(id, { tint: t ? String(t) : null })} /></div>}
        {onSat && <div className="tintsep" />}
        {/^true$/i.test(String(wsNode?.meta?.ui)) && <div className="row uisize" title="UI 框的设计尺寸（导出 / 复制 UI 布局用）；回车或点别处生效"><span className="rl">尺寸</span>
          {['w', 'h'].map((k, i) => <span key={k}>{i ? <span className="x">×</span> : null}<input type="number" min="20" key={id + k + wsNode.meta[k]} defaultValue={wsNode.meta[k]} disabled={!editable}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
            onBlur={e => { const v = Math.round(+e.currentTarget.value); if (v >= 20 && String(v) !== String(wsNode.meta[k])) onMeta(id, { [k]: String(v) }); else e.currentTarget.value = wsNode.meta[k]; }} /></span>)}</div>}
        <div className="row">状态 {STATUS.map(([s, ic]) => <button key={s} className={n.status === s ? 'on' : ''} onClick={() => onStatus(id, s)}>{ic}</button>)}
          <button title="清除状态（不标）" onClick={() => onStatus(id, null)}>—</button></div>
        {onColor && <div className="row swatches"><span className="rl">颜色</span><span className="cur" style={{ background: color }} title={'现在：' + color + (wsNode?.meta?.color ? '（手动）' : '（自动）')} />
          {Object.entries(PALETTE).map(([k, c]) => <button key={k} title={k} className={wsNode?.meta?.color === k ? 'on' : ''} style={{ background: c }} onClick={() => onColor(id, k)} />)}
          <button className={'auto' + (!wsNode?.meta?.color ? ' on' : '')} title="自动（按分组 / 词表配色）" onClick={() => onColor(id, null)}>自动</button>
          {!wsNode?.meta?.color && why('color')}</div>}
        {onPattern && <div className="row swatches pats"><span className="rl">图案</span>{Object.entries(PATTERNS).map(([k, c]) => <button key={k} title={k + '：' + PATTERN_HINT[k]} className={'patsw pat-' + c + (wsNode?.meta?.pattern === k ? ' on' : !wsNode?.meta?.pattern && pattern === k ? ' auto-on' : '')} style={{ '--c': color }} onClick={() => onPattern(id, k)} />)}
          <button className={'auto' + (!wsNode?.meta?.pattern ? ' on' : '')} title="自动（按图案词表 / AI 归类）" onClick={() => onPattern(id, null)}>自动</button>
          <button className={'auto' + (wsNode?.meta?.pattern === '无' ? ' on' : '')} title="不要底纹" onClick={() => onPattern(id, '无')}>无</button>
          {!wsNode?.meta?.pattern && why('pattern')}</div>}
        {words && onWords && <div className="row wordsrow" title="词表（_词表.md，颜色 + 图案一份）：名字里含某个词 → 自动用那一行的颜色 / 底纹，只管节点自己。每个分组还能有自己的一份，管它里面；找词从父级往上，哪层先命中用哪层，某层没写的接着往上">
          <span className="rl">词表</span>
          <span className="wl">上级</span><a onClick={() => onWords(words.upper.scope)} title={'对这张卡生效的最近一份词表在「' + words.upper.label + '」（再往上的接着兜底）；点 = 打开'}>📖 {words.upper.label}</a>
          {words.group && <><span className="wsep">│</span><span className="wl">本层</span><a className={words.own ? '' : 'add'} onClick={() => onWords(id)} title={words.own ? '这个分组自己的词表（管它里面）；点 = 打开' : '给这个分组建一份自己的词表（管它里面，空表）'}>📖{words.own ? '' : ' ＋'}</a></>}
        </div>}
        <MetaTable id={id} meta={meta} editable={editable} onMeta={onMeta} hints={metaHints} />
        {(ins.length > 0 || outs.length > 0) && <div className="edges">
          {ins.length > 0 && <><div className="eh in">← 输入{sub.size > 1 ? '（含子节点）' : ''}</div><ul>{ins.map(e => edgeRow(e, e.from, e.to))}</ul></>}
          {outs.length > 0 && <><div className="eh out">→ 输出{sub.size > 1 ? '（含子节点）' : ''}</div><ul>{outs.map(e => edgeRow(e, e.to, e.from))}</ul></>}
        </div>}
        <div className="eh bodyhead">正文<span className="modesw" title="预览 / 源码（Ctrl+E）：源码里能改，也看得到 frontmatter">
          {[['prev', '预览'], ['src', '源码']].map(([m, t]) => <a key={m} className={bodyMode === m ? 'on' : ''} onClick={() => onBodyMode(m)}>{t}</a>)}<kbd>Ctrl+E</kbd></span>
          <span className="hint">{editable ? (bodyMode === 'src' ? '失焦自动保存' : '双击进源码') : '样例模式不可编辑'}</span></div>
        <MdBody id={id} body={body} setBody={setBody} onSave={() => { if (editable && body !== (wsNode?.body || '')) onBody(id, body); }} raw={raw} editable={editable}
          mode={bodyMode} onMode={onBodyMode} hl={hl} file={file} onSelMenu={onSelMenu} />
        {file && <div className="filerow"><span className="hint" title={file}>{file}</span>
          <button onClick={() => onReveal(file, 'select')} title="在资源管理器中显示">📂</button>
          <button onClick={() => onReveal(file, 'open')} title="用默认程序打开（Obsidian / 编辑器）">↗</button></div>}
      </div>
    </aside>
  );
}

// >v<🗂️外部区-文件树-左栏「文件」页：项目根目录（__synapsis 之外），点文件右侧预览
//   顶上过滤框（👤 2026-10-08）：默认按文件名 / 路径过滤（命中的和它的上级目录全展开）；勾「内容」= 服务端逐行搜文本文件，列「路径:行 片段」
export function FileTree({ tree, onOpen, current, api }) {
  const [open, setOpen] = useState({});
  const [q, setQ] = useStash('files.q', ''), [inBody, setInBody] = useStash('files.body', false), [grep, setGrep] = useState(null); // 过滤词关窗口不丢
  const [fopen, setFopen] = useState({}); // 过滤时的展开状态（另记一份，换词就清空；不沿用平时手点开的）
  useEffect(() => setFopen({}), [q]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  useEffect(() => { // 搜内容：停手 300ms 再问
    if (!inBody || !words.length || !api) { setGrep(null); return; }
    setGrep({ loading: true });
    const t = setTimeout(() => api('/grep?q=' + encodeURIComponent(q)).then(setGrep).catch(e => setGrep({ error: e.message })), 300);
    return () => clearTimeout(t);
  }, [q, inBody]);
  // 名字过滤：留下路径含全部词的文件 + 它们的上级目录（目录本身命中 → 下面的路径也都含这些词，一起留下）
  // 只看「自己的名字」（不看路径：否则「游戏NPC状态空间组」下面的所有文件都算命中 —— 👤 2026-10-08「只搜标题貌似没过滤」）。
  //   hit = 名字命中的；keep = 命中的 + 它们的上级目录。名字命中、下面没有命中的目录 → 收着，点开看全部
  const flt = useMemo(() => {
    if (!tree || !words.length || inBody) return null;
    const hit = new Set(), keep = new Set(), m = it => words.every(w => it.name.toLowerCase().includes(w));
    const walk = items => { let any = false; for (const it of items) { const sub = it.dir && walk(it.children); if (m(it)) hit.add(it.path); if (sub || m(it)) { keep.add(it.path); any = true; } } return any; };
    walk(tree.tree);
    return { hit, keep };
  }, [tree, q, inBody]);
  if (!tree) return <div className="hint" style={{ padding: 12 }}>加载中…</div>;
  const hasKeptChild = it => it.children.some(c => flt.keep.has(c.path));
  const isOpen = it => flt ? fopen[it.path] ?? (hasKeptChild(it) && it.name !== '_过期的') : open[it.path]; // 过滤时 _过期的 默认收着
  const walk = (items, depth, all = false) => items.filter(it => all || !flt || flt.keep.has(it.path)).map(it => (
    <div key={it.path}>
      <div className={'fi' + (it.path === current ? ' cur' : '') + (flt?.hit.has(it.path) ? ' hit' : '')} style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => it.dir ? (flt ? setFopen : setOpen)(o => ({ ...o, [it.path]: !isOpen(it) })) : onOpen(it.path)}>
        {it.dir ? (isOpen(it) ? '▾ 📁 ' : '▸ 📁 ') : '　 📄 '}{it.name}
      </div>
      {it.dir && isOpen(it) && walk(it.children, depth + 1, all || (flt && !hasKeptChild(it)))}
    </div>
  ));
  const keep = flt?.keep;
  return <div className="files">
    <div className="otools ftools">
      <input className="ofilter" value={q} placeholder={inBody ? '搜文件内容…（空格分开多个词）' : '过滤…（文件名）'} onChange={e => setQ(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setQ(''); }} />
      <label className="hint" title="也搜文件内容（项目里的文本文件，跳过 _过期的 / node_modules / .git / 大于 1MB 的）"><input type="checkbox" checked={inBody} onChange={e => setInBody(e.target.checked)} />内容</label>
    </div>
    {inBody && words.length ? (
      !grep || grep.loading ? <div className="hint pad">搜索中…</div>
        : grep.error ? <div className="errs">{grep.error}</div>
        : <div className="grep">
            {grep.hits.map((h, i) => <div key={i} className={'gh' + (h.path === current ? ' cur' : '')} onClick={() => onOpen(h.path)} title={h.path + ':' + h.line}>
              <div className="gp">📄 {h.path}<span>:{h.line}</span></div><div className="gt">{h.text}</div></div>)}
            <div className="hint pad">{grep.hits.length ? `${grep.files} 个文件 · ${grep.hits.length} 行${grep.truncated ? '（太多，只列前 200 行）' : ''}` : '没找到'}</div>
          </div>
    ) : <>{walk(tree.tree, 0)}{keep && !keep.size && <div className="hint pad">没有文件名含这些字的（勾「内容」搜正文）</div>}</>}
    {tree.truncated && <div className="hint">（文件太多，只列了前 3000 个）</div>}
  </div>;
}

// >v<🌳左栏-文本查找-「文本」页顶上的查找条（👤 2026-10-08）：Enter 下一个 / Shift+Enter 上一个；焦点一直留在查找框里，
//   命中处在文本后面画高亮（当前那个更亮）并滚过去 —— 不动文本框的选区。
//   ⚠️ 第一版是「选中文本框里那段 + 把焦点给文本框」：再按一次 Enter = 用换行替换掉选中的词，把 Life Games 的一行大纲改坏了（👤 2026-10-08）。
//   想在命中处改字：点一下文本框（或按 Esc 回到文本框，光标停在当前命中处）。下面列出命中的行，点一下跳过去。
//   children = 文本框本身（包一层，好在它后面画高亮）
export function TextFind({ active, taRef, text, inputRef, children }) {
  const [q, setQ] = useStash('find.q', ''), [cur, setCur] = useState(-1); // 查找词关窗口不丢
  const mir = useRef(null);
  const hits = useMemo(() => {
    const out = [], t = text.toLowerCase(), w = q.toLowerCase();
    if (w) for (let i = t.indexOf(w); i >= 0 && out.length < 1000; i = t.indexOf(w, i + w.length)) out.push(i);
    return out;
  }, [text, q]);
  const lineOf = i => text.slice(0, i).split('\n').length;
  const lines = useMemo(() => { // 命中的行（同一行只列一次）
    const out = [], seen = new Set();
    for (let k = 0; k < hits.length && out.length < 60; k++) {
      const a = text.lastIndexOf('\n', hits[k] - 1) + 1, b = text.indexOf('\n', hits[k]), ln = lineOf(hits[k]);
      if (seen.has(ln)) continue; seen.add(ln);
      out.push({ k, ln, s: text.slice(a, b < 0 ? undefined : b).trim() });
    }
    return out;
  }, [hits, text]);
  useEffect(() => setCur(-1), [q]);
  // 高亮层和文本框对齐：字体 / 行高 / 内边距 / 可见宽高照抄，滚动跟着走
  const sync = () => {
    const ta = taRef.current, m = mir.current; if (!ta || !m) return;
    const cs = getComputedStyle(ta);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) m.style[p] = cs[p];
    m.style.top = ta.offsetTop + ta.clientTop + 'px'; m.style.left = ta.offsetLeft + ta.clientLeft + 'px';
    m.style.width = ta.clientWidth + 'px'; m.style.height = ta.clientHeight + 'px';
    m.scrollTop = ta.scrollTop;
  };
  useLayoutEffect(sync);
  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    const ro = new ResizeObserver(sync); ro.observe(ta); ta.addEventListener('scroll', sync);
    return () => { ro.disconnect(); ta.removeEventListener('scroll', sync); };
  }, [taRef.current]);
  const jump = k => {
    const ta = taRef.current; if (!hits.length || !ta) return;
    const j = ((k % hits.length) + hits.length) % hits.length;
    setCur(j);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (lineOf(hits[j]) - 1) * lh - ta.clientHeight / 3);
  };
  const toText = () => { // 回到文本框，光标停在当前命中处（不选中，打字不会吞掉它）
    const ta = taRef.current; if (!ta) return;
    const at = cur >= 0 ? hits[cur] : ta.selectionStart;
    ta.focus(); ta.setSelectionRange(at, at);
  };
  const ref = useRef({}); ref.current = { jump, cur, q };
  useEffect(() => { // 文本框里 F3 / Shift+F3 也能接着找（焦点还在文本框）
    const ta = taRef.current; if (!ta) return;
    const onKey = e => { if (e.key === 'F3' && ref.current.q) { e.preventDefault(); e.stopPropagation(); ref.current.jump(ref.current.cur + (e.shiftKey ? -1 : 1)); } };
    ta.addEventListener('keydown', onKey); return () => ta.removeEventListener('keydown', onKey);
  }, [taRef.current]);
  let marks = null;
  if (q && hits.length) {
    marks = []; let p = 0;
    hits.forEach((h, i) => { marks.push(text.slice(p, h), <mark key={i} className={i === cur ? 'cur' : ''}>{text.slice(h, h + q.length)}</mark>); p = h + q.length; });
    marks.push(text.slice(p) + '\n ');
  }
  const curLn = cur >= 0 && hits[cur] !== undefined ? lineOf(hits[cur]) : -1;
  return <>
    {active && <div className="textfind">
      <div className="otools">
        <input ref={inputRef} className="ofilter" value={q} placeholder="查找…（Enter 下一个，Shift+Enter 上一个，Esc 回文本）" onChange={e => setQ(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); toText(); } else if (e.key === 'Enter') { e.preventDefault(); jump(cur + (e.shiftKey ? -1 : 1)); } }} />
        {q && <span className="hint tcount">{hits.length ? `${cur < 0 ? '–' : cur + 1} / ${hits.length}` : '0'}</span>}
        {q && <button className="ghost" title="清空" onClick={() => setQ('')}>✕</button>}
      </div>
      {q && lines.length > 0 && <div className="tlines">{lines.map(l => <div key={l.ln} className={'tl' + (l.ln === curLn ? ' cur' : '')} onClick={() => jump(l.k)}><span>{l.ln}</span>{l.s}</div>)}</div>}
    </div>}
    <div className="tawrap" style={{ display: active ? '' : 'none' }}>
      {marks && <div className="tamirror" ref={mir} aria-hidden="true">{marks}</div>}
      {children}
    </div>
  </>;
}

// >v<🧭导航-操作历史栏-大纲栏右边的竖栏（Shift+` 开关，👤 2026-10-08）：撤销栈的每一步一句人话，最新的在上面。
//   点一行 = 回到「做完这一步」的样子（连续撤销 / 重做到那里）；灰的 = 撤销掉、还能重做的。刷新页面不丢，关窗口才清
const ago = t => { if (!t) return ''; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + ' 秒前' : s < 3600 ? Math.round(s / 60) + ' 分前' : new Date(t).toLocaleTimeString().slice(0, 5); };
export function HistoryPanel({ hist, busy, onJump, onClose }) {
  const { undo = [], redo = [] } = hist || {};
  const rows = [
    ...redo.map((e, j) => ({ e, key: 'r' + j, steps: redo.length - j, future: true })), // redo 栈顶 = 下一个能重做的，排在「现在」正上方
    ...undo.map((e, i) => ({ e, key: 'u' + i, steps: -(undo.length - 1 - i), cur: i === undo.length - 1 })).reverse(),
  ];
  return <aside className="histcol">
    <div className="bar"><b>🕘 历史</b><span className="hint">{undo.length} 步</span><span style={{ flex: 1 }} /><button className="ghost" title="关闭（Shift+Tab）" onClick={onClose}>✕</button></div>
    <div className="hlist">
      {!rows.length && <div className="hint pad">还没有改动。<br />增删改名、状态、连线、拖动、属性、正文……每一步都会记在这里，点一行就回到那一步。</div>}
      {rows.map(r => <div key={r.key} className={'hrow' + (r.future ? ' future' : '') + (r.cur ? ' cur' : '')} title={r.future ? '点一下：重做到这一步' : r.cur ? '现在的样子' : '点一下：撤销回做完这一步的样子'}
        onClick={() => !busy && r.steps && onJump(r.steps)}>
        <span className="hd">{r.cur ? '●' : r.future ? '↷' : '·'}</span><span className="ht">{r.e.desc || (r.e.op ? '改属性 / 正文' : '改了大纲')}</span><span className="ha">{ago(r.e.t)}</span>
      </div>)}
      {undo.length > 0 && <div className="hrow base" title="撤销全部：回到这次打开（或上次刷新）时的样子" onClick={() => !busy && onJump(-undo.length)}><span className="hd">○</span><span className="ht">打开时的样子</span></div>}
    </div>
  </aside>;
}

export function FilePanel({ file, onClose, hl, onSelMenu }) {
  return (
    <aside className="side wide">
      <div className="bar"><b>📄 {file?.path}</b><span className="hint">只读预览</span><button onClick={onClose}>✕</button></div>
      <div className="sidebody">
        {!file ? <div className="hint">加载中…</div> : file.error ? <div className="errs">{file.error}</div> : file.text === null ? <div className="hint">{file.note}</div> : <RawText text={file.text} hl={hl} file={file.path} onSelMenu={onSelMenu} />}
      </div>
    </aside>
  );
}

// >v<🌳大纲模型-大纲树-左栏默认页：点一下 = 导航 + 看内容（不进编辑）；双击 / Enter = 原地改名；▸ 折叠；→ 钻进；↑↓←→ 键盘走
// >v<🌳左栏-大纲树拖动-拖一行到另一行上 = 放进它里面；拖到树下面的空白 = 挪到根；拖到画布的卡片上也行（👤 2026-10-08 第 9 条）
export const DRAG_NODE = 'application/x-synapsis-node';
export function OutlineTree({ graph, rootId = '', selected, scope, renaming, status, onPick, onDrill, onRename, onCommit, onCancel, onMove, onReorder, colors, multiIds = [], onSelectSet, frozen = null, grouped = false }) {
  const multiSet = new Set(multiIds);
  const [over, setOver] = useState(null); // 拖动时悬停的位置 {id, where:'before'|'after'}：大纲里拖动只调同一层的次序
  const dragFrom = useRef(null); // 正在拖的行（dragover 里读不到 dataTransfer 的内容）
  const [open, setOpen] = useState({});
  const [q, setQ] = useState(''); // 过滤：只留名字命中的和它们的祖先（全部展开）
  const flt = useMemo(() => filterTree(graph, q), [graph, q]);
  const box = useRef(null);
  // 默认：前两层展开；当前页和选中节点的祖先一律展开（大纲里永远看得到「我在哪」）
  const focus = new Set();
  // 临时展开只跟「现在的焦点」：选中了节点 = 它的祖先链；没选中 = 当前页的祖先链。Alt+W 退回上一级 → 深的临时展开自动收回；选了别的节点 → 之前那条也不管了（自己点开的 open[] 不受影响）
  const f0 = frozen ? (frozen.selected && graph.nodes.has(frozen.selected) ? frozen.selected : frozen.scope) : selected && graph.nodes.has(selected) ? selected : scope;
  for (let c = f0; c && graph.nodes.has(c); c = graph.nodes.get(c).parent) focus.add(c);
  const isOpen = (id, depth) => flt ? true : open[id] ?? (depth < 2 || focus.has(id));
  const rows = [];
  const walk = (id, depth, top = null) => { for (const c of graph.nodes.get(id).children) { if (flt && !flt.keep.has(c)) continue; const n = graph.nodes.get(c); rows.push({ n, depth, top: top ?? c }); if (n.children.length && isOpen(c, depth)) walk(c, depth + 1, top ?? c); } };
  const rootEff = graph.nodes.has(rootId) ? rootId : '';
  const blocks = []; // 分组视图：同一层按「连在一起」分组，组内按流向排（core groupSiblings）；不同组各自一块
  if (grouped) {
    groupSiblings(graph, rootEff).forEach((g, gi) => {
      const from = rows.length;
      for (const c of g.ids) { if (flt && !flt.keep.has(c)) continue; const n = graph.nodes.get(c); rows.push({ n, depth: 0, top: c }); if (n.children.length && isOpen(c, 0)) walk(c, 1, c); }
      if (rows.length > from) blocks.push({ gi, from, to: rows.length, n: g.ids.length, loose: g.loose, info: g.info });
    });
  } else walk(rootEff, 0); // rootId = 只显示当前进入的这个节点里的子节点（左栏 ◎ 开关）
  // 选中节点 → 大纲里把它滚到正中间（👤 2026-10-08：以前 nearest，从下面选上来就贴在最底下）。只滚大纲这个盒子，不带动外层；
  //   人自己在大纲里点的那一下不滚（点哪行哪行不动，不然列表会在手底下跳）；键盘上下走、画布上选、面包屑 / ↑ 都居中
  const byClick = useRef(false);
  useEffect(() => {
    const b = box.current, el = b?.querySelector('.orow.sel');
    if (!b || !el || frozen) return;
    if (byClick.current) { byClick.current = false; return; }
    const bb = b.getBoundingClientRect(), er = el.getBoundingClientRect();
    b.scrollTop += er.top - bb.top - (bb.height - er.height) / 2;
  }, [selected]);
  const onKey = e => {
    if (renaming) return;
    const i = rows.findIndex(r => r.n.id === selected), r = rows[i];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const j = Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1))); onPick(rows[j].n.id); }
    else if (e.key === 'ArrowRight' && r?.n.children.length) { e.preventDefault(); setOpen(o => ({ ...o, [r.n.id]: true })); }
    else if (e.key === 'ArrowLeft' && r) { e.preventDefault(); if (r.n.children.length && isOpen(r.n.id, r.depth)) setOpen(o => ({ ...o, [r.n.id]: false })); else if (r.n.parent) onPick(r.n.parent); }
  };
  const renderRow = ({ n, depth, top }, info = null) => (
        <div key={n.id} className={'orow' + (n.id === selected || multiSet.has(n.id) ? ' sel' : '') + (n.id === scope && scope ? ' scope' : '') + (flt?.hits.has(n.id) ? ' hit' : '') + (over?.id === n.id ? ' drop-' + over.where : '') + (depth === 0 ? ' top' : n.children.length ? ' grp' : '')} style={{ paddingLeft: 4 + depth * 14, '--d': depth, '--g': colors?.get(top) || 'var(--line2)' }}
          draggable={!!onMove && renaming !== n.id} onDragStart={e => { const ids = multiSet.has(n.id) ? multiIds : [n.id]; dragFrom.current = ids; e.dataTransfer.setData(DRAG_NODE, JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copyMove'; }}
          onDragOver={e => { const d = dragFrom.current; if (!onReorder || grouped || !d || d.includes(n.id) || d.some(x => graph.nodes.get(x)?.parent !== n.parent)) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(), where = e.clientY < r.top + r.height / 2 ? 'before' : 'after'; setOver(o => o?.id === n.id && o.where === where ? o : { id: n.id, where }); }}
          onDragLeave={() => setOver(o => o?.id === n.id ? null : o)} onDragEnd={() => { dragFrom.current = null; setOver(null); }}
          onDrop={e => { const d = dragFrom.current, o = over; dragFrom.current = null; setOver(null); if (o?.id === n.id && d && !d.includes(n.id)) { e.preventDefault(); e.stopPropagation(); onReorder(d, n.id, o.where); } }}
          onClick={e => {
            if (renaming === n.id) return;
            if ((e.ctrlKey || e.metaKey) && onSelectSet) { // Ctrl+点击：加入 / 移出选择（和画布共用一组），不导航
              const cur = new Set(multiIds.length ? multiIds : selected ? [selected] : []); cur.has(n.id) ? cur.delete(n.id) : cur.add(n.id);
              onSelectSet([...cur], cur.has(n.id) ? n.id : null); return;
            }
            if (e.shiftKey && onSelectSet && selected) { // Shift+点击：选中它和已选的那一行之间所有可见的行（像 Windows）
              const a = rows.findIndex(r => r.n.id === selected), b = rows.findIndex(r => r.n.id === n.id);
              if (a >= 0 && b >= 0) { onSelectSet(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map(r => r.n.id), n.id); return; }
            }
            onPick(n.id);
          }} onDoubleClick={() => onRename(n.id)} title={n.id}>
          <span className="ocaret" onClick={e => { e.stopPropagation(); if (n.children.length) setOpen(o => ({ ...o, [n.id]: !isOpen(n.id, depth) })); }}>{n.children.length ? (isOpen(n.id, depth) ? '▾' : '▸') : ''}</span>
          <span className="ost">{n.status ? status[n.status] : '·'}</span>
          {renaming === n.id
            ? <input autoFocus defaultValue={n.label} onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.target.dataset.done = 1; onCommit(n.id, e.target.value); } else if (e.key === 'Escape') { e.target.dataset.done = 1; onCancel(); } }}
                onBlur={e => { if (!e.target.dataset.done) onCommit(n.id, e.target.value); }} />
            : <span className={'olab' + (n.status === 'dropped' ? ' strike' : '')}>{n.label}</span>}
          {info?.[n.id]?.up > 0 && depth === 0 && <span className="oup" title={`上游共 ${info[n.id].up} 个节点（直接入线 ${info[n.id].direct} 条）`}>←{info[n.id].up}</span>}
          {n.children.length > 0 && renaming !== n.id && <span className="odrill" title="钻进这一层（画布显示它的子节点）" onClick={e => { e.stopPropagation(); onDrill(n.id); }}>→</span>}
        </div>
  );
  const byTop = (list, info = null) => { // 同一棵顶层子树的行装进一个盒子：多列排版时整棵不拆开，子级留在节点下面，不会被挤到隔壁列
    const out = []; let cur = null;
    for (const r of list) { if (!cur || cur.top !== r.top) { cur = { top: r.top, rows: [] }; out.push(cur); } cur.rows.push(r); }
    return out.map(g => <div key={g.top} className="otop">{g.rows.map(r => renderRow(r, info))}</div>);
  };
  return (
    <>
    <div className="otools">
    <input className="ofilter" value={q} placeholder="过滤…（名字）" onChange={e => setQ(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setQ(''); else if (e.key === 'Enter' && flt?.hits.size) onPick([...flt.hits][0]); }} />
    <button className="ghost" title="全部展开" onClick={() => setOpen(Object.fromEntries([...graph.nodes.values()].filter(n => n.children.length).map(n => [n.id, true])))}>⊞</button>
    <button className="ghost" title="全部折叠（只留第一层）" onClick={() => setOpen(Object.fromEntries([...graph.nodes.values()].filter(n => n.children.length).map(n => [n.id, false])))}>⊟</button>
    </div>
    {grouped && blocks.length > 0 && <div className="ogchips"><span>{blocks.filter(b => !b.loose).length} 组</span>{blocks.map(b => <a key={b.gi} title={b.loose ? '没有连线的节点' : '连在一起的一组'} onClick={() => box.current?.querySelector(`[data-g="${b.gi}"]`)?.scrollIntoView({ block: 'start' })}>{b.loose ? '无' : b.gi + 1}<i>{b.n}</i></a>)}</div>}
    <div className="otree" ref={box} tabIndex={0} onKeyDown={onKey}
      onPointerDown={() => { byClick.current = true; setTimeout(() => { byClick.current = false; }, 300); }}
>
      {flt && !rows.length && <div className="hint" style={{ padding: 6 }}>没有名字含「{q}」的节点（Ctrl+F 可以搜属性和正文）</div>}
      {grouped ? blocks.map(b => <div key={'g' + b.gi} className="ogroup" data-g={b.gi}><div className="ogh">{b.loose ? '无连线' : '组 ' + (b.gi + 1)} · {b.n}</div>{byTop(rows.slice(b.from, b.to), b.info)}</div>) : byTop(rows)}
    </div>
    </>
  );
}

// >v<🧭导航-快捷键页-? 或 F1 弹出；键位只在这张表里写一次（以后要自定义就从这里长出来）
// >v<🏗️构建引导-项目文件对话框-👤 2026-10-12 和 ⚙ 里「init 生成哪些」合成一个：上面 Synapsis 自己的几样，下面项目文档骨架。
//   没挂过 Synapsis 的文件夹打开时自动弹（fresh）；顶栏「📄 项目文件…」随时补。先检测：已存在的灰掉；有同类中文名文件的默认不勾；
//   默认勾 = 上次在这里勾的（settings.yaml init 段）。只创建勾上的，已有的不覆盖
const SYN_NAMES = { manual: ['AI 接入手册', '别的 AI 怎么读图、按图施工'], blackboard: ['黑板', '多个 AI / 对话之间传话'], words: ['分层词表', '颜色 + 图案，名字含这些词自动上色 / 加底纹'], launcher: ['启动快捷方式', '项目根目录「在Synapsis打开本项目」'] };
export function ScaffoldModal({ data, onCreate, onClose }) {
  const { syn, items, docsDef, mounted, root } = data, fresh = !mounted;
  const [pickS, setPickS] = useState(() => new Set(syn.filter(i => !i.exists && i.def).map(i => i.key)));
  const [pick, setPick] = useState(() => new Set(docsDef ? items.filter(i => !i.exists && !i.alike.length).map(i => i.rel) : []));
  const flip = (set, v) => set(s => { const t = new Set(s); t.has(v) ? t.delete(v) : t.add(v); return t; });
  const docLeft = items.filter(i => !i.exists), allDocs = docLeft.length > 0 && docLeft.every(i => pick.has(i.rel));
  const n = pickS.size + pick.size, name = String(root).split(/[\\/]/).filter(Boolean).at(-1);
  return (
    <div className="modal" onClick={fresh ? undefined : onClose}>
      <div className="scaffold" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>{fresh ? `挂上 Synapsis：${name}` : '项目文件'}</b><span className="hint" style={{ flex: 1 }} title={root}>{root}</span>{!fresh && <button onClick={onClose}>✕</button>}</div>
        <div className="sidebody">
          <p className="hint">{fresh ? <>这个文件夹还没挂上 Synapsis。会建 <code>__synapsis/</code>（图数据）和 <code>.synapsis/</code>（本机状态），下面勾上的一起建。</> : '缺什么补什么。'}<b>已有的不会覆盖</b>{fresh ? '；这次勾的会记住，下个新项目默认照这样勾。' : '。'}</p>
          <h4>Synapsis</h4>
          <ul className="scaflist">{syn.map(i => (
            <li key={i.key} className={i.exists ? 'has' : ''}>
              <label><input type="checkbox" disabled={i.exists} checked={i.exists || pickS.has(i.key)} onChange={() => flip(setPickS, i.key)} /><b>{SYN_NAMES[i.key]?.[0] || i.key}</b> <code>{i.rel}</code></label>
              {i.exists ? <span className="hint">已存在</span> : <span className="hint">{SYN_NAMES[i.key]?.[1]}</span>}
            </li>))}</ul>
          <h4><label><input type="checkbox" disabled={!docLeft.length} checked={!docLeft.length || allDocs} onChange={() => setPick(allDocs ? new Set() : new Set(docLeft.map(i => i.rel)))} />项目文档骨架</label> <span className="hint">开发进度、待办、规矩那一套（和新项目引导同一套模板）；只做规划 / 研究可以不要</span></h4>
          <ul className="scaflist">{items.map(i => (
            <li key={i.rel} className={i.exists ? 'has' : ''}>
              <label><input type="checkbox" disabled={i.exists} checked={i.exists || pick.has(i.rel)} onChange={() => flip(setPick, i.rel)} />{i.rel}</label>
              {i.exists ? <span className="hint">已存在</span> : i.alike.length ? <span className="warn">已有同类：{i.alike.join('、')}</span> : null}
            </li>))}</ul>
        </div>
        <div className="bar"><span className="grow" />
          <button onClick={fresh ? () => window.close() : onClose} title={fresh ? '什么都不建，关掉这个窗口' : ''}>{fresh ? '不挂了' : '取消'}</button>
          <button className="primary" disabled={!fresh && !n} onClick={() => onCreate([...pickS], [...pick], fresh)}>{fresh ? (n ? `挂上，并建勾选的 ${n} 个` : '只挂上') : n ? `创建勾选的 ${n} 个` : '都已存在'}</button></div>
      </div>
    </div>
  );
}

// >v<⌨快捷键-键帽-👤 2026-10-12：一个键一个框，一眼看出要按几个键；Ctrl 蓝、Shift 黄、Alt 红、Tab 绿、方向键一个色系、WASD 一个色系。
//   「Ctrl(Shift)+Z / Ctrl+Y」→ [Ctrl]([Shift])+[Z] / [Ctrl]+[Y]；不是键的字（按住右键、单击、拖空白…）照原样写
const KEY_RE = /^(Ctrl|Shift|Alt|Tab|Enter|Del|Esc|Space|Backspace|F\d{1,2}|[A-Za-z0-9]|[←→↑↓`?=\-])$/;
const keyKind = k => /^Ctrl$/.test(k) ? 'ctrl' : k === 'Shift' ? 'shift' : k === 'Alt' ? 'alt' : k === 'Tab' ? 'tab' : /^[←→↑↓]$/.test(k) ? 'arrow' : /^[WASDwasd]$/.test(k) ? 'wasd' : '';
export function KeyCombo({ text }) {
  const parts = String(text).split(/(\s*\/\s*|\+|\(|\)|\s+)/).filter(x => x !== '');
  return <span className="kcombo">{parts.flatMap((p, i) => {
    if (/^[←→↑↓]{2,}$/.test(p)) return [...p].map((c, j) => <kbd key={i + '-' + j} className="k arrow">{c}</kbd>);
    if (KEY_RE.test(p)) return [<kbd key={i} className={'k ' + keyKind(p)}>{p.length === 1 ? p.toUpperCase() : p}</kbd>];
    if (/^\s+$/.test(p)) return [<span key={i} className="ksp" />];
    return [<span key={i} className={/^\s*\/\s*$/.test(p) ? 'kor' : /^[+()]$/.test(p) ? 'kop' : 'ktx'}>{p.trim()}</span>];
  })}</span>;
}
const KEY_HUE = { 导航与查看: ['🧭', '#5cc46a'], 选择与查看: ['👆', '#4d9bff'], AI: ['🤖', '#a97cff'], 搜索: ['🔎', '#36c6c0'], 导航: ['🧭', '#5cc46a'], 编辑: ['✏️', '#ff9636'], 复制: ['📋', '#e6c440'], 移动与复制: ['📦', '#e6c440'], 移动: ['📦', '#36c6c0'], 选择: ['🎯', '#ff79c2'], 排列: ['📐', '#9a9a9a'], 图片: ['🖼️', '#ff5f5f'], 界面: ['🎛️', '#7aa2c8'] };
export { KEYMAP };
// >v<🔎搜索-搜索框-Ctrl+F 跳到节点 / 右键「连线到…」选目标：同一个框（↑↓ 选，Enter 确定，Esc 关）
export function SearchModal({ title, items, exclude, onPick, onClose }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0), [tab, setTab] = useState('node');
  // 「连线到…」里除了节点还有项目文件（id 以 @file: 开头）：分成两个页签，文件太多不和节点混在一起；点页签或按 Tab 切
  const nodeItems = useMemo(() => items.filter(x => !String(x.id).startsWith('@file:')), [items]);
  const fileItems = useMemo(() => items.filter(x => String(x.id).startsWith('@file:')), [items]);
  const hasFiles = fileItems.length > 0; // 文件列表还没读出来 / 没有文件时，「项目文件」页签灰着
  const resN = useMemo(() => searchNodes(nodeItems, q).filter(r => r.id !== exclude).sort((a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0)), [nodeItems, q, exclude]); // 本页的节点排最前（稳定排序，页内仍按匹配度）
  const resF = useMemo(() => hasFiles ? searchNodes(fileItems, q) : [], [fileItems, q, hasFiles]);
  const res = hasFiles && tab === 'file' ? resF : resN;
  useEffect(() => setI(0), [q, tab]);
  const pick = r => r && (onClose(), onPick(r.id));
  const flip = () => setTab(t => t === 'node' ? 'file' : 'node');
  const inRef = useRef(null);
  useEffect(() => { // Tab 在弹窗里不管焦点在哪都是切页签（焦点不在输入框时不能漏给外面的「Tab 开关左栏」）
    const h = e => { if (e.key !== 'Tab' || e.ctrlKey || e.altKey) return; e.preventDefault(); e.stopPropagation(); if (hasFiles) flip(); inRef.current?.focus(); };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  });
  return (
    <div className="modal" onPointerDown={onClose}>
      <div className="finder" onPointerDown={e => e.stopPropagation()}>
        <div className="bar"><b>{title}</b><span className="hint">名字 / 属性 / 正文</span></div>
        <div className="ftabs">
          <a className={tab === 'node' ? 'on' : ''} onClick={() => setTab('node')}>节点{q.trim() ? ' ' + resN.length : ''}</a>
          <a className={(tab === 'file' ? 'on' : '') + (hasFiles ? '' : ' off')} onClick={() => hasFiles && setTab('file')}>📎 项目文件{q.trim() && hasFiles ? ' ' + resF.length : ''}</a>
          {hasFiles && <span className="tabkey" title="按 Tab 切页签">Tab</span>}
        </div>
        <input autoFocus ref={inRef} value={q} placeholder={tab === 'file' ? '搜项目文件…' : '搜索节点…'} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(res.length - 1, x + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)); } else if (e.key === 'Enter') pick(res[i]); }} />
        <ul>{res.map((r, k) => (
          <li key={r.id} className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => pick(r)}>
            <b>{r.label}</b><span className="fp">{r.path.split('/').slice(0, -1).join(' / ')}</span>{r.here && <span className="fw here">本页</span>}{r.where !== '名字' && <span className="fw">{r.where}</span>}
            {r.snippet && <div className="fs">{r.snippet}</div>}
          </li>))}
          {q.trim() && !res.length && <li className="hint">没找到{hasFiles && (tab === 'node' ? resF.length : resN.length) ? '（' + (tab === 'node' ? '「项目文件」页' : '「节点」页') + '有 ' + (tab === 'node' ? resF.length : resN.length) + ' 个）' : ''}</li>}</ul>
      </div>
    </div>
  );
}

// ⚙ 设置：Synapsis 目录根的 settings.yaml（进 git）。现在有方向键微调（「init 生成哪些」合进了「📄 项目文件…」对话框）；快捷键自定义下一步；以后别的设置慢慢往里加
export function SettingsModal({ api, onClose, onHelp }) {
  const [d, setD] = useState(null), [err, setErr] = useState('');
  useEffect(() => { api('/settings').then(setD).catch(e => setErr(e.message)); }, []);
  const set = (sec, k, v) => { setD(x => ({ ...x, settings: { ...x.settings, [sec]: { ...x.settings[sec], [k]: v } } })); api('/settings', { method: 'PUT', body: JSON.stringify({ [sec]: { [k]: v } }) }).then(r => { setD(r); window.dispatchEvent(new CustomEvent('syn-settings', { detail: r.settings })); }).catch(e => setErr(e.message)); };
  return (
    <div className="modal">{/* 👤 2026-10-12 点框外不关，只能点 ✕（改数字时手一滑就没了） */}
      <div className="settings" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>⚙ 设置</b><span className="hint" style={{ flex: 1 }}>改了立刻存进 settings.yaml</span><button onClick={onClose}>✕</button></div>
        <div className="sbody">
          {err && <div className="warn">{err}</div>}
          {!d && !err && <div className="hint">读取中…</div>}
          {d && Object.entries(d.schema).filter(([, x]) => !x.hidden).map(([sec, { title, hint, keys }]) => (
            <section key={sec}><h4>{title}</h4>
              {hint && <div className="hint" style={{ marginBottom: 4 }}>{hint}</div>}
              {Object.entries(keys).map(([k, [def, name, desc]]) => typeof def === 'number'
                ? <label key={k} className="srow"><input type="number" className="snum" min="1" defaultValue={d.settings[sec]?.[k] ?? def} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0 && v !== d.settings[sec]?.[k]) set(sec, k, v); }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} /><b>{name}</b><span className="hint">{desc}（默认 {def}）</span></label>
                : <label key={k} className="srow"><input type="checkbox" checked={!!d.settings[sec]?.[k]} onChange={e => set(sec, k, e.target.checked)} /><b>{name}</b><span className="hint">{desc}</span></label>
              )}
            </section>
          ))}
          <section><h4>新项目生成哪些</h4>
            <div className="hint">打开没挂过 Synapsis 的文件夹时会弹一个清单让你勾（上次勾的记住）；已有项目缺什么，顶栏 <b>📄 项目文件…</b> 里补。</div>
          </section>
          <section><h4>快捷键</h4>
            <div className="hint">自定义键位：下一步做。现在的键位表在 <a onClick={() => { onClose(); onHelp(); }}>⌨ 快捷键</a>（可以搜）。</div>
          </section>
          {d && <div className="hint spath" title={d.path}>设置文件：{d.path}（进 git，调好了直接分享；也可以手动改）</div>}
        </div>
      </div>
    </div>
  );
}

// 两个搜索框（都要满足）：左边「按一下键」= 查键位（组合键直接按；只按修饰键就在抬起时记；Backspace / Delete 清除，留白 = 不按键位筛）；右边打字搜说明文字
export function HelpModal({ onClose }) {
  const [combo, setCombo] = useState(null), [tq, setTq] = useState('');
  const pendingMod = useRef(null);
  const onKeyDown = e => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return; // 光按 Tab = 正常移走焦点
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Backspace' || e.key === 'Delete') { setCombo(null); return; }
    const c = comboFromKeyEvent(e);
    if (c) { pendingMod.current = null; setCombo(c); } else pendingMod.current = { mods: [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean), key: null };
  };
  const onKeyUp = e => { if (pendingMod.current && pendingMod.current.mods.length) setCombo(pendingMod.current); else if (pendingMod.current) pendingMod.current = null; };
  const t = tq.trim().toLowerCase();
  const groups = KEYMAP.map(([g, rows]) => [g, rows.filter(([k, v, basic]) => !basic && matchKey(k, combo) && (!t || (k + ' ' + v).toLowerCase().includes(t)))]).filter(([, rows]) => rows.length);
  return (
    <div className="modal" onClick={onClose}>
      <div className="help" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>⌨️ 快捷键</b>
          <input className="hkey" readOnly value={comboText(combo)} placeholder="按一下键查键位…" title="按一下键（组合键直接按）= 查哪些条目用到它；Backspace 清除，留白 = 不按键位筛" onKeyDown={onKeyDown} onKeyUp={onKeyUp} />
          {combo && <a className="hclear" onClick={() => setCombo(null)} title="清除键位">✕</a>}
          <input className="htext" value={tq} onChange={e => setTq(e.target.value)} placeholder="搜文字…" title="搜说明文字；和左边的键位一起用 = 两个都要满足" />
          <span className="grow" /><button onClick={onClose}>✕</button></div>
        <div className="helpgrid">{groups.map(([g, rows]) => (
          <section key={g} style={{ '--hue': KEY_HUE[g]?.[1] }}><h4>{KEY_HUE[g]?.[0] || '•'} {g}</h4><table><tbody>{rows.map(([k, v]) => <tr key={k}><td><KeyCombo text={k} /></td><td>{v}</td></tr>)}</tbody></table></section>
        ))}
        {!groups.length && <div className="hint" style={{ padding: 16 }}>没有符合的条目。</div>}</div>
      </div>
    </div>
  );
}

// >v<🧭顶栏-溢出菜单-第二行按钮放得下几个显示几个，放不下的收进右端「⋯」，点开 = 竖列表（👤 2026-10-08：顶栏不够宽）
//   宽度按「上次显示时量到的」记；窗口 / 栏宽一变（ResizeObserver）就重排
export function OverflowBar({ children }) {
  const items = Children.toArray(children).filter(Boolean);
  const box = useRef(null), widths = useRef({}), [n, setN] = useState(items.length), [open, setOpen] = useState(false);
  const keys = items.map(c => c.key);
  const fit = () => {
    const el = box.current; if (!el) return;
    for (const c of el.querySelectorAll(':scope > .ti')) widths.current[c.dataset.k] = c.offsetWidth + 6;
    const W = el.clientWidth - 12, ws = keys.map(k => widths.current[k] ?? 80), total = ws.reduce((a, b) => a + b, 0);
    let k = ws.length;
    if (total > W) { let sum = 0; k = 0; while (k < ws.length && sum + ws[k] <= W - 40) sum += ws[k++]; }
    setN(k);
  };
  useLayoutEffect(fit);
  useEffect(() => { const ro = new ResizeObserver(fit); ro.observe(box.current); return () => ro.disconnect(); }, [keys.join('|')]);
  useEffect(() => { if (!open) return; const c = e => { if (!e.target.closest?.('.moremenu, .morebtn')) setOpen(false); }; window.addEventListener('pointerdown', c, true); return () => window.removeEventListener('pointerdown', c, true); }, [open]);
  return (
    <div className="bar tools" ref={box}>
      {items.slice(0, n).map(c => <span key={c.key} className="ti" data-k={c.key}>{c}</span>)}
      {n < items.length && <span className="more">
        <button className="morebtn" title={'还有 ' + (items.length - n) + ' 个按钮'} onClick={() => setOpen(o => !o)}>⋯</button>
        {open && <div className="moremenu" onClick={() => setOpen(false)}>{items.slice(n)}</div>}
      </span>}
    </div>
  );
}

// >v<🎨画布-替换节点名-Ctrl+H（👤 2026-10-10）：只改本页（或选中几张）节点名里的文本；属性 / 正文别处改
export function ReplaceBar({ r, setR, total, cur, skip, scopeText, onStep, onOne, onAll, onClose }) {
  const set = p => setR(x => ({ ...x, ...p, note: '' }));
  return (
    <div className="replbar" onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <input className="rfind" autoFocus placeholder="查找节点名里的…" value={r.find} onChange={e => set({ find: e.target.value, idx: 0 })}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); else if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); } }} />
      <span className="rcount">{r.find ? (total ? `${cur + 1} / ${total}` : '没有') : ''}</span>
      <button title="上一个（Shift+Enter）" onClick={() => onStep(-1)} disabled={!total}>‹</button>
      <button title="下一个（Enter）" onClick={() => onStep(1)} disabled={!total}>›</button>
      <input className="rto" placeholder="替换为…" value={r.to} onChange={e => set({ to: e.target.value })}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); else if (e.key === 'Enter') { e.preventDefault(); onOne(); } }} />
      <button onClick={onOne} disabled={!total} title="只替换当前这个（Enter），然后跳到下一个">替换</button>
      <button onClick={onAll} disabled={!total} title="把范围里匹配的都换了；一次 Ctrl+Z 整批撤回">全部替换</button>
      <span className="rhint">{r.note || (skip ? `${skip} 个会因重名等跳过 · ` : '') + scopeText}</span>
      <button className="rx" title="关闭（Esc）" onClick={onClose}>✕</button>
    </div>
  );
}
