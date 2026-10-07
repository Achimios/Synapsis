import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 心跳：页面每 20s ping 一次；见过 ping 之后若 3 分钟没人 ping（网页全关了）→ 服务自动退出。
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

export default defineConfig({
  plugins: [react(), heartbeat()],
  build: { rollupOptions: { input: { index: resolve('index.html'), reactflow: resolve('reactflow.html'), tldraw: resolve('tldraw.html') } } },
});
