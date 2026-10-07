// >v<🎨画布-框选缩放排列-拖框选框的边 / 角 = 整体拉开或收紧间距（卡片本身不缩放）。👤 2026-10-08：
//   「左右缩到不能缩就是左右对齐，上下缩到不能缩就是上下对齐；都得检测是否会重叠，不能重叠，缩不了就排在上下 / 左右相邻」
// 纯函数，Node 和浏览器共用。rects = [{id, x, y, w, h}]（左上角 + 尺寸，画布坐标）
//
// 一根轴上的缩放：anchor = 'min'（拖的是右 / 下边，左 / 上边不动）或 'max'（拖左 / 上边）。
//   min：各卡的左边缘 x → a + (x − a)·s，a = 最左；s = 0 时左对齐
//   max：各卡的右边缘 → 同理，s = 0 时右对齐
// s 往小拖时：先缩到「再小就会重叠」的 sMin 停住；继续拖（s ≤ sMin − HOLD）→ 对齐，会重叠的沿另一根轴依次排开

export const GAP = 12;     // 卡片之间至少留这么宽
export const HOLD = 0.25;  // 卡在 sMin 之后，再拖多少才跳成「对齐 + 排开」

const A = { x: ['x', 'w', 'y', 'h'], y: ['y', 'h', 'x', 'w'] };
export const overlaps = (r, q, g = GAP) => r.x < q.x + q.w + g && q.x < r.x + r.w + g && r.y < q.y + q.h + g && q.y < r.y + r.h + g;
const anyOverlap = rs => rs.some((r, i) => rs.slice(i + 1).some(q => overlaps(r, q)));

function scaleRaw(rects, axis, anchor, s) {
  const [p, d] = A[axis];
  const key = r => anchor === 'min' ? r[p] : r[p] + r[d];
  const a = anchor === 'min' ? Math.min(...rects.map(key)) : Math.max(...rects.map(key));
  return rects.map(r => { const k = a + (key(r) - a) * s; return { ...r, [p]: anchor === 'min' ? k : k - r[d] }; });
}

// 对齐到锚边，然后沿另一根轴按原顺序把会重叠的依次推开（只往远离锚的方向推：上→下、左→右）
export function alignStack(rects, axis, anchor) {
  const [p, , q, e] = A[axis];
  const flat = scaleRaw(rects, axis, anchor, 0);
  // 顺序：沿另一根轴从上到下（左到右）；本来就在同一行（另一根轴上有重叠）的，按原来的左右（上下）顺序 —— 读的顺序
  const orig = new Map(rects.map(r => [r.id, r]));
  const sameRow = (m, n) => m[q] < n[q] + n[e] && n[q] < m[q] + m[e];
  const order = [...flat].sort((m, n) => { const om = orig.get(m.id), on = orig.get(n.id); return sameRow(om, on) ? om[p] - on[p] : om[q] - on[q]; });
  const placed = [];
  for (const r of order) {
    let v = r[q];
    for (const o of placed) if (overlaps({ ...r, [q]: v }, o)) v = Math.max(v, o[q] + o[e] + GAP);
    placed.push({ ...r, [q]: v });
  }
  return rects.map(r => placed.find(x => x.id === r.id));
}

// 不重叠前提下最小的 s（原本就重叠的，不设下限）
export function minScale(rects, axis, anchor) {
  if (anyOverlap(rects)) return 0;
  if (!anyOverlap(scaleRaw(rects, axis, anchor, 0))) return 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (anyOverlap(scaleRaw(rects, axis, anchor, m))) lo = m; else hi = m; }
  return hi;
}

// 主入口：返回 {rects, mode: 'scale' | 'hold' | 'align'}
export function scaleAxis(rects, axis, anchor, s) {
  s = Math.max(0, s);
  if (s >= 1 || rects.length < 2) return { rects: scaleRaw(rects, axis, anchor, s), mode: 'scale' };
  const sMin = minScale(rects, axis, anchor);
  if (s >= sMin) return { rects: scaleRaw(rects, axis, anchor, s), mode: s === 0 ? 'align' : 'scale' };
  if (sMin === 0 || s > sMin - HOLD) return { rects: scaleRaw(rects, axis, anchor, sMin), mode: sMin === 0 ? 'align' : 'hold' };
  return { rects: alignStack(rects, axis, anchor), mode: 'align' };
}

// 拖动柄 → 各轴的 s：handle 是 'e' 'w' 's' 'n' 或角 'ne' 'nw' 'se' 'sw'；dx/dy 是画布坐标位移
export function dragScale(rects, handle, dx, dy) {
  let out = rects, modes = [];
  for (const axis of ['x', 'y']) {
    const hi = axis === 'x' ? handle.includes('e') : handle.includes('s'), lo = axis === 'x' ? handle.includes('w') : handle.includes('n');
    if (!hi && !lo) continue;
    const [p, dim] = A[axis];
    const anchor = hi ? 'min' : 'max';
    const keys = out.map(r => anchor === 'min' ? r[p] : r[p] + r[dim]);
    const span = Math.max(...keys) - Math.min(...keys);
    const delta = axis === 'x' ? dx : dy;
    if (span < 1) { // 已经对齐在一条线上：往外拖 = 按顺序摊开（间距 = 拖出去的距离 / (n−1)）
      if ((hi ? delta : -delta) <= 0) continue;
      const [, , q] = A[axis];
      const order = [...out].sort((m, n) => m[q] - n[q]);
      const step = (hi ? delta : -delta) / (out.length - 1);
      out = out.map(r => ({ ...r, [p]: r[p] + (hi ? 1 : -1) * order.findIndex(x => x.id === r.id) * step }));
      modes.push('spread');
      continue;
    }
    const r = scaleAxis(out, axis, anchor, (span + (hi ? delta : -delta)) / span);
    out = r.rects; modes.push(r.mode);
  }
  return { rects: out, mode: modes.join('+') };
}
