// >v<⚙设置-settings.yaml-Synapsis 自己的设置，放在 Synapsis 目录根的 settings.yaml，进 git（👤 2026-10-10：调到最合理后直接分享给大家）
// 最小 YAML 子集：「段名:」下面缩进两格写「键: 值」；值只有 true / false / 数字 / 文字；# 开头是注释。不引依赖。
// 没有这个文件 = 全用默认；界面里改设置只改对应那一行（其余行和注释原样保留）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SETTINGS_FILE = 'settings.yaml';

// 默认值 + 给界面用的说明（段 → 键 → [默认, 名字, 说明]）
export const SCHEMA = {
  // 👤 2026-10-12 不在 ⚙ 里单独列了：和「📄 项目文件…」合成一个对话框（打开没挂过 Synapsis 的文件夹自动弹），这里只记上次勾了哪些 = 下次的默认 + 命令行 init 用
  init: {
    title: '新项目 init 时生成',
    hidden: true,
    keys: {
      manual: [true, 'AI 接入手册', '__synapsis/_synapsis.md：别的 AI 怎么用 Synapsis 读图、按图施工'],
      blackboard: [true, '黑板', '__synapsis/_Blackboard.md：多个 AI / 对话之间传话的地方'],
      words: [true, '分层词表', '__synapsis/_词表.md：颜色 + 图案两节，名字里含这些词的节点自动上色 / 加底纹'],
      launcher: [true, '启动快捷方式', '项目根目录的「在 Synapsis 打开」快捷方式 + .synapsis/ 里的兜底启动脚本'],
      docs: [false, '项目文档骨架', '_开发进度.md、_TODO.md、AGENTS.md 那一套（只做规划 / 研究可以不要）'],
    },
  },
  // 👤 2026-10-12 方向键挪卡片 / Ctrl+方向键 撑大 UI 框：打字时双手不离键盘
  nudge: {
    title: '方向键微调',
    hint: '方向键 = 挪选中的卡，Shift = 快速；Ctrl+方向键 = UI 框往那边撑大，Ctrl+Alt = 往回缩。按住不放：先停一下，再连续走。',
    keys: {
      step: [8, '每步距离', '一步挪 / 撑多少（画布单位，网格一格 = 24）'],
      fast: [4, 'Shift 倍数', '按住 Shift 时每步 × 几'],
      delay: [200, '首次停顿', '按下走一步后，停多久（毫秒）开始连续走'],
      interval: [100, '连续间隔', '连续走时每步隔多久（毫秒）'],
    },
  },
};

export const defaults = () => Object.fromEntries(Object.entries(SCHEMA).map(([sec, { keys }]) => [sec, Object.fromEntries(Object.entries(keys).map(([k, [d]]) => [k, d]))]));

const coerce = v => { const t = String(v).trim().replace(/\s+#.*$/, ''); if (t === 'true') return true; if (t === 'false') return false; if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); return t.replace(/^(["'])(.*)\1$/, '$2'); };

// 文本 → 设置（先放默认值，文件里有的覆盖；不认识的段 / 键原样带上，免得丢别人加的）
export function parseSettings(text) {
  const out = defaults();
  let sec = null, wordsSet = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = /^(\s*)([^:#\s][^:]*?):\s*(.*)$/.exec(raw);
    if (!m) continue;
    if (!m[1].length) { sec = m[2]; if (!(sec in out)) out[sec] = {}; if (m[3].trim() && m[3].trim() !== '{}') { out[sec] = coerce(m[3]); sec = null; } continue; }
    if (sec && typeof out[sec] === 'object') { out[sec][m[2]] = coerce(m[3]); if (sec === 'init' && m[2] === 'words') wordsSet = true; }
  }
  // 旧文件的 colorWords / patternWords（颜色、图案两份词表时代）→ words
  const I = out.init;
  if (I && !wordsSet && ('colorWords' in I || 'patternWords' in I)) I.words = !!(I.colorWords || I.patternWords);
  if (I) { delete I.colorWords; delete I.patternWords; }
  return out;
}

// 改一个值：保留其余行和注释；段或键不存在就补上
export function setSettingText(text, sec, key, value) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text || '').split(/\r?\n/);
  let si = lines.findIndex(l => new RegExp('^' + sec + ':\\s*(#.*)?$').test(l));
  if (si < 0) { if (lines.length && lines.at(-1) === '') lines.pop(); lines.push(sec + ':', '  ' + key + ': ' + value, ''); return lines.join(eol); }
  let end = si + 1;
  while (end < lines.length && (/^\s+/.test(lines[end]) || !lines[end].trim())) end++;
  for (let i = si + 1; i < end; i++) {
    const m = new RegExp('^(\\s+)' + key + ':(\\s*)([^#]*?)(\\s+#.*)?$').exec(lines[i]);
    if (m) { lines[i] = m[1] + key + ': ' + value + (m[4] || ''); return lines.join(eol); }
  }
  let at = end; while (at > si + 1 && !lines[at - 1].trim()) at--; // 插在这一段最后一个有内容的行后面
  lines.splice(at, 0, '  ' + key + ': ' + value);
  return lines.join(eol);
}

export const settingsPath = home => join(home, SETTINGS_FILE);
export function loadSettings(home) {
  const f = settingsPath(home);
  try { return parseSettings(existsSync(f) ? readFileSync(f, 'utf8') : ''); } catch { return defaults(); }
}
// patch = { init: { manual: false, … } }：只认 SCHEMA 里有的键，值的类型要和默认值一样（布尔 / 数字）
export function saveSettings(home, patch) {
  const f = settingsPath(home);
  let text = existsSync(f) ? readFileSync(f, 'utf8') : DEFAULT_TEXT;
  for (const [sec, vals] of Object.entries(patch || {})) {
    if (!SCHEMA[sec]) continue;
    for (const [k, v] of Object.entries(vals || {})) if (SCHEMA[sec].keys[k] && typeof v === typeof SCHEMA[sec].keys[k][0] && (typeof v !== 'number' || Number.isFinite(v))) text = setSettingText(text, sec, k, String(v));
  }
  writeFileSync(f, text);
  return loadSettings(home);
}

export const DEFAULT_TEXT = `# Synapsis 设置（进 git，团队共享）。在界面左上角 ⚙ 里改，也可以直接改这个文件。
# 没有的项 = 用默认值。格式：段名: 下面缩进两格写「键: 值」（true / false / 数字）。

# init：挂上 Synapsis 时默认勾哪些（打开新文件夹弹的对话框会记住你上次勾的；命令行 init 也照这个）
init:
  manual: true         # AI 接入手册  __synapsis/_synapsis.md
  blackboard: true     # 黑板  __synapsis/_Blackboard.md
  words: true          # 分层词表  __synapsis/_词表.md（颜色 + 图案）
  launcher: true       # 启动快捷方式（项目根目录 .lnk + .synapsis/ 兜底脚本）
  docs: false          # 项目文档骨架（_开发进度.md、_TODO.md、AGENTS.md 那一套）

# nudge：方向键挪卡片 / Ctrl+方向键 撑大 UI 框（数字）
nudge:
  step: 8              # 每步距离（画布单位，网格一格 = 24）
  fast: 4              # 按住 Shift 时每步 × 几
  delay: 200           # 按下走一步后，停多久（毫秒）开始连续走
  interval: 100        # 连续走时每步隔多久（毫秒）

# 快捷键自定义：下一步做（现在的键位见界面里的 ⌨ 快捷键）
# keys: {}
`;
