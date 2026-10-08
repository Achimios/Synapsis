// >v<✅自检-AI辅助-假的 LM Studio（本地 http，字符袋嵌入 + 固定回答）上跑：状态 / 潜在关联 / 缓存 / 语义配色 / 生成词表 / 写入备份
// node core/test/ai.test.js —— 不碰真的 LM Studio
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aiStatus, related, rerank, semColors, semPatterns, suggestWords, applyWords, explainRelation, embed, chat } from '../ai.js';
import { saveOutline, loadWorkspace, DIR } from '../workspace.js';
import { colorMap, PALETTE } from '../colors.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };

// 字符袋嵌入：共享的字越多越像（够让排序可预测）
const bag = t => { const v = new Array(97).fill(0); for (const ch of t) v[ch.codePointAt(0) % 97] += 1; return v; };
let embedCalls = 0, chatCalls = 0, chatReply = '';
// 归类配色的假回答：名字含「情绪」→ 第 1 类，含「传感」→ 第 2 类，其余 0
const classify = user => user.split(/\r?\n/).map(l => l.match(/^(\d+)\. (.*)$/)).filter(Boolean).map(m => `${m[1]}: ${/情绪/.test(m[2]) ? 1 : /传感/.test(m[2]) ? 2 : 0}`).join('\n');
const srv = createServer((req, res) => {
  let s = ''; req.on('data', c => s += c); req.on('end', () => {
    const j = s ? JSON.parse(s) : {}, send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url === '/api/v0/models') return send({ data: [{ id: 'emb-x', type: 'embeddings', state: 'loaded' }, { id: 'chat-x', type: 'llm', state: 'not-loaded' }] });
    if (req.url === '/v1/embeddings') { embedCalls++; return send({ data: j.input.map((t, index) => ({ index, embedding: bag(t) })) }); }
    if (req.url === '/v1/chat/completions') { chatCalls++; const sys = j.messages[0].content; return send({ choices: [{ message: { content: /归类配色/.test(sys) ? classify(j.messages[1].content) : /底纹/.test(sys) ? j.messages[1].content.split(/\r?\n/).map(l => l.match(/^(\d+)\. (.*)$/)).filter(Boolean).map(m => `${m[1]}: ${/咕噜/.test(m[2]) ? 5 : 0}`).join('\n') : chatReply } }] }); }
    res.statusCode = 404; res.end();
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const cfg = { url: `http://127.0.0.1:${srv.address().port}/v1`, embed: 'emb-x', chat: 'chat-x', semColors: true };
const root = mkdtempSync(join(tmpdir(), 'syn-ai-'));

try {
  const st = await aiStatus(cfg);
  ok(st.ok && st.embed.map(m => m.id).join() === 'emb-x' && st.chat.map(m => m.id).join() === 'chat-x', '状态：分出嵌入 / 对话模型 ' + JSON.stringify(st));
  const dead = await aiStatus({ ...cfg, url: 'http://127.0.0.1:9/v1' });
  ok(!dead.ok && /连不上/.test(dead.error), '连不上 → ok:false + 说人话 ' + dead.error);
  // 在线模型（deepseek:…）：没有 key → 说清楚 key 写哪儿，不去请求；key 不出现在状态里
  const kf = join(tmpdir(), 'syn-nokey-' + Date.now() + '.json');
  let msg = ''; try { await chat({ ...cfg, chat: 'deepseek:deepseek-flash', keys: kf }, 'x', 'y'); } catch (e) { msg = e.message; }
  ok(/没有 deepseek 的 key/.test(msg) && msg.includes(kf), '在线模型没 key → 报 key 该写哪 ' + msg);
  writeFileSync(kf, JSON.stringify({ deepseek: 'sk-test-secret' }));
  const st2 = await aiStatus({ ...cfg, keys: kf, online: false });
  ok(st2.ok && !st2.chat.some(m => m.online) && !JSON.stringify(st2).includes('sk-test-secret'), 'online:false 不查在线模型；key 不进状态');
  rmSync(kf);

  saveOutline(root, `情绪空间 -> 行为输出
  恐惧
行为输出
情绪反应模块
传感器
咕噜人
`);
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', '情绪空间笔记.md'), '# 情绪空间\n恐惧 焦虑 情绪');
  const r = await related(root, '情绪空间', cfg);
  const ids = r.map(x => x.id);
  ok(!ids.includes('情绪空间') && !ids.includes('行为输出') && !ids.includes('情绪空间/恐惧'), '潜在关联不含：自己 / 已连上的 / 子孙 ' + ids);
  ok(r[0].kind === 'file' && r[0].id === 'docs/情绪空间笔记.md', '最像的是同名笔记（项目文档也算） ' + JSON.stringify(r[0]));
  ok(ids.indexOf('情绪反应模块') < ids.indexOf('咕噜人'), '情绪反应模块 排在 咕噜人 前面');
  const n0 = embedCalls; await related(root, '情绪空间', cfg);
  ok(embedCalls === n0, '第二次全走缓存（.synapsis/embed.json），不再请求嵌入');
  ok(existsSync(join(root, '.synapsis', 'embed.json')), '缓存在工作区 .synapsis/（本机状态，不进 git）');
  const v = await embed({ ...cfg, embed: 'emb-y' }, ['情绪'], join(root, '.synapsis', 'embed.json'));
  ok(embedCalls === n0 + 1 && v[0].length === 97, '换了模型 → 缓存作废重算');

  // 语义配色：词表没命中的节点让对话模型归类（假模型：含「情绪」→ 紫行，含「传感」→ 蓝行）
  writeFileSync(join(root, DIR, '_配色.md'), '- 紫: 恐惧\n- 蓝: 观测\n');
  saveOutline(root, `情绪恐慌
  子节点
咕噜人
传感器组
  观测台
  传感杂项
`);
  const sc = await semColors(root, cfg);
  ok(sc['情绪恐慌'] === PALETTE.紫 && !sc['咕噜人'] && sc['传感器组'] === PALETTE.蓝, '语义配色：情绪恐慌 → 紫，传感器组 → 蓝，咕噜人 归「无」→ 不给 ' + JSON.stringify(sc));
  ok(!('传感器组/观测台' in sc), '自己（或祖先）已被词表命中的节点不问模型');
  const c0 = chatCalls; await semColors(root, cfg);
  ok(chatCalls === c0, '第二次走缓存（.synapsis/ai_colors.json），不再问模型');
  const ws = loadWorkspace(root);
  const cm = colorMap(ws.graph, () => undefined, ws.colorWords, sc);
  ok(cm.get('情绪恐慌/子节点') === PALETTE.紫, 'colorMap 吃 sem：子节点跟着祖先变紫');
  // 语义图案：词表没认出的才问（传感器组 含「传感」= 点阵，不问）；假模型把 咕噜人 归到第 5 行（波纹）
  const sp = await semPatterns(root, cfg);
  ok(sp['咕噜人'] === '波纹' && !('传感器组' in sp) && !sp['情绪恐慌'], '语义图案：只问词表没认出的，归「无」的不给 ' + JSON.stringify(sp));
  // 词表命中优先于语义：顶层被 AI 染了紫，下面词表命中「观测」的子节点仍是蓝
  const cm2 = colorMap(ws.graph, () => undefined, ws.colorWords, { 传感器组: PALETTE.紫 });
  ok(cm2.get('传感器组/观测台') === PALETTE.蓝 && cm2.get('传感器组/传感杂项') === PALETTE.紫, '词表命中排在语义配色前面');

  chatReply = '<think>想一想</think>好的，词表如下：\n- 紫: 情绪, 恐慌\n- 蓝: 传感, 观测\n- 臭: 认不出\n';
  const sw = await suggestWords(root, cfg);
  ok(sw.rules === 2 && sw.bad.length === 1 && sw.text.startsWith('# 配色词表') && !sw.text.includes('好的'), '生成词表：只留词表行，坏行报出来 ' + JSON.stringify(sw));
  applyWords(root, sw.text);
  const bak = readdirSync(join(root, DIR, '_过期的')).filter(f => f.startsWith('_配色_'));
  ok(readFileSync(join(root, DIR, '_配色.md'), 'utf8') === sw.text && bak.length === 1 && readFileSync(join(root, DIR, '_过期的', bak[0]), 'utf8').includes('紫: 恐惧'), '写入新词表，旧的备份进 _过期的/');

  // 精排：8B 会复述名字（「1. 名字 | 3 | 理由」）；乱写的行、越界的序号丢掉
  chatReply = '<think>x</think>好的\n1. 咕噜人 | 3 | 都讲惊慌\n2. 随便写写\n9. 越界 | 2 | 不要\n';
  const rr = await rerank(root, '情绪恐慌', [{ kind: 'node', id: '传感器组', score: 0.9 }, { kind: 'node', id: '咕噜人', score: 0.5 }].reverse(), cfg);
  ok(rr[0].id === '咕噜人' && rr[0].llm === 3 && rr[0].why === '都讲惊慌' && rr[1].llm === null, '精排：抠出分数和理由，按分数排，认不出的留 null ' + JSON.stringify(rr));

  chatReply = '<think>嗯</think>都和惊慌有关。';
  ok(await explainRelation(root, '情绪恐慌', { kind: 'node', id: '咕噜人' }, cfg) === '都和惊慌有关。', '一句话关系：剥掉 <think>');
} finally {
  srv.close(); rmSync(root, { recursive: true, force: true });
}
console.log(`ai: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
