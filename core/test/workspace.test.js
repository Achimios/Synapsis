// >v<✅自检-工作区-临时目录里跑：大纲→文件→大纲往返、保留正文/边标签、改名搬文件、删除进 _过期的
// node core/test/workspace.test.js
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspace, saveOutline, workspaceOutline, parseFrontmatter, serializeNode, setNodeMeta, checkWorkspace, saveLayout, saveAsset, saveView, loadView, listTree, DIR } from '../workspace.js';
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
    // 视图记忆
    saveView(r2, { scope: 'C', viewports: { C: { x: 1, y: 2, zoom: 0.5 } } });
    saveView(r2, { leftHidden: true });
    const v = loadView(r2);
    ok(v.scope === 'C' && v.viewports.C.zoom === 0.5 && v.leftHidden === true, '视图记忆合并写入 .synapsis/view.json');
    ok(existsSync(join(r2, '.synapsis', '.gitignore')), '.synapsis/ 自带 gitignore');
    ok(listTree(r2).tree.some(t => t.name === DIR) && !listTree(r2).tree.some(t => t.name === '.synapsis'), '文件树含 __synapsis、不含 .synapsis');
  } finally { rmSync(r2, { recursive: true, force: true }); }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`workspace: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
