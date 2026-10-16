// 内置 AI 联网：必应结果解析 / 跳转链接解码 / 只读公网（不碰本机、局域网）。node core/test/web.test.js（不真的联网）
import { parseBing, bingTarget, privateIp, webRead, webSearch, decode } from '../web.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

const html = `<ol><li class="b_algo" data-x="1"><h2><a href="https://zh.wikipedia.org/wiki/%E4%BA%AC%E8%A7%82" h="ID=1">京观 - <strong>维基</strong>百科</a></h2><div class="b_caption"><p class="b_lineclamp2">京观是古代把敌尸堆土封之&hellip;&amp;</p></div></li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1${Buffer.from('https://example.com/timur').toString('base64url')}&amp;ntb=1">Timur</a></h2><p>Skull towers</p></li>
<li class="b_ad"><h2><a href="https://ad.example">广告</a></h2></li></ol>`;
const rs = parseBing(html);
ok(rs.length === 2 && rs[0].title === '京观 - 维基百科' && rs[0].url.startsWith('https://zh.wikipedia.org') && rs[0].snippet === '京观是古代把敌尸堆土封之…&', '必应结果：标题 / 网址 / 摘要（去标签、解实体），广告不算');
ok(rs[1].url === 'https://example.com/timur' && bingTarget('https://x.org/a') === 'https://x.org/a', '必应跳转链接解成真网址');
ok(decode('&#x4e2d;&#25991;&nbsp;') === '中文 ', '数字实体也认');

ok(['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.1.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1'].every(privateIp), '本机 / 局域网 / 保留地址都认得出');
ok(!['8.8.8.8', '93.184.216.34', '2606:4700::1111'].some(privateIp), '公网地址放行');

const fakeLookup = async host => ({ 'lan.example': [{ address: '192.168.1.10' }], 'pub.example': [{ address: '93.184.216.34' }], 'evil.example': [{ address: '93.184.216.34' }] }[host] || []);
const page = (body, type = 'text/html; charset=utf-8', status = 200, loc = null) => ({ ok: status < 300, status, headers: { get: k => k === 'content-type' ? type : k === 'location' ? loc : null }, text: async () => body });
const fakeFetch = async url => url.startsWith('http://evil.example') ? page('', 'text/html', 302, 'http://127.0.0.1:1234/v1/models')
  : page('<html><head><title>标题</title><script>x=1</script></head><body><nav>导航</nav><p>正文第一段&amp;</p><p>第二段</p></body></html>');
const R = (u, o = {}) => webRead(u, { fetchFn: fakeFetch, lookupFn: fakeLookup, ...o }).then(x => x, e => ({ error: e.message }));
const p1 = await R('https://pub.example/a');
ok(p1.title === '标题' && p1.text.includes('正文第一段&') && p1.text.includes('第二段') && !p1.text.includes('x=1') && !p1.text.includes('导航'), '读网页：标题 + 正文，去掉 script / nav');
ok(/本机/.test((await R('http://localhost:1234/v1/models')).error) && /本机/.test((await R('http://127.0.0.1:5299/speak')).error) && /本机/.test((await R('http://lan.example/')).error), '本机 / 局域网（含域名解析到局域网的）一律不读');
ok(/本机/.test((await R('http://evil.example/')).error), '公网页面重定向到本机 → 也拦住');
ok(/http/.test((await R('file:///C:/Windows/win.ini')).error) && /网址/.test((await R('不是网址')).error), '只读 http / https');
ok(/不是网页/.test((await webRead('https://pub.example/x.zip', { fetchFn: async () => page('PK', 'application/zip'), lookupFn: fakeLookup }).catch(e => ({ message: e.message }))).message || ''), '二进制文件不读');
const s = await webSearch('京观', { fetchFn: async u => ({ ok: true, text: async () => (u.includes(encodeURIComponent('京观')) ? html : '') }) });
ok(s.length === 2, '搜：关键词编码进必应的网址');

console.log(`web: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
