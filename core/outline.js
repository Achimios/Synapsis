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
  const edges = [], idx = rawEdges.length ? labelIndex(nodes) : null;
  for (const e of rawEdges) {
    const to = resolveLabel(nodes, e.from, e.toLabel, idx);
    if (!to) { errors.push({ line: e.line, msg: '找不到目标：' + e.toLabel }); continue; }
    edges.push({ id: e.from + '->' + to, from: e.from, to });
  }
  return { nodes, edges, errors };
}

// 名字 → [id…]（批量解析时建一次传进 resolveLabel；全图只有一个同名的就不用逐层搜，几千节点时省下大头）
export function labelIndex(nodes) {
  const idx = new Map();
  for (const [id, n] of nodes) if (id !== ROOT) { const a = idx.get(n.label); if (a) a.push(id); else idx.set(n.label, [id]); }
  return idx;
}

export function resolveLabel(nodes, fromId, label, idx = null) {
  if (label.includes('/') && nodes.has(label)) return label;
  if (idx) { const a = (idx.get(label) || []).filter(id => id !== fromId); if (a.length <= 1) return a[0] ?? null; } // 唯一同名 = 一定在根的子树里，逐层搜也是它
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
  for (let i = 0; i < q.length; i++) {
    const id = q[i];
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
  const idx = graph.edges.length ? labelIndex(graph.nodes) : null;
  const walk = (id, depth) => {
    const n = graph.nodes.get(id);
    if (id !== ROOT) {
      const tg = (byFrom.get(id) || []).map(t => shortRef(graph, id, t, idx));
      out.push('  '.repeat(depth) + (n.status ? STATUS_CH[n.status] + ' ' : '') + n.label + (tg.length ? ' -> ' + tg.join(', ') : ''));
    }
    for (const c of n.children) walk(c, id === ROOT ? 0 : depth + 1);
  };
  walk(ROOT, 0);
  return out.join('\n');
}

// 用名称能唯一解析回去就写名称，否则写完整路径
export function shortRef(graph, from, to, idx = null) {
  const label = graph.nodes.get(to).label;
  return resolveLabel(graph.nodes, from, label, idx) === to ? label : to;
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
// info(id) → {meta, body}（可选）：界面里的 graph 只有大纲，属性 / 正文从工作区数据补；CLI 的 graph 节点自带 meta / body。
//   👤 2026-10-11：导出也标出 传送门 / UI 框 / 引用文件 / 人加的属性 / 正文字数，不然 LLM 不知道这些卡是什么
const EXPORT_SKIP = new Set(['status', 'order', 'to', 'label', 'color', 'pattern', 'ui', 'w', 'h', 'ref', 'file', 'evidence_hash', 'picw', 'img']);
const exportTags = (m = {}, body = '') => {
  const t = [];
  if (m.ref) t.push(`传送门 → [${m.ref}]（只是入口，不是内容）`);
  if (m.ui !== undefined && m.ui !== '' && String(m.ui) !== 'false') t.push(`UI 框 ${m.w || 220}×${m.h || 140}`);
  if (m.file) t.push(`引用文件 ${m.file}`);
  const ps = Object.entries(m).filter(([k, v]) => !EXPORT_SKIP.has(k) && v != null && typeof v !== 'object').map(([k, v]) => `${k}=${v}`);
  if (ps.length) t.push('属性: ' + ps.join('；'));
  const n = String(body || '').trim().length;
  if (n) t.push(`正文 ${n} 字`);
  return t;
};
export function exportForLLM(graph, scope = ROOT, info = null) {
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
      const x = info ? info(id) || {} : n;
      for (const t of exportTags(x.meta, x.body)) lines.push(t);
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
// dest = 粘到另一张图里（跨项目）：g 是来源图，dest 是目标图，parent 是 dest 里的节点；不给 = 同一张图
export function withCopies(g, ids, parent, dest = g) {
  if (!dest.nodes.has(parent)) return null;
  const inSet = new Set(ids.filter(id => g.nodes.has(id) && id !== ROOT));
  const under = id => { for (let x = g.nodes.get(id).parent; x != null; x = g.nodes.get(x).parent) if (inSet.has(x)) return true; return false; };
  const roots = [...inSet].filter(id => !under(id));
  if (!roots.length) return null;
  const h = cloneGraph(dest), map = new Map(), newRoots = [];
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

// >v<🌳大纲模型-批量改名-Ctrl+H 替换节点名里的文本（👤 2026-10-10）：只改名字，不碰正文 / 属性 / 引用
// ids = 要查的节点；only = 只改这一个；caseSens 默认不区分大小写。
// 改完同级重名 / 空名 / 含 -> 或逗号的，那几个跳过（skipped），其余照改；返回 {text, changed:[{id,to,from,label}], skipped:[{id,label,why}]}
export function replaceLabels(g, ids, find, repl, { only = null, caseSens = false } = {}) {
  const none = { text: null, changed: [], skipped: [] };
  if (!find) return none;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSens ? 'g' : 'gi');
  const want = new Map(); // id → 新名
  for (const id of ids) {
    if (only && id !== only) continue;
    const n = g.nodes.get(id); if (!n) continue;
    re.lastIndex = 0;
    const to = n.label.replace(re, () => repl).trim();
    if (to !== n.label) want.set(id, to);
  }
  const skipped = [], drop = (id, why) => { skipped.push({ id, label: g.nodes.get(id).label, why }); want.delete(id); };
  for (const [id, to] of [...want]) if (!to) drop(id, '名字会变空'); else if (/->|[,，]/.test(to)) drop(id, '名字里不能有 -> 或逗号');
  for (let again = true; again;) { // 同级重名：撞上谁（包括没改的兄弟、也在改名的兄弟）就跳过谁，直到稳定
    again = false;
    const seen = new Map(); // 父|名 → id
    for (const [id, n] of g.nodes) {
      if (id === ROOT) continue;
      const key = n.parent + '\u0000' + (want.get(id) ?? n.label);
      if (!seen.has(key)) { seen.set(key, id); continue; }
      const other = seen.get(key), loser = want.has(id) ? id : want.has(other) ? other : null;
      if (loser) { drop(loser, '同级已有同名'); again = true; break; }
    }
  }
  if (!want.size) return { ...none, skipped };
  const h = cloneGraph(g);
  for (const [id, to] of want) h.nodes.get(id).label = to;
  const newId = id => { const n = g.nodes.get(id); let p = n.parent, path = [want.get(id) ?? n.label]; while (p !== ROOT) { const pn = g.nodes.get(p); path.unshift(want.get(p) ?? pn.label); p = pn.parent; } return path.join('/'); };
  return { text: toOutline(h), changed: [...want].map(([id, to]) => ({ id, to: newId(id), from: g.nodes.get(id).label, label: to })), skipped };
}

// >v<🌳大纲模型-调次序-大纲里拖一行到另一行的上 / 下（👤 2026-10-10：大纲里拖动只调次序，不再「拖进别的节点」）
//   ids 和 target 必须是同一个父节点的兄弟；ids 按它们原来的先后挪到 target 前 / 后。返回 {text} 或 {error}
export function withReordered(g, ids, target, where = 'before') {
  const t = g.nodes.get(target);
  if (!t || target === ROOT) return { error: '目标不存在' };
  const set = ids.filter(id => g.nodes.has(id) && id !== target);
  if (!set.length) return { error: '没有要挪的' };
  if (set.some(id => g.nodes.get(id).parent !== t.parent)) return { error: '大纲里拖动只能调同一层的次序（要换层请在画布上拖，或用剪切粘贴）' };
  const kids = g.nodes.get(t.parent).children, moving = kids.filter(c => set.includes(c));
  const rest = kids.filter(c => !set.includes(c)), at = rest.indexOf(target) + (where === 'after' ? 1 : 0);
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (next.every((c, i) => c === kids[i])) return { error: '次序没变' };
  const h = cloneGraph(g);
  h.nodes.get(t.parent).children = next;
  return { text: toOutline(h) };
}

// >v<🌳大纲模型-分组排序-同一层的节点按「连在一起」分组，组内按流向排（👤 2026-10-10）
//   连线「提」到这一层：A 里的子节点连到 B 里的子节点，A、B 算同一组（以后细调多半是子节点连子节点）；没有任何连线的并成最后一组（loose）。
//   组内次序：从没有入线的节点（环里没有就取原顺序里第一个）顺着线走一遍（深度优先、按原顺序），走回当前路径上的线 = 回环线，忽略；
//   然后数每个节点「不重复的上游节点」个数，少的在前、同数保持原顺序。下游的上游一定比它的上游多 → 永远是先后顺序；出线多少不管。
export function groupSiblings(g, parent = ROOT) {
  const kids = g.nodes.get(parent)?.children || [], idx = new Map(kids.map((k, i) => [k, i]));
  const top = new Map();
  for (const k of kids) { const st = [k]; while (st.length) { const x = st.pop(); top.set(x, k); st.push(...g.nodes.get(x).children); } }
  const outs = new Map(kids.map(k => [k, new Set()])), ins = new Map(kids.map(k => [k, new Set()]));
  for (const e of g.edges) { const a = top.get(e.from), b = top.get(e.to); if (a && b && a !== b) { outs.get(a).add(b); ins.get(b).add(a); } }
  const uf = new Map(kids.map(k => [k, k])), find = x => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
  for (const [a, s] of outs) for (const b of s) uf.set(find(a), find(b));
  const comp = new Map();
  for (const k of kids) { const r = find(k); (comp.get(r) || comp.set(r, []).get(r)).push(k); }
  const groups = [], loose = [];
  for (const members of comp.values()) {
    if (members.length === 1 && !outs.get(members[0]).size && !ins.get(members[0]).size) { loose.push(members[0]); continue; }
    const state = new Map(), dagIn = new Map(members.map(m => [m, []])), post = [];
    const dfs = u => { state.set(u, 1); for (const v of [...outs.get(u)].sort((a, b) => idx.get(a) - idx.get(b))) { if (state.get(v) === 1) continue; dagIn.get(v).push(u); if (!state.has(v)) dfs(v); } state.set(u, 2); post.push(u); };
    const entries = members.filter(m => !ins.get(m).size);
    for (const m of [...(entries.length ? entries : [members[0]]), ...members]) if (!state.has(m)) dfs(m);
    const anc = new Map();
    for (const u of post.reverse()) { const s = new Set(); for (const p of dagIn.get(u)) { s.add(p); for (const x of anc.get(p)) s.add(x); } anc.set(u, s); }
    const ids = [...members].sort((a, b) => anc.get(a).size - anc.get(b).size || idx.get(a) - idx.get(b));
    groups.push({ ids, loose: false, info: Object.fromEntries(ids.map(i => [i, { up: anc.get(i).size, direct: ins.get(i).size }])) }); // up = 不重复的上游节点数（排序用），direct = 直接入线条数
  }
  groups.sort((a, b) => Math.min(...a.ids.map(i => idx.get(i))) - Math.min(...b.ids.map(i => idx.get(i))));
  if (loose.length) groups.push({ ids: loose, loose: true, info: Object.fromEntries(loose.map(i => [i, { up: 0, direct: 0 }])) });
  return groups;
}
