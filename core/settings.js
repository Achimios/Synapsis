// >v<⚙设置-settings.yaml-Synapsis 自己的设置，放在 Synapsis 目录根的 settings.yaml，进 git（👤 2026-10-10：调到最合理后直接分享给大家）
// 最小 YAML 子集：「段名:」下面缩进两格写「键: 值」；值只有 true / false / 数字 / 文字；# 开头是注释。不引依赖。
// 没有这个文件 = 全用默认；界面里改设置只改对应那一行（其余行和注释原样保留）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SETTINGS_FILE = 'settings.yaml';

// 默认值 + 给界面用的说明（段 → 键 → [默认, 名字, 说明]）
export const SCHEMA = {
  init: {
    title: '新项目 init 时生成',
    keys: {
      manual: [true, 'AI 接入手册', '__synapsis/_synapsis.md：别的 AI 怎么用 Synapsis 读图、按图施工'],
      blackboard: [true, '黑板', '__synapsis/_Blackboard.md：多个 AI / 对话之间传话的地方'],
      colorWords: [true, '配色词表', '__synapsis/_配色.md：名字里含这些词的节点自动上色'],
      patternWords: [true, '图案词表', '__synapsis/_图案.md：名字里含这些词的节点自动加底纹'],
      launcher: [true, '启动快捷方式', '项目根目录的「在 Synapsis 打开」快捷方式 + .synapsis/ 里的兜底启动脚本'],
    },
  },
};

export const defaults = () => Object.fromEntries(Object.entries(SCHEMA).map(([sec, { keys }]) => [sec, Object.fromEntries(Object.entries(keys).map(([k, [d]]) => [k, d]))]));

const coerce = v => { const t = String(v).trim().replace(/\s+#.*$/, ''); if (t === 'true') return true; if (t === 'false') return false; if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); return t.replace(/^(["'])(.*)\1$/, '$2'); };

// 文本 → 设置（先放默认值，文件里有的覆盖；不认识的段 / 键原样带上，免得丢别人加的）
export function parseSettings(text) {
  const out = defaults();
  let sec = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = /^(\s*)([^:#\s][^:]*?):\s*(.*)$/.exec(raw);
    if (!m) continue;
    if (!m[1].length) { sec = m[2]; if (!(sec in out)) out[sec] = {}; if (m[3].trim() && m[3].trim() !== '{}') { out[sec] = coerce(m[3]); sec = null; } continue; }
    if (sec && typeof out[sec] === 'object') out[sec][m[2]] = coerce(m[3]);
  }
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
// patch = { init: { manual: false, … } }：只认 SCHEMA 里有的键、布尔值
export function saveSettings(home, patch) {
  const f = settingsPath(home);
  let text = existsSync(f) ? readFileSync(f, 'utf8') : DEFAULT_TEXT;
  for (const [sec, vals] of Object.entries(patch || {})) {
    if (!SCHEMA[sec]) continue;
    for (const [k, v] of Object.entries(vals || {})) if (SCHEMA[sec].keys[k] && typeof v === 'boolean') text = setSettingText(text, sec, k, String(v));
  }
  writeFileSync(f, text);
  return loadSettings(home);
}

export const DEFAULT_TEXT = `# Synapsis 设置（进 git，团队共享）。在界面左上角 ⚙ 里改，也可以直接改这个文件。
# 没有的项 = 用默认值。格式：段名: 下面缩进两格写「键: 值」（true / false）。

# init：给新项目挂上 Synapsis 时生成哪些东西
init:
  manual: true         # AI 接入手册  __synapsis/_synapsis.md
  blackboard: true     # 黑板  __synapsis/_Blackboard.md
  colorWords: true     # 配色词表  __synapsis/_配色.md
  patternWords: true   # 图案词表  __synapsis/_图案.md
  launcher: true       # 启动快捷方式（项目根目录 .lnk + .synapsis/ 兜底脚本）

# 快捷键自定义：下一步做（现在的键位见界面里的 ⌨ 快捷键）
# keys: {}
`;
