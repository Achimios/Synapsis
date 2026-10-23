// >v<✅自检-规模-造假工作区（2026-10-23，设计对话 10-11「几千节点先测不先优化」）
// node core/tools/scale_gen.mjs <临时目录> [每个三级组的叶子数=5]  → 6 + 60 + 600 + 600×L 个节点（L=5 → 3666）、约 1/7 叶子带一条边、一半节点有正文
// ⚠ 会先清空 <临时目录>，只给临时目录用；计时接着跑 scale_bench.mjs / app/test/scale_ui.mjs
import fs from 'fs'; import path from 'path';
const R = new URL('../', import.meta.url).href;
const W = await import(R + 'workspace.js');
const root = process.argv[2], L = +(process.argv[3] || 5);
if (!root) { console.log('用法：node core/tools/scale_gen.mjs <空的临时目录> [L]'); process.exit(1); }
if (fs.existsSync(root) && fs.readdirSync(root).length) { console.log('目录不是空的，换一个（不替你删）：' + root); process.exit(1); }
fs.mkdirSync(root, { recursive: true });
const A = ['战斗', '探索', '叙事', '经济', '社交', '成长'], B = ['核心循环', '反馈', '节奏', '难度', '奖励', '惩罚', '信息', '空间', '时间', '身份'];
const C = ['手感', '读招', '资源', '风险', '选择', '代价', '惊喜', '掌控', '失误', '恢复'], S = ['○ ', '◐ ', '✅ ', '', ''];
let rnd = 7; const r = n => (rnd = (rnd * 48271) % 2147483647) % n;
const lines = [], leaves = [];
A.forEach((a, i) => {
  lines.push(a);
  B.forEach((b, j) => {
    lines.push('  ' + a + b);
    C.forEach((c, k) => {
      const g = `${a}${b}·${c}`; lines.push('    ' + S[r(5)] + g);
      for (let l = 0; l < L; l++) { const name = `${g}·例${l + 1}`; leaves.push(name); lines.push('      ' + S[r(5)] + name + '@@' + name); }
    });
  });
});
// 每 7 个叶子连一条到随机叶子（名字全局唯一，按名字就能解析）
const text = lines.map((s, i) => {
  const m = s.split('@@'); if (m.length < 2) return s;
  const t = leaves[r(leaves.length)];
  return r(7) === 0 && t !== m[1] ? m[0] + ' -> ' + t : m[0];
}).join('\n');
const t0 = Date.now();
const rep = W.saveOutline(root, text);
console.log('saveOutline 建库', Date.now() - t0, 'ms', rep.ok ? '' : JSON.stringify(rep.errors.slice(0, 5)));
// 正文：一半节点有 100～800 字
const ws = W.loadWorkspace(root); let nb = 0;
const P = '这里写一段玩法想法：玩家在压力下做选择，系统给出清晰反馈，失误可以恢复但有代价。';
for (const n of ws.graph.nodes.values()) {
  if (!n.file || r(2)) continue;
  const raw = fs.readFileSync(n.file, 'utf8'), { meta } = W.parseFrontmatter(raw);
  fs.writeFileSync(n.file, W.serializeNode(meta, P.repeat(3 + r(20))));
  nb++;
}
const ws2 = W.loadWorkspace(root);
console.log('节点', ws2.graph.nodes.size - 1, '边', ws2.graph.edges.length, '有正文', nb, '错误', ws2.graph.errors.length);
