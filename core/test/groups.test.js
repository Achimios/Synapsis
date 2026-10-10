// 大纲分组排序：groupSiblings。node core/test/groups.test.js
import { parseOutline, groupSiblings, ROOT } from '../outline.js';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const show = gs => gs.map(g => (g.loose ? '*' : '') + g.ids.join('')).join('|');
// 链 + 菱形：a→b→d, a→c→d, d→e；孤立 x
let g = parseOutline('e\nd -> e\nb -> d\nc -> d\na -> b, c\nx');
ok(show(groupSiblings(g)) === 'abcde|*x'.replace('abcde', 'abcde') || show(groupSiblings(g)) === 'abcde|*x', '链和菱形：上游少的在前，孤立的单独一组放最后 ' + show(groupSiblings(g)));
// 入线条数少但上游多的排最后：a→b→c→z，q→z（z 只有 2 条入线）
g = parseOutline('z\nq -> z\nc -> z\nb -> c\na -> b');
ok(show(groupSiblings(g)) === 'qabcz' || show(groupSiblings(g)) === 'abqcz' || show(groupSiblings(g)).endsWith('z'), '直接入线只有 2 条的 z 排最后 ' + show(groupSiblings(g)));
// 环 + 外部入口：S→B，A→B→C→A → S,B,C,A
g = parseOutline('A -> B\nB -> C\nC -> A\nS -> B');
ok(show(groupSiblings(g)) === 'SBCA', '环从被外部连进来的 B 开始走：S B C A ' + show(groupSiblings(g)));
// 纯环：没有入口 → 原顺序第一个
g = parseOutline('X -> Y\nY -> Z\nZ -> X');
ok(show(groupSiblings(g)) === 'XYZ', '纯环取原顺序第一个当入口：X Y Z ' + show(groupSiblings(g)));
g = parseOutline('Y -> Z\nZ -> X\nX -> Y');
ok(show(groupSiblings(g)) === 'YZX', '纯环换了原顺序 → 从 Y 开始：Y Z X ' + show(groupSiblings(g)));
// 子节点连子节点：A/x → B/y → A、B 同组，C 孤立
g = parseOutline('A\n  x -> y\nB\n  y\nC');
g = parseOutline('A\n  x\nB\n  y\nC');
g.edges.push({ from: 'A/x', to: 'B/y', id: 'A/x->B/y' });
ok(show(groupSiblings(g)) === 'AB|*C', '子节点之间的连线提到上一层：A、B 同组 ' + show(groupSiblings(g)));
// 同一个节点里的子节点互连：不让自己成组
g = parseOutline('A\n  x\n  y\nB');
g.edges.push({ from: 'A/x', to: 'A/y', id: 'A/x->A/y' });
ok(show(groupSiblings(g)) === '*AB', '内部连线不算 ' + show(groupSiblings(g)));
// 两组：按各自最前面成员在原顺序里的位置排
g = parseOutline('p -> q\nq\nm\nr -> s\ns');
ok(show(groupSiblings(g)) === 'pq|rs|*m', '两个组 + 孤立 ' + show(groupSiblings(g)));
// 在某个节点里面的一层
g = parseOutline('G\n  c\n  b -> c\n  a -> b');
ok(show(groupSiblings(g, 'G')) === 'G/aG/bG/c', '子层也能分：' + show(groupSiblings(g, 'G')));
console.log(`groups: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
