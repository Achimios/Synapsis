// >v<📐空间-核心-「空间」节点：frontmatter 有 axes: 的节点；子节点用 vec: 写坐标；空间之间用 映射→目标: 写矩阵
// 纯函数，Node 和浏览器共用（界面的散点投影、卡片小横条、边上的热力图都从这里算）
//
// 文件里长这样：
//   情绪空间/_node.md   axes: 愉悦, 唤醒, 支配
//                       映射→行为空间: 0.2 0.8 0; -0.5 0.6 0.9      ← 行 = 目标空间的轴，列 = 本空间的轴（y = W·x）
//   情绪空间/兴奋.md     vec: 0.6, 0.9, 0.4
//
// 为什么要有这个（👤 2026-10-07）：情绪词（兴奋/激动/恐惧…）不是正交基，是空间里贴了标签的方向。
// 内部状态放在正交轴上，情绪词当读数；换一组轴看同一批点 = 基变换。

const split = v => (Array.isArray(v) ? v.join(',') : String(v ?? '')).split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);

export const parseAxes = v => (Array.isArray(v) ? v : String(v ?? '').split(/[,，、]/)).map(s => s.trim()).filter(Boolean);
// 坐标：逗号或空格分隔；不是数的项当 NaN（check 会报）
export const parseVec = v => split(v).map(Number);
// 矩阵：行用 ; 分隔，行内逗号或空格
export const parseMatrix = v => String(v ?? '').split(/[;；]/).map(r => r.trim()).filter(Boolean).map(r => split(r).map(Number));

export const MAP_KEY = /^映射\s*(?:→|->)\s*(.+)$/;
// 节点 meta 里的所有映射：[{ref: 目标名字或 id, W}]
export const mapsOf = meta => Object.entries(meta || {}).flatMap(([k, v]) => { const m = k.match(MAP_KEY); return m ? [{ ref: m[1].trim(), key: k, W: parseMatrix(v) }] : []; });

export const isSpace = meta => !!(meta && meta.axes && parseAxes(meta.axes).length);

export const dot = (a, b) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
export const norm = a => Math.sqrt(dot(a, a));
export const cosine = (a, b) => { const d = norm(a) * norm(b); return d ? dot(a, b) / d : 0; };
export const unit = (n, i) => Array.from({ length: n }, (_, k) => +(k === i));

// 一个空间：轴 + 成员（有 vec 的子节点）。meta 的来源由调用方给：getMeta(id) → meta
export function spaceInfo(graph, id, getMeta) {
  const meta = getMeta(id);
  if (!isSpace(meta)) return null;
  const axes = parseAxes(meta.axes);
  const members = [], loose = [];
  for (const c of graph.nodes.get(id).children) {
    const m = getMeta(c);
    if (m && m.vec !== undefined && m.vec !== '') members.push({ id: c, label: graph.nodes.get(c).label, vec: parseVec(m.vec) });
    else loose.push(c);
  }
  return { id, axes, members, loose, maps: mapsOf(meta) };
}

// 投影方向：一根轴（'#0'、'#1'…）或者一个成员的方向（成员 id）→ 单位向量
export function direction(space, key) {
  const n = space.axes.length;
  if (typeof key === 'string' && key.startsWith('#')) return unit(n, +key.slice(1));
  const m = space.members.find(x => x.id === key);
  if (!m) return unit(n, 0);
  const l = norm(m.vec);
  return l ? m.vec.map(x => x / l) : unit(n, 0);
}
export const directionLabel = (space, key) => key.startsWith('#') ? space.axes[+key.slice(1)] ?? key : space.members.find(m => m.id === key)?.label ?? key;

// 两根投影方向的夹角（度）。不是 90° 说明这组「基」不正交：图上的距离会被拉歪
export const angleDeg = (u, v) => Math.acos(Math.max(-1, Math.min(1, cosine(u, v)))) * 180 / Math.PI;

// 成员两两余弦，按 |cos| 从大到小 —— 「哪几个词其实是一回事」
export function closestPairs(space, k = 5) {
  const out = [];
  const ms = space.members;
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) out.push({ a: ms[i].label, b: ms[j].label, cos: cosine(ms[i].vec, ms[j].vec) });
  return out.sort((x, y) => Math.abs(y.cos) - Math.abs(x.cos)).slice(0, k);
}

// 拖动散点 → 改坐标：只改投影用的两个方向上的分量，其余分量不动。
// 两根方向是轴时就是直接改那两维；是成员方向（可能不正交）时解 2×2：vec += a·u + b·v，使 u·vec = px、v·vec = py
export function moveInPlane(vec, u, v, px, py) {
  const cu = px - dot(vec, u), cv = py - dot(vec, v);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v);
  const det = uu * vv - uv * uv;
  if (Math.abs(det) < 1e-9) return vec.map((x, i) => x + cu * u[i] / (uu || 1)); // 两方向重合：只能沿一个方向挪
  const a = (cu * vv - cv * uv) / det, b = (cv * uu - cu * uv) / det;
  return vec.map((x, i) => x + a * u[i] + b * v[i]);
}
export const fmtVec = v => v.map(x => +x.toFixed(2)).join(', ');

// 检查：维数对不上、不是数、映射目标不是空间 / 形状不对
export function checkSpaces(graph, getMeta, resolve) {
  const issues = [];
  for (const id of graph.nodes.keys()) {
    const s = spaceInfo(graph, id, getMeta);
    if (!s) continue;
    for (const m of s.members) {
      if (m.vec.some(Number.isNaN)) issues.push({ level: 'error', where: m.id, msg: 'vec 里有不是数的项' });
      else if (m.vec.length !== s.axes.length) issues.push({ level: 'warn', where: m.id, msg: `vec 有 ${m.vec.length} 维，空间「${graph.nodes.get(id).label}」有 ${s.axes.length} 根轴` });
    }
    for (const mp of s.maps) {
      const to = resolve(id, mp.ref);
      const t = to && spaceInfo(graph, to, getMeta);
      if (!t) { issues.push({ level: 'error', where: id, msg: `${mp.key}：目标不是空间节点（要有 axes:）` }); continue; }
      const bad = mp.W.length !== t.axes.length || mp.W.some(r => r.length !== s.axes.length || r.some(Number.isNaN));
      if (bad) issues.push({ level: 'error', where: id, msg: `${mp.key}：矩阵应是 ${t.axes.length} 行（目标轴）× ${s.axes.length} 列（本空间轴），用 ; 分行` });
    }
  }
  return issues;
}
