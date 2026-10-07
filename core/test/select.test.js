// >v<✅自检-多选-扩一层 / 扩到头、两点之间的路径
// node core/test/select.test.js
import { expand, pathBetween } from '../select.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const S = s => [...s].sort().join(',');
// 观测 → 情绪 → 决策 → 行动；观测 → 决策；记忆 → 决策；行动 → 观测（回路）；旁支 → 无关
const E = [['观测', '情绪'], ['情绪', '决策'], ['观测', '决策'], ['记忆', '决策'], ['决策', '行动'], ['行动', '观测'], ['旁支', '无关']].map(([from, to]) => ({ from, to }));

ok(S(expand(E, ['决策'], 'in')) === '决策,情绪,观测,记忆', 'Ctrl+← 扩一层入线');
ok(S(expand(E, ['决策'], 'out')) === '决策,行动', 'Ctrl+→ 扩一层出线');
ok(S(expand(E, ['情绪'], 'out', true)) === '决策,情绪,行动,观测', 'Shift+→ 扩到头（有回路也会停）');
ok(S(expand(E, ['旁支'], 'in', true)) === '旁支', '没有入线 → 不变');
ok(S(expand(E, ['情绪', '旁支'], 'out')) === '决策,情绪,旁支,无关', '多个选中一起扩');

const E2 = [['A', 'B'], ['B', 'C'], ['A', 'X'], ['X', 'C'], ['C', 'D'], ['Y', 'B']].map(([from, to]) => ({ from, to }));
ok(S(pathBetween(E2, 'A', 'C')) === 'A,B,C,X', 'Shift+点击：A 到 C 的所有路径（两条）');
ok(S(pathBetween(E2, 'C', 'A')) === 'A,B,C,X', '反方向点也一样');
ok(S(pathBetween(E2, 'B', 'X')) === 'B,X', '没有有向路径 → 只选两端');
ok(!pathBetween(E2, 'A', 'D').has('Y'), '不在路径上的上游支路不选');

console.log(`select: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
