// >v<💾工作区-联网代理-👤 2026-10-16：xAI（Grok）国内直连连不上，浏览器走的是本机代理（如 Clash 127.0.0.1:7897），但 Node 的 fetch 默认不认代理。
//   服务启动时：有代理（环境变量 HTTPS_PROXY / HTTP_PROXY，没有就读 Windows 系统代理设置）→ 全局 fetch 走它；
//   本机 / 局域网地址（LM Studio、TTS、自己的服务）和国内服务（DeepSeek、必应国内版）一律直连。没代理 = 什么都不做
import { execFileSync } from 'node:child_process';
import { setGlobalDispatcher, EnvHttpProxyAgent, Agent } from 'undici';

function systemProxy() { // Windows「设置 → 代理」里开着的那个（不认 PAC 脚本）
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/.test(out)) return null;
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out); if (!m) return null;
    const v = m[1].includes('=') ? (/https=([^;]+)/.exec(m[1]) || /http=([^;]+)/.exec(m[1]) || [])[1] : m[1]; // 「http=…;https=…」这种分协议的写法
    return v ? (/^\w+:\/\//.test(v) ? v : 'http://' + v) : null;
  } catch { return null; }
}

const LOCAL = ['localhost', '127.0.0.1', '::1', '*.local', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  'api.deepseek.com', 'cn.bing.com']; // 国内服务也直连（👤 2026-10-16：VPN 切到全局模式时别把 DeepSeek 绕到国外）
let current = null, checkedAt = 0;
const detect = () => process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || systemProxy();
function apply(proxy) {
  current = proxy || null;
  if (!proxy) { setGlobalDispatcher(new Agent()); return null; }
  const noProxy = [...new Set([...(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim()).filter(Boolean), ...LOCAL])].join(',');
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: proxy, httpsProxy: proxy, noProxy }));
  return proxy;
}
// 重新看一眼代理设置（换了 VPN / 端口、托盘开的时候 VPN 还没开）：变了就换上，返回有没有变。最多 15 秒看一次
export function refreshProxy() {
  if (Date.now() - checkedAt < 15000) return false;
  checkedAt = Date.now();
  const p = detect() || null;
  if (p === current) return false;
  apply(p); console.log('[synapsis] 代理换成', p || '（无，直连）');
  return true;
}
const isLocal = u => { try { const h = new URL(u).hostname.replace(/^\[|\]$/g, ''); return /^(localhost|127\.|10\.|192\.168\.|::1$)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h); } catch { return true; } };
export function useProxy() {
  checkedAt = Date.now();
  const p = apply(detect());
  // 👤 2026-10-16「连不上时自动重新检测一次」：外网请求连不上 → 重新读代理设置，变了就换上再试一次（本机地址不管）
  const raw = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    try { return await raw(input, init); }
    catch (e) {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      if (isLocal(url) || init?.signal?.aborted || !/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|ENOTFOUND/i.test(String(e?.cause?.code || e?.cause?.message || e?.message))) throw e;
      if (!refreshProxy()) throw e;
      return raw(input, init);
    }
  };
  return p;
}
