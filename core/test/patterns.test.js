// >v<✅自检-底纹图案-词表认图案、只看自己不往下传、pattern: 覆盖 / 无、AI 归类兜底、默认词表能解析
// node core/test/patterns.test.js
import { patternMap, parsePatternWords, DEFAULT_PATTERN_WORDS, PATTERNS } from '../patterns.js';
import { parseOutline } from '../outline.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };

const g = parseOutline(`观测
  场景大局观空间
  自身传感器读数
  短期记忆
行动
  动作行为树
  咕噜人
内在
  情绪空间`);
let p = patternMap(g);
ok(p.get('观测/场景大局观空间') === '网格' && p.get('观测/自身传感器读数') === '点阵' && p.get('观测/短期记忆') === '点阵', '同一组兄弟靠图案区分：场景 = 网格，读数 / 记忆 = 点阵');
ok(p.get('行动/动作行为树') === '斜纹' && p.get('内在/情绪空间') === '网格', '行为树 = 斜纹；「情绪空间」含「空间」→ 网格（上面的行优先）');
ok(!p.has('行动') && !p.has('行动/咕噜人'), '没词的不带图案，也不从父节点继承');
const meta = { '行动/咕噜人': { pattern: '波纹' }, '观测/短期记忆': { pattern: '无' } };
p = patternMap(g, id => meta[id]);
ok(p.get('行动/咕噜人') === '波纹' && !p.has('观测/短期记忆'), 'pattern: 覆盖；pattern: 无 = 不要底纹');
p = patternMap(g, () => undefined, null, { 行动: '横纹' });
ok(p.get('行动') === '横纹' && !p.has('行动/咕噜人'), 'AI 归类兜底，也不往下传');
p = patternMap(g, () => undefined, '- 点阵: 咕噜\n- 金属: 不认识');
ok(p.get('行动/咕噜人') === '点阵' && !p.has('观测/场景大局观空间'), '工作区自己的词表');
ok(parsePatternWords('- 金属: x').bad.length === 1, '认不出的图案名 → 报 bad');
ok(parsePatternWords(DEFAULT_PATTERN_WORDS).bad.length === 0 && parsePatternWords(DEFAULT_PATTERN_WORDS).rules.length === Object.keys(PATTERNS).length, '默认词表自己能解析，每种图案一行');

console.log(`patterns: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
