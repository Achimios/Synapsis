// >v<🤖AI指令-动作校验-AI 指令框（Shift+F）里 8B 给出的动作：只认白名单里的 do，参数逐个查，查不过的不执行（附原因给人看）。
// 纯函数，不调模型、不碰文件（core/agent.js 调模型和落盘，自检 core/test/agent.test.js）。
// 每种动作对应一份说明书 core/skills/*.md（喂给模型）；VALIDATORS 和说明书一一对应（自检核对）。
import { PALETTE } from './colors.js';
import { withMoved, ROOT } from './outline.js';
import { badMemName, TYPES } from './memory.js';
import { tighten } from './arrange.js';

// 生图模型名缩短给人看：grok-imagine-image-2.0 → imagine-2.0；doubao-seedream-5-0-flash-260915 → seedream flash
export const imgShort = m => /^doubao-seedream/.test(m) ? 'seedream ' + (/-(flash|pro|lite)-/.exec(m)?.[1] || m.slice(16)) : m.replace('grok-imagine-image', 'imagine');
export const KINDS = { '': '', 普通: '', 调节: '调节', 离散: '离散' };
export const STATUSES = { done: 'done', partial: 'partial', todo: 'todo', dropped: 'dropped', none: null };
export const EDGES = ['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'];
export const SHAPES = ['row', 'column', 'grid'];
const EDGE_ZH = { left: '左边', right: '右边', top: '上边', bottom: '下边', hcenter: '水平居中', vcenter: '垂直居中' };
const SHAPE_ZH = { row: '横排', column: '竖排', grid: '网格' };
const STATUS_ZH = { done: '✅ 完成', partial: '◐ 进行中', todo: '○ 待做', dropped: '❌ 弃用', none: '清除状态' };
export const CREATE_MAX = 200;
const bodyOf = b => { if (b == null || b === '') return ''; if (typeof b !== 'string' || b.length > 8000) throw new Error('body 要是 8000 字以内的文字'); return b; };
const badName = s => typeof s !== 'string' || !s.trim() || /->|[,，\r\n]/.test(s) || s.trim().length > 60;

