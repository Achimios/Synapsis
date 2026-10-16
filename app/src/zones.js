// >v<⌨快捷键-生效区（👤 2026-10-16）：Ctrl+Tab / Ctrl+Shift+Tab 让 WASD 在 左栏 → 画布 → 右栏 之间轮转（只轮开着的栏）。
//   左栏：大纲 = 光标按屏幕位置走（见 okey），E 选中；文件 =W/S 上下、D 打开文件夹、A 收起、E 打开。「文本」页不给（误按就改了文字），轮转跳过它。
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

// 左栏「大纲」（👤 2026-10-16：以前借大纲的方向键 = 每走一行就选中、画布跟着进进出出；多列 / 分组时上下左右也不对）：
//   WASD 只挪一个光标（不选中、画布不动），按屏幕上看到的位置走 —— W / S = 同一列里上 / 下一行（列底再往下 = 下面那一组，不跳到同组的隔壁列），
//   A / D = 左 / 右边那一列里高度最近的行；那边没有列了 → D 展开、A 收起（已收起就跳到上级那一行）。E = 选中这一行（画布跳过去）
let ocur = null; // 光标在哪一行：行的 title = 节点 id
const orows = tree => [...tree.querySelectorAll('.orow')].filter(r => r.offsetParent !== null);
function omark(tree) {
  clearKb();
  const rows = orows(tree); let r = rows.find(x => x.title === ocur);
  if (!r) { r = tree.querySelector('.orow.sel') || rows[0]; ocur = r?.title ?? null; }
  if (r) { r.classList.add('zkb'); r.scrollIntoView?.({ block: 'nearest' }); }
  return r;
}
function ostep(tree, dir) { // 走一格；走不动回 false
  const rows = orows(tree), cur = rows.find(x => x.title === ocur) || omark(tree); if (!cur) return false;
  const c = cur.getBoundingClientRect(), cy = (c.top + c.bottom) / 2; let best = null, bd = Infinity;
  for (const r of rows) {
    if (r === cur) continue;
    const p = r.getBoundingClientRect(), py = (p.top + p.bottom) / 2;
    let d;
    if (dir === 'up' || dir === 'down') {
      if (!(p.left < c.right - 4 && p.right > c.left + 4)) continue; // 不在同一列
      d = dir === 'down' ? py - cy : cy - py; if (d <= 2) continue;
    } else {
      const dx = dir === 'right' ? p.left - c.right : c.left - p.right; if (dx < -4) continue; // 要在那一边的列里
      d = Math.abs(py - cy) + dx * 2;
    }
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return false;
  ocur = best.title; omark(tree); return true;
}
function okey(tree, K, n) {
  if (K === 'ok') { const r = omark(tree); r?.click(); setTimeout(() => omark(tree), 50); return; }
  if (K === 'up' || K === 'down') { for (let k = 0; k < n && ostep(tree, K); k++); return; }
  if (ostep(tree, K)) { for (let k = 1; k < n && ostep(tree, K); k++); return; }
  const r = omark(tree), caret = r?.querySelector('.ocaret'), t = caret?.textContent || ''; if (!r) return;
  if (K === 'right' && t === '▸') caret.click();
  else if (K === 'left' && t === '▾') caret.click();
  else if (K === 'left' && ocur?.includes('/')) { ocur = ocur.slice(0, ocur.lastIndexOf('/')); } // 回上级那一行
  setTimeout(() => omark(tree), 30);
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
  if (zone === 'left' && el.querySelector('.otree')) { omark(el.querySelector('.otree')); return; } // 大纲：自己的光标
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
  if (tree) { okey(tree, K, n); return; } // 大纲
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
