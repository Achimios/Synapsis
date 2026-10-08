// >v<✅自检-工作区-临时目录里跑：大纲→文件→大纲往返、保留正文/边标签、改名搬文件、删除进 _过期的
// node core/test/workspace.test.js
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspace, saveOutline, workspaceOutline, parseFrontmatter, serializeNode, setNodeMeta, checkWorkspace, saveLayout, saveAsset, saveLooseImage, removeLooseImage, saveView, loadView, listTree, scanAnchors, anchorMatches, restoreRemoved, groupStatus, pasteNodes, setNodeBody, ensureColorWords, linkNodes, moveNodes, movePic, grepProject, DIR } from '../workspace.js';
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
  ok(!('游戏AI/感知/敌方观察' in loadWorkspace(root).layout), '改名后旧 id 的坐标不留');
  { // 删掉再写回（撤销删除 / 历史栏回去）→ 卡片回原位：删掉的节点坐标留着
    const before = workspaceOutline(loadWorkspace(root));
    saveOutline(root, before.split('\n').filter(l => !l.trim().replace(/^\S*[✅◐○❌]\s*/u, '').startsWith('敌人观察')).join('\n'));
    const gone = !loadWorkspace(root).graph.nodes.has('游戏AI/感知/敌人观察');
    saveOutline(root, before);
    ok(gone && loadWorkspace(root).layout['游戏AI/感知/敌人观察']?.x === 11, '删掉再写回 → 坐标还是原来的');
  }

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
    // 搜文件内容（左栏「文件」页勾「内容」）
    mkdirSync(join(r2, 'docs')); writeFileSync(join(r2, 'docs', '笔记.md'), '第一行\n这里讲 Rigidbody 的阻尼\n别的\n'); writeFileSync(join(r2, 'bin.dat'), Buffer.from([0, 1, 2, 82, 105, 103, 105, 100]));
    mkdirSync(join(r2, 'node_modules')); writeFileSync(join(r2, 'node_modules', 'x.md'), 'rigidbody 阻尼');
    const g1 = grepProject(r2, 'rigidbody 阻尼');
    ok(g1.hits.length === 1 && g1.hits[0].path === 'docs/笔记.md' && g1.hits[0].line === 2 && g1.hits[0].text.includes('Rigidbody'), '搜内容：不分大小写、几个词同一行、带行号；跳过 node_modules ' + JSON.stringify(g1.hits));
    ok(grepProject(r2, 'Rigid').hits.every(h => h.path !== 'bin.dat') && grepProject(r2, '').hits.length === 0, '搜内容：二进制不搜、空词不搜');
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
    ok(!loadWorkspace(r3).graph.nodes.has('组') && rep.restore.length === 1 && rep.removed.length === 1, '删整个分组 = 文件夹作为一项进 _过期的/（不拆平）' + JSON.stringify(rep.removed));
    const gdir = join(r3, DIR, '_过期的', rep.removed[0].split(/[\\/]/).pop());
    ok(existsSync(join(gdir, '_node.md')) && existsSync(join(gdir, '甲.md')) && existsSync(join(gdir, '乙.md')) && readdirSync(gdir).some(n => n.startsWith('_pics')), '过期的里保持原来的层级（_node.md、甲、乙、图片文件夹都在里面）');
    ok(restoreRemoved(r3, [['../../外面.md', '组/甲.md']]).length === 0, 'restoreRemoved 只搬 _过期的/ 里的东西');
    const back = restoreRemoved(r3, rep.restore);
    saveOutline(r3, before);
    const g3 = loadWorkspace(r3).graph;
    ok(back.length === rep.restore.length && g3.nodes.get('组')?.meta.rate === '5 Hz' && g3.nodes.get('组/甲')?.meta.vec === '1, 2', '撤销删除：属性回来了');
    ok(g3.nodes.get('组/甲')?.body.includes('人写的正文') && g3.nodes.get('组/甲').pics.length === 1, '撤销删除：正文和图片回来了');
    ok(g3.edges.some(e => e.from === '组' && e.to === '别处'), '撤销删除：边回来了');
  } finally { rmSync(r3, { recursive: true, force: true }); }

  // 嵌套分组整棵删：只进一项；子孙有人被挪走时，被挪走的不跟着进去，其余照旧逐个文件
  const r3b = mkdtempSync(join(tmpdir(), 'syn-undo2-'));
  try {
    const nest = '外\n  中\n    内1\n    内2\n  旁\n留';
    saveOutline(r3b, nest);
    const rp = saveOutline(r3b, '留');
    ok(rp.removed.length === 1 && rp.restore.length === 1, '嵌套分组整棵删 → 只进一项（' + rp.removed.length + '）');
    restoreRemoved(r3b, rp.restore); saveOutline(r3b, nest);
    ok(['外', '外/中', '外/中/内1', '外/中/内2', '外/旁'].every(i => loadWorkspace(r3b).graph.nodes.has(i)) && readdirSync(join(r3b, DIR, '_过期的')).length === 0, '整棵撤销回来，层级完整，_过期的/ 里不留残渣');
    const rm = saveOutline(r3b, '留\n内1\n外\n  旁');
    const g3b = loadWorkspace(r3b).graph;
    ok(g3b.nodes.has('内1') && !g3b.nodes.has('外/中') && rm.removed.length >= 1 && !rm.removed.some(x => x.includes('内1')), '有子孙被挪走时不整夹带走，被挪走的节点还在 ' + JSON.stringify(rm.removed));
  } finally { rmSync(r3b, { recursive: true, force: true }); }

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
  // 实测快照：标 evidence=实测 时记下 code 文件的 hash；之后文件改了 check 给 info（只提示，不作废）
  const rEv = mkdtempSync(join(tmpdir(), 'syn-ev-'));
  try {
    saveOutline(rEv, '眼睛\n  ✅ 看见');
    mkdirSync(join(rEv, 'src'), { recursive: true });
    const src = join(rEv, 'src', 'eye.js');
    writeFileSync(src, 'export function see() {\r\n  return 1;\r\n}\r\n');
    const stale = () => checkWorkspace(loadWorkspace(rEv)).filter(i => i.where === '眼睛/看见' && i.msg.includes('改过'));
    setNodeMeta(rEv, '眼睛/看见', { code: 'src/eye.js#see', evidence: '实测' });
    const h0 = loadWorkspace(rEv).graph.nodes.get('眼睛/看见').meta.evidence_hash;
    ok(/^[0-9a-f]{10}$/.test(h0 || ''), '标 实测 → 记下 code 文件快照 ' + h0);
    ok(stale().length === 0, '文件没变 → 不提示');
    writeFileSync(src, 'export function see() {\n  return 1;\n}\n');
    ok(stale().length === 0, '只是 CRLF ⇄ LF（git 换行转换）→ 不算改过');
    setNodeMeta(rEv, '眼睛/看见', { rate: '5 Hz' });
    ok(loadWorkspace(rEv).graph.nodes.get('眼睛/看见').meta.evidence_hash === h0, '改别的属性不动快照');
    writeFileSync(src, 'export function see() {\n  return 2;\n}\n');
    ok(stale().length === 1 && stale()[0].level === 'info', '实测之后代码改过 → info 提示');
    ok(checkWorkspace(loadWorkspace(rEv)).every(i => i.level !== 'error'), '只提示，不报错、不作废（evidence 仍是 实测）');
    setNodeMeta(rEv, '眼睛/看见', { evidence: '实测' });
    ok(stale().length === 0, '重验后再标一次 实测 → 刷新快照，提示消失');
    setNodeMeta(rEv, '眼睛/看见', { evidence: '设计' });
    ok(loadWorkspace(rEv).graph.nodes.get('眼睛/看见').meta.evidence_hash === undefined, '不是 实测 → 快照删掉');
    writeFileSync(src, 'x');
    ok(stale().length === 0, '不是 实测 就不查');
    setNodeMeta(rEv, '眼睛/看见', { evidence: '实测', code: null });
    ok(loadWorkspace(rEv).graph.nodes.get('眼睛/看见').meta.evidence_hash === undefined, '没有 code → 没快照可记');
  } finally { rmSync(rEv, { recursive: true, force: true }); }
  // FK 读回 L2：代码里的 >v< ⇄ 节点的 anchor:，双向对照，只提示
  const rAn = mkdtempSync(join(tmpdir(), 'syn-anchor-'));
  try {
    saveOutline(rAn, '眼睛\n  ✅ 看见\n  ✅ 听见\n  ◐ 嗅\n  ❌ 旧的');
    mkdirSync(join(rAn, 'src'), { recursive: true });
    writeFileSync(join(rAn, 'src', 'a.js'), '// >v<👁️视觉-看见-主流程\nexport const a = 1;\n// >v<👁️视觉-边缘-没人认领的\n');
    writeFileSync(join(rAn, 'src', 'b.py'), '# >v<🔊听觉-听见-说明\n');
    writeFileSync(join(rAn, 'doc.md'), '讲解：// >v<📝文档-不算\n');
    writeFileSync(join(rAn, 'src', 'c.js'), "console.log('>v<'); // 字符串里的不算\n");
    const an = () => checkWorkspace(loadWorkspace(rAn)).filter(i => String(i.kind || '').startsWith('anchor'));
    ok(scanAnchors(rAn).length === 3, '只认代码文件里「注释符 + >v<」开头的行（md / 字符串不算）');
    ok(an().length === 0, '图里没人写 anchor → 完全不吭声（不逐条报孤儿，也不提示）');
    setNodeMeta(rAn, '眼睛/看见', { anchor: '👁️视觉-看见' });
    setNodeMeta(rAn, '眼睛/听见', { anchor: '>v<🔊听觉' });
    let r = an();
    ok(!r.some(i => i.kind === 'anchor-missing'), '节点说有、代码里也有 → 不报（含只写大标题 / 带 >v< 前缀）');
    const orphan = r.filter(i => i.kind === 'anchor-orphan');
    ok(orphan.length === 1 && orphan[0].where === 'src/a.js:3' && orphan[0].level === 'info', '代码里有、图里没节点 → 孤儿，info，指到文件:行');
    setNodeMeta(rAn, '眼睛/嗅', { anchor: '👃嗅觉-没写过' });
    r = an();
    const miss = r.filter(i => i.kind === 'anchor-missing');
    ok(miss.length === 1 && miss[0].where === '眼睛/嗅' && miss[0].level === 'warn' && miss[0].msg.includes('partial'), '节点说有、代码找不到 → warn，带上图里标的状态（主张和观测并排）');
    setNodeMeta(rAn, '眼睛/旧的', { anchor: '👃嗅觉-旧' });
    ok(an().filter(i => i.kind === 'anchor-missing').length === 1, '弃用的节点不查');
    ok(loadWorkspace(rAn).graph.nodes.get('眼睛/嗅').status === 'partial', '只提示：status 没被改');
    ok(checkWorkspace(loadWorkspace(rAn)).filter(i => i.level === 'error').length === 0, '不产生 error');
    ok(anchorMatches('🔊听觉-听见', '🔊听觉-听见-说明') && !anchorMatches('🔊听', '🔊听觉-听见'), '前缀要落在分隔符上，不会半个词命中');
  } finally { rmSync(rAn, { recursive: true, force: true }); }
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

  // 图片归属：散图 → 节点的图；节点的图 → 散图（坐标键一并去掉）
  const r7 = mkdtempSync(join(tmpdir(), 'syn-pic-'));
  try {
    saveOutline(r7, '组\n  甲\n乙');
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const lp = saveLooseImage(r7, '', PNG).path;
    saveLayout(r7, { ['@pic:' + lp]: { x: 5, y: 5 } });
    const a = movePic(r7, lp, '乙');
    let w7 = loadWorkspace(r7);
    ok(/^_pics_乙\//.test(a.path) && existsSync(join(r7, DIR, a.path)) && !existsSync(join(r7, DIR, lp)) && !w7.layout['@pic:' + lp], '散图拖到卡片 → 进 _pics_乙/，坐标键去掉 ' + a.path);
    const b = movePic(r7, a.path, null, '组');
    ok(/^组\/_pics\//.test(b.path) && existsSync(join(r7, DIR, b.path)), '节点的图拖到「组」页空白 → 变成组页的散图 ' + b.path);
    let bad = ''; try { movePic(r7, '../x.png', '乙'); } catch (e) { bad = e.message; }
    ok(/不是图片/.test(bad), '路径越界 → 拒绝');
  } finally { rmSync(r7, { recursive: true, force: true }); }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`workspace: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