// 传送门卡片（编号 p1…，id 是 @portal:目标）只能参与排版 / 选中，其余动作一律拒绝（它不是真节点）
const PORTAL_OK = new Set(['select', 'align', 'arrange', 'tighten', 'place']);
// ctx = { refs: Map('n1' → 真 id), graph, scope }；返回 { ok, why?, desc?, ...规范化后的参数（真 id）}
export function validateAction(a, ctx) {
  if (!a || typeof a !== 'object') return { ok: false, why: '不是一个动作对象' };
  const V = VALIDATORS[a.do];
  if (!V) return { ok: false, do: a.do, why: `没有「${a.do}」这种动作（只能用：${Object.keys(VALIDATORS).join(' ')}）` };
  const label = id => id.startsWith('@portal:') ? '传送门→' + (ctx.graph.nodes.get(id.slice(8))?.label ?? id.slice(8)) : ctx.graph.nodes.get(id)?.label ?? id;
  const one = r => {
    const id = ctx.refs.get(String(r)); if (!id) throw new Error(`不认识「${r}」（只能用本页列出的 n / p 编号）`);
    if (id.startsWith('@portal:') && !PORTAL_OK.has(a.do)) throw new Error(`「${r}」是传送门卡片，只能用 ${[...PORTAL_OK].join(' / ')}`);
    return id;
  };
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
  // >v<🤖AI指令-原语-挪位置（👤「不能完全依靠 skill 指导 LLM，不然 LLM 的意义是啥」）：只改一张卡的坐标，绝对 x,y 或相对 dx,dy。
  //   靠近 / 让开 / 摆成扇形……都由模型自己算，不再一个意图一份说明书
  place: (a, { one, label }) => {
    const id = one(a.id), num = v => v == null ? null : Number(v);
    const x = num(a.x), y = num(a.y), dx = num(a.dx), dy = num(a.dy);
    const abs = x != null || y != null, rel = dx != null || dy != null;
    if (abs === rel) throw new Error('要么给 x、y（挪到哪），要么给 dx、dy（挪多少），二选一');
    if ([x, y, dx, dy].some(v => v != null && !(Math.abs(v) < 1e5))) throw new Error('坐标要是正常的数字');
    return abs ? { id, x, y, desc: `挪位置：${label(id)} → (${x ?? '不变'}, ${y ?? '不变'})` } : { id, dx: dx || 0, dy: dy || 0, desc: `挪位置：${label(id)} 往${dx ? (dx > 0 ? '右 ' : '左 ') + Math.abs(dx) : ''}${dx && dy ? '、' : ''}${dy ? (dy > 0 ? '下 ' : '上 ') + Math.abs(dy) : ''}` };
  },
  // 记一笔长期记忆（core/memory.js）：人确认才写；不碰大纲
  remember: a => {
    const level = a.level || '项目';
    if (!['项目', '用户'].includes(level)) throw new Error('level 只能是 项目 / 用户');
    if (badMemName(a.name)) throw new Error('name 要是 40 字以内、能当文件名的短名字');
    if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 2000) throw new Error('text 要是 2000 字以内的正文');
    const mode = a.mode === 'replace' ? 'replace' : 'append';
    if (a.type != null && a.type !== '' && !TYPES.includes(a.type)) throw new Error('type 只能是 ' + TYPES.join(' / ') + '（或不写）');
    const name = a.name.trim(), text = a.text.trim();
    // summary = 索引里那一句（模型给的 desc）；desc = 给人看的预览（validateAction 统一用 desc 字段）
    return { level, name, text, mode, type: a.type || undefined, summary: typeof a.desc === 'string' ? a.desc : '', desc: `记住（${level}${mode === 'replace' ? '，整份换掉' : ''}）「${name}」：${text.slice(0, 40)}${text.length > 40 ? '…' : ''}` };
  },
  tighten: (a, { many, label }) => {
    const ids = many(a.ids, 2);
    const gap = a.gap == null ? 40 : Number(a.gap);
    if (!(gap >= 10 && gap <= 300)) throw new Error('gap 要在 10~300 之间');
    const s = a.s == null ? null : Number(a.s);
    if (s != null && !(s > 0 && s < 1)) throw new Error('s 要在 0~1 之间（0.7 = 距离变成 70%）');
    return { ids, gap, s, desc: `收紧（方位不变，${s == null ? '收到最近留 ' + gap : '距离 × ' + s}）：` + ids.map(label).join('、') };
  },
  order: (a, { many, label, graph }) => {
    const ids = many(a.ids, 2);
    const p = graph.nodes.get(ids[0]).parent;
    if (ids.some(id => graph.nodes.get(id).parent !== p)) throw new Error('order 的节点必须是同一个父节点下的兄弟');
    return { ids, desc: '大纲顺序改成：' + ids.map(label).join(' → ') };
  },
  // 👤 2026-10-16 配图（Grok / 👤 10-20 起也可以豆包 Seedream，花钱）：执行时由服务端调 core/imagegen.js，图存进这张卡的 _pics_
  //   👤 2026-10-17 不写 id = 当前页的散图（空白处右键「AI 配图」落在右键点的位置）
  image: (a, { one, label, scope }) => {
    const loose = a.id == null || a.id === '', id = loose ? null : one(a.id), prompt = String(a.prompt || '').trim();
    if (!prompt) throw new Error('prompt 不能空：写清画面内容和风格');
    const aspect = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '21:9'].includes(a.aspect) ? a.aspect : 'auto';
    // 没写的参数留 null = 用 AI 设置里的默认（👤 2026-10-17 生图默认可选）；模型名认 xAI 列表里带 image 的（新模型不用改这里）+ 豆包 doubao-seedream-*
    const quality = ['low', 'medium'].includes(a.quality) ? a.quality : null, resolution = ['1k', '2k'].includes(a.resolution) ? a.resolution : null, model = typeof a.model === 'string' && /^(grok-[\w.-]*image[\w.-]*|doubao-seedream[\w.-]*)$/.test(a.model) ? a.model : null;
    const tag = [aspect !== 'auto' && aspect, quality === 'medium' && '高质量', resolution === '2k' && '2k', model && imgShort(model)].filter(Boolean).join('，');
    // 👤 2026-10-20 title = 简介（进文件名），about = 描述（进图旁边的同名 .md）；都可省
    const title = typeof a.title === 'string' ? a.title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 30) : '', about = typeof a.about === 'string' ? a.about.trim().slice(0, 1000) : '';
    return { id, ...(loose ? { scope: scope ?? ROOT } : {}), prompt: prompt.slice(0, 2000), ...(title ? { title } : {}), ...(about ? { about } : {}), aspect, quality, resolution, ...(model ? { model } : {}), desc: `配图（${model && /^doubao/.test(model) ? '豆包' : model ? 'Grok' : '默认模型'}生成，花钱）：${loose ? '这一页的散图' : `「${label(id)}」`}←${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}${tag ? '（' + tag + '）' : ''}` };
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
    // 👤 2026-10-10 带正文 + 一次建一棵小树：body = 正文（md）；children = [{label, body?, children?}]，最多 4 层、整棵最多 CREATE_MAX 个
    const body = bodyOf(a.body);
    let count = 1;
    const tree = (kids, depth) => {
      if (kids == null) return [];
      if (!Array.isArray(kids)) throw new Error('children 要是数组');
      if (depth > 4) throw new Error('children 最多嵌 4 层');
      const seen = new Set();
      return kids.map(k => {
        if (!k || badName(k.label)) throw new Error('children 里每项要有 60 字以内、不含 -> 和逗号的 label');
        const nm = k.label.trim();
        if (seen.has(nm)) throw new Error(`children 里「${nm}」重名了`);
        seen.add(nm);
        if (++count > CREATE_MAX) throw new Error(`一个新建动作最多 ${CREATE_MAX} 个节点（含子节点）`);
        return { label: nm, body: bodyOf(k.body), children: tree(k.children, depth + 1) };
      });
    };
    const children = tree(a.children, 1);
    return { parent, label: name, from, to, body, children, desc: `新建「${name}」${parent === scope ? '' : '（在 ' + label(parent) + ' 下）'}${from ? '，' + label(from) + ' → 它' : ''}${to ? '，它 → ' + label(to) : ''}${body ? '，带正文' : ''}${count > 1 ? `，含 ${count - 1} 个子节点` : ''}` };
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

