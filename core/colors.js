// >v<🎨画布-节点配色-每个节点一个颜色，只看节点本身（换页不变色）：
//   1. 自己或最近的祖先写了 color: → 用它（👤 改的才写进 frontmatter）
//   2. 否则沿祖先往上，最上层一个名字含词表里的词的 → 那一行的颜色
//   3. 都没有 → 它所在的顶层分组按顺序轮色（跳过兄弟里已被词表占掉的色）
// 词表 = 工作区的 __synapsis/_配色.md（👤 2026-10-08：写死在代码里扩展性不行）；没有这个文件用 DEFAULT_WORDS。
// 线 = 出发节点的颜色（main.jsx FlowEdge）。
export const PALETTE = {
  蓝: '#4d9bff', 紫: '#a97cff', 橙: '#ff9636', 绿: '#5cc46a', 红: '#ff5f5f',
  灰: '#9a9a9a', 青: '#36c6c0', 粉: '#ff79c2', 黄: '#e6c440',
};
export const WORDS_FILE = '_配色.md';
export const DEFAULT_WORDS = `# 配色词表

> 名字里含这些词的节点（连同子孙）自动用这一行的颜色；一个节点沿祖先往上，按**最外层**含词的那个算。
> 格式：\`- 颜色: 词, 词, 词\`。颜色写调色板名（蓝 紫 橙 绿 红 灰 青 粉 黄）或 #rrggbb。上面的行优先。
> 想单独改某个节点：界面里右键色块（会写进那个节点的 \`color:\`）。

- 蓝: 观测, 感知, 观察, 输入, 传感
- 紫: 内在, 情绪, 记忆, 人格, 个性, 心理
- 橙: 决策, 规划, 思考, 判断
- 绿: 行动, 行为, 动作, 执行
- 灰: 外部, 环境, 世界, 外显, 身体
- 红: 兜底, 异常, 风险, fallback
- 青: 工具, 界面, 调试, 自检, 日志, 管线, 引擎
- 粉: 对话, 社交, 玩家, 交互, 喊话, 台词
- 黄: 路线, 待办, 里程碑, 资源, 经济, 平衡
`;
// 旧版默认词表（只有 6 行）：工作区里的 _配色.md 还是一字没改的旧默认 → 升级成新默认（👤 2026-10-08：词表把青 / 粉 / 黄漏了）
export const OLD_DEFAULT_WORDS = `# 配色词表

> 名字里含这些词的节点（连同子孙）自动用这一行的颜色；一个节点沿祖先往上，按**最外层**含词的那个算。
> 格式：\`- 颜色: 词, 词, 词\`。颜色写调色板名（蓝 紫 橙 绿 红 灰 青 粉 黄）或 #rrggbb。上面的行优先。
> 想单独改某个节点：界面里右键色块（会写进那个节点的 \`color:\`）。

- 蓝: 观测, 感知, 观察, 输入, 传感
- 紫: 内在, 情绪, 记忆, 人格, 个性, 心理
- 橙: 决策, 规划, 思考, 判断
- 绿: 行动, 行为, 动作, 执行
- 灰: 外部, 环境, 世界, 外显, 身体
- 红: 兜底, 异常, 风险, fallback
`;
const CYCLE = ['青', '粉', '黄', '蓝', '紫', '橙', '绿', '红'].map(k => PALETTE[k]);

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// color: 的值：调色板名（蓝 / 紫…）或 #rgb / #rrggbb；认不出 → null（当没写）
export function parseColor(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (PALETTE[t]) return PALETTE[t];
  if (!HEX.test(t)) return null;
  return t.length === 4 ? '#' + [...t.slice(1)].map(c => c + c).join('') : t.toLowerCase();
}
// 词表 md → [{color, words: [...]}]；认不出的行跳过（返回 bad 给 check 报）
export function parseColorWords(text) {
  const rules = [], bad = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*([^:：]+)[:：](.*)$/);
    if (!m) continue;
    const color = parseColor(m[1]), words = m[2].split(/[,，、]/).map(w => w.trim()).filter(Boolean);
    if (!color || !words.length) { bad.push(line.trim()); continue; }
    rules.push({ color, words });
  }
  return { rules, bad };
}
const DEFAULT_RULES = parseColorWords(DEFAULT_WORDS).rules;
export const wordColor = (label, rules = DEFAULT_RULES) => {
  const l = label.toLowerCase();
  return rules.find(r => r.words.some(w => l.includes(w.toLowerCase())))?.color || null;
};

// graph = parseOutline 的结果（nodes: Map id → {label, parent, children}），getMeta(id) → frontmatter 或 undefined；
// words = 词表 md 文本（undefined / null → 默认词表）；sem = {id: 颜色}（LM Studio 语义配色，core/ai.js semColors）—— 词表没命中时当命中用
export function colorMap(graph, getMeta = () => undefined, words = null, sem = null) {
  const rules = words == null ? DEFAULT_RULES : parseColorWords(words).rules;
  const ROOT = '', out = new Map();
  // 顶层分组轮色：词表占的色先让出来
  const top = graph.nodes.get(ROOT)?.children || [];
  const word = id => wordColor(graph.nodes.get(id).label, rules);
  const hit = id => word(id) || sem?.[id] || null;
  const taken = new Set(top.map(hit).filter(Boolean));
  const free = CYCLE.filter(c => !taken.has(c)), cyc = free.length ? free : CYCLE;
  const topHue = new Map();
  let k = 0;
  for (const id of top) topHue.set(id, hit(id) || cyc[k++ % cyc.length]);
  const of = id => {
    if (out.has(id)) return out.get(id);
    let explicit = null, kw = null, sk = null, topId = id;
    for (let x = id; x != null && x !== ROOT; x = graph.nodes.get(x)?.parent) {
      if (!explicit) explicit = parseColor(getMeta(x)?.color);
      const h = word(x), s = sem?.[x];
      if (h) kw = h; // 一路覆盖 → 留下最上层的
      if (s) sk = s; // 语义配色同理，但排在词表命中之后（不然一个顶层分组被 AI 染色，下面按词表分好的颜色全被盖掉）
      topId = x;
    }
    const c = explicit || kw || sk || topHue.get(topId) || PALETTE.灰;
    out.set(id, c);
    return c;
  };
  for (const id of graph.nodes.keys()) if (id !== ROOT) of(id);
  return out;
}
