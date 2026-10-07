// >v<✅自检-工作区-临时目录里跑：大纲→文件→大纲往返、保留正文/边标签、改名搬文件、删除进 _过期的
// node core/test/workspace.test.js
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspace, saveOutline, workspaceOutline, parseFrontmatter, serializeNode, setNodeMeta, checkWorkspace, saveLayout, saveAsset, saveLooseImage, removeLooseImage, saveView, loadView, listTree, restoreRemoved, groupStatus, pasteNodes, setNodeBody, ensureColorWords, linkNodes, moveNodes, DIR } from '../workspace.js';
import { scaffoldPlan, scaffoldWrite } from '../scaffold.js';
import { SAMPLE } from '../../app/src/sample.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const root = mkdtempSync(join(tmpdir(), 'syn-ws-'));
const B = p => join(root, DIR, p);

try {
  // frontmatter 往返
  const fm = serializeNode({ status: 'done', order: '2', rate: '5 Hz', to: ['决策空间 | 局势', 'X'] }, '正文第一行\n第二行');
  const back = parseFrontmatter(fm);
  ok(back.meta.status === 'done' && back.meta.to.length === 2 && back.meta.rate === '5 Hz' && back.body.startsWith('正文第一行'), 'frontmatter 往返 ' + JSON.stringify(back));

  // 大纲 → 文件 → 大纲（必须相等的量）
  saveOutline(root, SAMPLE);
  ok(existsSync(B('游戏AI/_node.md')) && existsSync(B('游戏AI/感知/敌方观察.md')), '文件夹 = 层级：分组用 _node.md、叶子用 名字.md');
  const nn = B('游戏AI/兜底/NN／LLM 生成不存在的树枝.md');
  ok(existsSync(nn) && parseFrontmatter(readFileSync(nn, 'utf8')).meta.label === 'NN/LLM 生成不存在的树枝', '名字带 / → 文件名全角、原名进 label（2026-10-07 往返自检抓到）');
  let ws = loadWorkspace(root);
  ok(ws.graph.errors.length === 0, '读回无错误 ' + JSON.stringify(ws.graph.errors));
  ok(workspaceOutline(ws) === SAMPLE.split('\n').map(l => l.replace(/\s+$/, '')).join('\n'), '大纲往返逐字相等');

  // 人在文件里写的正文和边标签，改大纲后要保留
  const f = B('游戏AI/感知/敌方观察.md');
  const p = parseFrontmatter(readFileSync(f, 'utf8'));
  p.meta.to = p.meta.to.map(t => t.startsWith('短期记忆') ? '短期记忆 | 观测 | 离散' : t);
  p.meta.rate = '2–20 Hz';
  writeFileSync(f, serializeNode(p.meta, '人写的说明：向量集。'));
  saveOutline(root, workspaceOutline(loadWorkspace(root)).replace('✅ 场景大局观', '◐ 场景大局观'));
  const p2 = parseFrontmatter(readFileSync(f, 'utf8'));
  ok(p2.body.includes('人写的说明') && p2.meta.rate === '2–20 Hz', '改别处后正文/其余属性保留');
  ok(p2.meta.to.includes('短期记忆 | 观测 | 离散'), '边标签保留 ' + JSON.stringify(p2.meta.to));
  ok(parseFrontmatter(readFileSync(B('游戏AI/感知/场景大局观.md'), 'utf8')).meta.status === 'partial', '状态改动写回');

  // 改名：同父下 1:1 → 搬文件，正文跟着走；布局跟着走
  saveLayout(root, { '游戏AI/感知/敌方观察': { x: 11, y: 22 } });
  saveOutline(root, workspaceOutline(loadWorkspace(root)).replace('敌方观察 ->', '敌人观察 ->'));
  ok(!existsSync(f) && existsSync(B('游戏AI/感知/敌人观察.md')), '改名 = 搬文件');
  ok(readFileSync(B('游戏AI/感知/敌人观察.md'), 'utf8').includes('人写的说明'), '改名后正文还在');
  ok(loadWorkspace(root).layout['游戏AI/感知/敌人观察']?.x === 11, '改名后坐标跟着走');

  // 分组改名：子节点整体搬
  saveOutline(root, workspaceOutline(loadWorkspace(root)).replace(/^  感知$/m, '  观测'));
  ok(existsSync(B('游戏AI/观测/敌人观察.md')) && !existsSync(B('游戏AI/感知')), '分组改名 → 整个文件夹搬过去、旧文件夹清掉');
  ws = loadWorkspace(root);
  ok(ws.graph.errors.length === 0 && ws.graph.edges.some(e => e.from === '游戏AI/观测/敌人观察'), '分组改名后边仍解析');

  // 叶子 → 分组（加子节点）
  saveOutline(root, workspaceOutline(loadWorkspace(root)).replace(/^(    ✅ 决策空间.*)$/m, '$1\n      ○ 效用表'));
  ok(existsSync(B('游戏AI/决策/决策空间/_node.md')) && existsSync(B('游戏AI/决策/决策空间/效用表.md')) && !existsSync(B('游戏AI/决策/决策空间.md')), '叶子加子节点 → 变文件夹');

  // 删除 → _过期的/，不真删
  saveOutline(root, workspaceOutline(loadWorkspace(root)).replace(/^\s+○ 地图分区\n?/m, ''));
  ok(!existsSync(B('游戏设计规划/地图分区.md')), '删除的节点不在原处');
  ok(readdirSync(B('_过期的')).some(n => n.includes('地图分区')), '删除的节点进了 _过期的/');

  // CRLF（git checkout 后）不算改动，不重写
  const crlfFile = B('游戏AI/决策/_node.md');
  writeFileSync(crlfFile, readFileSync(crlfFile, 'utf8').replace(/\n/g, '\r\n'));
  const r0 = saveOutline(root, workspaceOutline(loadWorkspace(root)));
  ok(r0.written.length === 0, '原样写回 = 0 个文件变动（CRLF 也不算）' + JSON.stringify(r0.written));

  // 大纲有错就不写
  const r = saveOutline(root, 'A -> 不存在');
  ok(r.ok === false && existsSync(B('游戏AI/_node.md')), '大纲有错 → 拒绝写入');

  // setNodeMeta 与 check
  setNodeMeta(root, '游戏AI/决策/决策空间', { code: 'tac.js#think' });
  const issues = checkWorkspace(loadWorkspace(root));
  ok(issues.some(i => i.msg.includes('code 指向不存在')), 'check 抓到 code 指向不存在的文件');
  ok(parseFrontmatter(readFileSync(B('游戏AI/决策/决策空间/_node.md'), 'utf8')).meta.status === 'done', 'setNodeMeta 不丢 status');

  // 图片：_pics_名字/ 紧挨节点 md；改名 / 叶子变分组 / 删除 时跟着走
  const r2 = mkdtempSync(join(tmpdir(), 'syn-pics-'));
  try {
    const P = p => join(r2, DIR, p);
    const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    saveOutline(r2, 'A\n  叶子\nB');
    const rel = saveAsset(r2, 'A/叶子', PNG);
    ok(rel.startsWith('A/_pics_叶子/') && existsSync(P(rel)), '贴图存进 A/_pics_叶子/ ' + rel);
    ok(loadWorkspace(r2).graph.nodes.get('A/叶子').pics[0] === rel, 'loadWorkspace 列出 pics');
    ok(!loadWorkspace(r2).graph.nodes.has('A/_pics_叶子'), '_pics_ 文件夹不是节点');
    saveOutline(r2, 'A\n  新名\nB');
    ok(existsSync(P('A/_pics_新名')) && !existsSync(P('A/_pics_叶子')), '改名 → 图片文件夹跟着改名');
    saveOutline(r2, 'A\n  新名\n    孙\nB');
    ok(existsSync(P('A/新名/_pics_新名')) && loadWorkspace(r2).graph.nodes.get('A/新名').pics.length === 1, '叶子变分组 → 图片文件夹搬进自己的文件夹');
    saveAsset(r2, 'B', PNG);
    saveOutline(r2, 'A\n  新名\n    孙');
    ok(!existsSync(P('_pics_B')) && readdirSync(P('_过期的')).some(n => n.endsWith('_pics')), '删除节点 → 图片文件夹一起进 _过期的/');
    saveOutline(r2, 'C\n  新名\n    孙');
    ok(existsSync(P('C/新名/_pics_新名')) && !existsSync(P('A')), '父节点改名 → 子节点的图片跟着走、旧目录清掉');
    // 散图：页的 _pics/；分组改名跟着走、坐标键跟着改；叶子页归给叶子自己；删 = 进 _过期的/
    const l0 = saveLooseImage(r2, '', PNG);
    ok(l0.path.startsWith('_pics/') && !l0.node && loadWorkspace(r2).loose[''][0] === l0.path, '根页散图 → __synapsis/_pics/ ' + l0.path);
    const l1 = saveLooseImage(r2, 'C', PNG);
    ok(l1.path.startsWith('C/_pics/'), '分组页散图 → C/_pics/ ' + l1.path);
    saveLayout(r2, { ['@pic:' + l1.path]: { x: 10, y: 20, w: 300 } });
    saveOutline(r2, 'D\n  新名\n    孙');
    const moved1 = l1.path.replace('C/', 'D/'), lay1 = loadWorkspace(r2).layout;
    ok(existsSync(P(moved1)) && !existsSync(P('C')), '分组改名 → 散图文件夹跟着搬 ' + moved1);
    ok(lay1['@pic:' + moved1]?.w === 300 && !lay1['@pic:' + l1.path], '散图坐标键跟着改（宽度保留）');
    const l2 = saveLooseImage(r2, 'D/新名/孙', PNG);
    ok(l2.node === 'D/新名/孙' && l2.path.includes('_pics_孙/'), '叶子页没有文件夹 → 归给叶子自己');
    removeLooseImage(r2, l0.path);
    ok(!existsSync(P(l0.path)) && readdirSync(P('_过期的')).some(n => n.includes('散图')), '删散图 → 进 _过期的/');
    let threw = false; try { removeLooseImage(r2, 'D/新名/_node.md'); } catch { threw = true; }
    ok(threw, '删散图接口拒绝非散图路径');
    // 视图记忆
    saveView(r2, { scope: 'C', viewports: { C: { x: 1, y: 2, zoom: 0.5 } } });
    saveView(r2, { leftHidden: true });
    const v = loadView(r2);
    ok(v.scope === 'C' && v.viewports.C.zoom === 0.5 && v.leftHidden === true, '视图记忆合并写入 .synapsis/view.json');
    ok(existsSync(join(r2, '.synapsis', '.gitignore')), '.synapsis/ 自带 gitignore');
    ok(listTree(r2).tree.some(t => t.name === DIR) && !listTree(r2).tree.some(t => t.name === '.synapsis'), '文件树含 __synapsis、不含 .synapsis');
  } finally { rmSync(r2, { recursive: true, force: true }); }

  // 撤销删除：删一个带正文 / 属性 / 图片的分组 → restoreRemoved + 写回原大纲 → 正文、属性、图片、子节点都回来
  const r3 = mkdtempSync(join(tmpdir(), 'syn-undo-'));
  try {
    const before = '组 -> 别处\n  甲\n  乙\n别处';
    saveOutline(r3, before);
    setNodeMeta(r3, '组', { rate: '5 Hz' }); setNodeMeta(r3, '组/甲', { vec: '1, 2' });
    writeFileSync(join(r3, DIR, '组', '甲.md'), readFileSync(join(r3, DIR, '组', '甲.md'), 'utf8') + '\n人写的正文\n');
    saveAsset(r3, '组/甲', 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'));
    const rep = saveOutline(r3, '别处');
    ok(!loadWorkspace(r3).graph.nodes.has('组') && rep.restore.length >= 4, '删除报告带上 restore 对照 ' + rep.restore.length);
    ok(restoreRemoved(r3, [['../../外面.md', '组/甲.md']]).length === 0, 'restoreRemoved 只搬 _过期的/ 里的东西');
    const back = restoreRemoved(r3, rep.restore);
    saveOutline(r3, before);
    const g3 = loadWorkspace(r3).graph;
    ok(back.length === rep.restore.length && g3.nodes.get('组')?.meta.rate === '5 Hz' && g3.nodes.get('组/甲')?.meta.vec === '1, 2', '撤销删除：属性回来了');
    ok(g3.nodes.get('组/甲')?.body.includes('人写的正文') && g3.nodes.get('组/甲').pics.length === 1, '撤销删除：正文和图片回来了');
    ok(g3.edges.some(e => e.from === '组' && e.to === '别处'), '撤销删除：边回来了');
  } finally { rmSync(r3, { recursive: true, force: true }); }

  // 跨父移动：大纲里把 队长（带正文、属性、子节点）挪进 小队 → 不丢东西、不进 _过期的/
  const r5 = mkdtempSync(join(tmpdir(), 'syn-move-'));
  try {
    saveOutline(r5, '小队\n  步枪兵\n队长 -> 步枪兵\n  口令\n精英');
    setNodeMeta(r5, '队长', { rate: '1 Hz' });
    writeFileSync(join(r5, DIR, '队长', '_node.md'), readFileSync(join(r5, DIR, '队长', '_node.md'), 'utf8') + '\n队长的正文\n');
    const rep5 = saveOutline(r5, '小队\n  步枪兵\n  队长 -> 步枪兵\n    口令\n精英');
    const g5 = loadWorkspace(r5).graph, cap = g5.nodes.get('小队/队长');
    ok(cap && cap.meta.rate === '1 Hz' && cap.body.includes('队长的正文') && g5.nodes.has('小队/队长/口令'), '跨父移动：正文、属性、子节点跟着走');
    ok(!rep5.removed.length && !g5.nodes.has('队长'), '跨父移动：没有东西进 _过期的/ ' + rep5.removed);
    ok(g5.edges.some(e => e.from === '小队/队长' && e.to === '小队/步枪兵'), '跨父移动：边还在');
  } finally { rmSync(r5, { recursive: true, force: true }); }

  // 粘贴节点：子孙、状态、内部边、属性、正文、节点图片都跟着拷；同名加「 2」；外部的边不拷；原件不动（👤 2026-10-08）
  const rPaste = mkdtempSync(join(tmpdir(), 'syn-paste-'));
  try {
    saveOutline(rPaste, '小队\n  ✅ 队长 -> 斥候, 外人\n  斥候\n外人\n目标页\n  队长');
    setNodeMeta(rPaste, '小队/队长', { 兵种: '精英', color: '粉' });
    setNodeBody(rPaste, '小队/队长', '\n队长的正文\n');
    saveAsset(rPaste, '小队/队长', 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64'));
    const before = readFileSync(join(rPaste, DIR, '小队', '队长.md'), 'utf8');
    const rep = pasteNodes(rPaste, ['小队/队长', '小队/斥候', '小队'], '目标页');
    const g = loadWorkspace(rPaste).graph;
    ok(rep.roots.join() === '目标页/小队' && g.nodes.has('目标页/小队/队长') && g.nodes.has('目标页/小队/斥候'), '选了分组和它的子节点 → 只复制分组一次（含子孙） ' + rep.roots);
    const cap = g.nodes.get('目标页/小队/队长');
    ok(cap.status === 'done' && cap.meta.兵种 === '精英' && cap.meta.color === '粉' && cap.body.includes('队长的正文'), '状态、属性、正文跟着拷');
    ok(g.edges.some(e => e.from === '目标页/小队/队长' && e.to === '目标页/小队/斥候') && !g.edges.some(e => e.from === '目标页/小队/队长' && e.to === '外人'), '内部边跟着拷（指向新斥候），外部边不拷');
    ok(existsSync(join(rPaste, DIR, '目标页', '小队', '_pics_队长')) && readdirSync(join(rPaste, DIR, '目标页', '小队', '_pics_队长')).length === 1, '节点图片跟着拷');
    { const after = readFileSync(join(rPaste, DIR, '小队', '队长.md'), 'utf8'), norm = s => s.replace(/\n+/g, '\n'); ok(norm(after) === norm(before) && g.nodes.has('小队/队长'), '原件不动（空行数不算） ' + JSON.stringify([before, after])); }
    const rep2 = pasteNodes(rPaste, ['小队/队长'], '目标页');
    ok(rep2.roots.join() === '目标页/队长 2', '同名（目标页里已有 队长）→ 加「 2」 ' + rep2.roots);
  } finally { rmSync(rPaste, { recursive: true, force: true }); }
  // 连线带类型（界面拖调节口）：没边先加边，再写 kind
  const rLink = mkdtempSync(join(tmpdir(), 'syn-link-'));
  try {
    saveOutline(rLink, '观察属性\n观察空间');
    const lr = linkNodes(rLink, '观察属性', '观察空间', '', '调节');
    const e = loadWorkspace(rLink).graph.edges.find(x => x.from === '观察属性' && x.to === '观察空间');
    ok(e && e.kind === '调节' && lr.outline.includes('观察属性 -> 观察空间'), 'linkNodes：加边 + kind 调节 ' + JSON.stringify(e));
    linkNodes(rLink, '观察属性', '观察空间', '', '离散');
    ok(loadWorkspace(rLink).graph.edges.filter(x => x.from === '观察属性').length === 1 && loadWorkspace(rLink).graph.edges[0].kind === '离散', '已有的边只改类型，不重复加');
  } finally { rmSync(rLink, { recursive: true, force: true }); }
  // 配色词表：没有文件 = null（用默认）；ensureColorWords 按默认建；写坏的行 check 报 warn
  const rWords = mkdtempSync(join(tmpdir(), 'syn-words-'));
  try {
    saveOutline(rWords, '甲');
    ok(loadWorkspace(rWords).colorWords === null, '没有 _配色.md → colorWords = null');
    const wf = ensureColorWords(rWords);
    ok(existsSync(wf) && loadWorkspace(rWords).colorWords.includes('- 蓝:'), 'ensureColorWords 按默认词表建一份');
    writeFileSync(wf, '- 蓝: 甲\n- 不是颜色: 乙\n');
    ok(checkWorkspace(loadWorkspace(rWords)).some(i => i.where === '_配色.md' && i.msg.includes('不是颜色')), 'check 报词表里认不出的行');
  } finally { rmSync(rWords, { recursive: true, force: true }); }
  // 弃用 ❌：frontmatter status: dropped 往返；分组汇总不算它；check 跳过它和子孙（👤 2026-10-08）
  const rDrop = mkdtempSync(join(tmpdir(), 'syn-drop-'));
  try {
    saveOutline(rDrop, '组\n  ✅ 做完\n  ❌ 不做了\n    孙子\n  ❌ 废叶');
    const wDrop = loadWorkspace(rDrop);
    ok(/^status: dropped$/m.test(readFileSync(join(rDrop, DIR, '组', '不做了', '_node.md'), 'utf8')) && workspaceOutline(wDrop).includes('❌ 不做了'), '弃用写成 status: dropped，读回来还是 ❌');
    ok(groupStatus(wDrop.graph, '组') === 'done', '分组汇总不算弃用的（只剩 ✅ → ✅）');
    const isDrop = checkWorkspace(wDrop);
    ok(!isDrop.some(i => i.where.startsWith('组/不做了') || i.where === '组/废叶'), 'check 跳过弃用节点和它的子孙 ' + JSON.stringify(isDrop));
  } finally { rmSync(rDrop, { recursive: true, force: true }); }
  // 项目骨架：检测已有 / 同类，只写勾上且不存在的
  const r4 = mkdtempSync(join(tmpdir(), 'syn-scaffold-'));
  try {
    writeFileSync(join(r4, '_TODO.md'), '我自己的待办');
    writeFileSync(join(r4, '_DevProgress.md'), '旧英文名的进度');
    const items = scaffoldPlan(r4);
    ok(items.find(i => i.rel === '_TODO.md')?.exists && items.find(i => i.rel === '_开发进度.md')?.alike.includes('_DevProgress.md'), '骨架检测：同名已存在 / 同类旧英文名');
    const made = scaffoldWrite(r4, ['_TODO.md', '_LEARNINGS.md']);
    ok(made.join() === '_LEARNINGS.md' && readFileSync(join(r4, '_TODO.md'), 'utf8') === '我自己的待办' && !existsSync(join(r4, '_开发进度.md')), '骨架只写勾上且不存在的，不覆盖');
  } finally { rmSync(r4, { recursive: true, force: true }); }

  // 移动节点（拖进节点 / 剪切粘贴）：别处有同名「备注」也不丢正文；子孙、连线、坐标跟着走；不能挪进自己里面；目标重名拒绝
  const r6 = mkdtempSync(join(tmpdir(), 'syn-mv-'));
  try {
    saveOutline(r6, '甲\n  备注 -> 乙\n  子\n乙\n  备注\n丙');
    setNodeBody(r6, '甲/备注', '甲的备注正文');
    setNodeMeta(r6, '甲/备注', { rate: '3 Hz' });
    saveLayout(r6, { '甲/备注': { x: 11, y: 22 } });
    let threw = '';
    try { moveNodes(r6, ['甲/备注'], '乙'); } catch (e) { threw = e.message; }
    ok(/已经有「备注」/.test(threw), '目标里重名 → 拒绝 ' + threw);
    try { moveNodes(r6, ['甲'], '甲/子'); } catch (e) { threw = e.message; }
    ok(/自己里面/.test(threw), '挪进自己的子孙 → 拒绝');
    const mv = moveNodes(r6, ['甲/备注'], '丙');
    const w6 = loadWorkspace(r6), n6 = w6.graph.nodes.get('丙/备注');
    ok(n6 && n6.body.includes('甲的备注正文') && n6.meta.rate === '3 Hz' && !mv.removed.length, '别处有同名「备注」也认对：正文、属性跟着走，没东西进 _过期的/ ' + JSON.stringify(mv.removed));
    ok(w6.graph.nodes.get('乙/备注') && !w6.graph.nodes.has('甲/备注'), '另一个同名的 乙/备注 不受影响');
    ok(w6.graph.edges.some(e => e.from === '丙/备注' && e.to === '乙'), '连线跟着走');
    ok(w6.layout['丙/备注']?.x === 11 && mv.roots.join() === '丙/备注', '坐标跟着走，返回新 id');
    moveNodes(r6, ['甲'], '丙');
    ok(loadWorkspace(r6).graph.nodes.has('丙/甲/子'), '分组连同子孙一起挪');
  } finally { rmSync(r6, { recursive: true, force: true }); }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`workspace: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
