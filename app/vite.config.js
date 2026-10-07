import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join, normalize, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { loadWorkspace, workspaceOutline, saveOutline, saveLayout, saveAsset, ensureWorkspaceReadme, setNodeMeta, setNodeBody, listTree, readProjectFile, loadView, saveView, DIR } from '../core/workspace.js';
import { workspaceRoot } from '../core/cli.js';

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
  const CLI = resolve('../core/cli.js').split('\\').join('/');
  const body = req => new Promise((ok, no) => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } }); });
  const payload = root => {
    const ws = loadWorkspace(root);
    const nodes = {};
    // file = 相对项目根的路径（文件树和「打开 md」用）；pics = 相对 __synapsis 的图片路径
    for (const [id, n] of ws.graph.nodes) if (id) nodes[id] = { meta: n.meta, body: n.body, file: relative(root, n.file).split('\\').join('/'), pics: n.pics };
    return { root, outline: workspaceOutline(ws), layout: ws.layout, nodes, edges: ws.graph.edges, errors: ws.graph.errors };
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
          if (url.pathname === '/ws' && req.method === 'GET') { ensureWorkspaceReadme(root, CLI); return send(200, { ...payload(root), view: loadView(root) }); }
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
            const r = saveOutline(root, (await body(req)).outline);
            return send(r.ok ? 200 : 400, { report: r, ...(r.ok ? payload(root) : {}) });
          }
          if (url.pathname === '/node' && req.method === 'PATCH') {
            const b = await body(req);
            if (b.meta) setNodeMeta(root, b.id, b.meta);
            if (typeof b.body === 'string') setNodeBody(root, b.id, b.body);
            return send(200, payload(root));
          }
          if (url.pathname === '/tree' && req.method === 'GET') return send(200, listTree(root));
          if (url.pathname === '/raw' && req.method === 'GET') return send(200, readProjectFile(root, url.searchParams.get('p') || ''));
          if (url.pathname === '/layout' && req.method === 'PUT') { saveLayout(root, (await body(req)).positions); return send(200, { ok: true }); }
          if (url.pathname === '/asset' && req.method === 'POST') {
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
            return send(200, { path: saveAsset(root, b.id, b.dataUrl) });
          }
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
