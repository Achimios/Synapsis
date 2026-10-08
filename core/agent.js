// >v<🤖AI指令-后端-AI 指令框（Shift+F，👤 2026-10-08）：人用自然语言交代 → 对话模型（8B）只能从白名单「技能」里挑动作 →
//   代码校验（core/plan.js）→ 界面预览 → 👤 确认才执行（进撤销栈）。8B 不碰文件，执行全由这里的代码做。
//   技能说明书 = core/skills/*.md（frontmatter: do / args；正文 = 什么时候用 + 例子），整份喂进系统提示词。
//   短记忆 = 工作区 .synapsis/ai_chat.json（最近 30 轮，喂最近 8 轮）；日志 = .synapsis/ai_log.jsonl（core/ai.js aiLog）。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, workspaceOutline, saveOutline, setNodeMeta, setEdgeLabel, parseFrontmatter } from './workspace.js';
import { parseOutline, withStatus, withEdge, withoutEdge, withNode, withLabel, withMoved, toOutline, ROOT } from './outline.js';
import { validateAction, planMoves, VALIDATORS } from './plan.js';
import { chat } from './ai.js';
import { pickKnowledge, knowledgeText } from './knowledge.js';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills');
export function loadSkills(dir = SKILL_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => {
    const { meta, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
    return { file: f, name: f.replace(/\.md$/, ''), do: meta.do, args: meta.args, body: body.trim() };
  });
}

const ST = { done: '✅', partial: '◐', todo: '○', dropped: '❌' };
// 本页（scope 的子节点）+ 选中的节点，编号 n1、n2…；模型只能用这些编号（真 id 是长路径，交给模型容易抄错）
export function pageContext(ws, scope, selected = []) {
  const g = ws.graph;
  if (!g.nodes.has(scope)) scope = ROOT;
  const ids = [...g.nodes.get(scope).children];
  for (const s of selected) if (g.nodes.has(s) && s !== ROOT && !ids.includes(s)) ids.push(s);
  const refs = new Map(), back = new Map();
  ids.forEach((id, i) => { refs.set('n' + (i + 1), id); back.set(id, 'n' + (i + 1)); });
  const sel = new Set(selected);
  const lines = ids.map(id => {
    const n = g.nodes.get(id), p = ws.layout[id];
    return [back.get(id), n.label, n.status ? ST[n.status] : '', n.children.length ? `（${n.children.length} 个子节点）` : '',
      n.parent !== scope ? `（在「${g.nodes.get(n.parent)?.label}」下）` : '', p ? `@(${Math.round(p.x / 10) * 10},${Math.round(p.y / 10) * 10})` : '', sel.has(id) ? '★选中' : ''].filter(Boolean).join(' ');
  });
  const edges = g.edges.filter(e => back.has(e.from) && back.has(e.to)).map(e => `${back.get(e.from)} -> ${back.get(e.to)}${e.kind ? '（' + e.kind + '）' : ''}${e.label ? '「' + e.label + '」' : ''}`);
  const crumb = []; for (let x = scope; x && x !== ROOT; x = g.nodes.get(x)?.parent) crumb.unshift(g.nodes.get(x).label);
  return { scope, refs, back, text: `当前页：${crumb.length ? crumb.join(' / ') : '根'}\n节点（编号 名字 状态 子节点数 @画布坐标(x 向右, y 向下) 是否选中）：\n${lines.join('\n') || '（空页）'}\n连线：\n${edges.join('\n') || '（无）'}` };
}

