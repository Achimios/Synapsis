// >v<🤖LLM接口-look-让 AI 看见画布（👤 2026-10-31 学 openfilm 的 `look`：AI 改完图自己看一眼再说做好了）
//   core/cli.js look [页id] 调这里：进程内起一个 vite（用当前代码，不借托盘那个可能还是旧代码的服务）→ 无头 Edge 打开 ?look=<页>
//   （界面只读：不发写请求、不用记住的视口、整页适配）→ 截这一页画布的图 + 量出问题：卡片互相盖住、字被截掉、页面报错。
//   图存 <项目>/.synapsis/look/<页>.png（本机临时品，同一页每次覆盖）；AI 读这张图就能看见画布。
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(fileURLToPath(import.meta.url));
const sleep = t => new Promise(r => setTimeout(r, t));

// 页面里量：卡片框（屏幕坐标）、互相盖住的、字被截掉的、缩放
function measure() {
  const name = el => el.querySelector('.lab')?.innerText.trim() || el.innerText.trim().split('\n')[0].slice(0, 30);
  const cards = [...document.querySelectorAll('.react-flow__node')].map(el => ({ id: el.dataset.id, name: name(el), r: el.getBoundingClientRect(), el }));
  const overlaps = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i].r, b = cards[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w <= 2 || h <= 2) continue;
    const small = Math.min(a.width * a.height, b.width * b.height);
    overlaps.push({ a: cards[i].id, b: cards[j].id, pct: Math.round(100 * w * h / small) });
  }
  // 字被截：自己设了 overflow 隐藏 / 省略号、内容又比框大的元素（标题、正文预览、属性）
  const clipped = [];
  for (const c of cards) for (const el of c.el.querySelectorAll('*')) {
    if (!el.childElementCount && !el.textContent.trim()) continue;
    const s = getComputedStyle(el);
    if (s.overflow === 'visible' && s.textOverflow !== 'ellipsis') continue;
    const pad = s.textOverflow === 'ellipsis' ? 0 : 2; // 省略号的往往只超 1~2px
    if (el.scrollWidth > el.clientWidth + pad || el.scrollHeight > el.clientHeight + pad) { clipped.push({ id: c.id, what: el.closest('.lab, .title') ? '名字' : el.closest('.props') ? '属性' : '内容', text: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 40) }); break; }
  }
  const vp = document.querySelector('.react-flow__viewport');
  const zoom = vp ? +(new DOMMatrix(getComputedStyle(vp).transform).a).toFixed(2) : null;
  return {
    cards: cards.map(c => ({ id: c.id, name: c.name })), edges: document.querySelectorAll('.react-flow__edge').length,
    overlaps, clipped, zoom, timeline: !!document.querySelector('.tlview:not(.emb)'), clips: document.querySelectorAll('.tlview:not(.emb) .tlclip').length,
  };
}

export async function look(root, page = '', { canvas = false, size = '1600x1000', out = null } = {}) {
  const [width, height] = size.split('x').map(Number);
  // SYN_IN_CLI：vite.config 会 import core/cli.js，别让它当成命令行再跑一遍（也不打代理提示）
  process.env.SYN_DESKTOP = '1'; process.env.SYN_IN_CLI = '1';
  const server = await createServer({ configFile: join(APP, 'vite.config.js'), root: APP, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errs = [];
    tab.on('pageerror', e => errs.push(e.message));
    tab.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text()); });
    await tab.goto(`${base}/?ws=${encodeURIComponent(root)}&look=${encodeURIComponent(page)}${canvas ? '&canvas' : ''}`);
    await tab.waitForSelector('.canvas .react-flow__renderer, .canvas .tlview', { timeout: 20000 });
    await sleep(1200);
    await tab.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; }))));
    const m = await tab.evaluate(measure);
    const file = out || join(root, '.synapsis', 'look', (page || '根').replace(/[\\/:*?"<>|]/g, '_') + (canvas ? '.canvas' : '') + '.png');
    mkdirSync(dirname(file), { recursive: true });
    await (await tab.$('.canvas')).screenshot({ path: file });
    return { file, ...m, errors: errs };
  } finally {
    await browser.close();
    await server.close();
  }
}

// 给人（和 AI）读的报告
export function lookReport(r, page) {
  const L = [`截图：${r.file.split('\\').join('/')}（用读图工具打开看）`];
  L.push(r.timeline ? `「${page || '根'}」时间轴视图：${r.clips} 段（看画布排布加 --canvas）` : `「${page || '根'}」画布：${r.cards.length} 张卡、${r.edges} 条线，缩放 ${r.zoom}`);
  const probs = [];
  for (const o of r.overlaps) probs.push(`盖住：${o.a} × ${o.b}（小的那张被盖 ${o.pct}%）`);
  for (const c of r.clipped) probs.push(`${c.what}被截：${c.id}「${c.text}…」${c.what === '名字' ? '' : '（卡上只显示一行，不一定要改）'}`);
  if (!r.timeline && r.zoom !== null && r.zoom < 0.5) probs.push(`卡太多，整页缩到 ${r.zoom} 倍，截图里字可能看不清：看子页，或 --size 2400x1600 放大`);
  for (const e of r.errors) probs.push('页面报错：' + e);
  L.push(...(probs.length ? probs.map(p => '⚠ ' + p) : ['✓ 没量出问题（重叠 / 截字 / 报错）；排得顺不顺眼看图']));
  return L.join('\n');
}
