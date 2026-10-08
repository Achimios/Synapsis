// >v<✅自检-AI指令-说明书 ↔ 校验器一一对应、动作校验、排版坐标、解析模型输出、执行（临时工作区）、问模型（假服务：重试 / 短记忆 / 日志）
// node core/test/agent.test.js —— 不碰真的 LM Studio
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkills, pageContext, parseReply, applyPlan, runAgent, loadChat, clearChat, systemPrompt, isQuestion } from '../agent.js';
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

  // 问模型（假服务）：第一次回废话 → 重试；带短记忆；写日志
  let calls = 0, lastMsgs = null;
  srv = createServer((req, res) => { let s = ''; req.on('data', c => s += c); req.on('end', () => {
    const j = JSON.parse(s); calls++; lastMsgs = j.messages;
    const last = j.messages.at(-1).content;
    const content = j.messages[0].content.includes('使用说明助手') ? '- 按 Ctrl+Z 撤销\n- Ctrl+Y 重做' : calls === 1 ? '好的我来帮你' : '{"say":"选上了","actions":[{"do":"select","ids":["n1","n9"]},{"do":"delete","ids":["n1"]}]}';
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
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
  ok(isQuestion('怎么连线？') && isQuestion('有哪些快捷键') && isQuestion('能撤销吗') && !isQuestion('把这几个左对齐') && !isQuestion('观测做完了') && !isQuestion('在决策后面加一个执行'), '问句判断：问用法 vs 交代事');
  clearChat(root);
} finally {
  if (srv) { srv.closeAllConnections(); await new Promise(r => srv.close(r)); }
  rmSync(root, { recursive: true, force: true });
}
console.log(`agent: ${pass} 过 / ${fail} 挂`);
process.exitCode = fail ? 1 : 0; // 别 process.exit：Windows 上 fetch 的连接还在收尾时硬退会触发 libuv 断言（exit 127）