export function systemPrompt(skills = loadSkills()) {
  return `你是 Synapsis（一个思维导图 / 节点图工具）里的操作助手。人会用自然语言交代要在【当前页】做的事，你只能用下面列出的动作完成。

硬规则：
1. 只输出一个 JSON 对象，不要任何别的文字、不要代码块标记：{"say": "给人看的一句中文", "actions": [ 动作, … ]}
   每次都必须有 actions 字段（做不了就是空数组）。做事时 say 说「将要做什么」（人确认后才会执行），不要说「已经做了」。
2. 每个动作是 {"do": 动作名, …参数}。动作名只能是：${skills.map(s => s.do).join('、')}。
3. 节点只能用本页列出的编号（n1、n2…），不要写名字当 id，不要编造编号。
4. 不能删除节点（没有这个动作）。人要删节点 → actions 留空，say 里请他自己右键删除。
5. 人的意思不清楚、或者做不到 → actions 留空，say 里说明或反问。不要猜着乱做。
6. 只做人要求的事，不要顺手多做。
7. 「这几个 / 选中的」= 标了 ★选中 的节点。
8. 人问的是软件怎么用而不是让你做事 → actions 留空，say 里请他换成问句再问一次（比如「怎么连线？」），会有专门的问答回答他。

可用动作（说明书）：
${skills.map(s => `## ${s.name}：${s.do}\n参数：${s.args}\n${s.body}`).join('\n\n')}`;
}

// 从模型输出里抠出 JSON 对象（容忍前后废话 / 代码块）
export function parseReply(raw) {
  const s = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('输出里没有 JSON 对象');
  const j = JSON.parse(s.slice(a, b + 1));
  if (typeof j !== 'object' || Array.isArray(j)) throw new Error('不是 JSON 对象');
  return { say: typeof j.say === 'string' ? j.say.slice(0, 1200) : '', actions: Array.isArray(j.actions) ? j.actions.slice(0, 30) : [] };
}

// —— 短记忆 ——
const chatFile = root => join(root, '.synapsis', 'ai_chat.json');
export const loadChat = root => { try { return JSON.parse(readFileSync(chatFile(root), 'utf8')); } catch { return []; } };
export const clearChat = root => { try { mkdirSync(dirname(chatFile(root)), { recursive: true }); writeFileSync(chatFile(root), '[]'); } catch { /* */ } };
const pushChat = (root, turn) => { const h = [...loadChat(root), turn].slice(-30); mkdirSync(dirname(chatFile(root)), { recursive: true }); writeFileSync(chatFile(root), JSON.stringify(h, null, 1)); };

// >v<🤖AI指令-问答-问句 = 问软件怎么用（不是让它做事）。「怎么把这几个左对齐」也算问句：答法 + 提示可以直接说让它做
export const isQuestion = t => /怎么|如何|怎样|哪里|在哪|哪个|有哪些|什么|能不能|可不可以|吗[？?。！!\s]*$|[？?]\s*$|快捷键|是干嘛|干什么用/.test(String(t));
export const ANSWER_PROMPT = `你是 Synapsis（思维导图 / 节点图工具）的使用说明助手。人问软件怎么用，你只根据消息里的【软件知识】回答。
- 写出具体的按键、按钮名和操作步骤；简洁，几行就好，可以用「- 」列点。
- 【软件知识】里没有的，就说「手册里没写这个」，不要编造按键或功能。
- Synapsis 没有菜单栏，也没有知识里没列出的快捷键（比如别编 Ctrl+L）。
- 如果人想做的事属于你能代劳的动作（选中、对齐、排列、大纲排序、配色、状态、连线、删线、新建、改名、移动进别的节点），先答怎么手动做，最后加一句：也可以直接对我说「……」，我来做。别的事（开关显示、主题、删除……）不要说你能做。
- 泛泛地问「有哪些快捷键 / 能做什么」→ 只挑最常用的 8 个左右列出，最后说：完整列表按 ? / F1（或顶栏「⌨ 快捷键」）。
- 只输出给人看的中文回答，不要 JSON，不要代码块。`;

// >v<🤖AI指令-上下文-还没问之前估一下这次会占多少 token（系统提示词 + 当前页 + 短记忆 + 知识预算 + 回答上限）。
//   粗估：中日韩字 ≈ 1 token，其它 ≈ 3.5 字符 1 token（Qwen 分词实测量级）；问过之后界面换成服务端报的真实用量
export const estTokens = s => { const t = String(s); const cjk = (t.match(/[㐀-鿿＀-￯]/g) || []).length; return Math.round(cjk + (t.length - cjk) / 3.5); };
export function estimateContext(root, { scope = ROOT, selected = [] } = {}) {
  const ws = loadWorkspace(root), ctx = pageContext(ws, scope, selected);
  const hist = loadChat(root).slice(-8).map(t => t.user + JSON.stringify({ say: t.say, actions: t.actions || [] })).join('');
  const parts = { 系统提示词: estTokens(systemPrompt()), 当前页: estTokens(ctx.text), 短记忆: estTokens(hist), 回答上限: 1200 };
  return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}

