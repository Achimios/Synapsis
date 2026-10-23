// >v<✅自检-规模-界面计时：先起 SYN_DESKTOP=1 npx vite --port 5477 --strictPort；node test/scale_ui.mjs <scale_gen 造的工作区绝对路径>
//   会在那个工作区里改一个名字，只给临时目录用
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';
const ws = process.argv[2], BASE = 'http://localhost:5477';
mkdirSync(join(ws, '.synapsis'), { recursive: true });
writeFileSync(join(ws, '.synapsis', 'ai.json'), JSON.stringify({ url: 'http://127.0.0.1:9/v1', offline: true }));
const sleep = t => new Promise(r => setTimeout(r, t));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true }); });
const longs = async () => { const l = await page.evaluate(() => { const a = window.__lt; window.__lt = []; return a; }); return l.length ? `长任务 ${l.length} 个，最长 ${Math.round(Math.max(...l))} ms，合计 ${Math.round(l.reduce((a, b) => a + b, 0))} ms` : '无长任务'; };
const until = async (f, max = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < max) { if (await f().catch(() => false)) return Date.now() - t0; await sleep(30); } return '超时'; };
const save = () => page.$eval('.save', e => e.innerText).catch(() => '');
const log = (...a) => console.log(...a);

// 1. 接口本身
let t0 = Date.now();
const api = await page.request.get(`${BASE}/api/ws?ws=${encodeURIComponent(ws)}`);
const body = await api.text();
log('GET /api/ws', Date.now() - t0, 'ms', Math.round(body.length / 1024), 'KB');

// 2. 打开工作区
t0 = Date.now();
await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`);
log('打开 → 「已加载」', await until(async () => (await save()).includes('已加载')), 'ms（goto 起算', Date.now() - t0, 'ms）');
await sleep(1500);
log('  根页卡片', (await page.$$('.card')).length, '| 左栏行数', await page.$$eval('aside.outline *', e => e.length).catch(() => '?'), '个元素 |', await longs());
log('  JS 堆', await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6)), 'MB | DOM 节点', await page.evaluate(() => document.getElementsByTagName('*').length));

// 3. 进一页（双击「战斗」）再进一层
const box = async label => { for (const l of await page.$$('.card .lab')) if ((await l.textContent()).trim() === label) return l.boundingBox(); };
for (const lab of ['战斗', '战斗节奏', '战斗节奏·代价']) {
  const b = await box(lab); if (!b) { log('  找不到卡片', lab); break; }
  const n0 = await page.$$eval('.card', c => c.map(x => x.innerText).join('|'));
  t0 = Date.now(); await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  const dt = await until(async () => (await page.$$eval('.card', c => c.map(x => x.innerText).join('|'))) !== n0);
  await sleep(600); log('进「' + lab + '」', dt, 'ms，卡片', (await page.$$('.card')).length, '|', await longs());
}

// 4. Ctrl+F
await page.mouse.click(700, 800); await page.keyboard.press('Control+f'); await sleep(300);
t0 = Date.now(); await page.keyboard.type('代价', { delay: 50 });
const fd = await until(async () => (await page.$$('.finder li')).length > 0);
log('Ctrl+F 打「代价」→ 出结果', fd, 'ms（含打字 100ms），结果', (await page.$$('.finder li')).length, '条 |', await longs());
await page.keyboard.press('Escape'); await sleep(300);

// 5. 改名（属性面板标题）→ 已保存
const b = await box('战斗节奏·代价·例3');
if (b) {
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(400);
  const inp = await page.$('.side h3 input');
  await inp.fill('战斗节奏·代价·例3改'); await longs();
  t0 = Date.now(); await inp.press('Enter');
  log('改名 → 「已保存」', await until(async () => /已保存|已改名/.test(await save())), 'ms |', await save(), '|', await longs());
}
// 6. 新建同级（右键空白 → 在这里新建节点 → Enter）
const blank = [1300, 780];
await page.mouse.click(...blank, { button: 'right' }); await sleep(300);
const mi = await page.$('.ctx .mi:has-text("在这里新建节点")');
if (mi) { await mi.click(); await sleep(300); t0 = Date.now(); await page.keyboard.press('Enter'); log('新建节点 → 「已保存」', await until(async () => /已保存/.test(await save())), 'ms |', await longs()); }
// 7. 回根 + 再看左栏
await page.keyboard.press('Escape');
log('页面错误', errs.length ? errs.slice(0, 3) : '无');
await page.screenshot({ path: join(ws, '..', 'shot_ui.png') });
await browser.close();
