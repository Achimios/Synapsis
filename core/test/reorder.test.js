// 大纲里拖动调次序：withReordered。node core/test/reorder.test.js
import { parseOutline, withReordered, toOutline, ROOT } from '../outline.js';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const g = parseOutline('甲\n乙\n丙\n丁\n戊 -> 甲\n  子1\n  子2');
const order = t => parseOutline(t).nodes.get(ROOT).children.join('');
let r = withReordered(g, ['丁'], '乙', 'before');
ok(order(r.text) === '甲丁乙丙戊', '丁 挪到 乙 前面 ' + order(r.text));
r = withReordered(g, ['甲'], '丙', 'after');
ok(order(r.text) === '乙丙甲丁戊', '甲 挪到 丙 后面 ' + order(r.text));
r = withReordered(g, ['甲', '丙'], '戊', 'before');
ok(order(r.text) === '乙丁甲丙戊', '多个一起挪，保持它们原来的先后 ' + order(r.text));
ok(parseOutline(r.text).edges.length === 1, '连线不丢');
r = withReordered(g, ['戊/子2'], '戊/子1', 'before');
ok(parseOutline(r.text).nodes.get('戊').children.join() === '戊/子2,戊/子1', '子级里也能调');
ok(withReordered(g, ['戊/子1'], '乙', 'before').error?.includes('同一层'), '不同层 → 拒绝，不偷偷搬家');
ok(withReordered(g, ['甲'], '乙', 'before').error === '次序没变', '原地不动 → 提示次序没变');
ok(withReordered(g, ['甲'], '甲', 'after').error, '拖到自己上 → 没有要挪的');
console.log(`reorder: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
