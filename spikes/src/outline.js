// 大纲文本 ⇄ 图模型。纯函数，Node 可测（test/outline.test.js）。
// 语法（每行一个节点，缩进 = 子级）：
//   [状态] 名称 [-> 目标名, 目标名2]
//   状态可选：✅ ◐ ○ ；目标按名称解析（同名时取最近的：兄弟 > 祖先的子 > 全局第一个）
// id = 祖先名称路径（"AI空间/观测/敌方"）—— 原型简化：改名会丢坐标，见 _LEARNINGS

const STATUS = { '✅': 'done', '◐': 'partial', '○': 'todo' };
const STATUS_CH = { done: '✅', partial: '◐', todo: '○' };
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
    if (STATUS[ch]) { status = STATUS[ch]; body = body.slice(ch.length).trim(); }
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

function resolveLabel(nodes, fromId, label) {
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
function shortRef(graph, from, to) {
  const label = graph.nodes.get(to).label;
  return resolveLabel(graph.nodes, from, label) === to ? label : to;
}

// 视图投影：当前范围 scope 下只显示直接子节点；
// 子孙之间的边提升到「在范围内可见的祖先」上并聚合（count），范围外的端点显示为 portal。
// >v<🔭视图投影-范围投影-只显示当前范围的子节点，子孙边提升聚合，范围外端点变 portal
export function projectView(graph, scope) {
  const visible = new Set(graph.nodes.get(scope).children);
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
    nodes: [...visible].map(id => graph.nodes.get(id)),
    portals: [...portals].map(([pid, target]) => ({ id: pid, target, label: '↗ ' + target })),
    edges: [...agg.values()],
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

// >v<🌳大纲模型-画布编辑-加边/加节点后重新生成大纲
export function withEdge(g, from, to) {
  if (from === to || g.edges.some(e => e.from === from && e.to === to)) return null;
  const h = cloneGraph(g);
  h.edges.push({ id: from + '->' + to, from, to });
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

// 初始自动布局：范围内按最长路径分层（左→右），已有坐标的不动
// >v<🔭视图投影-自动布局-最长路径分层，回边忽略，奇数层下错；已有坐标不动
export function autoLayout(view, positions) {
  const ids = view.nodes.map(n => n.id);
  const rank = new Map(ids.map(id => [id, 0]));
  // 反馈环：按大纲顺序 DFS，指向栈上节点的边是回边，分层时忽略（↺ 不影响左→右顺序）
  const adj = new Map(ids.map(id => [id, []]));
  for (const e of view.edges) if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push(e);
  const state = new Map(), forward = [];
  const dfs = id => {
    state.set(id, 1);
    for (const e of adj.get(id)) {
      if (state.get(e.to) === 1) continue;
      forward.push(e);
      if (!state.has(e.to)) dfs(e.to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) dfs(id);
  for (let it = 0; it < ids.length; it++) {
    let changed = false;
    for (const e of forward) {
      if (rank.get(e.to) < rank.get(e.from) + 1) {
        rank.set(e.to, rank.get(e.from) + 1); changed = true;
      }
    }
    if (!changed) break;
  }
  const rows = new Map();
  const out = {};
  for (const id of ids) {
    const r = rank.get(id);
    const row = rows.get(r) || 0; rows.set(r, row + 1);
    out[id] = positions[id] || { x: r * 260, y: row * 120 + (r % 2) * 70 }; // 奇数层下错，免得反馈边穿过同一行的节点
  }
  const maxR = Math.max(0, ...rank.values());
  let li = 0, ri = 0;
  for (const p of view.portals) {
    const isSource = view.edges.some(e => e.from === p.id);
    out[p.id] = positions[p.id] || (isSource ? { x: -260, y: li++ * 90 } : { x: (maxR + 1) * 260, y: ri++ * 90 });
  }
  return out;
}
