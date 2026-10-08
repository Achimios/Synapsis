// >v<✅自检-长期记忆-索引 / 读全文 / 写（追加、整份换掉进 _过期的）/ 宽松版里的「先 read 再答」一轮（core/memory.js + agent.js）
// node core/test/memory.test.js —— 只用临时目录和本机假服务，不联网
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listMemories, memoryIndex, readMemories, writeMemory, indexStatus, LEVELS } from '../memory.js';
import { runAgent, applyPlan, pageContext } from '../agent.js';
import { validateAction } from '../plan.js';
import { saveOutline, loadWorkspace, workspaceOutline } from '../workspace.js';
import { parseOutline } from '../outline.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const home = mkdtempSync(join(tmpdir(), 'syn-mem-home-')), root = mkdtempSync(join(tmpdir(), 'syn-mem-ws-'));
let srv;
try {
  saveOutline(root, '观测 -> 决策\n决策');
  ok(memoryIndex(home, root) === '', '没有记忆 → 索引是空的');
  writeMemory(home, root, { level: '项目', name: '分层约定', text: '空间按 观测 → 决策 → 行动 分层', desc: '空间的分层约定' });
  writeMemory(home, root, { level: '用户', name: '口味', text: '喜欢 acid 风格' });
  ok(existsSync(join(root, '__synapsis', '_AI记忆', '分层约定.md')) && existsSync(join(home, '.synapsis', '记忆', '口味.md')), '项目级进 __synapsis/_AI记忆/，用户级进 <Synapsis>/.synapsis/记忆/');
  ok(memoryIndex(home, root) === '- [项目] 分层约定：空间的分层约定\n- [用户] 口味：喜欢 acid 风格', '索引一条一行：名字 + 描述 ' + memoryIndex(home, root));
  ok(!loadWorkspace(root).graph.nodes.has('_AI记忆'), '记忆文件夹不会被当成节点');
  writeMemory(home, root, { level: '项目', name: '分层约定', text: '兜底挂在决策下' });
  ok(/观测[\s\S]*兜底挂在决策下/.test(readMemories(home, root, ['[项目] 分层约定']).text), '同名 = 追加；读的时候名字带不带 [项目] 都行');
  writeMemory(home, root, { level: '项目', name: '分层约定', text: '重来', mode: 'replace' });
  const old = join(root, '__synapsis', '_AI记忆', '_过期的');
  ok(readdirSync(old).length === 1 && !readMemories(home, root, ['分层约定']).text.includes('兜底') && listMemories(home, root).length === 2, 'replace：旧的整份进 _过期的/（不删），不出现在索引里');
  // 校验
  const ws = loadWorkspace(root), c = pageContext(ws, '', []), G = parseOutline(workspaceOutline(ws));
  const V = a => validateAction(a, { refs: c.refs, graph: G, scope: '' });
  ok(V({ do: 'remember', name: '偏好', text: 'x' }).ok && !V({ do: 'remember', name: 'a/b', text: 'x' }).ok && !V({ do: 'remember', name: 'a', text: 'x', level: '全局' }).ok, 'remember：名字能当文件名、level 只认 项目 / 用户');
  applyPlan(root, [V({ do: 'remember', name: '偏好', text: '喜欢扁平化指挥', level: '用户' })], {}, { home });
  ok(readMemories(home, root, ['偏好']).text.includes('扁平化'), '确认后 applyPlan 写进用户级记忆');

  // 类型 + 索引上限（2026-10-08）
  ok(!V({ do: 'remember', name: 'a', text: 'x', type: '随便' }).ok && V({ do: 'remember', name: 'a', text: 'x', type: 'feedback' }).ok && V({ do: 'remember', name: 'a', text: 'x' }).ok, 'remember：type 只认 user / feedback / project / reference，可以不写');
  writeMemory(home, root, { level: '用户', name: '纠正', text: '别叫我大佬', type: 'feedback' });
  ok(listMemories(home, root).find(m => m.name === '纠正').type === 'feedback' && memoryIndex(home, root).includes('纠正（feedback）：'), '类型写进 frontmatter、显示在索引里');
  ok(indexStatus(home, root, 4).near === true && indexStatus(home, root, 4).over === false && indexStatus(home, root, 3).over === true && indexStatus(home, root, 100).near === false, 'indexStatus：≥80% 算快满，超过算满');
  const capped = memoryIndex(home, root, 2).split('\n');
  ok(capped.length === 3 && /另有 2 条没列出来/.test(capped[2]), '超过上限：只列 2 条 + 一行说明 ' + capped.join('|'));
  const pre = applyPlan(root, [V({ do: 'remember', name: '又一条', text: '凑数', level: '用户' })], {}, { home });
  ok(Array.isArray(pre.warnings) && pre.warnings.length === 0, '没到 80% 不提醒');

  // 宽松版：第一轮附索引 → 模型回 read → 附全文再问一轮
  const seen = [];
  srv = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const j = JSON.parse(b), last = j.messages[j.messages.length - 1].content; seen.push({ last, n: j.messages.length });
      const content = last.includes('【记忆全文】') ? JSON.stringify({ say: '按约定来', actions: [] }) : seen.length === 1 ? JSON.stringify({ read: ['分层约定'] }) : JSON.stringify({ say: '第二句', actions: [] });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1 } }));
    });
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  process.env.SYNAPSIS_ONLINE_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.DEEPSEEK_API_KEY = 'sk-fake';
  const cfg = { url: 'http://127.0.0.1:9/v1', chat: 'q', agentSrc: 'online', onlineModel: 'deepseek-flash' };
  const r1 = await runAgent(root, { text: '怎么分层？' }, cfg, { home });
  ok(seen[0].last.includes('【记忆索引】') && seen[0].last.includes('分层约定') && seen.length === 2 && seen[1].last.includes('【记忆全文】') && seen[1].last.includes('重来'), '新对话附索引；它要 read → 附全文再问一轮');
  ok(r1.say === '按约定来' && r1.memRead.join() === '分层约定' && r1.memIndex === true, '返回读了哪些记忆 ' + JSON.stringify(r1.memRead));
  await runAgent(root, { text: '再说一句' }, cfg, { home });
  ok(!seen[2].last.includes('【记忆索引】') && JSON.stringify(seen[2]).length > 0, '8 轮内附过了就不再附（历史里那轮还带着索引）');
  const r3 = await runAgent(root, { text: '本地呢' }, { ...cfg, agentSrc: 'local', url: `http://127.0.0.1:${srv.address().port}/v1` }, { home });
  ok(!seen[3].last.includes('【记忆索引】') && r3.memRead.length === 0, '本地（严格版）不带记忆');
} finally {
  srv?.close(); delete process.env.SYNAPSIS_ONLINE_URL; delete process.env.DEEPSEEK_API_KEY;
  rmSync(home, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
}
console.log(`memory: ${pass} 过 / ${fail} 挂`);
process.exitCode = fail ? 1 : 0;
