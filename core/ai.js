// >v<🤖AI辅助-LM Studio 接入（👤 2026-10-08）：辅助功能，不是主流程 —— 连不上时一切照常，只是没有这些提示。
// 怎么连：LM Studio 开本机服务（界面 Developer → Start Server，或 `lms server start`），默认 http://127.0.0.1:1234/v1，
//   是 OpenAI 兼容的 HTTP 接口。Synapsis 的本机服务（vite / 托盘程序）直接 fetch 它，不需要通讯桥。
// 选哪个模型：本机设置 <Synapsis>/.synapsis/ai.json（模型是这台机器的事，不跟项目走），界面顶栏「AI」里选。
// 用到的：嵌入模型（相似度：潜在关联、语义配色）+ 对话模型（生成词表、一句话说明两个东西的关系）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { loadWorkspace, listTree, DIR } from './workspace.js';
import { PALETTE, WORDS_FILE, DEFAULT_WORDS, parseColorWords, wordColor } from './colors.js';
import { PATTERN_HINT, DEFAULT_PATTERN_WORDS, parsePatternWords, wordPattern } from './patterns.js';
import { isDropped } from './outline.js';

// agentSrc = AI 指令框 / 问答 / 生成词表 / 「?」关系说明 用本地还是在线；bulkSrc = 高频后台（潜在关联重排、语义配色归类），默认本地（👤「高频调用的默认不用在线」）
export const AI_DEFAULTS = { url: 'http://127.0.0.1:1234/v1', embed: 'text-embedding-qwen3-embedding-0.6b', chat: 'qwen3-8b', semColors: true,
  agentSrc: 'local', bulkSrc: 'local', onlineModel: 'deepseek-flash', onlineEffort: 'off' };
export const EFFORTS = ['off', 'low', 'high', 'max']; // off = 不思考（默认：快、省钱）；其余 = DeepSeek 的 reasoning_effort
const cfgFile = home => join(home, '.synapsis', 'ai.json');

