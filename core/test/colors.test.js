// >v<✅自检-节点配色-关键词认色、最上层关键词优先、顶层轮色、color: 覆盖并往下继承
// node core/test/colors.test.js
import { colorMap, parseColor, parseColorWords, PALETTE, DEFAULT_WORDS, satHex } from '../colors.js';
import { parseOutline } from '../outline.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };

const g = parseOutline(`游戏NPC组
  观测
    敌方观察
  内在
    情绪空间
      恐惧
    决策空间
  决策
  行动
战术层
  巡逻
工具链
外部世界`);
let c = colorMap(g);
ok(c.get('游戏NPC组/观测') === PALETTE.蓝 && c.get('游戏NPC组/观测/敌方观察') === PALETTE.蓝, '观测 = 蓝，子节点继承');
ok(c.get('游戏NPC组/内在/情绪空间/恐惧') === PALETTE.紫, '孙子继承 内在 的紫');
ok(c.get('游戏NPC组/内在/决策空间') === PALETTE.紫, '最上层关键词优先：内在 下的「决策空间」仍是紫，不变橙');
ok(c.get('游戏NPC组/决策') === PALETTE.橙 && c.get('游戏NPC组/行动') === PALETTE.绿, '决策橙 行动绿');
ok(c.get('外部世界') === PALETTE.灰, '顶层的关键词也认');
const tops = ['游戏NPC组', '战术层', '工具链'].map(id => c.get(id));
ok(new Set(tops).size === 3 && !tops.includes(PALETTE.灰), '没关键词的顶层分组各自轮到不同的色，且不撞关键词占的色 ' + tops);
ok(c.get('战术层/巡逻') === c.get('战术层'), '没关键词的子节点继承顶层色');

const meta = { '游戏NPC组/内在': { color: '#123' }, '战术层/巡逻': { color: '绿' }, '工具链': { color: '乱写' } };
c = colorMap(g, id => meta[id]);
ok(c.get('游戏NPC组/内在') === '#112233' && c.get('游戏NPC组/内在/情绪空间/恐惧') === '#112233', 'color: 覆盖关键词，并往下继承（#rgb 展开）');
ok(c.get('战术层/巡逻') === PALETTE.绿 && c.get('战术层') !== PALETTE.绿, '调色板名可用；只影响自己和子孙');
ok(c.get('工具链') === colorMap(g).get('工具链'), '认不出的 color: 当没写');
ok(parseColor(' #ABCDEF ') === '#abcdef' && parseColor('red') === null && parseColor(undefined) === null, 'parseColor');

// 工作区词表（👤 2026-10-08：写死扩展性不行 → __synapsis/_配色.md）
const words = '# 我的词表\n- 青: 战术, 巡逻\n- #123456: 工具\n- 乱色: 什么\n普通的一行\n- 紫：内在，情绪';
const pw = parseColorWords(words);
ok(pw.rules.length === 3 && pw.bad.length === 1 && pw.rules[2].words.join() === '内在,情绪', '词表解析：中文冒号 / 逗号也认，认不出的颜色进 bad ' + JSON.stringify(pw));
c = colorMap(g, () => undefined, words);
ok(c.get('战术层') === PALETTE.青 && c.get('战术层/巡逻') === PALETTE.青 && c.get('工具链') === '#123456', '自定义词表生效');
ok(c.get('游戏NPC组/观测') !== PALETTE.蓝, '词表里没有的词（观测）不再认蓝');
ok(parseColorWords(DEFAULT_WORDS).bad.length === 0 && parseColorWords(DEFAULT_WORDS).rules.length === 9, '默认词表自己能解析，9 种颜色都用上');

// 饱和度档：蓝/50 …（色相、亮度不变，只乘饱和度）
ok(satHex('#4d9bff', 100) === '#4d9bff', '100% = 原色');
ok(/^#([0-9a-f]{2})\1\1$/.test(satHex('#4d9bff', 0)), '0% = 灰（r=g=b） ' + satHex('#4d9bff', 0));
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const sat = h => { const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)); };
ok(Math.abs(sat(satHex('#4d9bff', 50)) / sat('#4d9bff') - 0.5) < 0.03, '50% 档：饱和度约是原来的一半 ' + satHex('#4d9bff', 50));
ok(parseColor('蓝/50') === satHex(PALETTE.蓝, 50) && parseColor('#ff9636/25') === satHex('#ff9636', 25), 'parseColor 认「名/百分比」和「#hex/百分比」');
ok(parseColor('蓝/100') === PALETTE.蓝 && parseColor('不存在/50') === null, '/100 = 原色；底色认不出 → null');

console.log(`colors: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
