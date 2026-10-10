// >v<🤖AI指令-后端-AI 指令框（Shift+F，👤 2026-10-08）：人用自然语言交代 → 对话模型（8B）只能从白名单「技能」里挑动作 →
//   代码校验（core/plan.js）→ 界面预览 → 👤 确认才执行（进撤销栈）。8B 不碰文件，执行全由这里的代码做。
//   技能说明书 = core/skills/*.md（frontmatter: do / args；正文 = 什么时候用 + 例子），整份喂进系统提示词。
//   短记忆 = 工作区 .synapsis/ai_chat.json（最近 30 轮，喂最近 8 轮）；日志 = .synapsis/ai_log.jsonl（core/ai.js aiLog）。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, workspaceOutline, saveOutline, setNodeMeta, setNodeBody, setEdgeLabel, parseFrontmatter, findNodes, grepProject } from './workspace.js';
import { overlaps } from './arrange.js';
import { parseOutline, withStatus, withEdge, withoutEdge, withNode, withLabel, withMoved, toOutline, ROOT } from './outline.js';
import { validateAction, planMoves, VALIDATORS } from './plan.js';
import { chat, chatModel } from './ai.js';
import { pickKnowledge, knowledgeText, knowledgeChunks } from './knowledge.js';
import { memoryIndex, readMemories, writeMemory, indexStatus } from './memory.js';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills');
export function loadSkills(dir = SKILL_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => {
    const { meta, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
    return { file: f, name: f.replace(/\.md$/, ''), do: meta.do, args: meta.args, body: body.trim() };
  });
}

const ST = { done: '✅', partial: '◐', todo: '○', dropped: '❌' };
// 本页（scope 的子节点）+ 选中的节点，编号 n1、n2…；模型只能用这些编号（真 id 是长路径，交给模型容易抄错）
// boxes = 前端量到的卡片 {id: {x, y, w, h}}（有就用它的坐标和宽高 —— 模型自己算位置时要知道卡多大）
export function pageContext(ws, scope, selected = [], boxes = {}) {
  const g = ws.graph;
  if (!g.nodes.has(scope)) scope = ROOT;
  const ids = [...g.nodes.get(scope).children];
  for (const s of selected) if (g.nodes.has(s) && s !== ROOT && !ids.includes(s)) ids.push(s);
  const refs = new Map(), back = new Map();
  ids.forEach((id, i) => { refs.set('n' + (i + 1), id); back.set(id, 'n' + (i + 1)); });
  const sel = new Set(selected);
  const lines = ids.map(id => {
    const n = g.nodes.get(id), b = boxes[id], p = b || ws.layout[id];
    return [back.get(id), n.label, n.status ? ST[n.status] : '', n.children.length ? `（${n.children.length} 个子节点）` : '',
      n.parent !== scope ? `（在「${g.nodes.get(n.parent)?.label}」下）` : '', p ? `@(${Math.round(p.x / 10) * 10},${Math.round(p.y / 10) * 10})` : '', b ? `${Math.round(b.w)}×${Math.round(b.h)}` : '', sel.has(id) ? '★选中' : ''].filter(Boolean).join(' ');
  });
  const edges = g.edges.filter(e => back.has(e.from) && back.has(e.to)).map(e => `${back.get(e.from)} -> ${back.get(e.to)}${e.kind ? '（' + e.kind + '）' : ''}${e.label ? '「' + e.label + '」' : ''}`);
  const crumb = []; for (let x = scope; x && x !== ROOT; x = g.nodes.get(x)?.parent) crumb.unshift(g.nodes.get(x).label);
  return { scope, refs, back, text: `当前页：${crumb.length ? crumb.join(' / ') : '根'}\n节点（编号 名字 状态 子节点数 @左上角画布坐标(x 向右, y 向下) 宽×高 是否选中）：\n${lines.join('\n') || '（空页）'}\n连线：\n${edges.join('\n') || '（无）'}` };
}

