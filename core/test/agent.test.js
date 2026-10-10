// >v<✅自检-AI指令-说明书 ↔ 校验器一一对应、动作校验、排版坐标、解析模型输出、执行（临时工作区）、问模型（假服务：重试 / 短记忆 / 日志）
// node core/test/agent.test.js —— 不碰真的 LM Studio
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkills, pageContext, parseReply, applyPlan, runAgent, loadChat, clearChat, systemPrompt, loosePrompt, isLoose, isQuestion, isFollowup, estimateContext, estTokens } from '../agent.js';
import { validateAction, planMoves, VALIDATORS } from '../plan.js';
import { saveOutline, loadWorkspace, workspaceOutline, DIR } from '../workspace.js';
import { parseOutline } from '../outline.js';
import { readAiLog } from '../ai.js';
import { knowledgeChunks, pickKnowledge } from '../knowledge.js';
import { KEYMAP } from '../keymap.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };

// 必须相等的量：每份说明书的 do 都有校验器，每个校验器都有说明书
const skills = loadSkills();
ok(skills.map(s => s.do).sort().join() === Object.keys(VALIDATORS).sort().join(), '说明书 ↔ 校验器一一对应 ' + skills.map(s => s.do));
ok(skills.every(s => s.args && s.body.includes('{"do":"' + s.do + '"')), '每份说明书都有参数说明和例子');
ok(systemPrompt(skills).includes('不能删除节点'), '系统提示词里写明不能删节点');

// 软件知识：同一份源（快捷键表 + AI 接入手册），按问题挑段
const kc = knowledgeChunks();
ok(KEYMAP.every(([g]) => kc.some(c => c.src === '快捷键·' + g)) && kc.some(c => c.src.startsWith('手册·')), '知识 = 快捷键表每一组 + 手册各节 ' + kc.length);
ok(pickKnowledge('怎么切白色主题')[0]?.src === '快捷键·界面', '「怎么切白色主题」→ 快捷键·界面');
ok(pickKnowledge('图片怎么放大')[0]?.src === '快捷键·图片' && pickKnowledge('CLI 怎么用')[0]?.src.startsWith('手册·'), '图片 → 快捷键·图片；CLI → 手册');
ok(pickKnowledge('有哪些快捷键').length === KEYMAP.length, '泛泛问快捷键 → 整张快捷键表');
ok(pickKnowledge('').length === 0 && pickKnowledge('怎么？').length === 0, '没有实词 → 不塞知识');
ok(pickKnowledge('怎么把节点放进另一个节点').reduce((s, c) => s + c.text.length, 0) <= 2400, '不超预算');

// 动作校验
const g = parseOutline('观测 -> 决策\n  敌方\n决策\n行动\n兜底');
const refs = new Map([['n1', '观测'], ['n2', '决策'], ['n3', '行动'], ['n4', '兜底'], ['n5', '观测/敌方']]);
const V = a => validateAction(a, { refs, graph: g, scope: '' });
ok(!V({ do: 'delete', ids: ['n1'] }).ok, '没有 delete 动作 → 拒绝');
ok(/不认识/.test(V({ do: 'select', ids: ['n9'] }).why), '编造的编号 → 拒绝');
ok(/不认识/.test(V({ do: 'select', ids: ['观测'] }).why), '拿名字当编号 → 拒绝');
ok(!V({ do: 'align', ids: ['n1'], edge: 'left' }).ok && !V({ do: 'align', ids: ['n1', 'n2'], edge: 'middle' }).ok, '对齐：少于 2 个 / edge 乱写 → 拒绝');
ok(V({ do: 'align', ids: ['n1', 'n2', 'n2'], edge: 'left' }).ids.join() === '观测,决策', '对齐：编号换成真 id 并去重');
ok(!V({ do: 'order', ids: ['n1', 'n5'] }).ok, '大纲排序：不同父节点 → 拒绝');
ok(!V({ do: 'create', label: '决策' }).ok && !V({ do: 'create', label: 'a -> b' }).ok, '新建：同级重名 / 名字带 -> → 拒绝');
ok(V({ do: 'link', from: 'n1', to: 'n2', kind: '调节' }).exists === true && !V({ do: 'link', from: 'n1', to: 'n1' }).ok, '连线：已有的线 = 改类型；自连 → 拒绝');
ok(!V({ do: 'unlink', from: 'n2', to: 'n3' }).ok, '删线：本来没有 → 拒绝');
ok(!V({ do: 'color', ids: ['n1'], color: '金' }).ok && V({ do: 'color', ids: ['n1'], color: 'auto' }).ok, '颜色：只认调色板 / auto');

