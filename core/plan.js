// >v<🤖AI指令-动作校验-AI 指令框（Ctrl+J）里 8B 给出的动作：只认白名单里的 do，参数逐个查，查不过的不执行（附原因给人看）。
// 纯函数，不调模型、不碰文件（core/agent.js 调模型和落盘，自检 core/test/agent.test.js）。
// 每种动作对应一份说明书 core/skills/*.md（喂给模型）；VALIDATORS 和说明书一一对应（自检核对）。
import { PALETTE } from './colors.js';
import { withMoved, ROOT } from './outline.js';

export const KINDS = { '': '', 普通: '', 调节: '调节', 离散: '离散' };
export const STATUSES = { done: 'done', partial: 'partial', todo: 'todo', dropped: 'dropped', none: null };
export const EDGES = ['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'];
export const SHAPES = ['row', 'column', 'grid'];
const EDGE_ZH = { left: '左边', right: '右边', top: '上边', bottom: '下边', hcenter: '水平居中', vcenter: '垂直居中' };
const SHAPE_ZH = { row: '横排', column: '竖排', grid: '网格' };
const STATUS_ZH = { done: '✅ 完成', partial: '◐ 进行中', todo: '○ 待做', dropped: '❌ 弃用', none: '清除状态' };
const badName = s => typeof s !== 'string' || !s.trim() || /->|[,，\r\n]/.test(s) || s.trim().length > 60;

// ctx = { refs: Map('n1' → 真 id), graph, scope }；返回 { ok, why?, desc?, ...规范化后的参数（真 id）}
export function validateAction(a, ctx) {
  if (!a || typeof a !== 'object') return { ok: false, why: '不是一个动作对象' };
  const V = VALIDATORS[a.do];
  if (!V) return { ok: false, do: a.do, why: `没有「${a.do}」这种动作（只能用：${Object.keys(VALIDATORS).join(' ')}）` };
  const label = id => ctx.graph.nodes.get(id)?.label ?? id;
  const one = r => { const id = ctx.refs.get(String(r)); if (!id) throw new Error(`不认识「${r}」（只能用本页列出的 n 编号）`); return id; };
  const many = (rs, min = 1) => {
    if (!Array.isArray(rs) || rs.length < min) throw new Error(`ids 至少要 ${min} 个`);
    const ids = [...new Set(rs.map(one))];
    if (ids.length < min) throw new Error(`去重后不到 ${min} 个`);
    return ids;
  };
  try { return { ok: true, do: a.do, ...V(a, { one, many, label, ...ctx }) }; } catch (e) { return { ok: false, do: a.do, why: e.message }; }
}

