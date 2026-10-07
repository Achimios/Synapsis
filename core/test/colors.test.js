// >v<✅自检-节点配色-关键词认色、最上层关键词优先、顶层轮色、color: 覆盖并往下继承
// node core/test/colors.test.js
import { colorMap, parseColor, PALETTE } from '../colors.js';
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

console.log(`colors: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
