// 大纲文本 ⇄ 图模型。纯函数，Node 可测（test/outline.test.js）。
// 语法（每行一个节点，缩进 = 子级）：
//   [状态] 名称 [-> 目标名, 目标名2]
//   状态可选：✅ ◐ ○ ；目标按名称解析（同名时取最近的：兄弟 > 祖先的子 > 全局第一个）
// id = 祖先名称路径（"AI空间/观测/敌方"）—— 原型简化：改名会丢坐标，见 _LEARNINGS

const STATUS = { '✅': 'done', '◐': 'partial', '○': 'todo', '❌': 'dropped' };
const STATUS_CH = { done: '✅', partial: '◐', todo: '○', dropped: '❌' };
export const ROOT = '';

// >v<🌳大纲模型-解析-大纲文本→节点树+边，按名称就近解析连线目标
export function parseOutline(text) {
  const nodes = new Map(); // id -> {id,label,parent,status,children:[]}
  nodes.set(ROOT, { id: ROOT, label: '根', parent: null, status: null, children: [] });
  const stack = [{ indent: -1, id: ROOT }];
  const rawEdges = [];
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('//')) return;
    const indent = line.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
    let body = line.trim();
    let targets = [];
    const arrow = body.indexOf('->');
    if (arrow >= 0) {
      targets = body.slice(arrow + 2).split(/[,，]/).map(s => s.trim()).filter(Boolean);
      body = body.slice(0, arrow).trim();
    }
    let status = null;
    const ch = [...body][0];
    if (STATUS[ch]) { status = STATUS[ch]; body = body.slice(ch.length).replace(/^\uFE0F/, '').trim(); } // ❌️ / ✅️ 带变体选择符也认
    if (!body) { errors.push({ line: i + 1, msg: '空名称' }); return; }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].id;
    let id = parent === ROOT ? body : parent + '/' + body;
    if (nodes.has(id)) { errors.push({ line: i + 1, msg: '同级重名：' + body }); id += '#' + (i + 1); }
    nodes.set(id, { id, label: body, parent, status, children: [] });
    nodes.get(parent).children.push(id);
    stack.push({ indent, id });
    for (const t of targets) rawEdges.push({ from: id, toLabel: t, line: i + 1 });
  });
  const edges = [];
  for (const e of rawEdges) {
    const to = resolveLabel(nodes, e.from, e.toLabel);
    if (!to) { errors.push({ line: e.line, msg: '找不到目标：' + e.toLabel }); continue; }
    edges.push({ id: e.from + '->' + to, from: e.from, to });
  }
  return { nodes, edges, errors };
}

export function resolveLabel(nodes, fromId, label) {
  if (label.includes('/') && nodes.has(label)) return label;
  // 从自身的父开始逐级向上，找该层子树中同名的节点（先直接子，再整个子树）
  let scope = nodes.get(fromId).parent;
  while (scope !== null) {
    const hit = findInSubtree(nodes, scope, label, fromId);
    if (hit) return hit;
    scope = nodes.get(scope).parent;
  }
  return null;
}

function findInSubtree(nodes, rootId, label, exclude) {
  const q = [...nodes.get(rootId).children];
  while (q.length) {
    const id = q.shift();
    const n = nodes.get(id);
    if (n.label === label && id !== exclude) return id;
    q.push(...n.children);
  }
  return null;
}

// >v<🌳大纲模型-序列化-图→大纲文本（画布编辑后回写，大纲是唯一真源）
export function toOutline(graph) {
  const out = [];
  const byFrom = new Map();
  for (const e of graph.edges) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from).push(e.to);
  }
  const walk = (id, depth) => {
    const n = graph.nodes.get(id);
    if (id !== ROOT) {
      const tg = (byFrom.get(id) || []).map(t => shortRef(graph, id, t));
      out.push('  '.repeat(depth) + (n.status ? STATUS_CH[n.status] + ' ' : '') + n.label + (tg.length ? ' -> ' + tg.join(', ') : ''));
    }
    for (const c of n.children) walk(c, id === ROOT ? 0 : depth + 1);
  };
  walk(ROOT, 0);
  return out.join('\n');
}

// 用名称能唯一解析回去就写名称，否则写完整路径
export function shortRef(graph, from, to) {
  const label = graph.nodes.get(to).label;
  return resolveLabel(graph.nodes, from, label) === to ? label : to;
}

// >v<💾工作区-弃用-status: dropped（大纲里 ❌）：自己或任一祖先弃用 = 弃用；完成度汇总、check 都跳过，界面灰 + 删除线（👤 2026-10-08）
export function isDropped(g, id) {
  for (let x = id; x != null && x !== ROOT; x = g.nodes.get(x)?.parent) if (g.nodes.get(x)?.status === 'dropped') return true;
  return false;
}