// >v<🤖AI指令-问模型-返回 {say, actions: [{ok, why?, desc, …}], raw}；不执行。输出不合格式 → 把错误告诉它重来一次
export async function runAgent(root, { scope = ROOT, selected = [], text }, cfg) {
  if (!text || !String(text).trim()) throw new Error('说点什么');
  const ws = loadWorkspace(root), ctx = pageContext(ws, scope, selected);
  // 历史里的回答按规定格式原样放回（以前存成 {say, done}，8B 会照着学、把 actions 丢掉 —— 2026-10-08 实测）；编号是当时那一页的，可能已变
  const history = loadChat(root).slice(-8).flatMap(t => [{ role: 'user', content: t.user }, { role: 'assistant', content: JSON.stringify({ say: t.say, actions: t.actions || [] }) }]);
  // 问用法（怎么 / 如何 / 哪 / 快捷键 / 问号…）→ 走问答：单独的提示词 + 挑出来的软件知识，纯文本回答、不出动作。
  //   和做事混在一个 JSON 提示词里时，8B 会给「将切换到白色主题」+ 乱编动作、或者知识就在眼前还说「手册里没写」（2026-10-08 实测）
  const know = pickKnowledge(text), usage = {}; // usage = LM Studio 报的 token 用量（prompt / completion / total），界面显示「已用 / 容量」
  if (isQuestion(text)) {
    const q = String(text).trim();
    const raw = await chat(cfg, ANSWER_PROMPT, `【软件知识】\n${know.length ? knowledgeText(know) : '（没有找到相关的段落）'}\n\n问题：${q}`, 900, { kind: 'AI 问答', usage, temperature: 0.2 });
    const say = raw.replace(/^```\w*\n?|```$/g, '').trim().slice(0, 1200) || '（模型没有回答）';
    pushChat(root, { t: new Date().toISOString(), scope: ctx.scope, user: q, say, actions: [], done: [] });
    return { say, actions: [], raw, knowledge: know.map(c => c.src), mode: 'answer', usage };
  }
  const sys = systemPrompt(), user = `${ctx.text}\n\n人说：${String(text).trim()}`;
  let raw = await chat(cfg, sys, user, 1200, { kind: 'AI 指令', history, usage, temperature: 0.1 }), reply;
  try { reply = parseReply(raw); } catch (e) {
    raw = await chat(cfg, sys, user + `\n\n（你上一次的输出不合格：${e.message}。只输出一个 JSON 对象。）`, 1200, { kind: 'AI 指令（重试）', history, usage, temperature: 0.1 });
    try { reply = parseReply(raw); } catch (e2) { reply = { say: '（模型的回答不是规定格式，没法执行：' + e2.message + '）', actions: [] }; }
  }
  const g = parseOutline(workspaceOutline(ws));
  for (const [id, n] of ws.graph.nodes) if (g.nodes.has(id)) g.nodes.get(id).status = n.status; // 状态以工作区为准
  g.edges = ws.graph.edges;
  const actions = reply.actions.map(a => validateAction(a, { refs: ctx.refs, graph: g, scope: ctx.scope }));
  // 嘴上说做了、手上没给动作（8B 实测会这样）→ 明说，别让人以为做了
  if (!actions.some(a => a.ok) && /^(已|将|会|我会|我将)|已(经)?(将|把|为|创建|新建|标记|删除|改|连|设|完成|排|对齐|选)/.test(reply.say)) reply.say += /删/.test(text) ? '（⚠ 删除节点不归 AI 做：请右键节点 → 删除）' : '（⚠ 模型没有给出能执行的动作，实际什么都没做）';
  pushChat(root, { t: new Date().toISOString(), scope: ctx.scope, user: String(text).trim(), say: reply.say, actions: reply.actions, done: actions.filter(a => a.ok).map(a => a.desc) });
  return { say: reply.say, actions, raw, knowledge: know.map(c => c.src), usage };
}

