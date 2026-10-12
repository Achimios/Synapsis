// >v<🎨画布-底纹图案-配色之外的第二维（👤 2026-10-08）：颜色 = 主题（观测 / 内在 / 决策…），图案 = 性质
//   （场景信息、路径可能性 = 几何 / 空间类；身体读数、短期记忆 = 读数 / 数据类；行为树、状态机 = 结构 / 流程类）。
//   只看节点自己（颜色现在也一样，👤 2026-10-12）：
//   1. 自己写了 pattern: → 用它；2. 名字含词表 _图案.md 某一行的词 → 那一行；3. AI 归类（core/ai.js semPatterns）；4. 无
import { wordTables, hierHit, DEFAULT_WORDS } from './colors.js';
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
// >v<🎨画布-词表合并-（👤 2026-10-12「两个 md 不方便管理，人看着晕」）每一层一个 _词表.md，「## 颜色」「## 图案」两节；
//   哪一行算颜色、哪一行算图案看冒号前面：网格 / 点阵 / 斜纹 / 横纹 / 波纹 = 图案，其余 = 颜色（认不出的颜色照样进颜色那边，check 会报）。
//   某一层只写了颜色没写图案 → 图案那边这一层是空的，就近命中时自然接着往上找。
export const WORDS_ALL = '_词表.md';
export function splitWords(text) {
  const color = [], pattern = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*([^:：]+)[:：]/);
    if (!m) continue;
    (PATTERNS[m[1].trim()] ? pattern : color).push(line);
  }
  return { color: color.join('\n'), pattern: pattern.join('\n') };
}
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
// 合并后的默认词表（项目那份）：说明 + 两节
const rows = t => t.split(/\r?\n/).filter(l => /^\s*[-*]\s*[^:：]+[:：]/.test(l)).join('\n');
export const DEFAULT_ALL = `# 词表

> 名字里含这些词的节点自动上色 / 加底纹，**只管节点自己**（不传给子孙）。
> 这是项目那份；每个分组的文件夹里还能放自己的 _词表.md，只管它里面。找词时从父级往上，哪一层先命中用哪一层；某一层没写图案（或颜色），就接着往上找。
> 格式：\`- 颜色: 词, 词\` / \`- 图案: 词, 词\`。颜色写 蓝 紫 橙 绿 红 灰 青 粉 黄 或 #rrggbb，后面可跟 /25 /50 /75；图案只能是 网格 点阵 斜纹 横纹 波纹。上面的行优先。
> 想单独改某个节点：右键色块 / 图案（写进那个节点的 \`color:\` / \`pattern:\`）。

## 颜色
${rows(DEFAULT_WORDS)}

## 图案
${rows(DEFAULT_PATTERN_WORDS)}
`;
export const LOCAL_WORDS = label => `# 词表（只管「${label}」里面）

> 名字里含这些词的子孙自动上色 / 加底纹（只管节点自己）。这里没命中 / 没写的，接着往上一层的词表找。
> 格式：\`- 红: 词, 词\` / \`- 网格: 词, 词\`。上面的行优先。

## 颜色

## 图案
`;
// 把两节写回一份（AI 起草后写入用）：head 保留原文件开头的说明
export function joinWords(head, color, pattern) {
  return `${String(head || '').trimEnd()}\n\n## 颜色\n${rows(color)}\n\n## 图案\n${rows(pattern)}\n`.replace(/\n{3,}/g, '\n\n');
}
export const wordsHead = text => String(text || '').split(/\r?\n## /)[0].trimEnd();
export const wordPattern = (label, rules = DEFAULT_RULES) => {
  const l = label.toLowerCase();
  return rules.find(r => r.words.some(w => l.includes(w.toLowerCase())))?.pattern || null;
};
export const patternTables = words => wordTables(words, t => parsePatternWords(t).rules, DEFAULT_RULES);
// → Map(id → 图案名)；sem = {id: 图案名}（AI 归类）
export function patternMap(graph, getMeta = () => undefined, words = null, sem = null) {
  const tables = patternTables(words); // 层级词表（同配色：父级往上就近命中）
  const out = new Map();
  for (const [id, n] of graph.nodes) {
    if (id === '') continue;
    const own = getMeta(id)?.pattern;
    const p = own === '无' ? null : PATTERNS[own] ? own : hierHit(graph, id, tables, r => r.pattern)?.value || sem?.[id] || null;
    if (p) out.set(id, p);
  }
  return out;
}