// >v<🤖AI辅助-在线对话模型-DeepSeek（👤 2026-10-08「给个在线接口」）：只接对话，嵌入照旧用 LM Studio（DeepSeek 没有嵌入接口）。
//   key 放 <Synapsis>/.synapsis/keys.json 的 {"deepseek": "sk-…"}（.synapsis/ 整个不进 git），或环境变量 DEEPSEEK_API_KEY；界面里也能填（写进同一个文件）。
//   key 只在服务端读，不进 cfg、不回给界面（只回「有没有」）、不写日志。
//   cfg.offline === true → 不查在线模型、全部走本地（自检用，免得跑测试时联网花钱）
export const ONLINE = { deepseek: { url: 'https://api.deepseek.com', env: 'DEEPSEEK_API_KEY' } };
export const keyFile = home => join(home, '.synapsis', 'keys.json');
// SYNAPSIS_ONLINE_URL = 自检用：把在线请求指到本机假服务
const onlineOf = id => { const m = /^(\w+):(.+)$/.exec(id || ''); return m && ONLINE[m[1]] ? { provider: m[1], model: m[2], ...ONLINE[m[1]], ...(process.env.SYNAPSIS_ONLINE_URL ? { url: process.env.SYNAPSIS_ONLINE_URL } : {}) } : null; };
// 这次调用实际用哪个对话模型（在线的带「deepseek:」前缀）
export const chatModel = (cfg, bulk = false) => !cfg.offline && (bulk ? cfg.bulkSrc : cfg.agentSrc) === 'online' ? 'deepseek:' + (cfg.onlineModel || 'deepseek-flash') : cfg.chat;
function onlineKey(cfg, provider) {
  if (process.env[ONLINE[provider].env]) return process.env[ONLINE[provider].env];
  try { return JSON.parse(readFileSync(cfg.keys, 'utf8'))[provider] || null; } catch { return null; }
}
export function saveKey(home, provider, key) {
  if (!ONLINE[provider]) throw new Error('不认识 ' + provider);
  let all = {}; try { all = JSON.parse(readFileSync(keyFile(home), 'utf8')); } catch { /* 第一次 */ }
  if (key) all[provider] = String(key).trim(); else delete all[provider];
  mkdirSync(dirname(keyFile(home)), { recursive: true });
  writeFileSync(keyFile(home), JSON.stringify(all, null, 2));
  delete onlineCache[provider];
}
const onlineCache = {};
async function onlineModels(cfg) {
  if (cfg.offline) return [];
  const out = [];
  for (const [p, o] of Object.entries(ONLINE)) {
    const key = onlineKey(cfg, p);
    if (!key) continue;
    if (!onlineCache[p] || Date.now() - onlineCache[p].t > 10 * 60e3) {
      try {
        const r = await fetch(o.url + '/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        onlineCache[p] = { t: Date.now(), list: (await r.json()).data.map(m => ({ id: p + ':' + m.id, name: m.name || m.id, embed: false, loaded: true, online: true, ctx: m.context_window || null, maxCtx: m.context_window || null })) };
      } catch { continue; }
    }
    out.push(...onlineCache[p].list);
  }
  return out;
}
// root 给了：工作区自己的 .synapsis/ai.json 可以覆盖（比如某个项目关掉语义配色；自检用它把临时工作区指到假服务）
export function aiConfig(home, root = null) {
  const read = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
  return { ...AI_DEFAULTS, keys: keyFile(home), ...read(cfgFile(home)), ...(root ? read(join(root, '.synapsis', 'ai.json')) : {}), ...(process.env.SYNAPSIS_LLM_URL ? { url: process.env.SYNAPSIS_LLM_URL } : {}) };
}
export function saveAiConfig(home, patch) {
  const { keys, ...next } = { ...aiConfig(home), ...patch }; // keys = key 文件的路径，每次现算，不存
  mkdirSync(dirname(cfgFile(home)), { recursive: true });
  writeFileSync(cfgFile(home), JSON.stringify(next, null, 2));
  return { ...next, keys };
}

const post = async (cfg, path, body, ms = 120000) => {
  const r = await fetch(cfg.url.replace(/\/$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`LM Studio ${path} ${r.status}：${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// 连得上吗 + 有哪些模型（分嵌入 / 对话）。LM Studio 自带的 /api/v0/models 有 type；别家 OpenAI 兼容服务就按名字猜
export async function aiStatus(cfg) {
  const base = cfg.url.replace(/\/$/, '');
  try {
    let list = null;
    try {
      const r = await fetch(base.replace(/\/v1$/, '') + '/api/v0/models', { signal: AbortSignal.timeout(3000) });
      if (r.ok) list = (await r.json()).data.map(m => ({ id: m.id, embed: m.type === 'embeddings', loaded: m.state === 'loaded', vision: m.type === 'vlm', ctx: m.loaded_context_length || null, maxCtx: m.max_context_length || null })); // ctx = 加载时设的上下文长度（没加载 = null），maxCtx = 模型最多支持
    } catch { /* 不是 LM Studio */ }
    if (!list) {
      const r = await fetch(base + '/models', { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      list = (await r.json()).data.map(m => ({ id: m.id, embed: /embed/i.test(m.id) }));
    }
    return { ok: true, local: true, cfg, embed: list.filter(m => m.embed), chat: list.filter(m => !m.embed), ...await onlinePart(cfg) };
  } catch (e) {
    const on = await onlinePart(cfg); // LM Studio 没开也能用在线对话（嵌入类功能这时没有）
    if (on.online.length) return { ok: true, local: false, cfg, embed: [], chat: [], ...on, warn: `本地 LM Studio 没连上（${e.cause?.code || e.message}）：潜在关联、语义配色用不了，在线对话照常` };
    return { ok: false, local: false, cfg, ...on, error: `连不上 ${base}（LM Studio 开了本机服务吗？）：${e.cause?.code || e.message}` };
  }
}
// online = 在线对话模型列表；hasKey = 各家有没有 key（只回有没有，不回 key）
async function onlinePart(cfg) {
  return { online: await onlineModels(cfg), hasKey: Object.fromEntries(Object.keys(ONLINE).map(p => [p, !!onlineKey(cfg, p)])) };
}
// 这次用的对话模型的信息（上下文容量等）
export const chatInfo = (st, id) => (st.chat || []).find(m => m.id === id) || (st.online || []).find(m => m.id === id) || null;

// —— 嵌入：缓存在工作区 .synapsis/embed.json（按 模型 + 文本 的哈希；向量归一化后存，余弦 = 点积）——
const h = s => createHash('sha1').update(s).digest('base64').slice(0, 20);
const pack = v => Buffer.from(new Float32Array(v).buffer).toString('base64');
const unpack = s => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const norm = v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map(x => x / s); };
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export async function embed(cfg, texts, cacheFile = null) {
  let cache = {};
  if (cacheFile) try { const c = JSON.parse(readFileSync(cacheFile, 'utf8')); if (c.model === cfg.embed) cache = c.vecs; } catch { /* 第一次 */ }
  const key = t => h(cfg.embed + '\n' + t);
  const miss = [...new Set(texts.filter(t => !cache[key(t)]))];
  for (let i = 0; i < miss.length; i += 32) {
    const part = miss.slice(i, i + 32);
    const r = await post(cfg, '/embeddings', { model: cfg.embed, input: part });
    r.data.forEach((d, j) => { cache[key(part[d.index ?? j])] = pack(norm(d.embedding)); });
  }
  if (cacheFile && miss.length) { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ model: cfg.embed, vecs: cache })); }
  return texts.map(t => unpack(cache[key(t)]));
}
const cacheOf = root => join(root, '.synapsis', 'embed.json');

// —— 对话：一次性短回答。Qwen3 的思考用 /no_think 关掉，回来的 <think> 段剥掉 ——
// opts.kind = 日志里的用途名；opts.history = 之前几轮 [{role, content}]（AI 指令框的短记忆）；opts.usage = 传个空对象进来，填上服务端报的 token 用量
// opts.bulk = 高频后台调用（潜在关联重排、语义配色归类）→ 按 cfg.bulkSrc 选本地 / 在线，其余按 cfg.agentSrc
export async function chat(cfg, system, user, maxTokens = 300, opts = {}) {
  const model = chatModel(cfg, opts.bulk), on = onlineOf(model);
  const messages = [{ role: 'system', content: system }, ...(opts.history || []), { role: 'user', content: on ? user : user + '\n/no_think' }];
  const t0 = Date.now();
  let raw = '', err = null;
  try {
    const body = { model: on ? on.model : model, temperature: opts.temperature ?? 0.3, max_tokens: maxTokens, messages };
    let r;
    if (on) { // 在线：默认不思考（一句话 < 1 秒，省钱）；设了思考强度 → reasoning_effort，思考过程丢掉只要答案
      const key = onlineKey(cfg, on.provider);
      if (!key) throw new Error(`没有 ${on.provider} 的 key：AI 设置「在线」页填，或写进 ${cfg.keys}（{"${on.provider}": "sk-…"}），或设环境变量 ${on.env}`);
      const eff = EFFORTS.includes(cfg.onlineEffort) && cfg.onlineEffort !== 'off' ? { reasoning_effort: cfg.onlineEffort, max_tokens: maxTokens + 4000 } : { thinking: { type: 'disabled' } };
      const res = await fetch(on.url + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ ...body, ...eff }), signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`${on.provider} ${res.status}：${(await res.text()).slice(0, 200)}`);
      r = await res.json();
    } else r = await post(cfg, '/chat/completions', body);
    raw = r.choices?.[0]?.message?.content || '';
    if (opts.usage && r.usage) Object.assign(opts.usage, r.usage);
  } catch (e) { err = e; }
  aiLog(cfg, { kind: opts.kind || 'chat', model, effort: on ? cfg.onlineEffort : undefined, ms: Date.now() - t0, messages, raw, error: err?.message, usage: opts.usage });
  if (err) throw err;
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// >v<🤖AI辅助-日志-每次调对话模型：用途 / 模型 / 耗时 / 发出去的全部消息 / 原始回答 / 出错，追加到工作区 .synapsis/ai_log.jsonl（超过 2MB 砍掉前一半）
//   cfg.log = 日志文件路径（服务端按工作区填；没填 = 不记）。界面：AI 指令框的「日志」页
export function aiLog(cfg, entry) {
  if (!cfg.log) return;
  try {
    mkdirSync(dirname(cfg.log), { recursive: true });
    writeFileSync(cfg.log, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n', { flag: 'a' });
    const s = readFileSync(cfg.log, 'utf8');
    if (s.length > 2e6) writeFileSync(cfg.log, s.slice(s.indexOf('\n', s.length / 2) + 1));
  } catch { /* 日志写不了不影响功能 */ }
}
export function readAiLog(file, n = 60) {
  try { return readFileSync(file, 'utf8').trim().split('\n').slice(-n).reverse().map(l => JSON.parse(l)); } catch { return []; }
}

// 节点用来算相似度的文字：名字 + 正文开头（不放所在路径和属性：同一分组的兄弟 / 同样带 axes、kind 的节点会因此全都「很像」，2026-10-08 实测）
const pathOf = (g, id) => { const out = []; for (let x = g.nodes.get(id)?.parent; x; x = g.nodes.get(x)?.parent) out.unshift(g.nodes.get(x).label); return out.join(' / '); };
function nodeText(ws, id) {
  const n = ws.graph.nodes.get(id);
  return [n.label, (n.body || '').replace(/\s+/g, ' ').slice(0, 300)].filter(Boolean).join('\n');
}
// 项目里的 md 文档（__synapsis 和 _过期的 不算），最多 maxFiles 个
function projectDocs(root, maxFiles = 400) {
  const out = [];
  const walk = items => { for (const it of items) { if (out.length >= maxFiles) return; if (it.dir) { if (it.name !== DIR && it.name !== '_过期的') walk(it.children); } else if (/\.md$/i.test(it.name)) out.push(it.path); } };
  walk(listTree(root).tree);
  return out.map(p => { let t = ''; try { t = readFileSync(join(root, p), 'utf8').replace(/^---[\s\S]*?\n---/, '').replace(/\s+/g, ' ').slice(0, 600); } catch { /* 读不了就只用名字 */ } return { path: p, label: p.split('/').pop().replace(/\.md$/i, ''), text: p.replace(/\.md$/i, '') + '\n' + t }; });
}

// >v<🤖AI辅助-潜在关联-选中节点 → 最像它、但还没连上（不是直接连线、不是祖先 / 子孙）的节点和项目文档
export async function related(root, id, cfg, k = 20) {
  const ws = loadWorkspace(root), g = ws.graph;
  if (!g.nodes.has(id)) throw new Error('没有这个节点：' + id);
  const near = new Set([id]);
  for (const e of g.edges) { if (e.from === id) near.add(e.to); if (e.to === id) near.add(e.from); }
  for (let x = g.nodes.get(id).parent; x; x = g.nodes.get(x)?.parent) near.add(x);
  const kids = x => { for (const c of g.nodes.get(x)?.children || []) { near.add(c); kids(c); } }; kids(id);
  const nodes = [...g.nodes.keys()].filter(x => x && !near.has(x) && !isDropped(g, x));
  const docs = projectDocs(root);
  const texts = [nodeText(ws, id), ...nodes.map(x => nodeText(ws, x)), ...docs.map(d => d.text)];
  const v = await embed(cfg, texts, cacheOf(root));
  const items = [
    ...nodes.map((x, i) => ({ kind: 'node', id: x, label: g.nodes.get(x).label, where: pathOf(g, x), score: dot(v[0], v[1 + i]) })),
    ...docs.map((d, i) => ({ kind: 'file', id: d.path, label: d.label, where: d.path, score: dot(v[0], v[1 + nodes.length + i]) })),
  ];
  return items.sort((a, b) => b.score - a.score).slice(0, k).map(it => ({ ...it, score: Math.round(it.score * 1000) / 1000 }));
}

// 一句话说两个东西可能是什么关系（展开潜在关联里某一条时才问，懒加载）
export async function explainRelation(root, id, other, cfg) {
  const ws = loadWorkspace(root);
  const b = other.kind === 'file' ? projectDocs(root).find(d => d.path === other.id)?.text || other.id : nodeText(ws, other.id);
  return chat(cfg, '你在帮人整理一个项目的思维导图。给你两个条目，用一句中文（不超过 50 字）说出它们之间可能有什么关系、为什么值得连起来。看不出有意义的关系就回答「看不出明显关系」。只输出这一句。', `A：${nodeText(ws, id)}\n\nB：${b}`, 200, { kind: "关系说明" });
}

// >v<🤖AI辅助-精排-嵌入只看「字面像不像」（👤 2026-10-08：嵌入不够用）→ 对话模型（8B）给嵌入挑出的前 N 条逐条打 0~3 分 + 一句理由
//   约束：模型只返回「序号: 分数 | 理由」这样的行，代码按格式抠数字和短文本，别的输出一律丢掉；模型不碰文件、不执行任何操作
export async function rerank(root, id, items, cfg) {
  const ws = loadWorkspace(root), docs = items.some(x => x.kind === 'file') ? projectDocs(root) : [];
  const textOf = it => (it.kind === 'file' ? docs.find(d => d.path === it.id)?.text || it.id : nodeText(ws, it.id)).replace(/\s+/g, ' ').slice(0, 160);
  const list = items.slice(0, 20);
  const raw = await chat(cfg, `你在帮人整理一个项目的思维导图，判断候选条目和目标条目有没有值得连起来的关系（因果、组成、输入输出、同一机制、互相制约）。
只是用词相近、但讲的不是一回事 → 0 分。评分：0 无关，1 弱相关，2 有关，3 强相关。
每个候选输出一行，格式严格是：序号: 分数 | 理由（不超过 25 字）
不要输出别的任何文字。`, `目标：${nodeText(ws, id).replace(/\s+/g, ' ').slice(0, 300)}\n\n候选：\n${list.map((it, i) => `${i + 1}. ${textOf(it)}`).join('\n')}`, 60 + list.length * 40, { kind: "精排", temperature: 0.1, bulk: true });
  const got = new Map();
  // 8B 实测会把名字也复述一遍（「1. 名字 | 2 | 理由」）→ 按竖线切开，取第一个单独是 0~3 的段当分数，它后面的段当理由
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*[:：.、]\s*(.*)$/);
    if (!m || +m[1] < 1 || +m[1] > list.length) continue;
    const segs = m[2].split(/[|｜]/).map(s => s.trim()), si = segs.findIndex(s => /^[0-3]$/.test(s));
    if (si < 0) continue;
    got.set(+m[1] - 1, { llm: +segs[si], why: (segs.slice(si + 1).join(' ') || '').slice(0, 60) });
  }
  return list.map((it, i) => ({ ...it, ...(got.get(i) || { llm: null, why: '' }) }))
    .sort((a, b) => (b.llm ?? -1) - (a.llm ?? -1) || b.score - a.score);
}

// >v<🤖AI辅助-语义配色-词表没命中的节点（自己和祖先都没命中），让对话模型按词表的行归类（可以归「无」）
//   返回 {id: 颜色}，交给 colorMap：优先级在词表命中之后、顶层轮色之前。
//   结果按名字缓存在 .synapsis/ai_colors.json（词表一改就作废），新节点才补问 —— 打开页面不用每次都等模型。
//   （试过用嵌入比名字和词表的词：短名字分差只有 0.01~0.05，「主界面 UI」被认成「观测」，不可靠 → 改用对话模型）
export async function semColors(root, cfg) {
  const ws = loadWorkspace(root), g = ws.graph;
  const { rules } = parseColorWords(ws.colorWords ?? DEFAULT_WORDS);
  if (!rules.length) return {};
  const chainHit = id => { for (let x = id; x; x = g.nodes.get(x)?.parent) if (wordColor(g.nodes.get(x).label, rules)) return true; return false; };
  const ids = [...g.nodes.keys()].filter(x => x && !isDropped(g, x) && !chainHit(x));
  const cache = await classifyLabels(cfg, join(root, '.synapsis', 'ai_colors.json'), rules.map(r => r.words.join('、')), ids.map(x => g.nodes.get(x).label),
    '你在帮人给思维导图的节点归类配色。', '语义配色');
  const out = {};
  for (const id of ids) { const r = cache[g.nodes.get(id).label]; if (r >= 0) out[id] = rules[r].color; }
  return out;
}

// 通用：把一批名字归到 rows 的某一行（-1 = 都不贴切）。按名字缓存在 file（行或模型一变就作废），只问新名字
async function classifyLabels(cfg, file, rows, labels, intro, kind) {
  const key = h(chatModel(cfg, true) + JSON.stringify(rows));
  let cache = {};
  try { const c = JSON.parse(readFileSync(file, 'utf8')); if (c.key === key) cache = c.map; } catch { /* 第一次 */ }
  const todo = [...new Set(labels.filter(l => !(l in cache)))];
  const list = rows.map((r, i) => `${i + 1}. ${r}`).join('\n');
  for (let i = 0; i < todo.length; i += 60) {
    const part = todo.slice(i, i + 60);
    const raw = await chat(cfg, `${intro}类别（编号. 关键词）：
${list}
对每个节点名，判断它最属于哪个类别；都不贴切就写 0。每行输出「节点序号: 类别编号」，不要别的文字。`, part.map((l, j) => `${j + 1}. ${l}`).join('\n'), 20 + part.length * 12, { kind, temperature: 0.1, bulk: true });
    const got = {};
    for (const m of raw.matchAll(/(\d+)\s*[:：.、]\s*(\d+)/g)) got[+m[1] - 1] = +m[2] - 1;
    part.forEach((l, j) => { const r = got[j]; cache[l] = r >= 0 && r < rows.length ? r : -1; });
  }
  if (todo.length) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ key, map: cache })); }
  return cache;
}

// >v<🤖AI辅助-语义图案-词表没认出、也没手动写 pattern: 的节点，让对话模型按「性质」归到图案词表某一行（可以归「无」）
export async function semPatterns(root, cfg) {
  const ws = loadWorkspace(root), g = ws.graph;
  const { rules } = parsePatternWords(ws.patternWords ?? DEFAULT_PATTERN_WORDS);
  if (!rules.length) return {};
  const ids = [...g.nodes.keys()].filter(x => x && !isDropped(g, x) && !g.nodes.get(x).meta?.pattern && !wordPattern(g.nodes.get(x).label, rules));
  const cache = await classifyLabels(cfg, join(root, '.synapsis', 'ai_patterns.json'), rules.map(r => `${r.pattern}（${PATTERN_HINT[r.pattern]}）：${r.words.join('、')}`), ids.map(x => g.nodes.get(x).label),
    '你在帮人给节点标注「性质」底纹（不是主题，是这个东西是什么性质：几何空间、读数数据、结构流程、文档规则、情绪信号）。', '语义图案');
  const out = {};
  for (const id of ids) { const r = cache[g.nodes.get(id).label]; if (r >= 0) out[id] = rules[r].pattern; }
  return out;
}

// >v<🤖AI辅助-生成词表-让对话模型看这个工作区的节点名，按调色板分组写一份新词表（只返回草稿，👤 点了才写）
export async function suggestWords(root, cfg) {
  const ws = loadWorkspace(root), g = ws.graph;
  const labels = [...g.nodes.keys()].filter(x => x && !isDropped(g, x)).map(x => g.nodes.get(x).label).slice(0, 300);
  const sys = `你在帮人给一个项目的思维导图配色。调色板只有这些颜色名：${Object.keys(PALETTE).join(' ')}。
按节点名的主题把它们分成 4~7 组，每组一个颜色，每组列 4~10 个「关键词」（短词，2~4 个字，节点名里会出现的那种词，不要整句节点名）。
只输出词表行，每行格式严格是：- 颜色: 词, 词, 词
不要输出任何别的文字。`;
  const raw = await chat(cfg, sys, `现有词表（可以参考、改进）：\n${(ws.colorWords ?? DEFAULT_WORDS).split(/\r?\n/).filter(l => /^\s*[-*]/.test(l)).join('\n')}\n\n节点名：\n${labels.join('、')}`, 800, { kind: "生成词表" });
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => /^[-*]\s*[^:：]+[:：]/.test(l));
  const head = DEFAULT_WORDS.split('\n- ')[0].trimEnd();
  const text = head + '\n\n' + lines.join('\n') + '\n';
  const { rules, bad } = parseColorWords(text);
  return { text, rules: rules.length, bad, raw };
}
// 写入新词表：旧的先备份进 __synapsis/_过期的/（不直接覆盖人改过的文件）
export function applyWords(root, text) {
  const f = join(root, DIR, WORDS_FILE);
  if (existsSync(f)) {
    const g = join(root, DIR, '_过期的', `_配色_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`);
    mkdirSync(dirname(g), { recursive: true }); copyFileSync(f, g);
  }
  writeFileSync(f, text);
  return f;
}
