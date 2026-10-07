// >v<🎨画布-底纹图案-配色之外的第二维（👤 2026-10-08）：颜色 = 主题（观测 / 内在 / 决策…），图案 = 性质
//   （场景信息、路径可能性 = 几何 / 空间类；身体读数、短期记忆 = 读数 / 数据类；行为树、状态机 = 结构 / 流程类）。
//   只看节点自己（不像颜色那样沿祖先继承 —— 同一个颜色组里的兄弟正是要靠图案区分）：
//   1. 自己写了 pattern: → 用它；2. 名字含词表 _图案.md 某一行的词 → 那一行；3. AI 归类（core/ai.js semPatterns）；4. 无
export const PATTERNS = { 网格: 'grid', 点阵: 'dots', 斜纹: 'hatch', 横纹: 'lines', 波纹: 'wave' };
export const PATTERN_HINT = { 网格: '几何 / 空间 / 地图 / 路径', 点阵: '读数 / 数据 / 记忆 / 参数', 斜纹: '结构 / 流程 / 行为树 / 状态机', 横纹: '文档 / 说明 / 表 / 规则', 波纹: '情绪 / 信号 / 波动 / 噪声' };
export const PATTERN_FILE = '_图案.md';
export const DEFAULT_PATTERN_WORDS = `# 图案词表

> 名字里含这些词的节点自动带这一行的底纹（只看节点自己，不往子孙传）。颜色表示主题，图案表示性质。
> 格式：\`- 图案: 词, 词, 词\`。图案只能是：网格 点阵 斜纹 横纹 波纹。上面的行优先。
> 想单独改某个节点：右键 → 图案（会写进那个节点的 \`pattern:\`）。

- 网格: 空间, 场景, 地图, 路径, 栅格, 几何, 视野, 位置, 分区, 暴露
- 点阵: 读数, 传感, 记忆, 数据, 参数, 数值, 日志, 快照
- 斜纹: 行为树, 状态机, 流程, 管线, 层级, 结构, 调度
- 横纹: 文档, 说明, 报告, 参考表, 规则, 契约, 笔记
- 波纹: 情绪, 信号, 噪声, 波动, 节奏
`;
export function parsePatternWords(text) {
  const rules = [], bad = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*([^:：]+)[:：](.*)$/);
    if (!m) continue;
    const p = m[1].trim(), words = m[2].split(/[,，、]/).map(w => w.trim()).filter(Boolean);
    if (!PATTERNS[p] || !words.length) { bad.push(line.trim()); continue; }
    rules.push({ pattern: p, words });
  }
  return { rules, bad };
}
const DEFAULT_RULES = parsePatternWords(DEFAULT_PATTERN_WORDS).rules;
export const wordPattern = (label, rules = DEFAULT_RULES) => {
  const l = label.toLowerCase();
  return rules.find(r => r.words.some(w => l.includes(w.toLowerCase())))?.pattern || null;
};
// → Map(id → 图案名)；sem = {id: 图案名}（AI 归类）
export function patternMap(graph, getMeta = () => undefined, words = null, sem = null) {
  const rules = words == null ? DEFAULT_RULES : parsePatternWords(words).rules;
  const out = new Map();
  for (const [id, n] of graph.nodes) {
    if (id === '') continue;
    const own = getMeta(id)?.pattern;
    const p = own === '无' ? null : PATTERNS[own] ? own : wordPattern(n.label, rules) || sem?.[id] || null;
    if (p) out.set(id, p);
  }
  return out;
}
