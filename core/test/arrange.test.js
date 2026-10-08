// >v<✅自检-框选缩放排列-缩放、卡在不重叠的下限、对齐、排开、已对齐再摊开
// node core/test/arrange.test.js
import { scaleAxis, dragScale, minScale, overlaps, GAP, tighten } from '../arrange.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const near = (a, b, e = 0.5) => Math.abs(a - b) < e;
const noOverlap = rs => !rs.some((r, i) => rs.slice(i + 1).some(q => overlaps(r, q, GAP - 0.01)));
const byId = (rs, id) => rs.find(r => r.id === id);

// 三张卡斜着排：横向收紧不会撞（y 错开）
const diag = [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }, { id: 'b', x: 300, y: 100, w: 100, h: 40 }, { id: 'c', x: 600, y: 200, w: 100, h: 40 }];
let r = scaleAxis(diag, 'x', 'min', 0.5);
ok(r.mode === 'scale' && near(byId(r.rects, 'b').x, 150) && near(byId(r.rects, 'c').x, 300) && byId(r.rects, 'a').x === 0, '拖右边往里：左边缘按比例收紧，最左不动');
r = scaleAxis(diag, 'x', 'min', 0);
ok(r.mode === 'align' && r.rects.every(q => q.x === 0) && noOverlap(r.rects), '横向收到 0 且不会撞 → 左对齐（排成一列）');
r = scaleAxis(diag, 'x', 'max', 0);
ok(r.rects.every(q => q.x + q.w === 700), '拖左边收到 0 → 右对齐');
r = scaleAxis(diag, 'x', 'min', 2);
ok(near(byId(r.rects, 'c').x, 1200), '往外拖 = 拉开');

// 三张卡在同一行：横向收紧会撞 → 先卡在 sMin，再往里拖 → 左对齐 + 往下依次排开
const row = [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }, { id: 'b', x: 300, y: 10, w: 100, h: 40 }, { id: 'c', x: 600, y: 0, w: 100, h: 40 }];
const sMin = minScale(row, 'x', 'min');
ok(sMin > 0.3 && sMin < 0.4, '同一行：不重叠的最小比例 ≈ (100+12)/300 ' + sMin.toFixed(3));
r = scaleAxis(row, 'x', 'min', sMin - 0.1);
ok(r.mode === 'hold' && noOverlap(r.rects), '缩过头一点：停在 sMin，不重叠');
r = scaleAxis(row, 'x', 'min', 0);
ok(r.mode === 'hold' && near(byId(r.rects, 'b').x, 112) && near(byId(r.rects, 'c').x, 224) && noOverlap(r.rects), '收到 0：同一行的依次贴住（挤到头），不重叠 ' + r.rects.map(q => q.x));
// 👤 2026-10-08：贴住的停下，其余还能靠近的继续靠近 —— 第一对贴住不能拦住别的行
const two = [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }, { id: 'b', x: 150, y: 0, w: 100, h: 40 }, { id: 'd', x: 400, y: 200, w: 100, h: 40 }];
r = scaleAxis(two, 'x', 'min', 0.3);
ok(near(byId(r.rects, 'b').x, 112) && near(byId(r.rects, 'd').x, 120) && r.mode === 'hold', 'a、b 贴住了，另一行的 d 照样按比例靠近（400 → 120） ' + r.rects.map(q => q.x));
r = scaleAxis(two, 'x', 'min', 0);
ok(byId(r.rects, 'd').x === 0 && near(byId(r.rects, 'b').x, 112), '收到 0：d 一路靠到最左，b 贴着 a');
// 拖过锚边再拖一段 → 对齐成一列，会重叠的往下排开
r = scaleAxis(row, 'x', 'min', -0.1);
ok(r.mode === 'hold' && near(byId(r.rects, 'c').x, 224), '刚拖过锚边：还停在挤到头');
r = scaleAxis(row, 'x', 'min', -0.5);
ok(r.mode === 'align' && r.rects.every(q => q.x === 0) && noOverlap(r.rects), '继续拖：左对齐，会重叠的往下排开');
const ys = ['a', 'b', 'c'].map(id => byId(r.rects, id).y);
ok(ys[0] === 0 && ys[1] >= 40 + GAP && ys[2] >= ys[1] + 40 + GAP - 0.01, '排开保持原来的上下顺序（a、b、c） ' + ys);

// 拖柄：右下角两轴一起；已经对齐的一列，往右拖 = 按顺序摊开
r = dragScale(diag, 'se', -300, -100);
ok(near(byId(r.rects, 'c').x, 300) && near(byId(r.rects, 'c').y, 100), '右下角：两轴一起收紧一半');
const col = scaleAxis(diag, 'x', 'min', 0).rects;
r = dragScale(col, 'e', 400, 0);
ok(r.mode === 'spread' && byId(r.rects, 'a').x === 0 && near(byId(r.rects, 'c').x, 400), '已对齐的一列往右拖：按上下顺序斜着摊开');
r = dragScale(diag, 'n', 0, 100);
ok(near(byId(r.rects, 'a').y, 100) && byId(r.rects, 'c').y === 200, '拖上边往下：下边不动，上面的往下收');

// 整体收紧（👤 2026-10-08「相对方位不要变，只是整体紧凑一点」）
{
  const R = [{ id: 'a', x: 0, y: 0, w: 100, h: 40 }, { id: 'b', x: 600, y: 0, w: 100, h: 40 }, { id: 'c', x: 300, y: 500, w: 100, h: 40 }];
  const T = tighten(R), cen = r => [r.x + r.w / 2, r.y + r.h / 2];
  const dir = (rs, i, j) => { const p = cen(rs[i]), q = cen(rs[j]); return Math.atan2(q[1] - p[1], q[0] - p[0]); };
  ok([[0, 1], [0, 2], [1, 2]].every(([i, j]) => Math.abs(dir(R, i, j) - dir(T, i, j)) < 0.02), '收紧：两两方位不变');
  ok(T[1].x - T[0].x < 300 && !T.some((r, i) => T.some((q, j) => i < j && overlaps(r, q, 39))), '收紧：明显变近，且不挨着 ' + JSON.stringify(T));
  const H = tighten(R, { s: 0.5 });
  ok(H[1].x - H[0].x === 300 && H[2].y - H[0].y === 250, '收紧 s=0.5：距离减半');
}
console.log(`arrange: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
