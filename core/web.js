// >v<🤖AI指令-联网-👤 2026-10-16「整理资料库一定要搜，要能搜网上的信息」：内置 AI 的 look {"web": 关键词} / {"url": 网址}，只读。
//   搜：cn.bing.com 的网页结果（不用 key；国内连得上，DuckDuckGo 连不上），取前几条 标题 + 网址 + 摘要。
//   读：抓网页转成纯文本。只许公网 http(s)：本机 / 局域网地址一律不给（不然模型能去敲 LM Studio、TTS daemon 这些本机服务），重定向每一跳都查
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', middot: '·', hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };
export const decode = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const strip = s => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// 必应结果里的链接有时是跳转（bing.com/ck/a?…&u=a1<base64url>）：解出真网址
export function bingTarget(href) {
  href = decode(href);
  try {
    const u = new URL(href);
    if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const p = u.searchParams.get('u') || '';
      if (p.startsWith('a1')) return Buffer.from(p.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
  } catch { /* 不是完整网址就原样 */ }
  return href;
}

// 必应结果页 HTML → [{title, url, snippet}]
export function parseBing(html, max = 6) {
  const out = [];
  for (const m of String(html).matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)) {
    const li = m[0], a = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(li);
    if (!a) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(li) || /<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/.exec(li);
    out.push({ title: strip(a[2]), url: bingTarget(a[1]), snippet: strip(p?.[1] || '').slice(0, 300) });
    if (out.length >= max) break;
  }
  return out;
}

export async function webSearch(q, { fetchFn = fetch } = {}) {
  const r = await fetchFn('https://cn.bing.com/search?q=' + encodeURIComponent(q), { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('必应 ' + r.status);
  return parseBing(await r.text());
}

// 本机 / 局域网 / 保留地址：不给读
export function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^::ffff:/.test(v) && privateIp(v.slice(7));
}
async function publicUrl(raw, { lookupFn = lookup } = {}) {
  let u; try { u = new URL(raw); } catch { throw new Error('不是网址'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('只读 http / https 网页');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.lan$|\.internal$/i.test(host)) throw new Error('不读本机 / 局域网地址');
  const ips = isIP(host) ? [host] : (await lookupFn(host, { all: true })).map(x => x.address);
  if (!ips.length || ips.some(privateIp)) throw new Error('不读本机 / 局域网地址');
  return u;
}

// 读网页 → 纯文本（去 script / style / 导航这类；最多 max 字）
export async function webRead(raw, { fetchFn = fetch, lookupFn = lookup, max = 12000 } = {}) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await publicUrl(url, { lookupFn });
    const r = await fetchFn(u.href, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), u).href; continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const type = r.headers.get('content-type') || '';
    if (!/text\/|json|xml/.test(type)) throw new Error('不是网页 / 文本（' + (type || '未知类型') + '）');
    let body = await r.text();
    if (body.length > 3e6) body = body.slice(0, 3e6);
    if (!/html/.test(type)) return { url: u.href, title: '', text: body.slice(0, max) };
    const title = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body) || [])[1]);
    const text = decode(body.replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h\d|tr|br|section|article)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
      .replace(/[ \t\f\r]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return { url: u.href, title, text: text.slice(0, max) + (text.length > max ? '\n…（后面还有，太长截了）' : '') };
  }
  throw new Error('跳转太多次');
}
