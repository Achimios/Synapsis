import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, join, normalize } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { loadWorkspace, workspaceOutline, saveOutline, saveLayout, saveAsset, ensureWorkspaceReadme, DIR } from '../core/workspace.js';
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
    for (const [id, n] of ws.graph.nodes) if (id) nodes[id] = { meta: n.meta, body: n.body };
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
          if (url.pathname === '/ws' && req.method === 'GET') { ensureWorkspaceReadme(root, CLI); return send(200, payload(root)); }
          if (url.pathname === '/outline' && req.method === 'PUT') {
            const r = saveOutline(root, (await body(req)).outline);
            return send(r.ok ? 200 : 400, { report: r, ...(r.ok ? payload(root) : {}) });
          }
          if (url.pathname === '/layout' && req.method === 'PUT') { saveLayout(root, (await body(req)).positions); return send(200, { ok: true }); }
          if (url.pathname === '/asset' && req.method === 'POST') { const b = await body(req); return send(200, { path: saveAsset(root, b.id, b.dataUrl) }); }
          if (url.pathname === '/file' && req.method === 'GET') {
            const base = join(root, DIR);
            const f = normalize(join(base, url.searchParams.get('p') || ''));
            if (!f.startsWith(normalize(base)) || !existsSync(f)) return send(404, { error: 'not found' });
            res.setHeader('content-type', f.endsWith('.png') ? 'image/png' : f.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream');
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
