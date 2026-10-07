// >v<✅自检-界面-无头 Edge 跑两个画布同一套交互
// 两个画布原型的同一套交互验收（无头 Edge）。先 npm run dev，再 node test/ui.test.js [截图目录]
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline } from '../../core/workspace.js';
import { SAMPLE } from '../src/sample.js';
const BASE = 'http://localhost:5410';
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const sleep = t => new Promise(r => setTimeout(r, t));

const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const kind of ['reactflow', 'tldraw']) {
  console.log('==', kind);
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text()); });
  await page.goto(`${BASE}/${kind}.html?demo`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await sleep(1500);

  // 画布无关的查询：卡片 DOM（两边都用 NodeCard）
  const cards = () => page.$$eval('.card', cs => cs.map(c => c.querySelector('.title')?.innerText.replace(/\s+/g, ' ').trim() || c.innerText.trim()));
  const cardBox = async label => {
    const all = await page.$$('.card');
    for (const c of all) if ((await c.innerText()).split('\n')[0].includes(label)) return c.boundingBox();
    return null;
  };
  const center = b => [b.x + b.width / 2, b.y + b.height / 2];
  const outline = () => page.$eval('textarea', t => t.value);
  // 边：RF 用 DOM，tldraw 用 editor（受管箭头）
  const edges = () => kind === 'reactflow'
    ? page.$$eval('.react-flow__edge', es => es.map(e => { const p = e.querySelector('.react-flow__edge-path'); return { id: e.dataset.id, color: p.style.stroke, op: +p.style.opacity }; }))
    : page.evaluate(() => window.__ed.getCurrentPageShapes().filter(s => s.type === 'arrow' && s.meta.managed).map(s => {
        const bs = window.__ed.getBindingsFromShape(s, 'arrow');
        const nid = t => window.__ed.getShape(bs.find(b => b.props.terminal === t).toId).props.nid;
        return { id: nid('start') + '=>' + nid('end'), color: s.props.color, op: s.opacity };
      }));
  const isIn = c => c === 'rgb(43, 123, 255)' || c === '#2b7bff' || c === 'blue';
  const isOut = c => c === 'rgb(255, 138, 31)' || c === '#ff8a1f' || c === 'orange';

  let c = await cards();
  ok(c.length === 3, '顶层 3 个节点, got ' + c.length);

  // 原地展开：点 ▸N → 卡片里列出子级（不钻进）；双击子项 → 跳进去并选中
  await page.click('.card:has-text("游戏AI") .kids'); await sleep(500);
  let kl = await page.$$eval('.kidlist li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
  ok(kl.length === 5 && kl.some(t => t.includes('决策')), '点 ▸N 原地展开子级 ' + JSON.stringify(kl));
  ok((await page.$eval('.crumbs', e => e.innerText)) === '根', '展开不钻进');
  const kli = await page.$('.kidlist li:has-text("决策")');
  const kb = await kli.boundingBox();
  await page.mouse.dblclick(kb.x + kb.width / 2, kb.y + kb.height / 2); await sleep(800);
  ok((await page.$eval('.crumbs', e => e.innerText)).includes('游戏AI'), '双击子项 → 跳进去');
  ok((await page.$$eval('.card.sel', cs => cs.map(c => c.innerText.split('\n')[0]))).some(t => t.includes('决策')), '双击子项 → 选中它');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+ArrowUp'); await sleep(800);
  await page.click('.card:has-text("游戏AI") .kids'); await sleep(400);
  ok((await page.$$('.kidlist li')).length === 0, '再点 ▸N 收起');
  await page.keyboard.press('Escape'); await sleep(200);

  // 钻进
  let b = await cardBox('游戏AI');
  await page.mouse.dblclick(...center(b));
  await sleep(800);
  ok((await page.$eval('.crumbs', e => e.innerText)).includes('游戏AI'), '双击钻进 → 面包屑');
  c = await cards();
  ok(c.length === 5, '游戏AI 内 5 个节点, got ' + c.length);
  let es = await edges();
  ok(es.length === 7, '聚合后 7 条边, got ' + es.length);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${kind}_1_drill.png` });

  // 选中 行动：入 = 决策、兜底（蓝），出 = 感知（橙），记忆与人格淡化
  b = await cardBox('行动');
  await page.mouse.click(...center(b));
  await sleep(500);
  es = await edges();
  const inE = es.filter(e => e.id.endsWith('=>游戏AI/行动'));
  const outE = es.filter(e => e.id.startsWith('游戏AI/行动=>'));
  ok(inE.length === 2 && inE.every(e => isIn(e.color)), '入边蓝 ' + JSON.stringify(inE));
  ok(outE.length === 1 && outE.every(e => isOut(e.color)), '出边橙 ' + JSON.stringify(outE));
  ok(es.filter(e => !inE.includes(e) && !outE.includes(e)).every(e => e.op < 0.2), '其余边淡化');
  const dims = await page.$$eval('.card.dim', cs => cs.map(c => c.innerText.split('\n')[0]));
  ok(dims.length === 1 && dims[0].includes('记忆与人格'), '无关节点淡化 ' + JSON.stringify(dims));
  await page.keyboard.press(' '); await sleep(400);
  ok((await page.$$eval('.kidlist li', ls => ls.length)) === 2, '选中后空格 → 原地展开（行动有 2 个子级）');
  await page.keyboard.press(' '); await sleep(400);
  ok((await page.$$('.kidlist li')).length === 0, '再按空格收起');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${kind}_2_select.png` });

  // 拖动 → 刷新后坐标还在
  b = await cardBox('兜底');
  const [x0, y0] = center(b);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + i * 6, y0 + i * 9);
  await page.mouse.up(); await sleep(400);
  const moved = await cardBox('兜底');
  ok(Math.abs(moved.y - b.y) > 40, '拖动生效 dy=' + (moved.y - b.y).toFixed(0));

  // 连线：兜底 → 记忆与人格
  const from = await cardBox('兜底'), to = await cardBox('记忆与人格');
  if (kind === 'reactflow') {
    const h = await page.$('.react-flow__node[data-id="游戏AI/兜底"] .react-flow__handle.source');
    const hb = await h.boundingBox();
    await page.mouse.move(...center(hb)); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + (to.x + 10 - hb.x) * i / 10, hb.y + (to.y + to.height / 2 - hb.y) * i / 10);
    await page.mouse.up();
  } else {
    await page.mouse.click(1000, 780); // 画布空白处拿焦点（别点到左边大纲，否则 a 会打进文本）
    await page.keyboard.press('a');
    await page.mouse.move(...center(from)); await page.mouse.down();
    const [tx, ty] = center(to);
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2 + (tx - from.x - from.width / 2) * i / 10, from.y + from.height / 2 + (ty - from.y - from.height / 2) * i / 10);
    await page.mouse.up();
  }
  await sleep(600);
  ok(/兜底 -> .*记忆与人格/.test(await outline()), '画布连线 → 大纲出现 -> 记忆与人格');

  // 键盘：选中 决策，Enter = 同级新节点
  if (kind === 'tldraw') await page.keyboard.press('v');
  b = await cardBox('决策');
  await page.mouse.click(...center(b)); await sleep(300);
  await page.keyboard.press('Enter'); await sleep(400);
  ok((await cards()).some(t => t.includes('新节点')), 'Enter 新建同级节点');
  // 建完光标在大纲里、名字选中 → 直接打字就是改名
  const selTxt = () => page.evaluate(() => { const a = document.activeElement; return a.tagName === 'TEXTAREA' ? a.value.slice(a.selectionStart, a.selectionEnd) : '(焦点不在大纲：' + a.tagName + ')'; });
  ok((await selTxt()) === '新节点', '新建后大纲选中名字 ' + await selTxt());
  await page.keyboard.type('效用表'); await sleep(400);
  ok((await cards()).some(t => t.includes('效用表')), '直接打字改名 → 画布同步');
  await page.mouse.click(1000, 780); await sleep(200);
  await page.click('button:has-text("＋ 节点")'); await sleep(400);
  ok((await selTxt()).startsWith('新节点'), '工具栏 ＋节点 → 大纲选中名字 ' + await selTxt());
  await page.keyboard.press('Escape'); await page.mouse.click(1000, 780); await sleep(200);

  // 导出
  await page.click('text=导出给 LLM'); await sleep(300);
  const ex = await page.$eval('.modal pre', p => p.innerText);
  ok(ex.includes('[游戏AI/决策/决策空间]') && ex.includes('输入(←)'), '导出含 id 与入边');
  await page.click('.modal button:has-text("关闭")');

  // 视图记忆：缩放平移后返回上一级、再钻回来 → 视图还原；Alt+← / Alt+→ 历史
  const cam = () => kind === 'reactflow'
    ? page.$eval('.react-flow__viewport', v => v.style.transform)
    : page.evaluate(() => { const c = window.__ed.getCamera(); return `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(3)}`; });
  const camFit = await cam();
  await page.mouse.move(900, 600);
  await page.mouse.wheel(0, -400); await sleep(300);
  await page.mouse.move(900, 600); await page.mouse.down(); await page.mouse.move(800, 500, { steps: 5 }); await page.mouse.up();
  await sleep(500);
  const camIn = await cam();
  ok(camIn !== camFit, '缩放平移确实改变了视图（否则下面的还原检查无意义）');
  await page.mouse.click(1000, 780); await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+ArrowUp'); await sleep(800);
  ok((await page.$eval('.crumbs', e => e.innerText)) === '根', 'Alt+↑ 返回上一级');
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(800);
  ok((await page.$eval('.crumbs', e => e.innerText)).includes('游戏AI'), 'Alt+← 后退回游戏AI');
  ok(await cam() === camIn, `返回再进来视图还原 ${camIn} vs ${await cam()}`);
  await page.keyboard.press('Alt+ArrowRight'); await sleep(600);
  ok((await page.$eval('.crumbs', e => e.innerText)) === '根', 'Alt+→ 前进');
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(600);

  // 刷新：坐标持久
  await page.reload(); await sleep(1500);
  b = await cardBox('游戏AI'); await page.mouse.dblclick(...center(b)); await sleep(800);
  const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), 'syn.pos.' + kind);
  ok(saved['游戏AI/兜底'] !== undefined, '拖动坐标已持久化');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${kind}_3_after.png` });

  ok(errs.length === 0, '无页面报错 ' + errs.slice(0, 3).join(' | '));
  await page.close();
}
// —— 工作区模式：临时目录，画布编辑 → 文件真的写进去 ——
for (const kind of ['reactflow', 'tldraw']) {
  console.log('== 工作区', kind);
  const ws = mkdtempSync(join(tmpdir(), 'syn-ui-'));
  saveOutline(ws, SAMPLE);
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/${kind}.html?ws=${encodeURIComponent(ws)}`);
  await sleep(1800);
  const saveTxt = () => page.$eval('.save', e => e.innerText);
  ok((await saveTxt()).includes('已加载'), '工作区加载 ' + await saveTxt());
  ok((await page.$$('.card')).length === 3, '顶层 3 个节点');
  // 钻进 游戏AI → 选中 决策 → Enter 新建同级 → 文件出现
  const box = async label => { for (const c of await page.$$('.card')) if ((await c.innerText()).split('\n')[0].includes(label)) return c.boundingBox(); };
  let b = await box('游戏AI'); await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); await sleep(800);
  b = await box('决策'); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(300);
  await page.keyboard.press('Enter'); await sleep(1800);
  ok(existsSync(join(ws, '__synapsis', '游戏AI', '新节点.md')), '画布 Enter → __synapsis/游戏AI/新节点.md 写入');
  ok((await saveTxt()).includes('已保存'), '显示已保存 ' + await saveTxt());
  // 拖动 → _layout.json
  b = await box('兜底'); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + i * 8, b.y + b.height / 2 + i * 8);
  await page.mouse.up(); await sleep(800);
  const lay = JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'));
  ok(lay['游戏AI/兜底'] !== undefined, '拖动 → _layout.json ' + JSON.stringify(Object.keys(lay)) + ' moved=' + JSON.stringify(b) + ' now=' + JSON.stringify(await box('兜底')));
  ok(existsSync(join(ws, '__synapsis', '_synapsis.md')), '自动生成 _synapsis.md 说明');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
await browser.close();
console.log(`ui: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