// >v<🤖AI指令-执行-👤 确认后：大纲类（新建 / 改名 / 状态 / 连线 / 删线 / 大纲排序）一次存盘 = 一步撤销；
//   连线类型 / 标签、颜色写 frontmatter；对齐 / 排列算好坐标交回前端（前端 move → 进撤销栈并存 _layout.json）。选中也交回前端。
//   boxes = 前端量到的卡片 {id: {x, y, w, h}}（存的坐标系）
export function applyPlan(root, actions, boxes = {}) {
  actions = actions.filter(a => a && a.ok);
  let g = (() => { const ws = loadWorkspace(root), h = parseOutline(workspaceOutline(ws)); return h; })();
  const ren = new Map(); // 旧 id → 新 id（改名会改子孙的 id）
  const fix = id => { for (const [o, n] of ren) { if (id === o) return n; if (id.startsWith(o + '/')) return n + id.slice(o.length); } return id; };
  const step = t => { if (t) g = parseOutline(t); };
  const kinds = [], colors = [], moved = new Set();
  for (const a of actions) {
    if (a.do === 'status') for (const id of a.ids) step(withStatus(g, fix(id), a.status === 'none' ? null : a.status));
    else if (a.do === 'link') { if (!a.exists) step(withEdge(g, fix(a.from), fix(a.to))); if (a.kind || a.label || a.exists) kinds.push(a); }
    else if (a.do === 'unlink') step(withoutEdge(g, fix(a.from), fix(a.to)));
    else if (a.do === 'create') {
      const r = withNode(g, fix(a.parent), null, a.label); step(r.text);
      if (a.from) step(withEdge(g, fix(a.from), r.id));
      if (a.to) step(withEdge(g, r.id, fix(a.to)));
    } else if (a.do === 'order') {
      const ids = a.ids.map(fix), p = g.nodes.get(g.nodes.get(ids[0]).parent), slots = p.children.map((c, i) => ids.includes(c) ? i : -1).filter(i => i >= 0);
      slots.forEach((s, k) => { p.children[s] = ids[k]; });
      step(toOutline(g));
    } else if (a.do === 'rename') {
      const id = fix(a.id), n = g.nodes.get(id), nid = n.parent === ROOT ? a.label : n.parent + '/' + a.label;
      step(withLabel(g, id, a.label)); ren.set(id, nid);
    } else if (a.do === 'move') {
      const r = withMoved(g, a.ids.map(fix), fix(a.parent));
      if (r.error) throw new Error('移动失败：' + r.error);
      step(r.text);
      for (const [o, n] of r.map) { for (const [k, v] of ren) if (v === o) ren.set(k, n); if (!ren.has(o)) ren.set(o, n); moved.add(o); }
    } else if (a.do === 'color') colors.push(a);
  }
  // 挪过的节点：把「最终 id → 原 id」交给 saveOutline，不靠名字猜（同 moveNodes）
  const orig = new Map(); for (const [o] of ren) if (moved.has(o) || [...moved].some(m => o.startsWith(m + '/'))) orig.set(fix(o), o);
  const report = saveOutline(root, toOutline(g), orig.size ? orig : null);
  if (!report.ok) throw new Error('执行失败：' + JSON.stringify(report.errors));
  for (const a of kinds) setEdgeLabel(root, fix(a.from), fix(a.to), a.label, a.kind);
  for (const a of colors) for (const id of a.ids) setNodeMeta(root, fix(id), { color: a.color === 'auto' ? null : a.color });
  const fixedBoxes = Object.fromEntries(Object.entries(boxes).map(([id, b]) => [fix(id), b]));
  const moves = planMoves(actions.filter(a => a.do === 'align' || a.do === 'arrange').map(a => ({ ...a, ids: a.ids.map(fix) })), fixedBoxes);
  const select = [...new Set(actions.filter(a => a.do === 'select').flatMap(a => a.ids.map(fix)))];
  return { report: { ...report, outline: workspaceOutline(loadWorkspace(root)) }, moves, select };
}
export { VALIDATORS };
