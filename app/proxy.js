// >v<💾工作区-联网代理-👤 2026-10-16：xAI（Grok）国内直连连不上，浏览器走的是本机代理（如 Clash 127.0.0.1:7897），但 Node 的 fetch 默认不认代理。
//   服务启动时：有代理（环境变量 HTTPS_PROXY / HTTP_PROXY，没有就读 Windows 系统代理设置）→ 全局 fetch 走它；
//   本机 / 局域网地址（LM Studio、TTS、自己的服务）和国内服务（DeepSeek、必应国内版）一律直连。没代理 = 什么都不做
import { execFileSync } from 'node:child_process';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

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

export function useProxy() {
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const proxy = env || systemProxy();
  if (!proxy) return null;
  const local = ['localhost', '127.0.0.1', '::1', '*.local', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
    'api.deepseek.com', 'cn.bing.com']; // 国内服务也直连（👤 2026-10-16：Clash 切到全局模式时别把 DeepSeek 绕到国外）
  const noProxy = [...new Set([...(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim()).filter(Boolean), ...local])].join(',');
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: proxy, httpsProxy: proxy, noProxy }));
  return proxy;
}
