// Ctrl+H 替换节点名：replaceLabels。node core/test/replace.test.js
import { parseOutline, replaceLabels, ROOT } from '../outline.js';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const g = parseOutline('敌人A\n敌人B -> 敌人A\n友军\n  敌人C\n  Boss敌人\n组\n  敌人A');
const page = g.nodes.get(ROOT).children;
let r = replaceLabels(g, page, '敌人', '怪物');
ok(r.changed.length === 2 && r.text.includes('怪物A') && r.text.includes('怪物B -> 怪物A') && r.text.includes('敌人C'), '本页（根）两个改了；子页的不动 ' + r.text);
ok(r.changed.find(c => c.from === '敌人B').to === '怪物B', '返回新 id');
r = replaceLabels(g, page, '敌人', '怪物', { only: '敌人B' });
ok(r.changed.length === 1 && r.text.includes('怪物B -> 敌人A'), '只替换一个');
r = replaceLabels(g, g.nodes.get('友军').children, '敌人', '怪物');
ok(r.changed.length === 2 && r.changed.find(c => c.from === 'Boss敌人').to === '友军/Boss怪物', '子页里的新 id 带上父路径 ' + JSON.stringify(r.changed));
ok(replaceLabels(g, page, 'a', 'x').changed.length === 1, '默认不区分大小写（敌人A）');
ok(replaceLabels(g, page, 'a', 'x', { caseSens: true }).changed.length === 0, '区分大小写时 a 匹配不到');
// 撞名：敌人A → A，同时 A 已存在
const g2 = parseOutline('A\n敌人A\n敌人B');
r = replaceLabels(g2, g2.nodes.get(ROOT).children, '敌人', '');
ok(r.changed.length === 1 && r.changed[0].from === '敌人B' && r.skipped.length === 1 && r.skipped[0].label === '敌人A', '改成已有的同名 → 跳过那个，其余照改 ' + JSON.stringify(r.skipped));
// 两个都改成同一个名字：留一个跳一个
const g3 = parseOutline('甲1\n甲2');
r = replaceLabels(g3, g3.nodes.get(ROOT).children, '甲1', '丙'); const g4 = parseOutline('甲x\nx甲'); const r2 = replaceLabels(g4, g4.nodes.get(ROOT).children, 'x', '');
ok(r.changed.length === 1, '单个正常改');
ok(r2.changed.length === 1 && r2.skipped.length === 1, '两个都变「甲」→ 一个改一个跳过 ' + JSON.stringify(r2));
ok(replaceLabels(g3, ['甲1'], '甲1', '').changed.length === 0 && replaceLabels(g3, ['甲1'], '甲1', '').skipped[0].why.includes('空'), '改成空名 → 跳过');
ok(replaceLabels(g3, ['甲1'], '1', ', ').skipped.length === 1, '含逗号 → 跳过');
ok(replaceLabels(g3, ['甲1'], '甲', '$&').changed[0].label === '$&1', '替换文本里的 $& 当普通字符');
ok(replaceLabels(g3, ['甲1'], '', 'x').text === null, '空的查找词 → 不动');
console.log(`replace: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
