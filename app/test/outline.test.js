// >v<✅自检-核心-纯 Node：解析/往返/投影/聚合/编辑/布局
// node test/outline.test.js
import { parseOutline, toOutline, projectView, breadcrumb, exportForLLM, withEdge, withNode, autoLayout, withoutNode, withStatus, withLabel, isDropped, ROOT } from '../../core/outline.js';
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
const lay2 = autoLayout({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [], portals: [] }, { a: { x: 0, y: 0 } });
ok(!(lay2.b.x === 0 && lay2.b.y === 0), '自动布局避开已摆好的节点 ' + JSON.stringify(lay2));
const gd = parseOutline(withoutNode(g, '游戏AI/感知'));
ok(!gd.nodes.has('游戏AI/感知') && !gd.nodes.has('游戏AI/感知/敌方观察') && gd.errors.length === 0, '删除分组 = 连子节点一起删，悬空边一起去掉 ' + JSON.stringify(gd.errors));
ok(parseOutline(withStatus(g, '外显/对话', 'done')).nodes.get('外显/对话').status === 'done', '改状态');
const gl = parseOutline(withLabel(g, '游戏AI/决策/决策空间', '战术决策'));
ok(gl.nodes.has('游戏AI/决策/战术决策') && gl.errors.length === 0 && gl.edges.some(e => e.to === '游戏AI/决策/战术决策'), '改名后指向它的边跟着改 ' + JSON.stringify(gl.errors));
ok(withLabel(g, '游戏AI/感知', '决策') === null, '改名撞同级 → 拒绝');
// 弃用 ❌（👤 2026-10-08）：带变体选择符的 ❌️ 也认；往返不变；子孙算弃用
const gx = parseOutline('❌ 旧方案\n  细节\n❌\uFE0F 另一个\n○ 留着');
ok(gx.nodes.get('旧方案').status === 'dropped' && gx.nodes.get('另一个').status === 'dropped' && gx.nodes.has('另一个') && gx.errors.length === 0, '❌ / ❌️ = dropped，名字里不留变体符 ' + [...gx.nodes.keys()]);
ok(toOutline(gx).includes('❌ 旧方案') && parseOutline(toOutline(gx)).nodes.get('另一个').status === 'dropped', '弃用往返');
ok(isDropped(gx, '旧方案/细节') && !isDropped(gx, '留着'), '弃用分组的子孙也算弃用');
// 分组原地展开成框（👤 2026-10-08）：框里的子节点可见、边直连不变传送门；框排在子节点前面
const vf = projectView(g, '游戏AI', new Set(['游戏AI/感知']));
ok(vf.nodes.findIndex(n => n.id === '游戏AI/感知') < vf.nodes.findIndex(n => n.id === '游戏AI/感知/敌方观察') && vf.parentOf.get('游戏AI/感知/敌方观察') === '游戏AI/感知', '框在子节点前，parentOf 记所在框');
ok(vf.edges.some(e => e.from === '游戏AI/感知/敌方观察' && e.to === '游戏AI/记忆与人格'), '框里的子节点直接连线（不再提升到分组）');
ok(!vf.parentOf.has('游戏AI/决策') && projectView(g, '游戏AI').parentOf.size === 0, '没展开的照旧');
console.log(`outline: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