// 排版
const boxes = { a: { x: 10, y: 0, w: 100, h: 30 }, b: { x: 50, y: 100, w: 60, h: 30 }, c: { x: 0, y: 200, w: 80, h: 40 } };
let m = planMoves([{ do: 'align', ids: ['a', 'b', 'c'], edge: 'left' }], boxes);
ok(m.a.x === 0 && m.b.x === 0 && m.c.x === 0 && m.b.y === 100, '左对齐：x 都 = 最左，y 不动');
m = planMoves([{ do: 'align', ids: ['a', 'b'], edge: 'right' }], boxes);
ok(m.a.x + 100 === m.b.x + 60 && m.a.x === 10, '右对齐：右边线对齐');
m = planMoves([{ do: 'arrange', ids: ['c', 'a', 'b'], as: 'row', gap: 20 }], boxes);
ok(m.c.x === 0 && m.a.x === 100 && m.b.x === 220 && m.a.y === 0 && m.c.y === 0, '横排：按给的顺序，间距 20，顶边对齐 ' + JSON.stringify(m));
m = planMoves([{ do: 'arrange', ids: ['a', 'b', 'c'], as: 'grid', gap: 10 }], boxes);
ok(m.a.y === m.b.y && m.c.y > m.a.y && m.c.x === m.a.x, '网格：2 列');

m = planMoves([{ do: 'tighten', ids: ['a', 'b', 'c'], s: 0.5, gap: 40 }], boxes);
ok(m.a.y < m.b.y && m.b.y < m.c.y && m.c.y - m.a.y < 200, '收紧：上下顺序不变，距离变近 ' + JSON.stringify(m));
ok(V({ do: 'tighten', ids: ['n1', 'n2'] }).ok && !V({ do: 'tighten', ids: ['n1', 'n2'], s: 2 }).ok, '收紧：s 只能 0~1');
// 原语：挪位置（绝对 / 相对二选一）
ok(V({ do: 'place', id: 'n1', x: 10, y: 20 }).ok && V({ do: 'place', id: 'n1', dy: -30 }).ok && !V({ do: 'place', id: 'n1', x: 1, dx: 1 }).ok && !V({ do: 'place', id: 'n1' }).ok, '挪位置：x,y 或 dx,dy 二选一');
m = planMoves([{ do: 'place', id: 'a', dx: 5, dy: -10 }, { do: 'place', id: 'b', x: 300, y: 7 }], boxes);
ok(m.a.x === 15 && m.a.y === -10 && m.b.x === 300 && m.b.y === 7, '挪位置：相对 / 绝对算对 ' + JSON.stringify(m));
const lp = loosePrompt();
ok(lp.includes('place') && lp.includes('【软件知识】') && lp.includes('Shift+F') && !lp.includes('手册里没写'), '宽松版：带原语、整份知识，不再逼它说「手册里没写」');
ok(isLoose({ chat: 'q', agentSrc: 'online' }) && !isLoose({ chat: 'q', agentSrc: 'local' }) && !isLoose({ chat: 'q', agentSrc: 'online', offline: true }), '在线 = 宽松版；offline 一律严格版');
ok(isFollowup('啊？你为什么什么都没做？') && !isQuestion('啊？你为什么什么都没做？') && isQuestion('怎么把这几个左对齐') && !isFollowup('怎么让它不显示'), '追问上一轮 → 不走问答（问答没历史）');

// 解析模型输出
ok(parseReply('好的：\n```json\n{"say":"嗯","actions":[{"do":"select","ids":["n1"]}]}\n```').actions.length === 1, '解析：容忍前后废话和代码块');
let threw = false; try { parseReply('我不知道'); } catch { threw = true; }
ok(threw, '解析：没有 JSON → 报错（触发重试）');

