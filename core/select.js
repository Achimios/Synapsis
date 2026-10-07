// >v<🎨画布-多选-按连线扩选（👤 2026-10-08）：Ctrl+← / → = 沿入线 / 出线扩一层，Shift+← / → = 扩到头；
// Shift+点击 = 选上两点之间有向路径上的所有节点（隔着选，中间的也选到）。edges = [{from, to}]（当前页的边，含传送门）
const step = (edges, ids, dir) => {
  const out = new Set();
  for (const e of edges) {
    if (dir === 'in' && ids.has(e.to)) out.add(e.from);
    if (dir === 'out' && ids.has(e.from)) out.add(e.to);
  }
  return out;
};
// 一层或一直到头；返回新集合（含原来的）
export function expand(edges, ids, dir, all = false) {
  const got = new Set(ids);
  let front = new Set(ids);
  do {
    const nx = [...step(edges, front, dir)].filter(x => !got.has(x));
    nx.forEach(x => got.add(x));
    front = new Set(nx);
  } while (all && front.size);
  return got;
}
// a 和 b 之间（任一方向）所有有向路径上的节点；没有路径 → 只有 a、b
export function pathBetween(edges, a, b) {
  const down = id => expand(edges, [id], 'out', true), up = id => expand(edges, [id], 'in', true);
  const res = new Set([a, b]);
  for (const [s, t] of [[a, b], [b, a]]) {
    const d = down(s), u = up(t);
    if (!d.has(t)) continue;
    for (const x of d) if (u.has(x)) res.add(x);
  }
  return res;
}
