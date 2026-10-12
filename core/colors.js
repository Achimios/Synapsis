// >v<🎨画布-调色板与词表-颜色只看节点自己（规则见文件末尾 colorMap）。
// 词表 = 工作区的 __synapsis/_配色.md + 各分组文件夹里自己的 _配色.md（层级词表）；项目那份没有就用 DEFAULT_WORDS。
// 线 = 出发节点的颜色（main.jsx FlowEdge）。
export const PALETTE = {
  蓝: '#4d9bff', 紫: '#a97cff', 橙: '#ff9636', 绿: '#5cc46a', 红: '#ff5f5f',
  灰: '#9a9a9a', 青: '#36c6c0', 粉: '#ff79c2', 黄: '#e6c440',
};
// >v<🎨画布-饱和度档-颜色右键里的 25 / 50 / 75 / 100%（👤 2026-10-10）：按 HSL 把饱和度乘上去，色相和亮度不变
export function satHex(hex, pct) {
  const p = Math.max(0, Math.min(100, pct)) / 100, n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  s *= p;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m0 = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r1, g1, b1].map(v => Math.round((v + m0) * 255).toString(16).padStart(2, '0')).join('');
}
export const WORDS_FILE = '_配色.md';
export const DEFAULT_WORDS = `# 配色词表

> 名字里含这些词的节点自动用这一行的颜色（只管节点自己，不传给子孙）。这是项目那份；分组文件夹里还能放自己的 _配色.md，只管它里面，就近命中优先。
> 格式：\`- 颜色: 词, 词, 词\`。颜色写调色板名（蓝 紫 橙 绿 红 灰 青 粉 黄）或 #rrggbb。上面的行优先。
> 想单独改某个节点：界面里右键色块（会写进那个节点的 \`color:\`）。
> 颜色后面可以跟饱和度 /25 /50 /75（100 = 不写），比如 \`- 蓝/50: 观测\`：同一个色相想分出深浅，就拆成两行。

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

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// color: 的值：调色板名（蓝 / 紫…）或 #rgb / #rrggbb；认不出 → null（当没写）
// 后面可以跟 /25 /50 /75（饱和度百分比，100 = 不写）：蓝/50、#ff9636/25
export function parseColor(s) {
  if (s == null) return null;
  let t = String(s).trim();
  const m = t.match(/^(.+)\/(\d{1,3})$/);
  if (m) { const base = parseColor(m[1]); return base ? satHex(base, +m[2]) : null; }
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
// 命中了哪一行的哪个词（「为什么是这个色」用）
const ruleHit = (label, rules) => { const l = label.toLowerCase(); for (const r of rules) { const w = r.words.find(w => l.includes(w.toLowerCase())); if (w) return { r, word: w }; } return null; };

// >v<🎨画布-层级词表-（👤 2026-10-11「几千个节点项目级管不过来，颜色也有限」）分组可以有自己的词表，管它的子孙。
//   words = 根那份的文本（旧调用）或 {'': 根文本 | null, 分组id: 文本, …}；根是 null = 默认词表。
//   找一个节点的词：从它的父级开始往上，哪一层的表先命中它的名字就用哪一层（就近命中，没命中接着往上），都没命中 = 不算命中
export function wordTables(words, parse = t => parseColorWords(t).rules, dflt = DEFAULT_RULES) {
  const o = words != null && typeof words === 'object' ? words : { '': words };
  const m = new Map();
  for (const [k, t] of Object.entries(o)) m.set(k, k === '' && t == null ? dflt : parse(t));
  if (!m.has('')) m.set('', dflt);
  return m;
}
// → { value（颜色 / 图案）, from（哪一层的词表：'' = 项目）, word } 或 null；pick(r) 取规则里的值
export function hierHit(graph, id, tables, pick = r => r.color) {
  const label = graph.nodes.get(id)?.label; if (label == null) return null;
  for (let a = graph.nodes.get(id)?.parent; a != null; a = a === '' ? null : graph.nodes.get(a)?.parent) {
    const rules = tables.get(a); if (!rules) continue;
    const h = ruleHit(label, rules); if (h) return { value: pick(h.r), from: a, word: h.word };
  }
  return null;
}
// 对 id 的子孙生效的「上级」词表在哪一层：从 id 自己的父级往上第一个有表的（根总是有）。本层 = tables.has(id)
export const upperTable = (graph, id, tables) => { for (let a = graph.nodes.get(id)?.parent; a != null; a = a === '' ? null : graph.nodes.get(a)?.parent) if (tables.has(a)) return a; return ''; };

// >v<🎨画布-节点配色-（👤 2026-10-12「颜色不要继承父级，颜色就影响本节点」）每个节点只看自己：
//   1. 自己写了 color: → 它；2. 自己的名字命中词表（层级词表，父级往上就近命中）→ 那一行；3. AI 语义配色；4. 灰。
//   不再沿祖先继承、不再轮色：新建的卡默认灰，所在的层有词表就马上分到色。
//   饱和度 sat: 25 / 50 / 75（100 = 不写）单独一个键，叠在上面算出的颜色上，不把自动色变成手动色（👤：手动标注用）。
// graph = parseOutline 的结果；getMeta(id) → frontmatter；words = 根词表文本或 {'': 根, 分组id: 文本}；sem = {id: 颜色}
// 不带 sat: 的颜色（饱和度按钮拿它当底色）；tables = wordTables(words)
export const baseColor = (graph, id, m, tables, sem = null) => parseColor(m?.color) || hierHit(graph, id, tables)?.value || sem?.[id] || PALETTE.灰;
export const satOf = m => { const s = +m?.sat; if (s > 0 && s < 100) return s; const t = String(m?.color || '').split('/')[1]; return +t > 0 && +t < 100 ? +t : 100; }; // 现在是哪一档（旧的 color: 蓝/50 也认）
export function colorMap(graph, getMeta = () => undefined, words = null, sem = null) {
  const tables = wordTables(words), out = new Map();
  for (const id of graph.nodes.keys()) {
    if (id === '') continue;
    const m = getMeta(id) || {};
    const base = baseColor(graph, id, m, tables, sem);
    const sat = +m.sat;
    out.set(id, sat > 0 && sat < 100 ? satHex(base, sat) : base);
  }
  return out;
}
