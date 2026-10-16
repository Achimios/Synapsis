import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join, normalize, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { loadSettings, saveSettings, settingsPath, SCHEMA as SETTINGS_SCHEMA } from '../core/settings.js';
import { loadWorkspace, workspaceOutline, saveOutline, saveLayout, saveAsset, ensureWorkspaceReadme, setNodeMeta, setNodeBody, listTree, readProjectFile, loadView, saveView, loadPins, savePins, findFilesByName, addFileNode, addRefNode, addUiNode, saveLooseImage, removeLooseImage, removePic, restoreRemoved, graveyardInfo, clearGraveyard, ensureGitignore, pasteNodes, ensureWords, linkNodes, setEdgeLabel, rewireEdge, moveNodes, movePic, grepProject, DIR } from '../core/workspace.js';
import { scaffoldPlan, scaffoldWrite } from '../core/scaffold.js';

import { workspaceRoot, manualText, synItems, synWrite } from '../core/cli.js';
import { wakeLms, aiConfig, saveAiConfig, saveKey, chatModel, chatInfo, aiStatus, related, rerank, explainRelation, semColors, semPatterns, suggestWords, applyWords, suggestPatternWords, readAiLog, readUsage } from '../core/ai.js';
import { lmsEstimate, lmsReload } from '../core/lmstudio.js';
import { loadVoice, saveVoiceCfg, speak } from '../core/voice.js';
import { genImage } from '../core/imagegen.js';
import { loadTodo, saveTodo, todoFile, TODO_HEAD } from '../core/todo.js';
import { runAgent, applyPlan, loadChat, clearChat, setSummaryText, estimateContext, isLoose, loadSummary, compactChat, needCompact } from '../core/agent.js';
import { fileURLToPath } from 'node:url';
import { useProxy } from './proxy.js';
const PROXY = useProxy(); // 有本机代理就让服务端的 fetch 走它（xAI 国内直连不通）；本机地址直连
if (PROXY) console.log('[synapsis] 联网走代理', PROXY);
const STASH = new Map(); // 工作区 → 界面暂存（见 /ui/stash）
const SESSION_START = Date.now() - 2000; // 这次服务进程（= 托盘）启动的时刻（留 2 秒余量：.junk 里的时间戳只到秒）。.junk/ 里比这更早的 = 上次没正常退出留下的
const SYN_HOME = resolve(fileURLToPath(new URL('.', import.meta.url)), '..'); // AI 设置是本机的：<Synapsis>/.synapsis/ai.json

// >v<🚀启停-心跳-3 分钟没人 ping 就退出（SYN_IDLE_MS 可调）
// 页面每 20s ping 一次；见过 ping 之后若 3 分钟没人 ping（网页全关了）→ 服务自动退出。
// 3 分钟而不是更短：后台标签页的定时器会被浏览器节流到约 1 次/分钟。
const IDLE_MS = +process.env.SYN_IDLE_MS || 3 * 60 * 1000; // 测试可用 SYN_IDLE_MS 调短
function heartbeat() {
  let last = 0;
  return {
    name: 'synapsis-heartbeat',
    configureServer(server) {
      server.middlewares.use('/__alive', (_req, res) => { last = Date.now(); res.end('ok'); });
      if (process.env.SYN_DESKTOP) return; // 托盘程序里由 Electron 管生命周期，不能「没网页就退出」
      setInterval(() => {
        if (last && Date.now() - last > IDLE_MS) { console.log('[synapsis] 没有网页开着，自动退出'); process.exit(0); }
      }, 15000).unref();
    },
  };
}

