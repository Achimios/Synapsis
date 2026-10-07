// >v<✅自检-搜索-名字 / 属性 / 正文，多词，排序，大纲树过滤
// node core/test/search.test.js
import { searchNodes, filterTree } from '../search.js';
import { parseOutline } from '../outline.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const items = [
  { id: '内在/情绪空间', label: '情绪空间', path: '内在/情绪空间', meta: { axes: '恐惧, 焦虑' }, body: '' },
  { id: '内在/情绪空间/恐惧', label: '恐惧', path: '内在/情绪空间/恐惧', meta: { vec: '1, 0' }, body: '受伤时会推动撤退。' },
  { id: '决策/撤退效用', label: '撤退效用', path: '决策/撤退效用', meta: {}, body: '恐惧直接推动撤退（fearRetreat=3）。' },
  { id: '观测', label: '观测', path: '观测', meta: { rate: '10 Hz' }, body: '' },
];
let r = searchNodes(items, '恐惧');
ok(r[0].id === '内在/情绪空间/恐惧' && r[0].where === '名字', '名字完全相同排第一 ' + r.map(x => x.id));
ok(r.some(x => x.id === '内在/情绪空间' && x.where === '属性') && r.some(x => x.id === '决策/撤退效用' && x.where === '正文' && x.snippet.includes('恐惧直接推动')), '属性、正文也能搜到，带片段');
r = searchNodes(items, '撤退 恐惧');
ok(r.length === 2 && r.every(x => x.id !== '观测' && x.id !== '内在/情绪空间'), '多个词都要命中（可在不同地方） ' + r.map(x => x.id));
ok(searchNodes(items, '10 hz')[0]?.id === '观测', '不分大小写');
ok(searchNodes(items, '   ').length === 0 && searchNodes(items, '不存在的词').length === 0, '空查询 / 没命中 → 空');
ok(searchNodes(items, '内在')[0].where === '名字', '路径命中也算（算在名字那栏）');

const g = parseOutline('内在\n  情绪空间\n    恐惧\n决策\n  撤退效用');
const f = filterTree(g, '恐');
ok(f.hits.has('内在/情绪空间/恐惧') && f.keep.has('内在') && f.keep.has('内在/情绪空间') && !f.keep.has('决策'), '大纲树过滤：命中 + 祖先');
ok(filterTree(g, '') === null, '空过滤 = 不过滤');

console.log(`search: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
