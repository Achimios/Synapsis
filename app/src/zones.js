// >v<⌨快捷键-生效区（👤 2026-10-16）：Ctrl+Tab / Ctrl+Shift+Tab 让 WASD 在 左栏 → 画布 → 右栏 之间轮转（只轮开着的栏）。
//   左栏：大纲 = W/S 上下行、A 收起 / 回上级、D 展开（同大纲里的方向键）；文件 = W/S 上下、D 打开文件夹、A 收起、E 打开。「文本」页不给（误按就改了文字），轮转跳过它。
//   右栏：W/S 上下一行，一排按钮里 A/D 左右，E = 点按钮 / 进输入框；在输入框 / 正文里 Esc = 退出来（回到 WASD）。
//   Shift = 一次走 4 格。当前生效区的栏有一圈强调色描边（body[data-kbzone]）；画布是默认区，不描边。
//   全靠 DOM 找行（和右键菜单 menuNav 一个思路），各栏长什么样这里不用跟着改。
let zone = 'canvas';
export const getZone = () => zone;

const leftEl = () => { const a = document.querySelector('aside.outline'); return a && a.offsetParent !== null && a.querySelector('.otree, .files') ? a : null; };
const rightEl = () => document.querySelector('aside.side');
const clearKb = () => document.querySelectorAll('.zkb').forEach(x => x.classList.remove('zkb'));
function setZone(z) {
  zone = z; clearKb();
  if (z === 'canvas') delete document.body.dataset.kbzone; else document.body.dataset.kbzone = z;
}
// 栏关了 / 左栏切到「文本」→ 回画布
function check() { if ((zone === 'left' && !leftEl()) || (zone === 'right' && !rightEl())) setZone('canvas'); }

export function cycleZone(back = false) {
  check();
  const order = [leftEl() && 'left', 'canvas', rightEl() && 'right'].filter(Boolean);
  const i = order.indexOf(zone);
  setZone(order[(i + (back ? -1 : 1) + order.length) % order.length]);
  if (zone !== 'canvas') { document.activeElement?.blur?.(); step(0); } // 进来先标出当前行
}

// 左栏「大纲」：借大纲树自己的方向键逻辑（选中 = 和画布同一个选中）。
//   造的方向键事件冒到 React 根节点就够了，别再冒到 window（画布那边方向键 = 挪卡片）
const fake = new WeakSet();
function outlineKey(tree, key, n) { // Shift 走 4 行：一次一行，等大纲重画完（它按当前选中算下一行）再走下一行
  const one = () => { const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); fake.add(ev); tree.dispatchEvent(ev); };
  one(); for (let k = 1; k < n; k++) setTimeout(one, k * 30);
}
// 行：文件树 = .fi；右栏 = 正文区里一排排的东西
function rowsOf(el) {
  if (el.matches('aside.outline')) return [...el.querySelectorAll('.files .fi')];
  const body = el.querySelector('.sidebody') || el;
  return [...body.querySelectorAll('h3 input, .row, textarea, .filerow, table.meta tr')].filter(r => r.offsetParent !== null && (r.matches('input, textarea') || r.querySelector('button, a, input, textarea')));
}
const ctrls = r => r.matches('input, textarea') ? [] : [...r.querySelectorAll('button, a, input, textarea, select')].filter(c => c.offsetParent !== null);
const pos = {}; // 每个区记 {row, col}
function mark(el, rows) {
  clearKb();
  const p = pos[zone], r = rows[p.row]; if (!r) return;
  const cs = ctrls(r), t = cs.length ? cs[Math.min(p.col, cs.length - 1)] : r;
  t.classList.add('zkb'); t.scrollIntoView?.({ block: 'nearest' });
}
function step(dy, dx = 0) {
  const el = zone === 'left' ? leftEl() : rightEl(); if (!el) return;
  if (zone === 'left' && el.querySelector('.otree')) return; // 大纲用自己的选中高亮
  const rows = rowsOf(el); if (!rows.length) return;
  const p = pos[zone] || (pos[zone] = { row: -1, col: 0 });
  if (p.row < 0 || p.row >= rows.length) { const cur = rows.findIndex(r => r.classList.contains('cur')); p.row = cur >= 0 ? cur : 0; }
  else p.row = Math.max(0, Math.min(rows.length - 1, p.row + dy));
  const cs = ctrls(rows[p.row]);
  if (dy) p.col = Math.max(0, cs.findIndex(c => c.classList.contains('on')));
  if (dx && cs.length) p.col = Math.max(0, Math.min(cs.length - 1, Math.min(p.col, cs.length - 1) + dx));
  mark(el, rows);
  return rows[p.row];
}

// 装在 window 的捕获阶段、模块一加载就装（比 shell / 画布的监听都早，才抢得到 WASD / E / Ctrl+Tab）
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => zoneKeys(e), true);
  document.addEventListener('keydown', e => { if (fake.has(e)) e.stopPropagation(); }); // React 处理完（根节点）就停
  window.addEventListener('pointerdown', e => { if (zone !== 'canvas' && e.target.closest?.('.react-flow')) setZone('canvas'); }, true); // 点画布 = 回画布
}
export function zoneKeys(e) {
  if (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); e.stopImmediatePropagation(); cycleZone(e.shiftKey); return; }
  check();
  if (zone === 'canvas') return;
  const el = zone === 'left' ? leftEl() : rightEl();
  const t = e.target;
  // 在输入框 / 正文里：Esc = 退出来（打字时别的键都归输入框）
  if (t.closest?.('input, textarea, [contenteditable="true"]')) {
    if (e.key === 'Escape' && el?.contains(t)) { e.preventDefault(); e.stopImmediatePropagation(); t.blur(); }
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const K = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', KeyE: 'ok' }[e.code];
  if (!K || document.querySelector('.ctx')) return; // 右键菜单开着：归菜单
  e.preventDefault(); e.stopImmediatePropagation();
  const n = e.shiftKey ? 4 : 1;
  const tree = zone === 'left' && el.querySelector('.otree');
  if (tree) { // 大纲
    if (K === 'up' || K === 'down') outlineKey(tree, K === 'up' ? 'ArrowUp' : 'ArrowDown', n);
    else if (K === 'left' || K === 'right') outlineKey(tree, K === 'left' ? 'ArrowLeft' : 'ArrowRight', 1);
    return;
  }
  if (K === 'up' || K === 'down') { step(K === 'up' ? -n : n); return; }
  const p = pos[zone]; const rows = rowsOf(el), r = p && rows[p.row];
  if (!r) { step(0); return; }
  if (zone === 'left') { // 文件树：D 打开文件夹 / A 收起（文件夹行文字以 ▾ / ▸ 开头）
    const isDir = /^[▾▸]/.test(r.textContent), opened = r.textContent.startsWith('▾');
    if ((K === 'right' && isDir && !opened) || (K === 'left' && isDir && opened) || K === 'ok') { r.click(); setTimeout(() => step(0), 0); }
    return;
  }
  if (K === 'left' || K === 'right') { step(0, K === 'right' ? n : -n); return; }
  // E：点这一格；输入框 / 正文 = 光标进去
  const cs = ctrls(r), c = cs.length ? cs[Math.min(p.col, cs.length - 1)] : r;
  if (c.matches('input, textarea, select')) { clearKb(); c.focus(); } else { c.click(); setTimeout(() => step(0), 0); }
}
