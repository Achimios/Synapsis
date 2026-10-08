// >v<✅自检-AI 循环-上一轮结果（提议 / 执行 / 执行后检查）+ 只读查看（look）多跳（core/agent.js）
// node core/test/loop.test.js —— 只用临时目录和本机假服务，不联网
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent, applyPlan, loadChat, outcomeNote, recordOutcome, overlapWarnings, parseReply, pageContext, lookAt, LOOK_MAX } from '../agent.js';
import { saveOutline, setNodeBody, loadWorkspace } from '../workspace.js';
import { readUsage } from '../ai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const home = mkdtempSync(join(tmpdir(), 'syn-loop-home-')), root = mkdtempSync(join(tmpdir(), 'syn-loop-ws-'));
let srv;
try {
  // —— 纯函数 ——
  const bx = { a: { x: 0, y: 0, w: 80, h: 30 }, b: { x: 200, y: 0, w: 80, h: 30 }, c: { x: 0, y: 100, w: 0, h: 0 } };
  ok(overlapWarnings(bx, { a: { x: 190, y: 0 } }, id => id.toUpperCase()).join() === '「A」和「B」重叠了', '挪过去压到别的卡 → 报重叠');
  ok(overlapWarnings(bx, { a: { x: 100, y: 0 } }).length === 0, '没压到 → 没警告');
  ok(overlapWarnings({ a: { x: 0, y: 0, w: 80, h: 30 }, b: { x: 10, y: 0, w: 80, h: 30 } }, {}).length === 0, '两张都没挪的，原来就叠着 → 不管');
  ok(overlapWarnings(bx, { c: { x: 0, y: 0 } }).length === 0, '量不到宽高的卡跳过');
  ok(parseReply('{"look":[{"node":"n1"},"x",[1]],"say":""}').look.length === 1, 'parseReply：look 只收对象');
  ok(outcomeNote({ done: [] }) === '' && outcomeNote({ done: ['a'], executed: ['a'] }).includes('执行了：a') && outcomeNote({ done: ['a'] }).includes('没有执行'), 'outcomeNote 三种情况');

  // —— 假在线服务：按剧本一条条回，记下每次收到的最后一条消息 ——
  const seen = []; let script = [];
  srv = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const j = JSON.parse(b); seen.push(j.messages[j.messages.length - 1].content);
      const content = JSON.stringify(script.length > 1 ? script.shift() : script[0] || { say: '嗯', actions: [] });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, prompt_cache_hit_tokens: 4 } }));
    });
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  process.env.SYNAPSIS_ONLINE_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.DEEPSEEK_API_KEY = 'sk-fake';
  const cfg = { url: 'http://127.0.0.1:9/v1', chat: 'q', agentSrc: 'online', onlineModel: 'deepseek-flash', keys: join(home, '.synapsis', 'keys.json') };
  const boxes = { 观测: { x: 0, y: 0, w: 80, h: 30 }, 决策: { x: 200, y: 0, w: 80, h: 30 } };
  const run = (text, c = cfg) => runAgent(root, { text, boxes }, c, { home });
  const last = () => seen[seen.length - 1];

  saveOutline(root, '观测 -> 决策\n决策');
  setNodeBody(root, '观测', '这里是观测的正文XYZ');
  const refs = pageContext(loadWorkspace(root), '', []).refs, n1 = [...refs].find(([, id]) => id === '观测')[0];

  // —— 提议 → 执行 → 下一轮知道 ——
  script = [{ say: '把观测挪过去', actions: [{ do: 'place', id: n1, x: 190, y: 0 }] }];
  const r1 = await run('把观测挪到决策那边');
  ok(r1.actions.every(a => a.ok) && loadChat(root).at(-1).done.length === 1 && !loadChat(root).at(-1).executed, '提议时：有 done、没有 executed');
  const ap = applyPlan(root, r1.actions, boxes, { home });
  ok(ap.warnings.join() === '「观测」和「决策」重叠了', 'applyPlan 返回执行后检查 ' + JSON.stringify(ap.warnings));
  const c1 = loadChat(root).at(-1);
  ok(c1.executed?.length === 1 && c1.warnings?.length === 1, '执行后回写 executed / warnings');
  script = [{ say: '我来修', actions: [] }];
  await run('怎么样');
  ok(last().includes('【上一轮结果】人确认并执行了') && last().includes('执行后检查发现：「观测」和「决策」重叠了'), '下一轮消息里带着执行结果和重叠警告');
  ok(recordOutcome(root, { executed: ['x'] }) === false, '同一轮不会被重复回写（上一轮的 done 已有 executed，且最近有 done 的轮次还是它）');

  // —— 提议了但没执行 ——
  script = [{ say: '再挪一次', actions: [{ do: 'place', id: n1, x: 50, y: 0 }] }];
  await run('再挪一下');
  script = [{ say: '好', actions: [] }];
  await run('算了，换个话题');
  ok(last().includes('【上一轮结果】人没有执行'), '提议后人没确认 → 下一轮被告知没执行');
  await run('还在吗');
  ok(!last().includes('【上一轮结果】'), '上一轮没有提议动作 → 不加结果行');

  // —— look：多跳、只读、有上限 ——
  script = [{ look: [{ node: n1 }, { page: n1 }, { search: 'XYZ' }, { node: 'n99' }] }, { look: [{ search: '决策' }] }, { say: '看完了', actions: [] }];
  const before = seen.length;
  const rl = await run('观测里写了什么');
  ok(seen.length - before === 3 && rl.say === '看完了', '查两次、第三次回答：共 3 次请求 ' + (seen.length - before));
  const second = seen[before + 1], third = seen[before + 2];
  ok(second.includes('【查看结果】') && second.includes('这里是观测的正文XYZ') && second.includes('里面') && second.includes('搜「XYZ」') && second.includes('本页没有这个编号'), '第一跳：正文 / 里面 / 搜索 / 无效编号 都有');
  ok(third.includes('搜「决策」') && third.includes('决策'), '第二跳：搜到节点');
  ok(rl.looked.length === 4 && loadChat(root).at(-1).looked.length === 4, 'looked 返回并记进这一轮');
  ok(second.includes('不能再查看') === false && third.includes('不能再查看') === false, '没到上限不催它回答');
  script = [{ look: [{ search: '观测' }] }];
  const b2 = seen.length;
  const rcap = await run('一直查');
  ok(seen.length - b2 === 1 + LOOK_MAX && last().includes('不能再查看了') && /查看次数用完/.test(rcap.say), `到 ${LOOK_MAX} 跳封顶：催它回答，仍不回答就明说`);

  // —— 本地严格版不循环 ——
  script = [{ look: [{ node: n1 }], say: '', actions: [] }];
  const b3 = seen.length;
  const rs = await run('看看本地', { ...cfg, agentSrc: 'local', url: `http://127.0.0.1:${srv.address().port}/v1` });
  ok(seen.length - b3 === 1 && !rs.looked.length, '本地 8B 不开 look');

  // —— 短记忆按模式分：在线宽松版不吃严格版（旧记录没有 mode 算 strict）留下的拒绝腔（2026-10-08 实测：它照着「手册里没写，我不能编」拒演明日香）——
  const chatFile = join(root, '.synapsis', 'ai_chat.json');
  const keep = loadChat(root);
  writeFileSync(chatFile, JSON.stringify([{ t: 'x', scope: '', user: '旧：你演明日香', say: '手册里没写这个，我不能编', actions: [], done: [] }, { t: 'y', mode: 'strict', scope: '', user: '旧2', say: '我只是使用说明助手', actions: [], done: [] }]));
  let nMsgs = 0; const origListen = srv.listeners('request')[0];
  srv.removeAllListeners('request'); srv.on('request', (req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { const j = JSON.parse(b); nMsgs = j.messages.length; seen.push(j.messages.at(-1).content); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: '你好', actions: [] }) } }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, prompt_cache_hit_tokens: 4 } })); }); });
  await run('用明日香的口气问个好');
  ok(nMsgs === 2, `在线宽松版：严格版 / 旧记录留下的 2 轮不喂给它（只有 system + 这一句，实际 ${nMsgs} 条）`);
  await run('再来一句');
  ok(nMsgs === 4, `它自己的这一轮（mode: loose）会喂回去（system + 上一轮 2 条 + 这一句 = 4，实际 ${nMsgs}）`);
  ok(loadChat(root).at(-1).mode === 'loose' && loadChat(root).filter(t => !t.mode).length === 1, '新记录带 mode；旧的不动');
  writeFileSync(chatFile, JSON.stringify(keep)); srv.removeAllListeners('request'); srv.on('request', origListen);

  // —— 用量：每次调对话模型都记（在线 / 本地分开；用途名去掉括号里的细节）——
  const us = readUsage(cfg), on = us.today.online, lo = us.today.local;
  ok(on.n === seen.length - 1 && on.p === 7 * on.n && on.c === 3 * on.n && on.h === 4 * on.n, `在线用量累加：${on.n} 次，提示 ${on.p}、回答 ${on.c}、缓存命中 ${on.h}（共 ${seen.length} 次请求，其中 1 次本地）`);
  ok(lo.n === 1 && lo.p === 7, '本地那一次记在本地');
  ok(on.kinds['AI 指令']?.n >= 3 && !Object.keys(on.kinds).some(k => k.includes('（')), '用途名去掉括号里的细节：查看 / 读记忆都算进「AI 指令」 ' + Object.keys(on.kinds).join('|'));
  ok(us.week.online.n === on.n, '近 7 天合计包含今天');

  // —— lookAt 单测：页 / 搜索不动工作区 ——
  const ctx = pageContext(loadWorkspace(root), '', []);
  const la = lookAt(root, ctx, [{ page: n1 }]);
  ok(la.text.includes('（空）') || la.text.includes('里面'), 'page 看空节点不炸');
} finally {
  srv?.close(); delete process.env.SYNAPSIS_ONLINE_URL; delete process.env.DEEPSEEK_API_KEY;
  rmSync(home, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
}
console.log(`loop: ${pass} 过 / ${fail} 挂`);
process.exitCode = fail ? 1 : 0;