// >v<🤖AI指令-排版-对齐 / 排列 / 收紧的新坐标（boxes = {id: {x, y, w, h}}，左上角坐标；返回 {id: {x, y}}）
export function planMoves(actions, boxes) {
  const cur = Object.fromEntries(Object.entries(boxes).map(([id, b]) => [id, { ...b }]));
  const out = {};
  for (const a of actions) {
    if (a.do === 'place') {
      const b = cur[a.id];
      if (!b && (a.x == null || a.y == null)) continue; // 量不到这张卡又只给了相对量 → 没法算
      const nx = a.x != null ? a.x : a.dx != null ? b.x + a.dx : b.x, ny = a.y != null ? a.y : a.dy != null ? b.y + a.dy : b.y;
      cur[a.id] = { ...(b || { w: 0, h: 0 }), x: Math.round(nx), y: Math.round(ny) };
      out[a.id] = { x: cur[a.id].x, y: cur[a.id].y };
      continue;
    }
    if (a.do === 'tighten') {
      const bs = a.ids.map(id => cur[id] && { id, ...cur[id] }).filter(Boolean);
      if (bs.length < 2) continue;
      for (const r of tighten(bs, { s: a.s, gap: a.gap ?? 40 })) { cur[r.id].x = r.x; cur[r.id].y = r.y; out[r.id] = { x: r.x, y: r.y }; }
      continue;
    }
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
