// >v<🖼️UI节点-布局导出-选中一批 UI 节点（或一个父 UI 节点）→ 一段给 LLM 看的文字（👤 2026-10-10）
//   UI 节点 = 带 ui: 的普通节点，在所在页里是个有宽高（w / h）的线框；里面（钻进去）是正常画布，位置用里面这一页自己的坐标。
//   输出：UI 节点带四个角（左上 / 右上 / 右下 / 左下）+ 宽高，坐标就是那一页画布上的坐标（x 向右、y 向下）；普通节点只带名字和正文，按层级缩进。
//   选中的 UI 节点里面还有 UI 节点 → 每一级都输出。不输出 bounding box（几个区块 LLM 自己看得出）。
export const UI_DEFAULT = { w: 220, h: 140 }; // 👤 2026-10-10 刚建出来里面没东西，别太大
export const isUi = meta => !!meta && meta.ui !== undefined && meta.ui !== '' && String(meta.ui) !== 'false';
export const uiSize = meta => ({ w: +meta?.w > 0 ? +meta.w : UI_DEFAULT.w, h: +meta?.h > 0 ? +meta.h : UI_DEFAULT.h });

// graph = parseOutline 的图；meta[id] / body[id] 来自工作区；layout[id] = {x, y}（左上角）
export function uiLayoutText(graph, meta, body, layout, ids) {
  const set = new Set(ids.filter(id => graph.nodes.has(id) && isUi(meta[id])));
  const under = (id, anc) => { for (let x = graph.nodes.get(id)?.parent; x != null; x = graph.nodes.get(x)?.parent) if (x === anc) return true; return false; };
  const roots = [...set].filter(id => ![...set].some(o => o !== id && under(id, o)));
  if (!roots.length) return '';
  const rn = n => Math.round(n * 10) / 10, out = [];
  const line = (id, depth) => {
    const p = layout[id] || { x: 0, y: 0 }, { w, h } = uiSize(meta[id]), x1 = rn(p.x), y1 = rn(p.y), x2 = rn(p.x + w), y2 = rn(p.y + h);
    out.push(`${'  '.repeat(depth)}- [UI] ${graph.nodes.get(id).label}  左上(${x1},${y1}) 右上(${x2},${y1}) 右下(${x2},${y2}) 左下(${x1},${y2})  宽${rn(w)} 高${rn(h)}`);
  };
  const note = (id, depth) => {
    const b = String(body[id] || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    out.push(`${'  '.repeat(depth)}- ${graph.nodes.get(id).label}${b ? '：' + b : ''}`);
  };
  const walk = (id, depth) => { // 里面这一页：UI 节点（带四角）和普通节点（名字 + 正文），先按位置从上到下、从左到右排
    const kids = [...graph.nodes.get(id).children].sort((a, b) => { const pa = layout[a] || { x: 0, y: 0 }, pb = layout[b] || { x: 0, y: 0 }; return pa.y - pb.y || pa.x - pb.x; });
    for (const c of kids) { if (isUi(meta[c])) { line(c, depth); walk(c, depth + 1); } else { note(c, depth); walk(c, depth + 1); } }
  };
  out.push('UI 布局（坐标是各自所在那一页画布上的：x 向右、y 向下，单位像素；缩进 = 在上一级里面）');
  for (const id of roots.sort((a, b) => { const pa = layout[a] || { x: 0, y: 0 }, pb = layout[b] || { x: 0, y: 0 }; return pa.y - pb.y || pa.x - pb.x; })) { line(id, 0); walk(id, 1); }
  return out.join('\n');
}