// >v<🤖AI指令-宽松版-在线模型（聪明）用：👤 2026-10-08「被你训的太听话了…主观能动性…扁平化指挥给基层更多自由度」。
//   能聊、能接人设、自己推理、自己算坐标；唯一硬底线 = 改页面只能用白名单动作、人确认才执行、不能删节点。
//   整份软件知识直接放进来（7 千字左右；放在系统提示词 = 不变的前缀，在线服务的缓存能命中，几乎不花钱）
export function loosePrompt(skills = loadSkills(), knowledge = knowledgeChunks()) {
  return `你是 Synapsis（思维导图 / 节点图工具）里的 AI 搭档，和人一起在【当前页】上思考和整理。
你可以聊天、讨论想法、提建议、接受人给你的人设和语气，自己判断怎么做最好；拿不准的就说出你的猜测或者反问。别把自己当成只会查手册的说明书。

唯一的硬规矩：要改动页面，只能用下面的动作（人看过、确认后才执行）；没有删除节点的动作，人要删就请他右键删。
一条底线：图里写的是人的意图。你做不到节点里写的意图时，把差距说出来，别改节点的名字或正文去迁就能做到的；真要改意图，要明说「这是在改意图」，由人决定。

输出：只输出一个 JSON 对象，不要代码块标记：{"say": "给人看的话（可以多行，可以用 - 列点）", "actions": [ 动作, … ]}
- 不改页面时 actions 是空数组。改页面时 say 说清楚打算怎么做（人确认后才执行，别说成已经做完）。
- 动作是 {"do": 动作名, …参数}，动作名只能是：${skills.map(s => s.do).join('、')}。
- 节点只能用本页列出的编号（n1、n2…）。「这几个 / 选中的」= 标了 ★选中 的。
- 长期记忆：有时消息里会附【记忆索引】（每份一行：名字 + 一句描述）。觉得哪份和这次有关、想看全文，就只输出 {"read": ["名字", …]}（这一次不要 say 和 actions），全文会发给你，你再正常回答。用不上就别读。值得以后记住的，用 remember 提议。
- 查看：【当前页】只列了名字和位置。需要更多信息（某张卡的正文、某个节点里面有什么、项目里哪里提到某个词、某份文档、软件怎么用）时，只输出 {"look": [{"node": "n3"}, {"page": "n5"}, {"search": "词"}, {"file": "路径.md"}, {"manual": "关键词"}]}（这一次不要 say 和 actions），结果会发给你，你再继续。{"node": 编号} = 正文和属性；{"page": 编号} = 那个节点里面有什么（子节点和连线；里面的东西没有编号，只能读，不能动手）；{"search": 词} = 搜节点名字 / 正文 / 项目文件（结果没有编号）；{"file": 项目里的相对路径} = 读一份文本文件（md / txt / 代码…）；{"manual": 关键词} = 翻软件手册。查看只读，不改任何东西；最多连续查看 3 次，能直接答就别查。
- 【上一轮结果】：消息里可能有这一行，告诉你上次提议的动作人执行了没有、执行后检查出了什么问题（比如卡片重叠了）。以它为准，别凭印象说「已经做完了」；有问题就这一轮顺手修好。
- 坐标：@(x,y) 是卡片左上角，x 向右、y 向下，后面是宽×高。用 place 挪位置时自己算好，别和别的卡重叠（留 20 以上的空隙）。

动作（说明书）：
${skills.map(s => `## ${s.name}：${s.do}\n参数：${s.args}\n${s.body}`).join('\n\n')}

【软件知识】（人问怎么用时参考。快捷键表在下面；手册只给目录——要细节就 look {"manual": "关键词"} 翻。翻过手册和快捷键表都没有的功能就是没有：可以直说，也可以建议别的办法）
${knowledgeText(knowledge.filter(c => c.src.startsWith('快捷键')))}

【手册目录】（共 ${knowledge.filter(c => !c.src.startsWith('快捷键')).length} 段）：${[...new Set(knowledge.filter(c => !c.src.startsWith('快捷键')).map(c => c.src.replace('手册·', '')))].join('、')}`;
}

export function systemPrompt(skills = loadSkills()) {
  return `你是 Synapsis（一个思维导图 / 节点图工具）里的操作助手。人会用自然语言交代要在【当前页】做的事，你只能用下面列出的动作完成。

硬规则：
1. 只输出一个 JSON 对象，不要任何别的文字、不要代码块标记：{"say": "给人看的一句中文", "actions": [ 动作, … ]}
   每次都必须有 actions 字段（做不了就是空数组）。做事时 say 用一句话具体说出要做的事，比如「将把 6 张卡朝中间收紧，方位不变」（人确认后才会执行），不要说「已经做了」，也不要照抄这句例子。
2. 每个动作是 {"do": 动作名, …参数}。动作名只能是：${skills.map(s => s.do).join('、')}。
3. 节点只能用本页列出的编号（n1、n2…），不要写名字当 id，不要编造编号。
4. 不能删除节点（没有这个动作）。人要删节点 → actions 留空，say 里请他自己右键删除。
5. 人的意思不清楚、或者做不到 → actions 留空，say 里说明或反问。不要猜着乱做。
6. 只做人要求的事，不要顺手多做。
7. 「这几个 / 选中的」= 标了 ★选中 的节点。
8. 人问的是软件怎么用而不是让你做事 → actions 留空，say 里请他换成问句再问一次（比如「怎么连线？」），会有专门的问答回答他。
9. 人追问「为什么没做 / 怎么没变」→ 看上一轮：上一轮 actions 是空的就老实说没给出动作，这次把该做的动作补上；做不到就说做不到。
10. 消息里有【上一轮结果】就以它为准判断上一轮做没做；写了「执行后检查发现」的问题，这一轮顺手修好。

可用动作（说明书）：
${skills.map(s => `## ${s.name}：${s.do}\n参数：${s.args}\n${s.body}`).join('\n\n')}`;
}

// 从模型输出里抠出 JSON 对象（容忍前后废话 / 代码块）
export function parseReply(raw, max = 1200) {
  const s = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('输出里没有 JSON 对象');
  const j = JSON.parse(s.slice(a, b + 1));
  if (typeof j !== 'object' || Array.isArray(j)) throw new Error('不是 JSON 对象');
  return { say: typeof j.say === 'string' ? j.say.slice(0, max) : '', actions: Array.isArray(j.actions) ? j.actions.slice(0, 60) : [], read: Array.isArray(j.read) ? j.read.slice(0, 6).map(String) : [], look: Array.isArray(j.look) ? j.look.slice(0, 6).filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [] };
}

// —— 短记忆 ——
const chatFile = root => join(root, '.synapsis', 'ai_chat.json');
export const loadChat = root => { try { return JSON.parse(readFileSync(chatFile(root), 'utf8')); } catch { return []; } };
export const clearChat = root => { try { mkdirSync(dirname(chatFile(root)), { recursive: true }); writeFileSync(chatFile(root), '[]'); } catch { /* */ } };
// >v<🤖AI指令-短记忆-只喂「和这次同一种模式」的历史（2026-10-08 实测：在线模型读到严格版时代留下的「手册里没写，我不能编」，照着学，拒绝演明日香）。
//   每轮记下 mode（loose 在线宽松版 | strict 本地严格版和问答）；没有 mode 的旧记录算 strict。界面里仍然全部显示，只是不喂给另一种模式的模型
export const recentTurns = (root, loose, n = 8) => loadChat(root).filter(t => (t.mode || 'strict') === (loose ? 'loose' : 'strict')).slice(-n);
const saveChat = (root, h) => { mkdirSync(dirname(chatFile(root)), { recursive: true }); writeFileSync(chatFile(root), JSON.stringify(h, null, 1)); };
const pushChat = (root, turn) => saveChat(root, [...loadChat(root), turn].slice(-30));

// >v<🤖AI指令-结果-历史里分清「提议了」和「执行了」（2026-10-08）：done 只是提议时校验通过的动作；人确认执行后 applyPlan 回写 executed / warnings。
//   喂给模型的是下一轮消息里的一行【上一轮结果】：执行了什么（和执行后检查出的问题）/ 人没执行。提议里没有可执行动作的轮次不写。
export function outcomeNote(t) {
  if (!t || !t.done || !t.done.length) return '';
  if (t.executed?.length) return `【上一轮结果】人确认并执行了：${t.executed.join('；')}。${t.warnings?.length ? '执行后检查发现：' + t.warnings.join('；') + '。' : ''}`;
  return '【上一轮结果】人没有执行你上一轮提议的动作，页面没有因此改变。';
}
// 把结果记在最近一个「有可执行提议、还没记结果」的轮次上；没有对话记录（比如自检里直接调 applyPlan）就什么也不做
export function recordOutcome(root, { executed = [], warnings = [] }) {
  const h = loadChat(root);
  const i = h.findLastIndex(t => t.done?.length);
  if (i < 0 || h[i].executed) return false;
  h[i].executed = executed; if (warnings.length) h[i].warnings = warnings;
  saveChat(root, h); return true;
}

// >v<🤖AI指令-问答-问句 = 问软件怎么用（不是让它做事）。「怎么把这几个左对齐」也算问句：答法 + 提示可以直接说让它做
// 追问上一轮（「为什么什么都没做 / 怎么没反应」）不是问用法：走做事那条路，它看得到上一轮 —— 问答那条没有历史，只会答「手册里没写」（2026-10-08 实测）
export const isFollowup = t => /(为什么|为啥).{0,6}(没|不)|(怎么|咋).{0,4}(没|还是)|没反应|没动|没变/.test(String(t));
export const isQuestion = t => !isFollowup(t) && /怎么|如何|怎样|哪里|在哪|哪个|有哪些|什么|能不能|可不可以|吗[？?。！!\s]*$|[？?]\s*$|快捷键|是干嘛|干什么用/.test(String(t));
export const ANSWER_PROMPT = `你是 Synapsis（思维导图 / 节点图工具）的使用说明助手。人问软件怎么用，你只根据消息里的【软件知识】回答。
- 写出具体的按键、按钮名和操作步骤；简洁，几行就好，可以用「- 」列点。
- 【软件知识】里没有的，就说「手册里没写这个」，不要编造按键或功能。
- 没有固定口令，别编「说『整理页面』」这种。
- Synapsis 没有菜单栏，也没有知识里没列出的快捷键（比如别编 Ctrl+L）。
- 如果人想做的事属于你能代劳的动作（选中、对齐、排列、收紧（方位不变整体靠拢）、大纲排序、配色、状态、连线、删线、新建、改名、移动进别的节点），先答怎么手动做，最后加一句：也可以直接用自己的话叫我做，我来做。别的事（开关显示、主题、删除……）不要说你能做。
- 泛泛地问「有哪些快捷键 / 能做什么」→ 只挑最常用的 8 个左右列出，最后说：完整列表按 ? / F1（或顶栏「⌨ 快捷键」）。
- 只输出给人看的中文回答，不要 JSON，不要代码块。`;

// >v<🤖AI指令-上下文-还没问之前估一下这次会占多少 token（系统提示词 + 当前页 + 短记忆 + 知识预算 + 回答上限）。
//   粗估：中日韩字 ≈ 1 token，其它 ≈ 3.5 字符 1 token（Qwen 分词实测量级）；问过之后界面换成服务端报的真实用量
export const estTokens = s => { const t = String(s); const cjk = (t.match(/[㐀-鿿＀-￯]/g) || []).length; return Math.round(cjk + (t.length - cjk) / 3.5); };
export const isLoose = cfg => !!cfg && /^\w+:/.test(chatModel(cfg) || ''); // 在线模型 → 宽松版
export function estimateContext(root, { scope = ROOT, selected = [], loose = false } = {}) {
  const ws = loadWorkspace(root), ctx = pageContext(ws, scope, selected);
  const hist = recentTurns(root, loose).map(t => t.user + JSON.stringify({ say: t.say, actions: t.actions || [] })).join('');
  const parts = { 系统提示词: estTokens(loose ? loosePrompt() : systemPrompt()), 当前页: estTokens(ctx.text), 短记忆: estTokens(hist), 回答上限: 1200 };
  return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}

// >v<🤖AI指令-查看-只读原语（只给在线宽松版；👤「给原语不给剧本」）：模型回 {"look": [{node}|{page}|{search}]}，这里查完附在消息后面再问一轮，最多 LOOK_MAX 跳。
//   node = 本页某张卡的正文和属性；page = 本页某个节点里面有什么（子节点 + 连线，没有编号 → 只能读）；search = 节点名字 / 正文 / 项目文件
//   只读：不碰工作区。返回 { text, said: ['n3 正文', '搜「词」'…] }
export const LOOK_MAX = 3;
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `…（共 ${s.length} 字，已截断）` : s; };
export function lookAt(root, ctx, items) {
  const g = loadWorkspace(root).graph, ws = { graph: g }, out = [], said = [];
  const lab = id => g.nodes.get(id)?.label ?? id;
  const props = n => Object.entries(n.meta || {}).filter(([k]) => k !== 'to').map(([k, v]) => `${k}: ${v}`).join('；');
  for (const it of items.slice(0, 6)) {
    if (it.node != null || it.page != null) {
      const ref = String(it.node ?? it.page), id = ctx.refs.get(ref), n = id && g.nodes.get(id);
      if (!n) { out.push(`【${ref}】本页没有这个编号（只能用【当前页】列出的编号）`); continue; }
      if (it.node != null) {
        said.push(`${ref}「${n.label}」正文`);
        out.push(`【${ref}「${n.label}」正文】\n${clip(n.body?.trim() || '（没有正文）', 6000)}${props(n) ? '\n属性：' + clip(props(n), 400) : ''}`);
      } else {
        said.push(`${ref}「${n.label}」里面`);
        const kids = n.children.slice(0, 40).map(c => { const k = g.nodes.get(c); return `- ${k.label}${k.status ? ' ' + ST[k.status] : ''}${k.children.length ? `（${k.children.length} 个子节点）` : ''}`; });
        const inner = new Set(n.children), edges = g.edges.filter(e => inner.has(e.from) && inner.has(e.to)).slice(0, 40).map(e => `${lab(e.from)} -> ${lab(e.to)}${e.kind ? '（' + e.kind + '）' : ''}${e.label ? '「' + e.label + '」' : ''}`);
        out.push(`【${ref}「${n.label}」里面】（这里面的节点没有编号，只能读）\n${kids.join('\n') || '（空）'}${edges.length ? '\n连线：\n' + edges.join('\n') : ''}`);
      }
    } else if (typeof it.file === 'string' && it.file.trim()) {
      const rel = it.file.trim().replace(/^[\\/]+/, ''), abs = resolve(root, rel), back = relative(root, abs);
      said.push(`读文件 ${rel}`);
      if (!rel || back.startsWith('..') || isAbsolute(back) || /(^|[\\/])(\.synapsis|\.git|node_modules)([\\/]|$)/.test(back) || !/\.(md|txt|json|js|jsx|ts|css|html|csv|yaml|yml)$/i.test(back)) { out.push(`【文件 ${rel}】不能读（只读项目里的文本文件：md / txt / json / 代码…，不含 .synapsis / .git）`); continue; }
      let t; try { t = readFileSync(abs, 'utf8'); } catch { out.push(`【文件 ${rel}】没有这个文件`); continue; }
      out.push(`【文件 ${rel}】\n${clip(t, 8000)}`);
    } else if (typeof it.manual === 'string' && it.manual.trim()) {
      const q = it.manual.trim().slice(0, 80); said.push(`翻手册「${q}」`);
      const picks = pickKnowledge(q, { budget: 3500 });
      out.push(`【手册·${q}】\n${picks.length ? knowledgeText(picks) : '（手册里没有相关的段落）'}`);
    } else if (typeof it.search === 'string' && it.search.trim()) {
      const q = it.search.trim().slice(0, 60); said.push(`搜「${q}」`);
      const nodes = findNodes(ws, q).slice(0, 10).map(h => `- 「${lab(h.id)}」${g.nodes.get(h.id).parent !== ROOT ? `（在「${lab(g.nodes.get(h.id).parent)}」下）` : ''} ${h.where}：${h.snippet}`);
      const files = grepProject(root, q, { max: 8, perFile: 2 }).hits.map(h => `- ${h.path}:${h.line} ${h.text}`);
      out.push(`【搜「${q}」】（结果没有编号；要动手就请人先进到那一页）\n节点：\n${nodes.join('\n') || '（没有）'}\n项目文件：\n${files.join('\n') || '（没有）'}`);
    }
  }
  return { text: out.join('\n\n') || '（没有可查看的内容：look 里要写 {"node":"n3"} / {"page":"n5"} / {"search":"词"}）', said };
}

// >v<🤖AI指令-问模型-返回 {say, actions: [{ok, why?, desc, …}], raw}；不执行。输出不合格式 → 把错误告诉它重来一次
// opts.home = Synapsis 目录（用户级记忆在那儿）；给了才有长期记忆（只给宽松版 / 在线模型用）
export async function runAgent(root, { scope = ROOT, selected = [], text, boxes = {} }, cfg, opts = {}) {
  if (!text || !String(text).trim()) throw new Error('说点什么');
  const ws = loadWorkspace(root), ctx = pageContext(ws, scope, selected, boxes), loose = isLoose(cfg);
  // 历史里的回答按规定格式原样放回（以前存成 {say, done}，8B 会照着学、把 actions 丢掉 —— 2026-10-08 实测）；编号是当时那一页的，可能已变
  const recent = recentTurns(root, loose);
  // 记忆索引附在那一轮的人话后面、跟着历史走：8 轮之内模型都看得见；滚出去了（或新对话 / 清空后）再附一次
  // 上一轮的结果（执行了 / 没执行 / 执行后检查出的问题）写在「下一轮的人话」前面，不写在 assistant 那条里 —— 免得 8B 学着在 JSON 后面加废话
  const history = recent.flatMap((t, i) => { const pre = outcomeNote(recent[i - 1]); return [{ role: 'user', content: (pre ? pre + '\n\n' : '') + t.user + (t.memNote ? '\n\n' + t.memNote : '') }, { role: 'assistant', content: JSON.stringify({ say: t.say, actions: t.actions || [] }) }]; });
  // 问用法（怎么 / 如何 / 哪 / 快捷键 / 问号…）→ 走问答：单独的提示词 + 挑出来的软件知识，纯文本回答、不出动作。
  //   和做事混在一个 JSON 提示词里时，8B 会给「将切换到白色主题」+ 乱编动作、或者知识就在眼前还说「手册里没写」（2026-10-08 实测）
  const know = pickKnowledge(text), usage = {}; // usage = LM Studio 报的 token 用量（prompt / completion / total），界面显示「已用 / 容量」
  if (!loose && isQuestion(text)) { // 宽松版（在线）不分流：问用法、聊天、做事都在一个提示词里，它自己判断
    const q = String(text).trim();
    const raw = await chat(cfg, ANSWER_PROMPT, `【软件知识】\n${know.length ? knowledgeText(know) : '（没有找到相关的段落）'}\n\n问题：${q}`, 900, { kind: 'AI 问答', usage, temperature: 0.2 });
    const say = raw.replace(/^```\w*\n?|```$/g, '').trim().slice(0, 1200) || '（模型没有回答）';
    pushChat(root, { t: new Date().toISOString(), mode: 'strict', scope: ctx.scope, user: q, say, actions: [], done: [] });
    return { say, actions: [], raw, knowledge: know.map(c => c.src), mode: 'answer', usage };
  }
  const idx = loose && opts.home ? memoryIndex(opts.home, root) : '';
  const memNote = idx && !recent.some(t => t.memNote) ? `【记忆索引】（想看全文就只回 {"read": ["名字"]}）\n${idx}` : '';
  const sys = loose ? loosePrompt() : systemPrompt();
  const lastNote = outcomeNote(recent.at(-1));
  let user = `${ctx.text}\n\n${lastNote ? lastNote + '\n\n' : ''}人说：${String(text).trim()}${memNote ? '\n\n' + memNote : ''}`;
  const out = loose ? 3000 : 1200, temp = loose ? 0.6 : 0.1; // 宽松版：话可以长、温度高些（有个性）
  let raw = await chat(cfg, sys, user, out, { kind: 'AI 指令', history, usage, temperature: temp }), reply;
  try { reply = parseReply(raw, out); } catch (e) {
    raw = await chat(cfg, sys, user + `\n\n（你上一次的输出不合格：${e.message}。只输出一个 JSON 对象。）`, out, { kind: 'AI 指令（重试）', history, usage, temperature: 0.1 });
    try { reply = parseReply(raw, out); } catch (e2) { reply = { say: '（模型的回答不是规定格式，没法执行：' + e2.message + '）', actions: [], read: [], look: [] }; }
  }
  // 它要看记忆全文 / 查看别的信息 → 附上再问一轮，最多 LOOK_MAX 跳（只给在线宽松版；每跳在日志里一条）
  let memRead = [], looked = [], hops = 0;
  while (loose && hops < LOOK_MAX && ((opts.home && reply.read.length) || reply.look.length)) {
    hops++;
    let add = '';
    if (opts.home && reply.read.length) {
      const m = readMemories(opts.home, root, reply.read);
      memRead.push(...m.names);
      add += `\n\n【记忆全文】\n${m.text || '（没有叫这些名字的记忆）'}`;
    }
    if (reply.look.length) {
      const l = lookAt(root, ctx, reply.look);
      looked.push(...l.said);
      add += `\n\n【查看结果】\n${l.text}`;
    }
    user += add + (hops >= LOOK_MAX ? '\n\n（不能再查看了，现在必须回答：输出 {"say": …, "actions": […]}）' : `\n\n（已附上。还缺信息可以再 look / read，最多还能 ${LOOK_MAX - hops} 次；够了就正常回答：输出 {"say": …, "actions": […]}）`);
    raw = await chat(cfg, sys, user, out, { kind: reply.look.length ? `AI 指令（查看：${looked.slice(-3).join('、')}）` : 'AI 指令（读记忆后）', history, usage, temperature: temp });
    try { reply = parseReply(raw, out); } catch (e) { reply = { say: '（查看之后的回答不是规定格式：' + e.message + '）', actions: [], read: [], look: [] }; }
  }
  if (loose && (reply.look.length || (opts.home && reply.read.length)) && !reply.say) reply.say = '（查看次数用完了，模型还在要信息，没有给出回答）';
  const g = parseOutline(workspaceOutline(ws));
  for (const [id, n] of ws.graph.nodes) if (g.nodes.has(id)) g.nodes.get(id).status = n.status; // 状态以工作区为准
  g.edges = ws.graph.edges;
  const actions = reply.actions.map(a => validateAction(a, { refs: ctx.refs, graph: g, scope: ctx.scope }));
  // 嘴上说做了、手上没给动作（8B 实测会这样）→ 明说，别让人以为做了
  if (!actions.some(a => a.ok) && (loose ? /^已(经)?(将|把|为|创建|新建|标记|改|连|设|排|对齐|选|挪|收紧)/ : /^(已|将|会|我会|我将)|已(经)?(将|把|为|创建|新建|标记|删除|改|连|设|完成|排|对齐|选)/).test(reply.say)) reply.say += /删/.test(text) ? '（⚠ 删除节点不归 AI 做：请右键节点 → 删除）' : '（⚠ 模型没有给出能执行的动作，实际什么都没做）';
  pushChat(root, { t: new Date().toISOString(), mode: loose ? 'loose' : 'strict', scope: ctx.scope, user: String(text).trim(), say: reply.say, actions: reply.actions, done: actions.filter(a => a.ok).map(a => a.desc), ...(memNote ? { memNote } : {}), ...(memRead.length ? { memRead } : {}), ...(looked.length ? { looked } : {}) });
  return { say: reply.say, actions, raw, knowledge: loose ? [] : know.map(c => c.src), usage, mode: loose ? 'loose' : 'strict', memRead, looked, memIndex: !!memNote };
}

// >v<🤖AI指令-执行-👤 确认后：大纲类（新建 / 改名 / 状态 / 连线 / 删线 / 大纲排序）一次存盘 = 一步撤销；
//   连线类型 / 标签、颜色写 frontmatter；对齐 / 排列算好坐标交回前端（前端 move → 进撤销栈并存 _layout.json）。选中也交回前端。
//   boxes = 前端量到的卡片 {id: {x, y, w, h}}（存的坐标系）
export function applyPlan(root, actions, boxes = {}, opts = {}) {
  actions = actions.filter(a => a && a.ok);
  let g = (() => { const ws = loadWorkspace(root), h = parseOutline(workspaceOutline(ws)); return h; })();
  const ren = new Map(); // 旧 id → 新 id（改名会改子孙的 id）
  const fix = id => { for (const [o, n] of ren) { if (id === o) return n; if (id.startsWith(o + '/')) return n + id.slice(o.length); } return id; };
  const step = t => { if (t) g = parseOutline(t); };
  const kinds = [], colors = [], moved = new Set(), bodies = []; // bodies = 新建时带的正文 [id, 文字]（存盘后才有文件，再写）
  for (const a of actions) {
    if (a.do === 'status') for (const id of a.ids) step(withStatus(g, fix(id), a.status === 'none' ? null : a.status));
    else if (a.do === 'link') { if (!a.exists) step(withEdge(g, fix(a.from), fix(a.to))); if (a.kind || a.label || a.exists) kinds.push(a); }
    else if (a.do === 'unlink') step(withoutEdge(g, fix(a.from), fix(a.to)));
    else if (a.do === 'create') {
      const r = withNode(g, fix(a.parent), null, a.label); step(r.text);
      if (a.body) bodies.push([r.id, a.body]);
      const addKids = (pid, kids) => { for (const k of kids || []) { const rr = withNode(g, pid, null, k.label); step(rr.text); if (k.body) bodies.push([rr.id, k.body]); addKids(rr.id, k.children); } };
      addKids(r.id, a.children);
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
  for (const [id, b] of bodies) setNodeBody(root, fix(id), b);
  for (const a of kinds) setEdgeLabel(root, fix(a.from), fix(a.to), a.label, a.kind);
  for (const a of colors) for (const id of a.ids) setNodeMeta(root, fix(id), { color: a.color === 'auto' ? null : a.color });
  const fixedBoxes = Object.fromEntries(Object.entries(boxes).map(([id, b]) => [fix(id), b]));
  const moves = planMoves(actions.filter(a => ['align', 'arrange', 'tighten', 'place'].includes(a.do)).map(a => a.do === 'place' ? { ...a, id: fix(a.id) } : { ...a, ids: a.ids.map(fix) }), fixedBoxes);
  const select = [...new Set(actions.filter(a => a.do === 'select').flatMap(a => a.ids.map(fix)))];
  // 记忆：人确认后才写（项目级进 __synapsis/_AI记忆/，用户级进 <Synapsis>/.synapsis/记忆/）
  const remembered = actions.filter(a => a.do === 'remember').map(a => writeMemory(opts.home || root, root, { ...a, desc: a.summary }));
  // 执行后检查（规则，不用 LLM 当裁判）：挪过的卡有没有压到别的卡；记忆索引是不是快满了。警告显示给人，也写进这一轮的结果，下一轮模型看得见
  const label = id => g.nodes.get(id)?.label ?? id;
  const warnings = overlapWarnings(fixedBoxes, moves, label);
  if (remembered.length) { const st = indexStatus(opts.home || root, root); if (st.near) warnings.push(`记忆索引${st.over ? '满了' : '快满了'}（${st.n}/${st.max} 条）：建议整理——合并重复的、用 replace 换掉过时的（旧的会进 _过期的/）`); }
  recordOutcome(root, { executed: actions.map(a => a.desc), warnings });
  return { report: { ...report, outline: workspaceOutline(loadWorkspace(root)) }, moves, select, remembered, warnings };
}

// >v<🤖AI指令-检查-挪位置后的重叠（B，2026-10-08）：moves = {id: {x, y}} 是新左上角，boxes = 挪之前量到的 {id: {x, y, w, h}}。
//   只报「挪过的卡」和别的卡真的压在一起（gap 0）；两张都没挪的不管；量不到宽高（w/h 为 0）的跳过。最多 5 条
export function overlapWarnings(boxes, moves, label = id => id) {
  const fin = {}; for (const [id, b] of Object.entries(boxes)) if (b && b.w > 0 && b.h > 0) fin[id] = { ...b, ...(moves[id] || {}) };
  const seen = new Set(), out = [];
  for (const a of Object.keys(moves)) {
    if (!fin[a]) continue;
    for (const b of Object.keys(fin)) {
      if (a === b) continue;
      const key = [a, b].sort().join('\n');
      if (seen.has(key) || !overlaps(fin[a], fin[b], 0)) continue;
      seen.add(key); out.push(`「${label(a)}」和「${label(b)}」重叠了`);
    }
  }
  return out.slice(0, 5);
}
export { VALIDATORS };
