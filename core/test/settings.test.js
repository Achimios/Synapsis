// settings.yaml：解析 / 只改一行 / init 听设置的话。node core/test/settings.test.js
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSettings, setSettingText, loadSettings, saveSettings, defaults, DEFAULT_TEXT } from '../settings.js';
import { init } from '../cli.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

// 默认值 / 解析
ok(JSON.stringify(parseSettings('')) === JSON.stringify(defaults()) && defaults().init.manual === true, '空文本 = 全默认（init 各项都生成）');
const p1 = parseSettings('init:\n  manual: false   # 不要手册\n  launcher: false\n未知段:\n  x: 3\n');
ok(p1.init.manual === false && p1.init.launcher === false && p1.init.blackboard === true, '文件里有的覆盖默认，没写的还是默认');
ok(p1['未知段']?.x === 3, '不认识的段 / 键原样带上（数字）');
ok(parseSettings(DEFAULT_TEXT).init.colorWords === true, '自带的默认文件能读回来');
ok(parseSettings('init:\r\n  manual: false\r\n').init.manual === false, 'CRLF 也行');

// 只改一行，其余和注释不动
const t0 = '# 头注释\ninit:\n  manual: true   # 手册\n  blackboard: true\n\n# 尾注释\nkeys: {}\n';
const t1 = setSettingText(t0, 'init', 'manual', 'false');
ok(t1.includes('  manual: false   # 手册') && t1.includes('# 头注释') && t1.includes('# 尾注释') && t1.includes('keys: {}'), '改 manual：注释、别的行原样');
ok(setSettingText(t0, 'init', 'launcher', 'false').includes('  blackboard: true\n  launcher: false\n'), '没有的键补在这一段最后');
ok(setSettingText('', 'init', 'manual', 'false').includes('init:\n  manual: false'), '没有段 → 补一段');
ok(!/\r\n/.test(t1) && /\r\n/.test(setSettingText('init:\r\n  manual: true\r\n', 'init', 'manual', 'false')), '保持原来的换行风格');

// 存 / 读（临时目录当 Synapsis 目录）
const home = mkdtempSync(join(tmpdir(), 'syn-settings-'));
ok(loadSettings(home).init.manual === true && !existsSync(join(home, 'settings.yaml')), '没有文件 → 默认，也不凭空建文件');
const s2 = saveSettings(home, { init: { manual: false, 不存在的键: true, blackboard: 'yes' }, 乱来: { x: true } });
ok(s2.init.manual === false && s2.init.blackboard === true, '只认设计里有的键、且必须是布尔');
ok(existsSync(join(home, 'settings.yaml')) && /manual: false/.test(readFileSync(join(home, 'settings.yaml'), 'utf8')), '存出 settings.yaml');
ok(!/乱来|不存在的键/.test(readFileSync(join(home, 'settings.yaml'), 'utf8')), '不认识的写不进去');

// init 听设置
const proj = mkdtempSync(join(tmpdir(), 'syn-proj-'));
saveSettings(home, { init: { manual: false, blackboard: false, colorWords: true, patternWords: false, launcher: false } });
const log = console.log; console.log = () => {};
try { init(proj, home); } finally { console.log = log; }
const has = rel => existsSync(join(proj, rel));
ok(has('__synapsis') && has('__synapsis/_词表.md'), 'init：词表生成了（颜色勾着）');
ok(!has('__synapsis/_synapsis.md') && !has('__synapsis/_Blackboard.md') && !has('__synapsis/_图案.md'), 'init：关掉的（手册 / 黑板）没生成；不再有单独的 _图案.md');
ok(!has('.synapsis/Synapsis.vbs'), 'init：关掉启动快捷方式 → 没有兜底脚本');
const proj2 = mkdtempSync(join(tmpdir(), 'syn-proj2-'));
const home2 = mkdtempSync(join(tmpdir(), 'syn-home2-'));
console.log = () => {}; try { init(proj2, home2); } finally { console.log = log; }
ok(existsSync(join(proj2, '__synapsis', '_synapsis.md')) && existsSync(join(proj2, '__synapsis', '_词表.md')), '没有 settings.yaml → 照旧全生成');

for (const d of [home, home2, proj, proj2]) rmSync(d, { recursive: true, force: true });
console.log(`settings: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