// >v<💾工作区-HTTP接口-界面读写被规划项目的 __synapsis/（工作区：?ws= > SYN_WS > .synapsis/config.json）
function workspaceApi() {
  const body = req => new Promise((ok, no) => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } }); });
  const payload = root => {
    // 词表文件直接放出来（以前点「词表…」才建，👤 2026-10-08 根本找不到）
    if (existsSync(join(root, DIR))) { try { ensureWords(root); } catch { /* 只读目录就用默认 */ } } // 👤 2026-10-12 一层一份 _词表.md：没有就建；旧的 _配色.md / _图案.md 并进来（旧文件进 _过期的/）
    const ws = loadWorkspace(root);
    const nodes = {};
    // file = 相对项目根的路径（文件树和「打开 md」用）；pics = 相对 __synapsis 的图片路径
    for (const [id, n] of ws.graph.nodes) if (id) nodes[id] = { meta: n.meta, body: n.body, file: relative(root, n.file).split('\\').join('/'), pics: n.pics };
    return { root, outline: workspaceOutline(ws), layout: ws.layout, nodes, edges: ws.graph.edges, errors: ws.graph.errors, loose: ws.loose, colorWords: ws.colorWords, patternWords: ws.patternWords, colorWordsAt: ws.colorWordsAt, patternWordsAt: ws.patternWordsAt, wordsFiles: ws.wordsFiles, pins: loadPins(root) };
  };
  return {
    name: 'synapsis-workspace',
    configureServer(server) {
      server.middlewares.use('/api/', async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
        let root;
        try { root = url.searchParams.get('ws') || workspaceRoot([]); } catch (e) { return send(404, { error: e.message }); }
        try {
          if (url.pathname === '/settings') { // ⚙ 设置：<Synapsis>/settings.yaml（进 git）
            if (req.method === 'PUT') return send(200, { settings: saveSettings(SYN_HOME, await body(req)), schema: SETTINGS_SCHEMA, path: settingsPath(SYN_HOME) });
            return send(200, { settings: loadSettings(SYN_HOME), schema: SETTINGS_SCHEMA, path: settingsPath(SYN_HOME) });
          }
          if (url.pathname === '/ws' && req.method === 'GET') {
            if (existsSync(join(root, DIR))) { ensureWorkspaceReadme(root, manualText(root)); ensureGitignore(root); } // 没挂上的文件夹别往里写（界面会弹「挂上 Synapsis」清单）
            // .junk/ 里有「这次托盘启动之前」留下的东西 = 上次没正常退出托盘，或 CLI / AI 删过东西：交给界面问一句要不要清。
            // 这次托盘期间删的不问（关 vault 再打开还要能撤销，退出托盘才清）
            const left = graveyardInfo(root).entries.filter(e => e.time < SESSION_START);
            return send(200, { ...payload(root), view: loadView(root), graveyard: left.length ? { count: left.length, size: left.reduce((s, e) => s + e.size, 0) } : null });
          }
          // 📌 钉子（临时翻阅组）：整份读写，界面每次操作后整份 PUT；存 .synapsis/pins.json（本机）
          if (url.pathname === '/pins' && req.method === 'PUT') { if (!existsSync(join(root, DIR))) return send(404, { error: '不是 Synapsis 工作区' }); return send(200, { ok: true, pins: savePins(root, await body(req)) }); }
          // 清空 .junk/ 里上次留下的（送系统回收站）；界面在打开时问过用户才调
          if (url.pathname === '/graveyard/clear' && req.method === 'POST') return send(200, clearGraveyard(root, { before: SESSION_START }));
          // 只往已挂上 Synapsis 的目录写（别因为一个拼错的 ?ws= 在磁盘上凭空建目录）
          if (url.pathname === '/view' && req.method === 'PUT') { if (!existsSync(join(root, DIR))) return send(404, { error: '不是 Synapsis 工作区' }); saveView(root, await body(req)); return send(200, { ok: true }); }
          // 在资源管理器里显示 / 用默认程序打开（服务只在本机跑，等于本机操作；路径限定在项目内）
          if (url.pathname === '/reveal' && req.method === 'POST') {
            const b = await body(req), f = normalize(join(root, b.p || ''));
            if (!f.startsWith(normalize(root)) || !existsSync(f)) return send(404, { error: 'not found' });
            if (b.how === 'open') spawn('cmd', ['/c', 'start', '""', '"' + f + '"'], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
            else spawn('explorer.exe', ['/select,"' + f + '"'], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
            return send(200, { ok: true });
          }
          if (url.pathname === '/outline' && req.method === 'PUT') {
            const b = await body(req), r = saveOutline(root, b.outline, Array.isArray(b.hint) ? new Map(b.hint) : null); // hint = 撤销 / 重做移动时的 [新id, 旧id]
            return send(r.ok ? 200 : 400, { report: r, ...(r.ok ? payload(root) : {}) });
          }
          if (url.pathname === '/node' && req.method === 'PATCH') {
            const b = await body(req);
            if (b.meta) setNodeMeta(root, b.id, b.meta);
            if (typeof b.body === 'string') setNodeBody(root, b.id, b.body);
            return send(200, payload(root));
          }
          // 配色词表：没有就按默认写一份，返回相对项目根的路径（前端接着用默认程序打开）
          // scope = 分组 id → 那个分组自己的词表（👤 2026-10-11 层级词表；没有就建一份空表）
          if ((url.pathname === '/words' || url.pathname === '/pattern-words' || url.pathname === '/color-words') && req.method === 'POST') { // 一份 _词表.md（旧路径名照收）
            const b = await body(req).catch(() => ({}));
            try { return send(200, { file: relative(root, ensureWords(root, b?.scope || '')).split('\\').join('/') }); } catch (e) { return send(400, { error: e.message }); }
          }
          // 连线（带类型）/ 改已有边的标签类型
          if (url.pathname === '/link' && req.method === 'POST') { const b = await body(req); const r = linkNodes(root, b.from, b.to, b.label || '', b.kind || ''); return send(200, { report: r, ...payload(root) }); }
          if (url.pathname === '/move-pic' && req.method === 'POST') { const b = await body(req); const r = movePic(root, b.path, b.to ?? null, b.scope ?? ''); return send(200, { pic: r, ...payload(root) }); }
          if (url.pathname === '/move' && req.method === 'POST') { const b = await body(req); const r = moveNodes(root, b.ids, b.parent); return send(200, { report: r, ...payload(root) }); }
          if (url.pathname === '/rewire' && req.method === 'POST') { const b = await body(req); const r = rewireEdge(root, b.from, b.to, b.nf, b.nt); return send(200, { report: r, ...payload(root) }); }
          if (url.pathname === '/edge' && req.method === 'PATCH') { const b = await body(req); setEdgeLabel(root, b.from, b.to, b.label || '', b.kind || ''); return send(200, payload(root)); }
          // 粘贴节点：复制子孙 / 属性 / 正文 / 图片 / 内部边到 parent 下
          if (url.pathname === '/paste' && req.method === 'POST') { const b = await body(req); const r = pasteNodes(root, b.ids, b.parent, b.src || root); return send(200, { report: r, ...payload(root) }); }
          // 撤销删除：把 .junk/ 里的文件搬回去（随后前端写回删除前的大纲）
          if (url.pathname === '/restore' && req.method === 'POST') return send(200, { restored: restoreRemoved(root, (await body(req)).pairs) });
          // 项目骨架（_开发进度.md 那套）：GET = 检测清单，POST = 只写勾上且不存在的
          // 👤 2026-10-12 「📄 项目文件…」一个对话框：挂 Synapsis 的几样（手册 / 黑板 / 词表 / 快捷方式）+ 项目文档骨架。没挂过的文件夹打开时自动弹
          //   默认勾 = settings.yaml 的 init 段（上次在这里勾的）；已有的灰掉不覆盖
          if (url.pathname === '/scaffold' && req.method === 'GET') { const S = loadSettings(SYN_HOME).init;
            return send(200, { mounted: existsSync(join(root, DIR)), root, syn: synItems(root).map(i => ({ ...i, def: S[i.key] !== false })), docsDef: !!S.docs, items: scaffoldPlan(root).map(({ rel, exists, alike }) => ({ rel, exists, alike })) }); }
          if (url.pathname === '/scaffold' && req.method === 'POST') {
            const b = await body(req), keys = b.syn || [], files = b.files || [];
            const synLeft = synItems(root).filter(i => !i.exists), docLeft = scaffoldPlan(root).filter(i => !i.exists);
            const made = [...(keys.length || b.mount ? synWrite(root, keys) : []), ...scaffoldWrite(root, files)];
            const remember = !b.mount ? {} : Object.fromEntries(synLeft.map(i => [i.key, keys.includes(i.key)])); // 挂新项目时记住这次的选择 = 下个新项目的默认（已有的那几样不算数；平时补文件不改默认）
            if (b.mount && docLeft.length) remember.docs = files.length > 0;
            if (Object.keys(remember).length) try { saveSettings(SYN_HOME, { init: remember }); } catch { /* 设置文件只读就算了 */ }
            return send(200, { made });
          }
          // >v<🤖AI辅助-接口-LM Studio（core/ai.js）：连不上回 503，前端安静降级
          // >v<🎛界面暂存-关掉 AI 框 / 关窗口不丢的界面状态（没发出的话、待确认的动作、查找词、过滤词…）。
          //   👤 2026-10-08「退出后输入框里没发出的文字要保留…是否执行也要保留…重启托盘才重置」→ 存在这个服务进程的内存里（按工作区），
          //   托盘程序一退出就没了；不写盘。AI 的短记忆是另一回事（.synapsis/ai_chat.json，重启托盘也在，只有「清空」才清）
          if (url.pathname === '/ui/stash') {
            const st = STASH.get(root) || {};
            if (req.method === 'PUT') { for (const [k, v] of Object.entries(await body(req))) v === null ? delete st[k] : st[k] = v; STASH.set(root, st); }
            return send(200, st);
          }
          if (url.pathname.startsWith('/ai/')) {
            const cfg = { ...aiConfig(SYN_HOME, root), log: existsSync(join(root, DIR)) ? join(root, '.synapsis', 'ai_log.jsonl') : null };
            if (url.pathname === '/ai/status') { // 👤 2026-10-11 模型加载了、HTTP 服务没开 → 本机地址时顺手开一次（每个服务进程只试一次；开服务不加载模型、不占显存）
              let s = await aiStatus(cfg);
              if (!s.ok && /ECONNREFUSED|fetch failed/.test(s.error || '') && await wakeLms(cfg)) { try { s = await aiStatus(cfg); } catch {} } // 👤 2026-10-16 后开的 LM Studio 也能接上：连不上就试着开服务（最多 30 秒一次）
              return send(200, s);
            }
            if (url.pathname === '/ai/usage') return send(200, readUsage(cfg));
            if (url.pathname === '/ai/log') return send(200, { entries: cfg.log ? readAiLog(cfg.log, Number(url.searchParams.get('n')) || 60) : [] });
            // summary = 各模式的记忆摘要 {loose|strict: {text, upto}}（界面在 upto 那一轮下面画「以上已压缩」）；compacting = 后台正在压
            if (url.pathname === '/ai/todo') { // 📋 待办页：<项目>/.synapsis/AI待办.md
              if (req.method === 'PUT') { const b = await body(req); return send(200, { text: saveTodo(root, b.text), file: todoFile(root) }); }
              return send(200, { text: loadTodo(root) || TODO_HEAD, file: todoFile(root) });
            }
            if (url.pathname === '/ai/chat' && req.method === 'GET') return send(200, { turns: loadChat(root), summary: loadSummary(root), compacting: !!(STASH.get(root) || {}).compacting });
            if (url.pathname === '/ai/chat' && req.method === 'DELETE') { clearChat(root); return send(200, { turns: [], summary: {} }); }
            // 🗜 手动压缩：除了最近 keep 轮（默认按设置），旧原文 + 旧摘要 → 新摘要
            if (url.pathname === '/ai/chat/summary' && req.method === 'PUT') { const b = await body(req); try { setSummaryText(root, !!b.loose, b.text); } catch (e) { return send(400, { error: e.message }); } return send(200, { turns: loadChat(root), summary: loadSummary(root) }); }
            if (url.pathname === '/ai/chat/compact' && req.method === 'POST') {
              const b = await body(req);
              try { const r = await compactChat(root, isLoose(cfg), cfg, { keep: b.keep }); return send(200, { ...r, turns: loadChat(root), summary: loadSummary(root) }); }
              catch (e) { return send(503, { error: '压缩失败：' + (e.cause?.code === 'ECONNREFUSED' ? '连不上模型' : e.message) }); }
            }
            // 上下文：这次大概要占多少（估）+ 对话模型加载时设的上下文长度（LM Studio /api/v0/models 的 loaded_context_length）
            if (url.pathname === '/ai/context') {
              const est = existsSync(join(root, DIR)) ? estimateContext(root, { scope: url.searchParams.get('scope') || '', selected: (url.searchParams.get('selected') || '').split('\n').filter(Boolean), loose: isLoose(cfg), cfg }) : null;
              const st = await aiStatus(cfg), model = chatModel(cfg), m = chatInfo(st, model);
              return send(200, { estimate: est, model, loose: isLoose(cfg), ctx: m?.ctx || null, maxCtx: m?.maxCtx || null, loaded: !!m?.loaded, thinks: /^deepseek:/.test(model) && !!cfg.onlineEffort && cfg.onlineEffort !== 'off' }); // thinks = 真开了思考（界面「🧠 思考中」只在这时显示）
            }
            // AI 指令框：问模型（只回动作草案）/ 👤 确认后执行
            if (url.pathname === '/ai/apply' && req.method === 'POST') {
              const b = await body(req), all = b.actions || [], imgs = all.filter(a => a && a.ok && a.do === 'image');
              const r = applyPlan(root, all.filter(a => !(a && a.do === 'image')), b.boxes || {}, { home: SYN_HOME });
              // 配图（花钱，慢）：大纲改完再一张张生成，存进那张卡的 _pics_；失败的写进 warnings（AI 下一轮会知道）
              //   没 id = 当前页的散图，落在 b.at（空白处右键「AI 配图」点的位置；几张错开）
              for (const [i, a] of imgs.slice(0, 4).entries()) {
                const name = a.id ? a.id.split('/').pop() : '散图';
                try {
                  const img = await genImage(cfg, a);
                  if (a.id) saveAsset(root, a.id, img);
                  else { const s = saveLooseImage(root, a.scope ?? '', img); if (b.at && !s.node) saveLayout(root, { ['@pic:' + s.path]: { x: b.at.x + i * 30, y: b.at.y + i * 30 } }); }
                  (r.made ??= []).push('配图：' + name);
                } catch (e) { r.warnings.push(`配图「${name}」失败：${e.message}`); }
              }
              delete (STASH.get(root) || {}).plan; return send(200, { ...r, ...payload(root) });
            }
            // 在线 key：只写进 <Synapsis>/.synapsis/keys.json，回的状态里只有「有没有」
            if (url.pathname === '/ai/key' && req.method === 'PUT') { const b = await body(req); saveKey(SYN_HOME, b.provider || 'deepseek', b.key || ''); return send(200, await aiStatus(aiConfig(SYN_HOME))); }
            // 本地模型的上下文长度：先估显存，再「卸载 → 按新长度加载」（core/lmstudio.js，走 LM Studio 的 lms 命令行）
            if (url.pathname === '/ai/lms/estimate') { try { return send(200, await lmsEstimate(url.searchParams.get('model') || cfg.chat, Number(url.searchParams.get('ctx')))); } catch (e) { return send(500, { error: e.message }); } }
            if (url.pathname === '/ai/lms/load' && req.method === 'POST') { const b = await body(req); try { const r = await lmsReload(b.model || cfg.chat, b.ctx); if (aiConfig(SYN_HOME).chat !== r.key && (b.model || cfg.chat).replace(/:\d+$/, '') === r.key) saveAiConfig(SYN_HOME, { chat: r.key }); return send(200, { ...r, status: await aiStatus(aiConfig(SYN_HOME)) }); } catch (e) { return send(500, { error: e.message }); } }
            if (url.pathname === '/ai/config' && req.method === 'PUT') return send(200, await aiStatus(saveAiConfig(SYN_HOME, await body(req))));
            try {
              if (url.pathname === '/ai/agent' && req.method === 'POST') {
                const b = await body(req), st = STASH.get(root) || {}; STASH.set(root, st);
                st.thinking = String(b.text || '').slice(0, 40); // 关掉框再打开时，界面看这个知道「还在想」
                try {
                  const vo = b.voice ? loadVoice(SYN_HOME) : null; // 📢 开着才带语音说明；TTS 找不到（vo.ok = false）就不让模型说，回一句为什么
                  // 中间几跳：说的话进 st.steps（界面每秒拉一次 /ui/stash 显示），语音当场念；progress = 正在搜 / 读什么
                  st.steps = []; delete st.progress;
                  const onStep = s => { st.steps.push({ say: s.say, ...(s.voice ? { voice: s.voice.text } : {}) }); if (vo?.ok && s.voice) speak(vo, s.voice, Date.now().toString(36)); };
                  const r = await runAgent(root, b, cfg, { home: SYN_HOME, voice: vo?.ok ? vo : null, onStep, onProgress: p => { st.progress = p; } });
                  if (vo && !vo.ok) r.spoke = { ok: false, why: vo.error };
                  if (vo && r.voice) r.spoke = speak(vo, r.voice, Date.now().toString(36)); // 念出来（不等播完）
                  if (r.actions.length) st.plan = r; else delete st.plan;
                  // 短记忆超了 → 后台压缩（不等它：这一轮的回答先回去，下一轮用上新摘要）
                  if (!st.compacting && needCompact(root, isLoose(cfg), cfg)) { st.compacting = true; r.compacting = true; compactChat(root, isLoose(cfg), cfg).catch(() => {}).finally(() => { delete st.compacting; }); }
                  if (String(st['agent.text'] || '').trim() === String(b.text || '').trim()) delete st['agent.text']; // 发出去了 = 输入框该空了
                  return send(200, r);
                } finally { delete st.thinking; delete st.steps; delete st.progress; }
              } // 待确认的动作服务端也记一份：AI 还在想时关掉框，回来照样能确认
              if (url.pathname === '/ai/voice') { // 🔊 语音页：人的三个选择（settings.yaml 的 voice 段）+ TTS 现读的角色表
                if (req.method === 'PUT') { const b = await body(req); return send(200, saveVoiceCfg(SYN_HOME, b.set || {})); } // set = 人的三个选择 {tts, role, backend}
                return send(200, loadVoice(SYN_HOME));
              }
              if (url.pathname === '/ai/related') return send(200, { items: await related(root, url.searchParams.get('id') || '', cfg) });
              if (url.pathname === '/ai/rerank' && req.method === 'POST') { const b = await body(req); return send(200, { items: await rerank(root, b.id, b.items, cfg) }); }
              if (url.pathname === '/ai/explain' && req.method === 'POST') { const b = await body(req); return send(200, { text: await explainRelation(root, b.id, b.other, cfg) }); }
              if (url.pathname === '/ai/patterns') return send(200, { patterns: cfg.semColors ? await semPatterns(root, cfg) : {} });
              if (url.pathname === '/ai/colors') return send(200, { colors: cfg.semColors ? await semColors(root, cfg) : {} });
              // 颜色 + 图案一起起草；scope = 分组 id（画布没选中 = 当前画布节点，选中分组 = 它）→ 只看它里面，写进它自己的 _词表.md
              if (url.pathname === '/ai/words' && req.method === 'POST') { const b = await body(req).catch(() => ({})), sc = b?.scope || ''; const [c, p] = await Promise.all([suggestWords(root, cfg, sc), suggestPatternWords(root, cfg, sc)]); return send(200, { ...c, pattern: p }); }
              if (url.pathname === '/ai/words/apply' && req.method === 'POST') { const b = await body(req); const f = applyWords(root, { color: typeof b.text === 'string' ? b.text : null, pattern: typeof b.patternText === 'string' ? b.patternText : null }, b.scope || ''); return send(200, { file: relative(root, f).split('\\').join('/'), ...payload(root) }); }
            } catch (e) { return send(503, { error: e.cause?.code === 'ECONNREFUSED' ? 'LM Studio 没开本机服务（' + cfg.url + '）' : e.message }); }
          }
          if (url.pathname === '/tree' && req.method === 'GET') return send(200, listTree(root));
          if (url.pathname === '/grep' && req.method === 'GET') return send(200, grepProject(root, url.searchParams.get('q') || ''));
          if (url.pathname === '/addfile' && req.method === 'POST') { const b = await body(req); try { const r = addFileNode(root, b.parent || '', b.rel); return send(200, { id: r.id, report: { ...r.report, outline: workspaceOutline(loadWorkspace(root)) }, ...payload(root) }); } catch (e) { return send(400, { error: e.message }); } } // 外部文件当节点
          if (url.pathname === '/addref' && req.method === 'POST') { const b = await body(req); try { const r = addRefNode(root, b.parent || '', b.target); return send(200, { id: r.id, report: { ...r.report, outline: workspaceOutline(loadWorkspace(root)) }, ...payload(root) }); } catch (e) { return send(400, { error: e.message }); } } // 传送门卡片：指向别处节点
          if (url.pathname === '/addui' && req.method === 'POST') { const b = await body(req); try { const r = addUiNode(root, b.parent || '', { w: b.w, h: b.h }); return send(200, { id: r.id, report: { ...r.report, outline: workspaceOutline(loadWorkspace(root)) }, ...payload(root) }); } catch (e) { return send(400, { error: e.message }); } } // UI 框
          if (url.pathname === '/findfile' && req.method === 'GET') return send(200, { matches: findFilesByName(root, url.searchParams.get('p') || '') }); // 📌 行钉子的文件搬了位置：按文件名找
          if (url.pathname === '/raw' && req.method === 'GET') return send(200, readProjectFile(root, url.searchParams.get('p') || ''));
          if (url.pathname === '/layout' && req.method === 'PUT') { saveLayout(root, (await body(req)).positions); return send(200, { ok: true }); }
          // 图片：/asset 进某个节点；/loose 当散图放进某一页；/loose-remove 删散图（进 .junk/）
          if ((url.pathname === '/asset' || url.pathname === '/loose') && req.method === 'POST') {
            const b = await body(req);
            // 从浏览器拖来的网页图：页面跨域拿不到，由本机服务代下（只收图片、30MB 封顶）
            if (b.url && !b.dataUrl) {
              if (!/^https?:\/\//.test(b.url)) return send(400, { error: '只支持 http(s) 图片地址' });
              const r = await fetch(b.url, { signal: AbortSignal.timeout(20000) });
              const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
              if (!r.ok || !ct.startsWith('image/')) return send(400, { error: `拿不到图片（${r.status} ${ct || '未知类型'}）` });
              const buf = Buffer.from(await r.arrayBuffer());
              if (buf.length > 30e6) return send(400, { error: '图片超过 30MB' });
              b.dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
            }
            if (url.pathname === '/loose') {
              const r = saveLooseImage(root, b.scope ?? '', b.dataUrl);
              if (b.at && !r.node) saveLayout(root, { ['@pic:' + r.path]: b.at });
              return send(200, r);
            }
            return send(200, { path: saveAsset(root, b.id, b.dataUrl) });
          }
          if (url.pathname === '/loose-remove' && req.method === 'POST') return send(200, { pair: removeLooseImage(root, (await body(req)).path) });
          // 撤销「贴图 / 拖进图片」：这几张挪进 .junk/，回 pairs 给重做时 /restore 搬回来
          if (url.pathname === '/pic-remove' && req.method === 'POST') { const pairs = []; for (const p of (await body(req)).paths || []) try { pairs.push(removePic(root, p)); } catch { /* 已经不在了（手动删了 / 挪走了）就跳过 */ } return send(200, { pairs }); }
          if (url.pathname === '/file' && req.method === 'GET') {
            const base = join(root, DIR);
            const f = normalize(join(base, url.searchParams.get('p') || ''));
            if (!f.startsWith(normalize(base)) || !existsSync(f)) return send(404, { error: 'not found' });
            const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
            res.setHeader('content-type', MIME[f.split('.').pop().toLowerCase()] || 'application/octet-stream');
            return res.end(readFileSync(f));
          }
          send(404, { error: 'no route' });
        } catch (e) { send(500, { error: e.message }); }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), heartbeat(), workspaceApi()],
  server: { fs: { allow: [resolve('..')] } }, // 浏览器要 import ../core/outline.js
});
