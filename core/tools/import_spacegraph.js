// >v<💾工作区-导入空间图-把 Life Games/研究/空间图.html 的节点/边/说明搬进 __synapsis/（一次性，留作来源记录）
// node core/tools/import_spacegraph.js "<Life Games/研究>"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { saveOutline, setNodeMeta, saveLayout, loadWorkspace, DIR } from '../workspace.js';

const root = process.argv[2];
if (!root) { console.log('用法：node core/tools/import_spacegraph.js <研究目录>'); process.exit(1); }
if (existsSync(join(root, DIR, '游戏NPC状态空间组'))) { console.log('已经导入过（游戏NPC状态空间组 存在），不重复导入'); process.exit(0); }

const html = readFileSync(join(root, '空间图.html'), 'utf8');
const grab = name => { const m = html.match(new RegExp(`const ${name}=\\[([\\s\\S]*?)\\n\\];`)); return Function(`return [${m[1]}]`)(); };
const N = grab('N'), E = grab('E');
const TOP = '游戏NPC状态空间组';
const GROUPS = [['obs', '观测'], ['int', '内在'], ['dec', '决策'], ['act', '行动'], ['ext', '外部（身体、结果、外显）'], ['llm', '兜底']];
const ST = { '✅': '✅', '◐': '◐', '○': '○' };
const byId = Object.fromEntries(N.map(n => [n.id, n]));

// 1) 结构：大纲
const lines = [TOP];
for (const [g, gname] of GROUPS) {
  lines.push('  ' + gname);
  for (const n of N.filter(n => n.g === g)) {
    const to = E.filter(e => e[0] === n.id).map(e => byId[e[1]].t);
    lines.push('    ' + (ST[n.st] ? ST[n.st] + ' ' : '') + n.t + (to.length ? ' -> ' + to.join(', ') : ''));
  }
}
const r = saveOutline(root, lines.join('\n'));
if (!r.ok) { console.log('大纲有错', r.errors); process.exit(1); }

// 2) 属性 + 边标签 + 正文（大纲表达不了的）
const ws = loadWorkspace(root);
const idOf = t => [...ws.graph.nodes.values()].find(n => n.label === t).id;
for (const n of N) {
  const to = E.filter(e => e[0] === n.id).map(e => [byId[e[1]].t, e[2], e[4] ? 'LLM' : e[3] ? '离散' : ''].join(' | ').replace(/( \| )+$/, ''));
  setNodeMeta(root, idOf(n.t), { rate: n.rate, math: n.math, ...(to.length ? { to } : {}), source: '空间图.html（2026-10-07 导入；边是设计估计）' });
  const f = loadWorkspace(root).graph.nodes.get(idOf(n.t)).file;
  writeFileSync(f, readFileSync(f, 'utf8').replace(/\n*$/, '\n') + `\n## Life Games 现状\n${n.lg}\n`);
}
// 3) 组内坐标沿用空间图里的位置
saveLayout(root, Object.fromEntries(N.map(n => [idOf(n.t), { x: n.x * 1.6, y: n.y * 1.4 }])));
console.log(`导入完成：${N.length} 节点、${E.length} 边 → ${join(root, DIR)}`);
