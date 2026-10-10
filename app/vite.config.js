import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join, normalize, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { loadSettings, saveSettings, settingsPath, SCHEMA as SETTINGS_SCHEMA } from '../core/settings.js';
import { loadWorkspace, workspaceOutline, saveOutline, saveLayout, saveAsset, ensureWorkspaceReadme, setNodeMeta, setNodeBody, listTree, readProjectFile, loadView, saveView, loadPins, savePins, findFilesByName, addFileNode, addRefNode, addUiNode, saveLooseImage, removeLooseImage, removePic, restoreRemoved, graveyardInfo, clearGraveyard, ensureGitignore, pasteNodes, ensureColorWords, ensurePatternWords, linkNodes, setEdgeLabel, rewireEdge, moveNodes, movePic, grepProject, DIR } from '../core/workspace.js';
import { scaffoldPlan, scaffoldWrite } from '../core/scaffold.js';

import { workspaceRoot, manualText } from '../core/cli.js';
import { aiConfig, saveAiConfig, saveKey, chatModel, chatInfo, aiStatus, related, rerank, explainRelation, semColors, semPatterns, suggestWords, applyWords, suggestPatternWords, applyPatternWords, readAiLog, readUsage } from '../core/ai.js';
import { lmsEstimate, lmsReload, lmsServerStart } from '../core/lmstudio.js';
let lmsTried = false;
import { runAgent, applyPlan, loadChat, clearChat, estimateContext, isLoose, loadSummary, compactChat, needCompact } from '../core/agent.js';
import { fileURLToPath } from 'node:url';
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
    if (existsSync(join(root, DIR))) { try { ensureColorWords(root); } catch { /* 只读目录就用默认 */ } } // 没有就建；没改过的旧默认（6 行）升级成新默认
    if (existsSync(join(root, DIR)) && !existsSync(join(root, DIR, '_图案.md'))) { try { ensurePatternWords(root); } catch { /* 同上 */ } }
    const ws = loadWorkspace(root);
    const nodes = {};
    // file = 相对项目根的路径（文件树和「打开 md」用）；pics = 相对 __synapsis 的图片路径
    for (const [id, n] of ws.graph.nodes) if (id) nodes[id] = { meta: n.meta, body: n.body, file: relative(root, n.file).split('\\').join('/'), pics: n.pics };
    return { root, outline: workspaceOutline(ws), layout: ws.layout, nodes, edges: ws.graph.edges, errors: ws.graph.errors, loose: ws.loose, colorWords: ws.colorWords, patternWords: ws.patternWords, pins: loadPins(root) };
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
            ensureWorkspaceReadme(root, manualText(root));
            ensureGitignore(root);
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
          if (url.pathname === '/pattern-words' && req.method === 'POST') return send(200, { file: relative(root, ensurePatternWords(root)).split('\\').join('/') });
          if (url.pathname === '/color-words' && req.method === 'POST') return send(200, { file: relative(root, ensureColorWords(root)).split('\\').join('/') });
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
          if (url.pathname === '/scaffold' && req.method === 'GET') return send(200, { items: scaffoldPlan(root).map(({ rel, exists, alike }) => ({ rel, exists, alike })) });
          if (url.pathname === '/scaffold' && req.method === 'POST') { if (!existsSync(join(root, DIR))) return send(404, { error: '不是 Synapsis 工作区' }); return send(200, { made: scaffoldWrite(root, (await body(req)).files) }); }
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
              if (!s.ok && /ECONNREFUSED/.test(s.error || '') && /\/\/(127\.0\.0\.1|localhost):1234\b/.test(cfg.url || '') && !lmsTried) { lmsTried = true; try { await lmsServerStart(); s = await aiStatus(cfg); } catch {} }
              return send(200, s);
            }
            if (url.pathname === '/ai/usage') return send(200, readUsage(cfg));
            if (url.pathname === '/ai/log') return send(200, { entries: cfg.log ? readAiLog(cfg.log, Number(url.searchParams.get('n')) || 60) : [] });
            // summary = 各模式的记忆摘要 {loose|strict: {text, upto}}（界面在 upto 那一轮下面画「以上已压缩」）；compacting = 后台正在压
            if (url.pathname === '/ai/chat' && req.method === 'GET') return send(200, { turns: loadChat(root), summary: loadSummary(root), compacting: !!(STASH.get(root) || {}).compacting });
            if (url.pathname === '/ai/chat' && req.method === 'DELETE') { clearChat(root); return send(200, { turns: [], summary: {} }); }
            // 🗜 手动压缩：除了最近 keep 轮（默认按设置），旧原文 + 旧摘要 → 新摘要
            if (url.pathname === '/ai/chat/compact' && req.method === 'POST') {
              const b = await body(req);
              try { const r = await compactChat(root, isLoose(cfg), cfg, { keep: b.keep }); return send(200, { ...r, turns: loadChat(root), summary: loadSummary(root) }); }
              catch (e) { return send(503, { error: '压缩失败：' + (e.cause?.code === 'ECONNREFUSED' ? '连不上模型' : e.message) }); }
            }
            // 上下文：这次大概要占多少（估）+ 对话模型加载时设的上下文长度（LM Studio /api/v0/models 的 loaded_context_length）
            if (url.pathname === '/ai/context') {
              const est = existsSync(join(root, DIR)) ? estimateContext(root, { scope: url.searchParams.get('scope') || '', selected: (url.searchParams.get('selected') || '').split('\n').filter(Boolean), loose: isLoose(cfg), cfg }) : null;
              const st = await aiStatus(cfg), model = chatModel(cfg), m = chatInfo(st, model);
              return send(200, { estimate: est, model, ctx: m?.ctx || null, maxCtx: m?.maxCtx || null, loaded: !!m?.loaded });
            }
            // AI 指令框：问模型（只回动作草案）/ 👤 确认后执行
            if (url.pathname === '/ai/apply' && req.method === 'POST') { const b = await body(req); const r = applyPlan(root, b.actions || [], b.boxes || {}, { home: SYN_HOME }); delete (STASH.get(root) || {}).plan; return send(200, { ...r, ...payload(root) }); }
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
                  const r = await runAgent(root, b, cfg, { home: SYN_HOME });
                  if (r.actions.length) st.plan = r; else delete st.plan;
                  // 短记忆超了 → 后台压缩（不等它：这一轮的回答先回去，下一轮用上新摘要）
                  if (!st.compacting && needCompact(root, isLoose(cfg), cfg)) { st.compacting = true; r.compacting = true; compactChat(root, isLoose(cfg), cfg).catch(() => {}).finally(() => { delete st.compacting; }); }
                  if (String(st['agent.text'] || '').trim() === String(b.text || '').trim()) delete st['agent.text']; // 发出去了 = 输入框该空了
                  return send(200, r);
                } finally { delete st.thinking; }
              } // 待确认的动作服务端也记一份：AI 还在想时关掉框，回来照样能确认
              if (url.pathname === '/ai/related') return send(200, { items: await related(root, url.searchParams.get('id') || '', cfg) });
              if (url.pathname === '/ai/rerank' && req.method === 'POST') { const b = await body(req); return send(200, { items: await rerank(root, b.id, b.items, cfg) }); }
              if (url.pathname === '/ai/explain' && req.method === 'POST') { const b = await body(req); return send(200, { text: await explainRelation(root, b.id, b.other, cfg) }); }
              if (url.pathname === '/ai/patterns') return send(200, { patterns: cfg.semColors ? await semPatterns(root, cfg) : {} });
              if (url.pathname === '/ai/colors') return send(200, { colors: cfg.semColors ? await semColors(root, cfg) : {} });
              if (url.pathname === '/ai/words' && req.method === 'POST') { const [c, p] = await Promise.all([suggestWords(root, cfg), suggestPatternWords(root, cfg)]); return send(200, { ...c, pattern: p }); } // 颜色词表 + 图案词表一起起草
              if (url.pathname === '/ai/words/apply' && req.method === 'POST') { const b = await body(req), fs = []; if (typeof b.text === 'string') fs.push(applyWords(root, b.text)); if (typeof b.patternText === 'string') fs.push(applyPatternWords(root, b.patternText)); return send(200, { file: fs.map(f => relative(root, f).split('\\').join('/')).join('、'), ...payload(root) }); }
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
