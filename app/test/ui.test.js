// >v<✅自检-界面-无头 Edge 跑两个画布同一套交互
// 界面验收（React Flow；tldraw 对比版已退役，见 _过期的/tldraw_spike）
// 两个画布原型的同一套交互验收（无头 Edge）。先 npm run dev，再 node test/ui.test.js [截图目录]
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

for (const kind of ['reactflow']) {
  console.log('==', kind);
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errs.push(m.text()); });
  await page.goto(`${BASE}/?demo`);
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
  const edges = () => page.$$eval('.react-flow__edge', es => es.map(e => { const p = e.querySelector('.react-flow__edge-path'); return { id: e.dataset.id, color: p.style.stroke, op: +p.style.opacity }; }));
  const isIn = c => c === 'rgb(43, 123, 255)' || c === '#2b7bff';
  const isOut = c => c === 'rgb(255, 138, 31)' || c === '#ff8a1f';

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
  const h = await page.$('.react-flow__node[data-id="游戏AI/兜底"] .react-flow__handle.source');
  const hb = await h.boundingBox();
  await page.mouse.move(...center(hb)); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + (to.x + 10 - hb.x) * i / 10, hb.y + (to.y + to.height / 2 - hb.y) * i / 10);
  await page.mouse.up();
  await sleep(600);
  ok(/兜底 -> .*记忆与人格/.test(await outline()), '画布连线 → 大纲出现 -> 记忆与人格');

  // 键盘：选中 决策，Enter = 同级新节点
  b = await cardBox('决策');
  await page.mouse.click(...center(b)); await sleep(300);
  await page.keyboard.press('Enter'); await sleep(400);
  ok((await cards()).some(t => t.includes('新节点')), 'Enter 新建同级节点');
  // 建完光标在大纲里、名字选中 → 直接打字就是改名
  // 改名在大纲树里原地出输入框（👤：点大纲不该直接进编辑；改名 = 新建后 / F2 / 双击）
  const selTxt = () => page.evaluate(() => { const a = document.activeElement; return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' ? a.value.slice(a.selectionStart, a.selectionEnd) : '(焦点不在改名框：' + a.tagName + ')'; });
  ok((await selTxt()) === '新节点', '新建后大纲树里出改名框、名字选中 ' + await selTxt());
  await page.keyboard.type('效用表'); await page.keyboard.press('Enter'); await sleep(400);
  ok((await cards()).some(t => t.includes('效用表')), '直接打字 + 回车改名 → 画布同步');
  ok((await page.$$eval('.card.sel', cs => cs.map(c => c.innerText))).some(t => t.includes('效用表')), '改名后仍选中它');
  // Insert = 新建子级（Tab 改给左栏开关了）
  await page.keyboard.press('Insert'); await sleep(400);
  ok((await selTxt()) === '新节点', 'Insert 新建子级 → 改名框 ' + await selTxt());
  await page.keyboard.press('Escape'); await sleep(200);
  ok(/效用表\n\s+\S*\s*新节点/.test(await outline()), 'Insert 建在选中节点下面 ' + JSON.stringify((await outline()).split('\n').filter(l => l.includes('新节点') || l.includes('效用表'))));
  // Tab = 左栏开关；鼠标侧键 = 后退 / 前进
  await page.mouse.click(1000, 780); await sleep(200);
  await page.keyboard.press('Tab'); await sleep(200);
  ok(await page.$eval('aside.outline', a => getComputedStyle(a).display) === 'none', 'Tab 收起左栏');
  await page.keyboard.press('Tab'); await sleep(200);
  ok(await page.$eval('aside.outline', a => getComputedStyle(a).display) !== 'none', '再按 Tab 展开左栏');
  const crumbNow = () => page.$eval('.crumbs', e => e.innerText);
  const side = btn => page.evaluate(b => { for (const t of ['mousedown', 'mouseup']) window.dispatchEvent(new MouseEvent(t, { button: b, bubbles: true })); }, btn);
  await side(3); await sleep(600);
  ok((await crumbNow()) === '根', '鼠标后退键 → 回到根 ' + await crumbNow());
  await side(4); await sleep(600);
  ok((await crumbNow()).includes('游戏AI'), '鼠标前进键 → 回到游戏AI ' + await crumbNow());
  // 快捷键页：? 弹出，Esc 关
  await page.keyboard.press('?'); await sleep(300);
  ok((await page.$$eval('.help kbd', ks => ks.map(k => k.innerText))).includes('Tab'), '? 弹出快捷键页');
  await page.keyboard.press('Escape'); await sleep(200);
  ok((await page.$('.help')) === null, 'Esc 关掉快捷键页');
  // 大纲树：点一下 = 导航 + 属性面板显示内容，不进编辑
  await page.click('.orow:has-text("短期记忆")'); await sleep(600);
  ok((await crumbNow()).includes('记忆与人格'), '点大纲树 → 画布跳到那一页 ' + await crumbNow());
  ok((await page.$eval('.side h3', e => e.innerText).catch(() => '')) === '短期记忆', '点大纲树 → 右侧显示它的内容');
  ok(await page.evaluate(() => document.activeElement.tagName) !== 'INPUT', '点大纲树不进改名');
  await page.keyboard.press('ArrowDown'); await sleep(300);
  ok((await page.$eval('.orow.sel', e => e.innerText)).includes('个性空间'), '大纲树 ↓ 走到下一个');
  await page.dblclick('.orow:has-text("个性空间")'); await sleep(300);
  ok((await selTxt()) === '个性空间', '双击大纲树 → 改名框');
  await page.keyboard.press('Escape'); await sleep(200);
  await page.click('.side .bar button'); // 关掉属性面板
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(600);
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
  const cam = () => page.$eval('.react-flow__viewport', v => v.style.transform);
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
for (const kind of ['reactflow']) {
  console.log('== 工作区', kind);
  const ws = mkdtempSync(join(tmpdir(), 'syn-ui-'));
  saveOutline(ws, SAMPLE);
  writeFileSync(join(ws, 'README_测试.md'), '# 外部区的文件\n项目根目录里的普通文件。');
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`);
  await sleep(1800);
  const saveTxt = () => page.$eval('.save', e => e.innerText);
  ok((await saveTxt()).includes('已加载'), '工作区加载 ' + await saveTxt());
  ok((await page.$$('.card')).length === 3, '顶层 3 个节点');
  // 钻进 游戏AI → 选中 决策 → Enter 新建同级 → 文件出现
  // 按 .title 整体匹配：标题是 flex，带状态图标时 innerText 会把图标和名字拆成两行
  const box = async label => { for (const c of await page.$$('.card')) { const t = await c.$eval('.title', e => e.textContent).catch(() => ''); if (t.includes(label)) return c.boundingBox(); } };
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

  // 右键菜单：改状态 → 文件；属性面板改正文 → 文件；删除 → _过期的/；Del 键
  page.on('dialog', d => d.accept());
  const rclick = async label => { const bb = await box(label); if (!bb) { console.log('  找不到卡片', label, await page.$$eval('.card', cs => cs.map(c => c.innerText.split('\n')[0])), await page.$eval('.crumbs', e => e.innerText)); } await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' }); await sleep(300); };
  const nodeFile = rel => readFileSync(join(ws, '__synapsis', ...rel.split('/')), 'utf8');
  await rclick('行动');
  ok(await page.$('.ctx') !== null && (await page.$eval('.ctx .mh', e => e.innerText)) === '行动', '右键节点 → 菜单');
  await page.click('.ctx .mi.row button:has-text("✅")'); await sleep(1500);
  ok(/status: done/.test(nodeFile('游戏AI/行动/_node.md')), '右键改状态 → 文件 status: done');
  await rclick('行动'); await page.click('.ctx .mi:has-text("属性")'); await sleep(400);
  ok((await page.$eval('.side h3', e => e.innerText)) === '行动', '右键 属性 → 面板');
  ok((await page.$$eval('.side .edges li', ls => ls.length)) > 0, '属性面板列出入/出边');
  await page.fill('textarea.body', '行动层：从战术目标展开成动作序列。');
  await page.mouse.click(1000, 780); await sleep(1200);
  ok(nodeFile('游戏AI/行动/_node.md').includes('从战术目标展开成动作序列'), '属性面板改正文 → 写进文件');
  await rclick('新节点'); await page.click('.ctx .mi.danger'); await sleep(1500);
  ok(!existsSync(join(ws, '__synapsis', '游戏AI', '新节点.md')) && readdirSync(join(ws, '__synapsis', '_过期的')).some(n => n.includes('新节点')), '右键删除 → 移进 _过期的/');
  b = await box('兜底'); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.keyboard.press('Delete'); await sleep(1500);
  ok(!existsSync(join(ws, '__synapsis', '游戏AI', '兜底')), 'Del 键删除分组（确认框已接受）');
  await page.mouse.click(1000, 500, { button: 'right' }); await sleep(300);
  ok((await page.$$eval('.ctx .mi', ms => ms.map(m => m.innerText))).some(t => t.includes('新建节点')), '右键空白 → 新建节点菜单');
  await page.keyboard.press('Escape');
  // 文件页：项目根目录（__synapsis 之外）
  await page.click('.bar.tabs a:has-text("文件")'); await sleep(800);
  ok((await page.$$eval('.fi', fs => fs.map(f => f.innerText))).some(t => t.includes('README_测试.md')), '文件页列出根目录文件');
  await page.click('.fi:has-text("README_测试.md")'); await sleep(800);
  ok((await page.$eval('pre.raw', p => p.innerText)).includes('外部区的文件'), '点文件 → 右侧预览内容');
  // 文件树里有 __synapsis，点节点 md → 预览 + 画布选中它
  await page.click('.fi:has-text("__synapsis")'); await sleep(300);
  await page.click('.fi:has-text("游戏AI")'); await sleep(300);
  await page.click('.fi:has-text("决策")'); await sleep(300);
  await page.click('.fi:has-text("_node.md") >> nth=-1').catch(() => {}); await sleep(500);
  const fis = await page.$$eval('.fi', fs => fs.map(f => f.innerText));
  ok(fis.some(t => t.includes('__synapsis')), '文件树列出 __synapsis');
  ok((await page.$$('.card.sel')).length === 1 && (await page.$eval('pre.raw', p => p.innerText)).includes('---'), '点节点 md → 预览原文 + 画布选中那个节点');
  await page.click('.bar.tabs a:has-text("大纲")');
  await page.click('.side.wide .bar button'); await sleep(300); // 关掉预览：它会压住画布右半边
  await page.keyboard.press('Escape'); await page.click('.crumbs a >> nth=0'); await sleep(600);
  b = await box('游戏AI'); await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); await sleep(800);
  // 贴图（走同一个接口）→ 卡片显示图片；文件进 _pics_决策/
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate(async ([ws, png]) => { await fetch('/api/asset?ws=' + encodeURIComponent(ws), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: '游戏AI/决策', dataUrl: png }) }); }, [ws, PNG]);
  ok(readdirSync(join(ws, '__synapsis', '游戏AI', '决策', '_pics_决策')).length === 1, '贴图 → __synapsis/游戏AI/决策/_pics_决策/');
  // 视图记忆：缩放一下 → 刷新（= 下次启动）→ 还在 游戏AI 这一页、视图一样
  await page.mouse.move(900, 500); await page.mouse.wheel(0, -300); await sleep(1500);
  const camBefore = await page.$eval('.react-flow__viewport', v => v.style.transform);
  ok(existsSync(join(ws, '.synapsis', 'view.json')), '视图写进 .synapsis/view.json');
  await page.reload(); await sleep(2000);
  ok((await page.$eval('.crumbs', e => e.innerText)).includes('游戏AI'), '刷新后还在上次那一页 ' + await page.$eval('.crumbs', e => e.innerText));
  ok(await page.$eval('.react-flow__viewport', v => v.style.transform) === camBefore, '刷新后视图还原 ' + camBefore);
  ok((await page.$$('.card .pics img')).length === 1, '刷新后卡片显示 _pics_ 里的图');
  // 收起 / 显示：卡片上的 🖼；工具栏全局按钮
  await page.click('.card .picbadge'); await sleep(400);
  ok((await page.$$('.card .pics img')).length === 0, '点 🖼 收起这张卡的图');
  await page.click('button:has-text("显示图片")'); await sleep(400);
  ok((await page.$$('.card .pics img')).length === 1, '全局「显示图片」');
  await page.click('button:has-text("收起图片")'); await sleep(400);
  ok((await page.$$('.card .pics img')).length === 0, '全局「收起图片」');
  await page.click('button:has-text("显示图片")'); await sleep(400);
  // 右下角拖 → 宽度写进节点 frontmatter picw
  await page.hover('.card.hasimg'); await sleep(200);
  const g = await (await page.$('.card .picgrip')).boundingBox();
  const w0 = (await (await page.$('.card.hasimg')).boundingBox()).width;
  await page.mouse.move(g.x + 5, g.y + 5); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(g.x + 5 + i * 15, g.y + 5 + i * 5);
  await page.mouse.up(); await sleep(1200);
  ok((await (await page.$('.card.hasimg')).boundingBox()).width > w0 + 60, '拖图片右下角 → 卡片变宽');
  ok(/picw: \d+/.test(readFileSync(join(ws, '__synapsis', '游戏AI', '决策', '_node.md'), 'utf8')), '宽度写进 _node.md 的 picw');
  // 图片拖到空白处 → 新建一张图片卡（文件名当名字），图存进它的 _pics_
  const nBefore = (await page.$$('.card')).length;
  await page.evaluate(png => {
    const bin = atob(png.split(',')[1]), u8 = Uint8Array.from(bin, c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([u8], '参考图.png', { type: 'image/png' }));
    const c = document.querySelector('.canvas'), r = c.getBoundingClientRect();
    c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 80, clientY: r.bottom - 80 }));
  }, PNG);
  await sleep(2500);
  ok((await page.$$('.card')).length === nBefore + 1 && (await page.$$eval('.card .title', ts => ts.map(t => t.textContent))).some(t => t.includes('参考图')), '拖图到空白处 → 新卡「参考图」');
  ok(existsSync(join(ws, '__synapsis', '游戏AI', '_pics_参考图')) && readdirSync(join(ws, '__synapsis', '游戏AI', '_pics_参考图')).length === 1, '图存进 游戏AI/_pics_参考图/');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
await browser.close();
console.log(`ui: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
