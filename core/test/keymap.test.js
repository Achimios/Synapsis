// 快捷键页「搜键位」：按键事件 → 组合；组合 → 匹配键位文字。node core/test/keymap.test.js
import { KEYMAP, comboFromKeyEvent as ev, comboText, matchKey } from '../keymap.js';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

ok(comboText(ev({ key: 'z', ctrlKey: true })) === 'Ctrl+Z', '组合显示 Ctrl+Z');
ok(comboText(ev({ key: 'ArrowUp', altKey: true })) === 'Alt+↑', 'Alt+↑');
ok(ev({ key: 'Control', ctrlKey: true }) === null && ev({ key: 'Shift', shiftKey: true }) === null, '只按修饰键 → null（抬起时才记）');
ok(!ev({ key: '?', shiftKey: true }).mods.includes('Shift'), '? 要按 Shift 才出来，Shift 不算');
ok(ev({ key: 'Z', shiftKey: true, ctrlKey: true }).key === 'z' && ev({ key: 'Z', shiftKey: true, ctrlKey: true }).mods.includes('Shift'), 'Ctrl+Shift+Z：字母小写，Shift 算');

const m = (text, e) => matchKey(text, ev(e));
ok(m('Ctrl+Z', { key: 'z', ctrlKey: true }), 'Ctrl+Z 命中 Ctrl+Z');
ok(m('Ctrl+Shift+Z / Ctrl+Y', { key: 'z', ctrlKey: true }), '只按 Ctrl+Z 也能找到 Ctrl+Shift+Z（多的修饰键不拦）');
ok(m('Ctrl+Shift+Z / Ctrl+Y', { key: 'y' }), '只按 Y = 列出所有用到 Y 的（带 Ctrl 的也算）');
ok(!m('Ctrl+Shift+Z / Ctrl+Y', { key: 'q' }), '不含这个键的不命中');
ok(m('Ctrl+Shift+Z / Ctrl+Y', { key: 'y', ctrlKey: true }), 'Ctrl+Y 命中');
ok(!m('Alt+↑', { key: 'z', ctrlKey: true }), '不相干的不命中');
ok(m('? / F1', { key: '?', shiftKey: true }), '? 命中');
ok(m('Ctrl+← / →', { key: 'ArrowRight', ctrlKey: true }), 'Ctrl+→ 命中「Ctrl+← / →」');
ok(m('反引号 ` / 顶栏 📌', { key: '`' }), '反引号');
ok(m('▸N / 空格', { key: ' ' }), '空格');
ok(m('Q / 顶栏 🔍', { key: 'q' }), 'Q');
ok(!m('Tab', { key: 'Tab', ctrlKey: true }), 'Ctrl+Tab 不命中只写了 Tab 的条目');
ok(matchKey('anything', null), '没按键 = 不过滤');
ok(matchKey('Ctrl+Z', { mods: ['Ctrl'], key: null }) && !matchKey('Alt+↑', { mods: ['Ctrl'], key: null }), '只按修饰键：看有没有这个修饰键');

// 真实键位表：Ctrl+Z 应该能找到「撤销」，Q 能找到「看清连线」那一条
const rows = KEYMAP.flatMap(([, rs]) => rs);
ok(rows.some(([k, v]) => matchKey(k, ev({ key: 'z', ctrlKey: true })) && /撤销/.test(v)), '真实表里 Ctrl+Z → 撤销');
ok(rows.some(([k, v]) => matchKey(k, ev({ key: 'q' })) && /看清连线/.test(v)), '真实表里 Q → 看清连线那条');

console.log(`keymap: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