// 执行（临时工作区）
const root = mkdtempSync(join(tmpdir(), 'syn-agent-'));
let srv;
try {
  saveOutline(root, '观测 -> 决策\n  敌方\n决策\n行动\n兜底');
  const ws = loadWorkspace(root), ctx = pageContext(ws, '', ['观测/敌方']);
  ok(ctx.refs.get('n1') === '观测' && ctx.refs.get('n5') === '观测/敌方' && /n5 敌方.*★选中/.test(ctx.text) && /n1 -> n2/.test(ctx.text), '本页上下文：编号、选中标记、连线 ' + ctx.text);
  const G = parseOutline(workspaceOutline(ws));
  G.edges = ws.graph.edges;
  const acts = [
    { do: 'create', label: '执行', from: 'n2' },
    { do: 'status', ids: ['n1'], status: 'done' },
    { do: 'link', from: 'n4', to: 'n2', kind: '调节' },
    { do: 'unlink', from: 'n1', to: 'n2' },
    { do: 'rename', id: 'n1', label: '感知' },
    { do: 'color', ids: ['n5'], color: '红' },
    { do: 'order', ids: ['n3', 'n2'] },
    { do: 'align', ids: ['n2', 'n3'], edge: 'top' },
    { do: 'select', ids: ['n4'] },
  ].map(a => validateAction(a, { refs: ctx.refs, graph: G, scope: '' }));
  ok(acts.every(a => a.ok), '这批动作都合法 ' + JSON.stringify(acts.filter(a => !a.ok)));
  const r = applyPlan(root, acts, { 决策: { x: 0, y: 50, w: 80, h: 30 }, 行动: { x: 200, y: 0, w: 80, h: 30 } });
  const w2 = loadWorkspace(root), G2 = w2.graph;
  ok(G2.nodes.has('执行') && G2.edges.some(e => e.from === '决策' && e.to === '执行'), '新建「执行」并从 决策 连过去');
  ok(G2.nodes.has('感知') && G2.nodes.has('感知/敌方') && !G2.nodes.has('观测') && G2.nodes.get('感知').status === 'done', '改名 观测 → 感知（子孙跟着），状态 ✅ 跟着');
  ok(G2.edges.find(e => e.from === '兜底' && e.to === '决策')?.kind === '调节', '连线 兜底 → 决策 带类型 调节');
  ok(!G2.edges.some(e => e.from === '感知' && e.to === '决策'), '删掉 观测 → 决策');
  ok(G2.nodes.get('感知/敌方').meta.color === '红', '颜色写进改名后的 感知/敌方');
  const top = G2.nodes.get('').children;
  ok(top.indexOf('行动') < top.indexOf('决策'), '大纲排序：行动 挪到 决策 前面 ' + top);
  ok(r.moves['决策'].y === 0 && r.moves['行动'].y === 0 && r.select.join() === '兜底', '对齐的坐标、选中交回前端 ' + JSON.stringify(r));

  // 移动技能：挪进别的节点（别处有同名也认对，属性跟着走）；挪进自己里面 → 校验就拒绝
  saveOutline(root, '小队\n队长\n  口令\n斥候\n别处\n  队长');
  (await import('../workspace.js')).setNodeMeta(root, '队长', { rate: '2 Hz' });
  const w3 = loadWorkspace(root), c3 = pageContext(w3, '', []), G3 = parseOutline(workspaceOutline(w3));
  const mv = validateAction({ do: 'move', ids: ['n2', 'n3'], parent: 'n1' }, { refs: c3.refs, graph: G3, scope: '' });
  ok(mv.ok && /移进「小队」：队长、斥候/.test(mv.desc), '移动：校验通过 ' + JSON.stringify(mv));
  ok(!validateAction({ do: 'move', ids: ['n1'], parent: 'n1' }, { refs: c3.refs, graph: G3, scope: '' }).ok, '挪进自己 → 拒绝');
  applyPlan(root, [mv, validateAction({ do: 'rename', id: 'n3', label: '侦察兵' }, { refs: c3.refs, graph: G3, scope: '' })]);
  const G4 = loadWorkspace(root).graph;
  ok(G4.nodes.get('小队/队长')?.meta.rate === '2 Hz' && G4.nodes.has('小队/队长/口令') && G4.nodes.has('别处/队长'), '执行：队长（带属性、子节点）进了小队，别处的同名队长不受影响');
  ok(G4.nodes.has('小队/侦察兵') && !G4.nodes.has('斥候'), '同一批里先移动再改名也对');

  // 👤 2026-10-10 新建带正文 + 一次建一棵小树；查看项目文件 / 翻手册
  saveOutline(root, '设计\n别处');
  const w5 = loadWorkspace(root), c5 = pageContext(w5, '', []), G5 = parseOutline(workspaceOutline(w5));
  const VC = a => validateAction(a, { refs: c5.refs, graph: G5, scope: '' });
  const tree = VC({ do: 'create', label: '战斗', parent: 'n1', body: '# 战斗\n总述', children: [{ label: '近战', body: '挥刀' }, { label: '远程', children: [{ label: '弓', body: '拉满' }] }] });
  ok(tree.ok && /带正文/.test(tree.desc) && /含 3 个子节点/.test(tree.desc), '新建：带正文 + 子树校验通过 ' + (tree.why || tree.desc));
  ok(!VC({ do: 'create', label: 'X', children: [{ label: '甲' }, { label: '甲' }] }).ok, '新建：children 里重名 → 拒绝');
  ok(!VC({ do: 'create', label: 'X', children: Array.from({ length: 200 }, (_, i) => ({ label: 'c' + i })) }).ok && VC({ do: 'create', label: 'X', children: Array.from({ length: 199 }, (_, i) => ({ label: 'c' + i })) }).ok, '新建：整棵最多 200 个（含自己）');
  ok(!VC({ do: 'create', label: 'X', body: 5 }).ok && !VC({ do: 'create', label: 'X', body: 'a'.repeat(8001) }).ok, '新建：body 不是文字 / 太长 → 拒绝');
  const deep = n => n ? { label: 'd' + n, children: [deep(n - 1)] } : undefined;
  ok(!VC({ do: 'create', label: 'X', children: [deep(5)] }).ok, '新建：children 嵌到第 5 层 → 拒绝');
  applyPlan(root, [tree]);
  const G6 = loadWorkspace(root).graph;
  ok(G6.nodes.has('设计/战斗/远程/弓') && G6.nodes.get('设计/战斗/近战').body.trim() === '挥刀' && G6.nodes.get('设计/战斗/远程/弓').body.trim() === '拉满' && G6.nodes.get('设计/战斗').body.includes('总述'), '执行：整棵子树建好，每个节点的正文都在');
  ok(G6.nodes.get('设计/战斗').children.join() === '设计/战斗/近战,设计/战斗/远程', '子节点顺序 = 给的顺序');
  ok(parseReply(JSON.stringify({ say: '', actions: Array.from({ length: 80 }, () => ({ do: 'select' })) })).actions.length === 60, '一次最多收 60 个动作');
  const { lookAt } = await import('../agent.js');
  writeFileSync(join(root, '设计说明.md'), '# 说明\n我是项目里的文档');
  const lk = lookAt(root, c5, [{ file: '设计说明.md' }, { file: '../外面.md' }, { file: '.synapsis/ai.json' }, { file: '没有.md' }, { manual: '怎么连线' }]);
  ok(lk.text.includes('我是项目里的文档') && lk.said.includes('读文件 设计说明.md'), '查看：读项目里的 md');
  ok((lk.text.match(/不能读/g) || []).length === 2 && lk.text.includes('没有这个文件'), '查看：项目外 / .synapsis / 不存在的文件读不了');
  ok(lk.text.includes('【手册·怎么连线】') && !lk.text.includes('（手册里没有相关的段落）'), '查看：翻手册能找到连线那段');
  // 在线版（rich）多给：正文开头、传送门障碍物、本页范围、项目大纲
  { const w = loadWorkspace(root), c = pageContext(w, '设计', [], { '设计/战斗': { x: 0, y: 0, w: 100, h: 40 }, '@portal:别处': { x: 300, y: 20, w: 120, h: 30 } }, { rich: true });
    const plain = pageContext(w, '设计', [], { '@portal:别处': { x: 300, y: 20, w: 120, h: 30 } });
    ok(c.text.includes('障碍物') && c.text.includes('传送门→别处') && c.text.includes('宽高比') && c.text.includes('项目大纲') && c.text.includes('「挥刀') === false, 'rich：障碍物 / 范围 / 项目大纲都在 ' + c.text.slice(0, 40));
    ok(!plain.text.includes('障碍物') && !plain.text.includes('项目大纲'), '严格版（8B）上下文不变短小') ; }
  ok(lp.includes('【手册目录】') && lp.length < loosePrompt([], []).length + 9000, '宽松版提示词：快捷键表 + 手册目录，手册正文不整份塞');

  // 问模型（假服务）：第一次回废话 → 重试；带短记忆；写日志
  let calls = 0, lastMsgs = null;
  srv = createServer((req, res) => { let s = ''; req.on('data', c => s += c); req.on('end', () => {
    const j = JSON.parse(s); calls++; lastMsgs = j.messages;
    const last = j.messages.at(-1).content;
    const content = j.messages[0].content.includes('使用说明助手') ? '- 按 Ctrl+Z 撤销\n- Ctrl+Y 重做' : calls === 1 ? '好的我来帮你' : '{"say":"选上了","actions":[{"do":"select","ids":["n1","n9"]},{"do":"delete","ids":["n1"]}]}';
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 700, completion_tokens: 30, total_tokens: 730 } }));
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const cfg = { url: `http://127.0.0.1:${srv.address().port}/v1`, chat: 'chat-x', log: join(root, '.synapsis', 'ai_log.jsonl') };
  clearChat(root);
  const out = await runAgent(root, { scope: '', selected: [], text: '把第一个选上' }, cfg);
  ok(calls === 2 && out.say === '选上了', '第一次不是 JSON → 告诉它错在哪、重来一次');
  ok(!out.actions[0].ok && /不认识/.test(out.actions[0].why) && !out.actions[1].ok, '编造的编号 / 不存在的动作 → 标为不执行，带原因');
  ok(loadChat(root).length === 1 && loadChat(root)[0].user === '把第一个选上', '短记忆记下这一轮');
  await runAgent(root, { scope: '', selected: [], text: '再选第二个' }, cfg);
  ok(lastMsgs.some(m => m.role === 'user' && m.content === '把第一个选上') && lastMsgs.some(m => m.role === 'assistant' && m.content.includes('选上了')), '第二轮带上了上一轮（短记忆）');
  const log = readAiLog(cfg.log);
  ok(log.length === 3 && log[0].kind === 'AI 指令' && log.some(l => l.kind === 'AI 指令（重试）') && log[0].raw && log[0].ms >= 0, '日志：每次调用都记（用途 / 原始输出 / 耗时） ' + log.map(l => l.kind));
  clearChat(root);
  ok(loadChat(root).length === 0, '清空记忆');
  // 问用法：消息里带上挑出来的软件知识，回答不被当成「嘴上说做了」
  const qa = await runAgent(root, { scope: '', selected: [], text: '怎么撤销？' }, cfg);
  const um = lastMsgs.at(-1).content;
  ok(um.includes('【软件知识】') && um.includes('Ctrl+Z') && qa.knowledge.includes('快捷键·编辑'), '问「怎么撤销」→ 消息里带上快捷键表的「编辑」段 ' + qa.knowledge);
  ok(qa.mode === 'answer' && qa.say.startsWith('- 按 Ctrl+Z') && qa.actions.length === 0 && !lastMsgs.some(m => m.role === 'assistant'), '问句走问答：纯文本回答、不出动作、不带做事的历史');
  ok(loadChat(root).at(-1)?.say === qa.say, '问答也记进短记忆');
  ok(qa.usage?.total_tokens === 730, '带回 LM Studio 报的 token 用量（界面显示「已用 / 容量」）');
  const est = estimateContext(root);
  ok(est.total > 1200 && est.parts.系统提示词 > 300 && est.parts.短记忆 > 0, '没问之前能估这次大概占多少 ' + JSON.stringify(est.parts));
  ok(estTokens('一二三四') === 4 && estTokens('abcdefg') === 2, '粗估：中文 1 字 ≈ 1 token，英文 3.5 字符 ≈ 1 token');
  ok(isQuestion('怎么连线？') && isQuestion('有哪些快捷键') && isQuestion('能撤销吗') && !isQuestion('把这几个左对齐') && !isQuestion('观测做完了') && !isQuestion('在决策后面加一个执行'), '问句判断：问用法 vs 交代事');
  clearChat(root);
} finally {
  if (srv) { srv.closeAllConnections(); await new Promise(r => srv.close(r)); }
  rmSync(root, { recursive: true, force: true });
}
console.log(`agent: ${pass} 过 / ${fail} 挂`);
process.exitCode = fail ? 1 : 0; // 别 process.exit：Windows 上 fetch 的连接还在收尾时硬退会触发 libuv 断言（exit 127）