// 视图投影：当前范围 scope 下只显示直接子节点；
// 子孙之间的边提升到「在范围内可见的祖先」上并聚合（count），范围外的端点显示为 portal。
// >v<🔭视图投影-范围投影-只显示当前范围的子节点，子孙边提升聚合，范围外端点变 portal
// frames = 展开成框的分组 id 集合（可嵌套）：框里的子节点也算可见，parentOf 记它在哪个框里（👤 2026-10-08）
export function projectView(graph, scope, frames = null) {
  const order = [], parentOf = new Map();
  const add = (id, frame) => {
    order.push(id);
    if (frame != null) parentOf.set(id, frame);
    if (frames?.has(id)) for (const c of graph.nodes.get(id).children) add(c, id);
  };
  for (const c of graph.nodes.get(scope).children) add(c, null);
  const visible = new Set(order);
  const lift = id => {
    let cur = id;
    while (cur !== null && !visible.has(cur)) cur = graph.nodes.get(cur).parent;
    return cur; // null = 不在本范围内
  };
  const agg = new Map();
  const portals = new Map();
  for (const e of graph.edges) {
    let a = lift(e.from), b = lift(e.to);
    if (a === null && b === null) continue;
    if (a === b) continue;
    if (a === null) { a = portalId(e.from); portals.set(a, e.from); }
    if (b === null) { b = portalId(e.to); portals.set(b, e.to); }
    const key = a + '=>' + b;
    if (!agg.has(key)) agg.set(key, { id: key, from: a, to: b, count: 0, raw: [] });
    const x = agg.get(key); x.count++; x.raw.push(e.id);
  }
  return {
    nodes: order.map(id => graph.nodes.get(id)), // 框（分组）排在它的子节点前面（React Flow 要求父节点先出现）
    portals: [...portals].map(([pid, target]) => ({ id: pid, target, label: '↗ ' + target })),
    edges: [...agg.values()],
    parentOf,
  };
}
const portalId = target => '@portal:' + target;

export function breadcrumb(graph, scope) {
  const out = [];
  for (let cur = scope; cur !== null; cur = graph.nodes.get(cur).parent) out.unshift(cur);
  return out.map(id => ({ id, label: graph.nodes.get(id).label }));
}

