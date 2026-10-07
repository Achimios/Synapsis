// >v<✅自检-框选缩放排列-缩放、卡在不重叠的下限、对齐、排开、已对齐再摊开
// node core/test/arrange.test.js
import { scaleAxis, dragScale, minScale, overlaps, GAP } from '../arrange.js';

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
ok(r.mode === 'align' && r.rects.every(q => q.x === 0) && noOverlap(r.rects), '继续拖到底：左对齐，会重叠的往下排开');
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

console.log(`arrange: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