export const VALIDATORS = {
  select: (a, { many, label }) => { const ids = many(a.ids); return { ids, desc: '选中：' + ids.map(label).join('、') }; },
  align: (a, { many, label }) => {
    const ids = many(a.ids, 2);
    if (!EDGES.includes(a.edge)) throw new Error('edge 只能是 ' + EDGES.join(' / '));
    return { ids, edge: a.edge, desc: `对齐（${EDGE_ZH[a.edge]}）：` + ids.map(label).join('、') };
  },
  arrange: (a, { many, label }) => {
    const ids = many(a.ids, 2);
    if (!SHAPES.includes(a.as)) throw new Error('as 只能是 ' + SHAPES.join(' / '));
    const gap = a.gap == null ? 40 : Number(a.gap);
    if (!(gap >= 10 && gap <= 300)) throw new Error('gap 要在 10~300 之间');
    return { ids, as: a.as, gap, desc: `${SHAPE_ZH[a.as]}（按这个顺序，间距 ${gap}）：` + ids.map(label).join(' → ') };
  },
  order: (a, { many, label, graph }) => {
    const ids = many(a.ids, 2);
    const p = graph.nodes.get(ids[0]).parent;
    if (ids.some(id => graph.nodes.get(id).parent !== p)) throw new Error('order 的节点必须是同一个父节点下的兄弟');
    return { ids, desc: '大纲顺序改成：' + ids.map(label).join(' → ') };
  },
  color: (a, { many, label }) => {
    const ids = many(a.ids);
    if (a.color !== 'auto' && !PALETTE[a.color]) throw new Error('color 只能是 ' + Object.keys(PALETTE).join(' ') + ' 或 auto');
    return { ids, color: a.color, desc: `颜色 → ${a.color === 'auto' ? '自动' : a.color}：` + ids.map(label).join('、') };
  },
  status: (a, { many, label }) => {
    const ids = many(a.ids);
    if (!(a.status in STATUSES)) throw new Error('status 只能是 ' + Object.keys(STATUSES).join(' / '));
    return { ids, status: a.status, desc: `状态 → ${STATUS_ZH[a.status]}：` + ids.map(label).join('、') };
  },
  link: (a, { one, label, graph }) => {
    const from = one(a.from), to = one(a.to);
    if (from === to) throw new Error('不能自己连自己');
    const kind = a.kind == null ? '' : a.kind;
    if (!(kind in KINDS)) throw new Error('kind 只能是 普通 / 调节 / 离散');
    if (a.label != null && (typeof a.label !== 'string' || /[|\r\n]/.test(a.label) || a.label.length > 30)) throw new Error('label 要是 30 字以内、不含 | 的短文字');
    const exists = graph.edges.some(e => e.from === from && e.to === to);
    return { from, to, kind: KINDS[kind], label: a.label || '', exists, desc: `${exists ? '改连线' : '连线'}：${label(from)} → ${label(to)}${KINDS[kind] ? '（' + KINDS[kind] + '）' : ''}${a.label ? '「' + a.label + '」' : ''}` };
  },
  unlink: (a, { one, label, graph }) => {
    const from = one(a.from), to = one(a.to);
    if (!graph.edges.some(e => e.from === from && e.to === to)) throw new Error(`${label(from)} → ${label(to)} 本来就没有线`);
    return { from, to, desc: `删连线：${label(from)} → ${label(to)}` };
  },
  create: (a, { one, label, graph, scope }) => {
    if (badName(a.label)) throw new Error('label 要是 60 字以内、不含 -> 和逗号的名字');
    const parent = a.parent == null || a.parent === 'page' ? scope : one(a.parent);
    const name = a.label.trim();
    if (graph.nodes.get(parent).children.some(c => graph.nodes.get(c).label === name)) throw new Error(`「${name}」同级已经有了`);
    const from = a.from == null ? null : one(a.from), to = a.to == null ? null : one(a.to);
    return { parent, label: name, from, to, desc: `新建「${name}」${parent === scope ? '' : '（在 ' + label(parent) + ' 下）'}${from ? '，' + label(from) + ' → 它' : ''}${to ? '，它 → ' + label(to) : ''}` };
  },
  move: (a, { many, one, label, graph }) => {
    const ids = many(a.ids);
    const parent = a.parent === 'root' || a.parent === '根' ? ROOT : one(a.parent);
    const r = withMoved(graph, ids, parent);
    if (r.error) throw new Error(r.error);
    return { ids, parent, desc: `移进「${parent === ROOT ? '根' : label(parent)}」：` + ids.map(label).join('、') };
  },
  rename: (a, { one, label, graph }) => {
    const id = one(a.id);
    if (badName(a.label)) throw new Error('label 要是 60 字以内、不含 -> 和逗号的名字');
    const name = a.label.trim(), n = graph.nodes.get(id);
    if (name === n.label) throw new Error('名字没变');
    if (graph.nodes.get(n.parent).children.some(c => c !== id && graph.nodes.get(c).label === name)) throw new Error(`「${name}」同级已经有了`);
    return { id, label: name, desc: `改名：${label(id)} → ${name}` };
  },
};

// >v<🤖AI指令-排版-对齐 / 排列的新坐标（boxes = {id: {x, y, w, h}}，左上角坐标；返回 {id: {x, y}}）
export function planMoves(actions, boxes) {
  const cur = Object.fromEntries(Object.entries(boxes).map(([id, b]) => [id, { ...b }]));
  const out = {};
  for (const a of actions) {
    if (a.do !== 'align' && a.do !== 'arrange') continue;
    const bs = a.ids.map(id => cur[id] && { id, ...cur[id] }).filter(Boolean);
    if (bs.length < 2) continue;
    const minX = Math.min(...bs.map(b => b.x)), minY = Math.min(...bs.map(b => b.y));
    const set = (id, x, y) => { cur[id].x = Math.round(x); cur[id].y = Math.round(y); out[id] = { x: cur[id].x, y: cur[id].y }; };
    if (a.do === 'align') {
      const maxR = Math.max(...bs.map(b => b.x + b.w)), maxB = Math.max(...bs.map(b => b.y + b.h));
      const cx = bs.reduce((s, b) => s + b.x + b.w / 2, 0) / bs.length, cy = bs.reduce((s, b) => s + b.y + b.h / 2, 0) / bs.length;
      for (const b of bs) {
        if (a.edge === 'left') set(b.id, minX, b.y);
        else if (a.edge === 'right') set(b.id, maxR - b.w, b.y);
        else if (a.edge === 'top') set(b.id, b.x, minY);
        else if (a.edge === 'bottom') set(b.id, b.x, maxB - b.h);
        else if (a.edge === 'hcenter') set(b.id, cx - b.w / 2, b.y);
        else if (a.edge === 'vcenter') set(b.id, b.x, cy - b.h / 2);
      }
    } else if (a.as === 'row') {
      let x = minX;
      for (const b of bs) { set(b.id, x, minY); x += b.w + a.gap; }
    } else if (a.as === 'column') {
      let y = minY;
      for (const b of bs) { set(b.id, minX, y); y += b.h + a.gap; }
    } else {
      const cols = Math.ceil(Math.sqrt(bs.length)), cw = Math.max(...bs.map(b => b.w)) + a.gap, ch = Math.max(...bs.map(b => b.h)) + a.gap;
      bs.forEach((b, i) => set(b.id, minX + (i % cols) * cw, minY + Math.floor(i / cols) * ch));
    }
  }
  return out;
}
