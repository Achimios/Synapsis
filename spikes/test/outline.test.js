// >v<✅自检-核心-纯 Node：解析/往返/投影/聚合/编辑/布局
// node test/outline.test.js
import { parseOutline, toOutline, projectView, breadcrumb, exportForLLM, withEdge, withNode, autoLayout, ROOT } from '../src/outline.js';
import { SAMPLE } from '../src/sample.js';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };

const g = parseOutline(SAMPLE);
ok(g.errors.length === 0, '样例无错误 ' + JSON.stringify(g.errors));
ok(g.nodes.get('游戏AI/感知/敌方观察').status === 'done', '状态解析');
ok(g.edges.some(e => e.from === '游戏AI/感知/敌方观察' && e.to === '游戏AI/记忆与人格/短期记忆'), '跨分组按名称解析');
// 往返：toOutline 再 parse 得到同一结构（必须相等的量）
const g2 = parseOutline(toOutline(g));
ok(JSON.stringify([...g2.nodes.keys()]) === JSON.stringify([...g.nodes.keys()]), '往返节点一致');
ok(JSON.stringify(g2.edges.map(e => e.id).sort()) === JSON.stringify(g.edges.map(e => e.id).sort()), '往返边一致');

// 投影：顶层只见 3 个；游戏AI→外显 没有边
const top = projectView(g, ROOT);
ok(top.nodes.length === 3, '顶层 3 个节点');
// 游戏AI 内：感知→决策 聚合（场景大局观、队友 两条）
const ai = projectView(g, '游戏AI');
const pd = ai.edges.find(e => e.from === '游戏AI/感知' && e.to === '游戏AI/决策');
ok(pd && pd.count === 2, '感知→决策 聚合 2 条, got ' + (pd && pd.count));
ok(!ai.edges.some(e => e.from === e.to), '组内边不画自环');
// 行动内：自身传感器在范围外 → portal
const act = projectView(g, '游戏AI/行动');
ok(act.portals.some(p => p.target === '游戏AI/感知/自身传感器'), '范围外端点变 portal');
// 决策空间出度（行为树）在 决策 范围内也是 portal
ok(breadcrumb(g, '游戏AI/行动').map(b => b.label).join('>') === '根>游戏AI>行动', '面包屑');

// 错误
const bad = parseOutline('A -> 不存在\nA');
ok(bad.errors.some(e => e.msg.includes('找不到')) && bad.errors.some(e => e.msg.includes('重名')), '报错：缺目标/重名');

const txt = exportForLLM(g, '游戏AI');
ok(txt.includes('[游戏AI/决策/决策空间]') && txt.includes('输入(←)'), 'LLM 导出含 id 与入边');
// 画布编辑 → 文本 → 再解析
const t1 = withEdge(g, '游戏AI/兜底', '外显/对话');
const g3 = parseOutline(t1);
ok(g3.errors.length === 0 && g3.edges.some(e => e.from === '游戏AI/兜底' && e.to === '外显/对话'), 'withEdge 往返 ' + JSON.stringify(g3.errors));
ok(withEdge(g, '外显', '外显') === null, '自环拒绝');
const r = withNode(g, '游戏AI/决策', '游戏AI/决策/决策空间');
const g4 = parseOutline(r.text);
ok(g4.nodes.has(r.id) && g4.nodes.get('游戏AI/决策').children[1] === r.id, 'withNode 插入位置');
const r2 = withNode(g4, '游戏AI/决策');
ok(r2.id.endsWith('新节点2'), '新节点不重名');
const lay = autoLayout(ai, {});
ok(lay['游戏AI/感知'].x < lay['游戏AI/决策'].x && lay['游戏AI/决策'].x < lay['游戏AI/行动'].x, '分层布局 感知<决策<行动');
console.log(`outline: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
