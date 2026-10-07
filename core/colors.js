// >v<🎨画布-节点配色-每个节点一个颜色，只看节点本身（换页不变色）：
//   1. 自己或最近的祖先写了 color: → 用它（👤 改的才写进 frontmatter）
//   2. 否则沿祖先往上，最上层一个名字认得出的（观测 / 内在 / 决策 / 行动 / 外部 / 兜底…）→ 那一类的颜色
//   3. 都没有 → 它所在的顶层分组按顺序轮色（跳过兄弟里已被关键词占掉的色）
// 线 = 出发节点的颜色（main.jsx FlowEdge）。
export const PALETTE = {
  蓝: '#4d9bff', 紫: '#a97cff', 橙: '#ff9636', 绿: '#5cc46a', 红: '#ff5f5f',
  灰: '#9a9a9a', 青: '#36c6c0', 粉: '#ff79c2', 黄: '#e6c440',
};
export const KEYWORDS = [
  [/观测|感知|观察|输入|传感/, '蓝'],
  [/内在|情绪|记忆|人格|个性|心理/, '紫'],
  [/决策|规划|思考|判断/, '橙'],
  [/行动|行为|动作|执行/, '绿'],
  [/外部|环境|世界|外显|身体/, '灰'],
  [/兜底|异常|风险|fallback/i, '红'],
];
const CYCLE = ['青', '粉', '黄', '蓝', '紫', '橙', '绿', '红'];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// color: 的值：调色板名（蓝 / 紫…）或 #rgb / #rrggbb；认不出 → null（当没写）
export function parseColor(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (PALETTE[t]) return PALETTE[t];
  if (!HEX.test(t)) return null;
  return t.length === 4 ? '#' + [...t.slice(1)].map(c => c + c).join('') : t.toLowerCase();
}
export const keywordHue = label => KEYWORDS.find(([re]) => re.test(label))?.[1] || null;

// graph = parseOutline 的结果（nodes: Map id → {label, parent, children}），getMeta(id) → frontmatter 或 undefined
export function colorMap(graph, getMeta = () => undefined) {
  const ROOT = '', out = new Map();
  // 顶层分组轮色：关键词占的色先让出来
  const top = graph.nodes.get(ROOT)?.children || [];
  const taken = new Set(top.map(id => keywordHue(graph.nodes.get(id).label)).filter(Boolean));
  const topHue = new Map();
  let k = 0;
  for (const id of top) {
    let h = keywordHue(graph.nodes.get(id).label);
    if (!h) {
      const free = CYCLE.filter(c => !taken.has(c));
      h = (free.length ? free : CYCLE)[k++ % (free.length || CYCLE.length)];
    }
    topHue.set(id, h);
  }
  const of = id => {
    if (out.has(id)) return out.get(id);
    let explicit = null, kw = null, topId = id;
    for (let x = id; x != null && x !== ROOT; x = graph.nodes.get(x)?.parent) {
      if (!explicit) explicit = parseColor(getMeta(x)?.color);
      const h = keywordHue(graph.nodes.get(x).label);
      if (h) kw = h; // 一路覆盖 → 留下最上层的
      topId = x;
    }
    const c = explicit || PALETTE[kw || topHue.get(topId) || '灰'];
    out.set(id, c);
    return c;
  };
  for (const id of graph.nodes.keys()) if (id !== ROOT) of(id);
  return out;
}