// 给 LLM 的结构化文本（节点卡，简版；完整规范见需求文档 §0.6）
// >v<📤LLM导出-节点卡-当前范围导出成带 id 的结构化文本
export function exportForLLM(graph, scope = ROOT) {
  const ins = new Map(), outs = new Map();
  for (const e of graph.edges) {
    (outs.get(e.from) || outs.set(e.from, []).get(e.from)).push(e.to);
    (ins.get(e.to) || ins.set(e.to, []).get(e.to)).push(e.from);
  }
  const lines = [];
  const walk = (id, depth) => {
    const n = graph.nodes.get(id);
    if (id !== scope) {
      lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} [${id}] ${n.label}  状态:${n.status ? STATUS_CH[n.status] : '未标'}`);
      if (ins.get(id)) lines.push('输入(←): ' + ins.get(id).map(x => `[${x}]`).join(' | '));
      if (outs.get(id)) lines.push('输出(→): ' + outs.get(id).map(x => `[${x}]`).join(' | '));
      if (n.children.length) lines.push('包含: ' + n.children.map(c => graph.nodes.get(c).label).join('、'));
      lines.push('');
    }
    for (const c of n.children) walk(c, id === scope ? 0 : depth + 1);
  };
  walk(scope, 0);
  return lines.join('\n');
}

// —— 画布侧的编辑：改图 → 重新生成大纲文本（大纲是唯一真源）——
function cloneGraph(g) {
  const nodes = new Map();
  for (const [k, n] of g.nodes) nodes.set(k, { ...n, children: [...n.children] });
  return { nodes, edges: g.edges.map(e => ({ ...e })), errors: [] };
}

// >v<🌳大纲模型-移动节点-把 ids（连同子孙）挪到 parent 下（👤 2026-10-08：拖进节点 / Ctrl+X 剪切粘贴）。
//   返回 {text, map: [[旧id, 新id]…]（含子孙）} 或 {error}。不能挪进自己的子孙；目标下已有同名 → 拒绝（不偷偷改名）
export function withMoved(g, ids, parent) {
  if (!g.nodes.has(parent)) return { error: '目标不存在' };
  const set = new Set(ids.filter(id => g.nodes.has(id) && id !== ROOT));
  const under = (id, anc) => { for (let x = g.nodes.get(id)?.parent; x != null; x = g.nodes.get(x)?.parent) if (x === anc) return true; return false; };
  const roots = [...set].filter(id => ![...set].some(o => o !== id && under(id, o)) && g.nodes.get(id).parent !== parent);
  if (!roots.length) return { error: '已经在这里了' };
  for (const id of roots) if (id === parent || under(parent, id)) return { error: `不能把「${g.nodes.get(id).label}」挪进它自己里面` };
  const taken = new Set(g.nodes.get(parent).children.map(c => g.nodes.get(c).label));
  for (const id of roots) { const l = g.nodes.get(id).label; if (taken.has(l)) return { error: `目标里已经有「${l}」了` }; taken.add(l); }
  const h = cloneGraph(g);
  for (const id of roots) {
    const n = h.nodes.get(id), op = h.nodes.get(n.parent);
    op.children = op.children.filter(c => c !== id);
    h.nodes.get(parent).children.push(id); n.parent = parent;
  }
  // 重新算 id（= 祖先名字路径），边跟着换
  const re = new Map([[ROOT, ROOT]]), nodes = new Map();
  const walk = (old, nid) => {
    const n = h.nodes.get(old); re.set(old, nid);
    const kids = n.children.map(c => { const cid = nid === ROOT ? h.nodes.get(c).label : nid + '/' + h.nodes.get(c).label; walk(c, cid); return cid; });
    nodes.set(nid, { ...n, id: nid, parent: n.parent == null ? null : re.get(n.parent), children: kids });
  };
  walk(ROOT, ROOT);
  const edges = h.edges.map(e => ({ ...e, from: re.get(e.from), to: re.get(e.to), id: re.get(e.from) + '->' + re.get(e.to) }));
  const map = [...re].filter(([o, n]) => o !== ROOT && o !== n);
  return { text: toOutline({ nodes, edges, errors: [] }), map, roots: roots.map(r => re.get(r)) };
}

// >v<🌳大纲模型-画布编辑-加边/加节点后重新生成大纲
export function withEdge(g, from, to) {
  if (from === to || g.edges.some(e => e.from === from && e.to === to)) return null;
  const h = cloneGraph(g);
  h.edges.push({ id: from + '->' + to, from, to });
  return toOutline(h);
}

export function withoutEdge(g, from, to) {
  if (!g.edges.some(e => e.from === from && e.to === to)) return null;
  const h = cloneGraph(g);
  h.edges = h.edges.filter(e => !(e.from === from && e.to === to));
  return toOutline(h);
}

// 在 parent 下新建节点；after = 插在哪个兄弟后面（null = 末尾）。返回 {text, id}
export function withNode(g, parent, after = null, base = '新节点') {
  const h = cloneGraph(g);
  const p = h.nodes.get(parent);
  let label = base, i = 2;
  const taken = new Set(p.children.map(c => h.nodes.get(c).label));
  while (taken.has(label)) label = base + i++;
  const id = parent === ROOT ? label : parent + '/' + label;
  h.nodes.set(id, { id, label, parent, status: 'todo', children: [] });
  const at = after ? p.children.indexOf(after) + 1 : p.children.length;
  p.children.splice(at, 0, id);
  return { text: toOutline(h), id };
}

// >v<🌳大纲模型-复制节点-把 ids（连同子孙、状态、它们之间的边）复制到 parent 下；同名加「 2」「 3」。
// 返回 {text, map: [[旧id, 新id]…], roots: [新的顶层 id…]}；属性 / 正文 / 图片由 workspace.pasteNodes 跟着拷
export function withCopies(g, ids, parent) {
  if (!g.nodes.has(parent)) return null;
  const inSet = new Set(ids.filter(id => g.nodes.has(id) && id !== ROOT));
  const under = id => { for (let x = g.nodes.get(id).parent; x != null; x = g.nodes.get(x).parent) if (inSet.has(x)) return true; return false; };
  const roots = [...inSet].filter(id => !under(id));
  if (!roots.length) return null;
  const h = cloneGraph(g), map = new Map(), newRoots = [];
  const taken = new Set(h.nodes.get(parent).children.map(c => h.nodes.get(c).label));
  const clone = (old, newParent, label) => {
    const id = newParent === ROOT ? label : newParent + '/' + label;
    h.nodes.set(id, { id, label, parent: newParent, status: g.nodes.get(old).status, children: [] });
    h.nodes.get(newParent).children.push(id);
    map.set(old, id);
    for (const c of g.nodes.get(old).children) clone(c, id, g.nodes.get(c).label);
    return id;
  };
  for (const r of roots) {
    const base = g.nodes.get(r).label;
    let label = base, i = 2;
    while (taken.has(label)) label = base + ' ' + i++;
    taken.add(label);
    newRoots.push(clone(r, parent, label));
  }
  for (const e of g.edges) if (map.has(e.from) && map.has(e.to)) h.edges.push({ id: map.get(e.from) + '->' + map.get(e.to), from: map.get(e.from), to: map.get(e.to) });
  return { text: toOutline(h), map: [...map], roots: newRoots };
}

// 初始自动布局：范围内按最长路径分层（左→右），已有坐标的不动
// >v<🔭视图投影-自动布局-最长路径分层，回边忽略，奇数层下错；已有坐标不动
export function autoLayout(view, positions) {
  const ids = view.nodes.map(n => n.id);
  const rank = new Map(ids.map(id => [id, 0]));
  // 反馈环：大纲顺序就是人写下的流向提示 —— 指向前面兄弟的边算回边（↺），分层时忽略。
  // （以前用 DFS 顺序断环：观测→决策→行动→外部→内在 这条长路先被走到，「内在」被甩到最右，2026-10-07 研究工作区截图发现）
  const idx = new Map(ids.map((id, i) => [id, i]));
  // 调节边（e.mod）不参与左→右分层：调节源不是数据流的上游（👤 2026-10-08）
  const forward = view.edges.filter(e => !e.mod && idx.has(e.from) && idx.has(e.to) && idx.get(e.to) > idx.get(e.from));
  for (let it = 0; it < ids.length; it++) {
    let changed = false;
    for (const e of forward) {
      if (rank.get(e.to) < rank.get(e.from) + 1) {
        rank.set(e.to, rank.get(e.from) + 1); changed = true;
      }
    }
    if (!changed) break;
  }
  const out = {};
  // 已摆好的先占位；没坐标的在自己那一列里找第一个空槽（不压住已有节点 —— 2026-10-07 新节点压住「兜底」导致拖错）
  const placed = ids.filter(id => positions[id]).map(id => (out[id] = positions[id]));
  const free = p => !placed.some(q => Math.abs(q.x - p.x) < 200 && Math.abs(q.y - p.y) < 90);
  for (const id of ids) {
    if (out[id]) continue;
    const r = rank.get(id);
    let row = 0, p;
    do p = { x: r * 260, y: row++ * 120 + (r % 2) * 70 }; // 奇数层下错，免得反馈边穿过同一行的节点
    while (!free(p));
    out[id] = p; placed.push(p);
  }
  // 只往外发调节边的节点（纯调节源）：没摆过的放到它调节的那个节点上方
  for (const id of ids) {
    if (positions[id]) continue;
    const mine = view.edges.filter(e => e.from === id || e.to === id);
    const tgt = mine.length && mine.every(e => e.mod && e.from === id) ? mine[0].to : null;
    if (tgt && out[tgt]) {
      let p = { x: out[tgt].x, y: out[tgt].y - 110 };
      while (placed.some(q => q !== out[id] && Math.abs(q.x - p.x) < 200 && Math.abs(q.y - p.y) < 90)) p = { x: p.x + 210, y: p.y };
      out[id] = p;
    }
  }
  const maxR = Math.max(0, ...rank.values());
  let li = 0, ri = 0;
  for (const p of view.portals) {
    const isSource = view.edges.some(e => e.from === p.id);
    out[p.id] = positions[p.id] || (isSource ? { x: -260, y: li++ * 90 } : { x: (maxR + 1) * 260, y: ri++ * 90 });
  }
  return out;
}

// 节点在 toOutline 输出里的行号（DFS 顺序，一节点一行）—— 新建后把大纲光标放到它的名字上
export function lineOf(g, id) {
  let i = 0, hit = -1;
  const walk = cur => { for (const c of g.nodes.get(cur).children) { if (c === id) hit = i; i++; walk(c); } };
  walk(ROOT);
  return hit;
}

// >v<🌳大纲模型-删除/改状态/改名-右键菜单用；都返回新大纲文本（删除在工作区里 = 文件移进 .junk/）
export function withoutNode(g, id) {
  const h = cloneGraph(g);
  const gone = new Set();
  const walk = x => { gone.add(x); for (const c of h.nodes.get(x).children) walk(c); };
  walk(id);
  const p = h.nodes.get(h.nodes.get(id).parent);
  p.children = p.children.filter(c => c !== id);
  for (const x of gone) h.nodes.delete(x);
  h.edges = h.edges.filter(e => !gone.has(e.from) && !gone.has(e.to));
  return toOutline(h);
}
export function withStatus(g, id, status) {
  const h = cloneGraph(g);
  h.nodes.get(id).status = status;
  return toOutline(h);
}
export function withLabel(g, id, label) {
  label = label.trim();
  const n = g.nodes.get(id);
  if (!label || label === n.label || /->|[,，]/.test(label)) return null;
  if (g.nodes.get(n.parent).children.some(c => g.nodes.get(c).label === label)) return null; // 同级重名
  const h = cloneGraph(g);
  h.nodes.get(id).label = label;
  return toOutline(h); // toOutline 按 label 输出，id 在重新解析时自然变成新路径
}
