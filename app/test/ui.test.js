// >v<✅自检-界面-无头 Edge 跑两个画布同一套交互
// 界面验收（React Flow；tldraw 对比版已退役，见 _过期的/tldraw_spike）
// 两个画布原型的同一套交互验收（无头 Edge）。先 npm run dev，再 node test/ui.test.js [截图目录]
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, setNodeBody } from '../../core/workspace.js';
import { runBatch } from '../../core/cli.js';
import { SAMPLE } from '../src/sample.js';
import { PALETTE } from '../../core/colors.js';
const BASE = 'http://localhost:5410';
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const sleep = t => new Promise(r => setTimeout(r, t));
// 临时工作区不碰真的 LM Studio：工作区级 .synapsis/ai.json 指到一个没人听的端口（AI 那段自检另起假服务）
const noAi = (ws, url = 'http://127.0.0.1:9/v1') => { mkdirSync(join(ws, '.synapsis'), { recursive: true }); writeFileSync(join(ws, '.synapsis', 'ai.json'), JSON.stringify({ url })); };

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
  const cards = () => page.$$eval('.card', cs => cs.map(c => (c.querySelector('.title input.rename')?.value || '') + (c.querySelector('.title')?.innerText.replace(/\s+/g, ' ').trim() || c.innerText.trim()))); // 改名框里的字 innerText 读不到
  // 点卡片的名字（卡片中间可能正好是 ▸N / ⊞ 按钮）
  const cardBox = async label => {
    for (const l of await page.$$('.card .lab')) if ((await l.textContent()).includes(label)) return l.boundingBox();
    return null;
  };
  const center = b => [b.x + b.width / 2, b.y + b.height / 2];
  const outline = () => page.$eval('textarea', t => t.value);
  const edges = () => page.$$eval('.react-flow__edge', es => es.map(e => { const p = e.querySelector('.react-flow__edge-path'); return { id: e.dataset.id, color: p.style.stroke, op: +p.style.opacity, w: parseFloat(p.style.strokeWidth) }; }));
  const rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
  const sameCol = (c, h) => c === h || c === rgb(h);

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

  // 颜色（👤 2026-10-08）：卡片按名字认色，线 = 出发节点的颜色
  const cardCol = label => page.$$eval('.card', (cs, l) => { const c = cs.find(x => x.querySelector('.title')?.textContent.includes(l)); return c && c.style.getPropertyValue('--c'); }, label);
  ok(await cardCol('感知') === PALETTE.蓝 && await cardCol('决策') === PALETTE.橙 && await cardCol('行动') === PALETTE.绿 && await cardCol('兜底') === PALETTE.红, '卡片颜色：感知蓝 决策橙 行动绿 兜底红');
  ok(es.every(e => e.op < 0.95 && e.op > 0.1), '没选中时所有线半透明');
  const idle = es;
  // 选中 行动：颜色不变，相连的线变实变粗；入 = 决策（橙）、兜底（红），出 = 感知（行动的绿）；记忆与人格淡化
  b = await cardBox('行动');
  await page.mouse.click(...center(b));
  await sleep(500);
  es = await edges();
  const inE = es.filter(e => e.id.endsWith('=>游戏AI/行动'));
  const outE = es.filter(e => e.id.startsWith('游戏AI/行动=>'));
  const colOf = id => sameCol(es.find(e => e.id === id).color, PALETTE[{ '游戏AI/决策=>游戏AI/行动': '橙', '游戏AI/兜底=>游戏AI/行动': '红' }[id]]);
  ok(inE.length === 2 && inE.every(e => colOf(e.id)), '入边 = 出发节点的颜色（决策橙、兜底红） ' + JSON.stringify(inE));
  ok(outE.length === 1 && sameCol(outE[0].color, PALETTE.绿), '出边 = 行动自己的绿 ' + JSON.stringify(outE));
  ok([...inE, ...outE].every(e => e.op === 1 && e.w > idle.find(x => x.id === e.id).w), '相连的线变实变粗');
  ok(es.filter(e => !inE.includes(e) && !outE.includes(e)).every(e => e.op < 0.2), '其余边淡化');
  const dims = await page.$$eval('.card.dim', cs => cs.map(c => c.innerText.split('\n')[0]));
  ok(dims.length === 1 && dims[0].includes('记忆与人格'), '无关节点淡化 ' + JSON.stringify(dims));
  await page.keyboard.press(' '); await sleep(400);
  ok((await page.$$eval('.kidlist li', ls => ls.length)) === 2, '选中后空格 → 原地展开（行动有 2 个子级）');
  await page.keyboard.press(' '); await sleep(400);
  ok((await page.$$('.kidlist li')).length === 0, '再按空格收起');
  // 多选（👤 2026-10-08：Ctrl+单击 曾经死循环黑屏）
  const selLabs = async () => (await page.$$eval('.card.sel .lab', ls => ls.map(l => l.textContent))).sort().join(',');
  const nErr = errs.length;
  await page.keyboard.down('Control'); await page.mouse.click(...center(await cardBox('决策'))); await page.keyboard.up('Control'); await sleep(400);
  ok(await selLabs() === '决策,行动' && !!(await page.$('.scaleframe')) && errs.length === nErr, 'Ctrl+单击 = 加入选择（不崩），出缩放框 ' + await selLabs() + ' ' + errs.slice(nErr).join(' '));
  await page.keyboard.down('Control'); await page.mouse.click(...center(await cardBox('决策'))); await page.keyboard.up('Control'); await sleep(400);
  ok(await selLabs() === '行动', '再 Ctrl+单击 = 移出 ' + await selLabs());
  await page.keyboard.press('Escape'); await page.mouse.click(...center(await cardBox('感知'))); await sleep(300);
  await page.keyboard.down('Shift'); await page.mouse.click(...center(await cardBox('行动'))); await page.keyboard.up('Shift'); await sleep(400);
  ok(await selLabs() === '决策,感知,行动,记忆与人格', 'Shift+单击 = 两点之间路径上的都选上（兜底不在路径上） ' + await selLabs());
  await page.keyboard.press('Escape'); await page.mouse.click(...center(await cardBox('行动'))); await sleep(300);
  await page.keyboard.press('Control+ArrowLeft'); await sleep(400);
  ok(await selLabs() === '兜底,决策,行动', 'Ctrl+← = 沿入线扩一层 ' + await selLabs());
  await page.keyboard.press('Shift+ArrowLeft'); await sleep(400);
  ok((await page.$$('.card.sel')).length === 5, 'Shift+← = 一直扩到头 ' + await selLabs());
  await page.keyboard.press('Escape'); await sleep(200);
  ok((await page.$$('.card.sel')).length === 0, 'Esc 清空多选');
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
  const to = await (await page.$('.react-flow__node[data-id="游戏AI/记忆与人格"]')).boundingBox();
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
  const inCard = () => page.evaluate(() => !!document.activeElement.closest('.card'));
  ok((await selTxt()) === '新节点' && await inCard(), '新建后卡片上就地出改名框、名字选中（👤 2026-10-08：不跳左栏） ' + await selTxt());
  await page.keyboard.type('效用表'); await page.keyboard.press('Enter'); await sleep(400);
  ok((await cards()).some(t => t.includes('效用表')), '直接打字 + 回车改名 → 画布同步');
  ok((await page.$$eval('.card.sel', cs => cs.map(c => c.innerText))).some(t => t.includes('效用表')), '改名后仍选中它');
  // Insert = 新建子级（Tab 改给左栏开关了）
  await page.keyboard.press('Insert'); await sleep(400);
  ok((await selTxt()) === '新节点' && await inCard(), 'Insert 新建子级 → 父卡片展开的子级列表里就地改名 ' + await selTxt());
  await page.keyboard.press('Escape'); await sleep(200);
  ok(!(await page.$('.card input.rename')), 'Esc 取消改名');
  // F2 = 在卡片上改名；Delete 在改名框里只删字，不删节点
  // 效用表 仍是选中的（Insert 不改选中）
  await page.keyboard.press('F2'); await sleep(300);
  ok((await selTxt()) === '效用表' && await inCard(), 'F2 → 卡片上改名框');
  await page.keyboard.press('Delete'); await page.keyboard.type('效用表2'); await page.keyboard.press('Enter'); await sleep(400);
  ok((await cards()).some(t => t.includes('效用表2')), 'F2 改名 → 画布同步，Delete 没删节点');
  await page.keyboard.press('F2'); await sleep(300); await page.keyboard.type('效用表'); await page.keyboard.press('Enter'); await sleep(400);
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
  ok((await page.$eval('.side h3 input', e => e.value).catch(() => '')) === '短期记忆', '点大纲树 → 右侧显示它的内容');
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
  const ws = mkdtempSync(join(tmpdir(), 'syn-ui-')); noAi(ws);
  saveOutline(ws, SAMPLE);
  runBatch(ws, [['link', '游戏AI/行动/动作状态机', '游戏AI/感知/自身传感器', { label: '触发', kind: '离散' }]]);
  writeFileSync(join(ws, '__synapsis', '_配色.md'), '- 绿: 行动\n- 黄: 兜底\n'); // 工作区词表：兜底改黄、观测词没了
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
  const box = async label => { for (const l of await page.$$('.card .lab')) if ((await l.textContent()).includes(label)) return l.boundingBox(); }; // 点名字（卡片中间可能是 ▸N / ⊞ 按钮）
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
  // 颜色：自动配色不写文件；右键点色块才写 color:，「自动」删掉（👤 2026-10-08）
  const cc = label => page.$$eval('.card', (cs, l) => { const c = cs.find(x => x.querySelector('.title')?.textContent.includes(l)); return c && c.style.getPropertyValue('--c'); }, label);
  ok(!nodeFile('游戏AI/行动/_node.md').includes('color:') && await cc('行动') === PALETTE.绿, '自动配色（行动绿）不写进文件');
  ok(await cc('兜底') === PALETTE.黄, '工作区词表 _配色.md 生效（兜底 → 黄）');
  const dash = await page.$$eval('.react-flow__edge', es => Object.fromEntries(es.map(e => [e.dataset.id, e.querySelector('.react-flow__edge-path').style.strokeDasharray])));
  ok(dash['游戏AI/行动=>游戏AI/感知'] && !dash['游戏AI/决策=>游戏AI/行动'], 'kind 离散 的边 = 虚线，其余实线 ' + JSON.stringify(dash));
  await rclick('行动'); await page.click('.ctx .swatches button[title="粉"]'); await sleep(1500);
  ok(/^color: 粉$/m.test(nodeFile('游戏AI/行动/_node.md')) && await cc('行动') === PALETTE.粉, '右键点粉 → color: 粉 写进文件，卡片变粉');
  await rclick('行动'); await page.click('.ctx .swatches button.auto'); await sleep(1500);
  ok(!nodeFile('游戏AI/行动/_node.md').includes('color:') && await cc('行动') === PALETTE.绿, '右键「自动」→ 删掉 color:，回到绿');
  await rclick('行动'); await page.click('.ctx .mi:has-text("属性")'); await sleep(400);
  ok((await page.$eval('.side h3 input', e => e.value)) === '行动', '右键 属性 → 面板');
  // 属性面板：颜色色块 → color:；名字框改名（👤 2026-10-08）
  await page.click('.side .swatches button[title="青"]'); await sleep(1500);
  ok(/^color: 青$/m.test(nodeFile('游戏AI/行动/_node.md')) && await cc('行动') === PALETTE.青, '属性面板点色块 → color: 写进文件、卡片变色');
  await page.click('.side .swatches button.auto'); await sleep(1500);
  ok(!nodeFile('游戏AI/行动/_node.md').includes('color:'), '属性面板「自动」→ 删掉 color:');
  await page.fill('.side h3 input', '行动层'); await page.keyboard.press('Enter'); await sleep(1800);
  ok(existsSync(join(ws, '__synapsis', '游戏AI', '行动层', '_node.md')) && (await page.$eval('.side h3 input', e => e.value)) === '行动层', '属性面板名字框改名 → 文件夹跟着改，面板还停在它上面');
  await page.fill('.side h3 input', '行动'); await page.keyboard.press('Enter'); await sleep(1800);
  ok(existsSync(join(ws, '__synapsis', '游戏AI', '行动', '_node.md')), '改回原名');
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
  // 图片拖到空白处 → 散图（👤：不必变成节点），存进这一页的 _pics/，坐标在落点
  const nBefore = (await page.$$('.card')).length;
  await page.evaluate(png => {
    const bin = atob(png.split(',')[1]), u8 = Uint8Array.from(bin, c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([u8], '参考图.png', { type: 'image/png' }));
    const c = document.querySelector('.canvas'), r = c.getBoundingClientRect();
    c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 40 }));
  }, PNG);
  await sleep(2500);
  ok((await page.$$('.card')).length === nBefore && (await page.$$('.loosepic img')).length === 1, '拖图到空白处 → 散图（不新建节点）');
  const looseDir = join(ws, '__synapsis', '游戏AI', '_pics');
  ok(existsSync(looseDir) && readdirSync(looseDir).length === 1, '散图存进 游戏AI/_pics/');
  const lay2 = JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'));
  ok(Object.keys(lay2).some(k => k.startsWith('@pic:游戏AI/_pics/')), '散图坐标写进 _layout.json（@pic:）');
  // 拖右下角调大小 → 宽度进 _layout.json；收起；Del 删 → 进 _过期的/
  await page.hover('.loosepic'); await sleep(200);
  const lg = await (await page.$('.loosepic .picgrip')).boundingBox();
  const lw0 = (await (await page.$('.loosepic')).boundingBox()).width;
  await page.mouse.move(lg.x + 5, lg.y + 5); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(lg.x + 5 + i * 15, lg.y + 5);
  await page.mouse.up(); await sleep(1000);
  ok((await (await page.$('.loosepic')).boundingBox()).width > lw0 + 40, '散图拖角变大');
  ok(Object.entries(JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'))).some(([k, v]) => k.startsWith('@pic:') && v.w > 0), '散图宽度写进 _layout.json');
  await page.click('button:has-text("收起图片")'); await sleep(400);
  ok((await page.$$('.loosepic.folded')).length === 1, '全局收起也收起散图');
  await page.click('button:has-text("显示图片")'); await sleep(400);
  const lb = await (await page.$('.loosepic')).boundingBox();
  await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2); await sleep(200);
  await page.keyboard.press('Delete'); await sleep(1500);
  ok((await page.$$('.loosepic')).length === 0 && readdirSync(looseDir).length === 0, '选中散图 Del → 删掉（文件进 _过期的/）');
  // 左右栏拖宽（👤 2026-10-08）
  const sideW = () => page.$eval('aside.side', a => a.offsetWidth);
  const sw0 = await sideW(), rz = await (await page.$('.resizer.right')).boundingBox();
  await page.mouse.move(rz.x + 3, rz.y + 300); await page.mouse.down(); await page.mouse.move(rz.x - 117, rz.y + 300, { steps: 6 }); await page.mouse.up(); await sleep(900);
  ok(Math.abs(await sideW() - sw0 - 120) < 4, "拖右栏边 → 右栏变宽 " + sw0 + ' → ' + await sideW());
  ok(JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8')).panelW?.right === sw0 + 120, '栏宽记进 view.json');
  const olw0 = await page.$eval('aside.outline', a => a.offsetWidth), lz = await (await page.$('.resizer.left')).boundingBox();
  await page.mouse.move(lz.x + 3, lz.y + 300); await page.mouse.down(); await page.mouse.move(lz.x + 63, lz.y + 300, { steps: 6 }); await page.mouse.up(); await sleep(300);
  ok(Math.abs(await page.$eval('aside.outline', a => a.offsetWidth) - olw0 - 60) < 4, '拖左栏边 → 左栏变宽');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 空间节点：投影、换基、拖动改坐标、卡片小横条、边上的热力图 ——
{
  console.log('== 空间');
  const ws = mkdtempSync(join(tmpdir(), 'syn-space-ui-')); noAi(ws);
  saveOutline(ws, '情绪空间 -> 行为空间\n  兴奋\n  激动\n  谨慎\n  愤怒\n  备注\n行为空间');
  runBatch(ws, [
    ['set', '情绪空间', 'axes=愉悦, 唤醒, 支配', '映射→行为空间=0.2 0.5 0.8; 0 1 -0.3'],
    ['set', '情绪空间/兴奋', 'vec=0.6, 0.9, 0.4'], ['set', '情绪空间/激动', 'vec=0.1, 0.95, 0.2'],
    ['set', '情绪空间/谨慎', 'vec=-0.2, 0.15, -0.4'], ['set', '情绪空间/愤怒', 'vec=-0.8, 0.9, 0.8', 'evidence=估计'],
    ['set', '行为空间', 'axes=攻击性, 移动速度'],
  ]);
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`);
  await sleep(1800);
  const card = async label => { for (const c of await page.$$('.card')) { const t = await c.$eval('.title', e => e.textContent).catch(() => ''); if (t.includes(label)) return c; } };
  const mid = b => [b.x + b.width / 2, b.y + b.height / 2];
  ok(await page.$$eval('.matchip tr', rs => rs.length) === 3 && await page.$$eval('.matchip td[title]', ts => ts.length) === 6, '空间→空间的边画成 2×3 热力图');
  ok((await (await card('情绪空间')).$eval('.axchips', e => e.textContent)).includes('愉悦 · 唤醒 · 支配'), '空间节点卡片列出轴');
  // 没高亮的边也有颜色（出发节点的颜色），越长越淡越灰（👤 2026-10-08）
  const edgeSt = () => page.$eval('.react-flow__edge-path', p => ({ stroke: p.style.stroke, op: +p.style.opacity }));
  const sat = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b); };
  const e0 = await edgeSt();
  ok(e0.stroke.startsWith('rgb(') && sat(e0.stroke) > 100 && e0.op > 0.3, '未高亮的边 = 出发节点的颜色，不是灰 ' + JSON.stringify(e0));
  const zoom = await page.$eval('.react-flow__viewport', v => new DOMMatrix(getComputedStyle(v).transform).a);
  const [bx, by] = mid(await (await card('行为空间')).boundingBox());
  await page.mouse.move(bx, by); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(bx + 1500 * zoom * i / 10, by + 300 * zoom * i / 10);
  await page.mouse.up(); await sleep(600);
  const e1 = await edgeSt();
  ok(e1.op < e0.op * 0.7, '把节点拖远 → 连线变淡 ' + e0.op.toFixed(2) + ' → ' + e1.op.toFixed(2));
  if (SHOTS) await page.screenshot({ path: SHOTS + '/space_drag.png' });
  ok(sat(e1.stroke) < sat(e0.stroke) * 0.6, '拖远后颜色也变灰（饱和度降低） ' + e0.stroke + ' → ' + e1.stroke);
  await page.click('.react-flow__controls-fitview'); await sleep(600); // 拖到边上会自动平移，先看全
  await page.mouse.dblclick(...mid(await (await card('情绪空间')).boundingBox())); await sleep(1000);
  ok(!!(await page.$('.planebar')) && (await page.$eval('.planebar', e => e.innerText)).includes('夹角 90°'), '钻进空间 → 投影工具条，轴夹角 90°');
  // 坐标核对：卡片中心相对坐标轴原点 / 单位长度 = (愉悦, 唤醒)
  const ax = await (await page.$('svg.axes')).boundingBox(), o = mid(ax), unit = ax.width / 2.5;
  const coord = async label => { const [x, y] = mid(await (await card(label)).boundingBox()); return [(x - o[0]) / unit, (o[1] - y) / unit]; };
  let c = await coord('兴奋');
  ok(Math.abs(c[0] - 0.6) < 0.03 && Math.abs(c[1] - 0.9) < 0.03, '兴奋落在 (0.6, 0.9) ' + c.map(x => x.toFixed(2)));
  ok(await (await card('兴奋')).$$eval('.vecbars .vb', v => v.length) === 3, '成员卡片有 3 条小横条');
  ok((await (await card('愤怒')).$eval('.ev', e => e.textContent)) === '估计', '证据标签显示在卡片上');
  const sels = await page.$$('.planebar select');
  await sels[0].selectOption('情绪空间/兴奋'); await sels[1].selectOption('情绪空间/激动'); await sleep(500);
  ok(/夹角 (\d+)°/.test(await page.$eval('.planebar', e => e.innerText)) && !!(await page.$('.planebar .warn')), '换成两个情绪词当基 → 夹角不是 90°，标黄');
  await sels[0].selectOption('#0'); await sels[1].selectOption('#1'); await sleep(500);
  // 拖动 谨慎 往右 0.5 个单位 → vec 第 1 维变、第 3 维不动；坐标不写进 _layout.json
  const [x0, y0] = mid(await (await card('谨慎')).boundingBox());
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + unit * 0.5 * i / 10, y0);
  await page.mouse.up(); await sleep(1500);
  const md = readFileSync(join(ws, '__synapsis', '情绪空间', '谨慎.md'), 'utf8');
  const v = (md.match(/vec: (.*)/) || [])[1]?.split(',').map(Number) || [];
  ok(Math.abs(v[0] - 0.3) < 0.08 && Math.abs(v[1] - 0.15) < 0.05 && v[2] === -0.4, '拖动改写 vec（只动投影的两维） ' + v);
  ok(!Object.keys(JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'))).includes('情绪空间/谨慎'), '空间成员的位置不写进 _layout.json');
  c = await coord('谨慎');
  ok(Math.abs(c[0] - v[0]) < 0.03, '松手后卡片停在新坐标 ' + c.map(x => x.toFixed(2)) + ' vec ' + v);
  await sleep(800);
  // 属性面板直接加坐标：选中没坐标的「备注」→「加坐标」按钮 → 改值回车 → 写进 md，出现在散点图里
  await page.mouse.click(...mid(await (await card('备注')).boundingBox())); await sleep(400);
  await page.click('.metahints button:has-text("加坐标")');
  await page.fill('.meta .addrow td:nth-child(2) input', '0.5, -0.5, 0'); await page.keyboard.press('Enter'); await sleep(1200);
  ok(/vec: 0\.5, -0\.5, 0/.test(readFileSync(join(ws, '__synapsis', '情绪空间', '备注.md'), 'utf8')), '属性面板「加坐标」写进 md');
  c = await coord('备注');
  ok(Math.abs(c[0] - 0.5) < 0.05 && Math.abs(c[1] + 0.5) < 0.05, '加了坐标立刻出现在散点图上 ' + c.map(x => x.toFixed(2)));
  const vin = await page.$('.meta.edit tr:has(input.mk[value="vec"]) td:nth-child(2) input');
  await vin.fill('0.5, -0.5, 0.9'); await page.keyboard.press('Enter'); await sleep(1000);
  ok(/vec: 0\.5, -0\.5, 0\.9/.test(readFileSync(join(ws, '__synapsis', '情绪空间', '备注.md'), 'utf8')), '属性值原地改，回车保存');
  const view = JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8'));
  ok(view.spaceAxes?.['情绪空间']?.join() === '#0,#1', '投影方向记进 view.json');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 撤销重做、框选缩放排列、项目文档骨架（👤 2026-10-08）——
{
  console.log('== 撤销 / 框选 / 项目文档');
  const ws = mkdtempSync(join(tmpdir(), 'syn-undo-ui-')); noAi(ws);
  saveOutline(ws, '甲 -> 乙\n乙\n丙\n丁');
  writeFileSync(join(ws, '__synapsis', '甲.md'), readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8') + '\n甲的正文，人写的。\n');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 }, 乙: { x: 400, y: 0 }, 丙: { x: 800, y: 0 }, 丁: { x: 400, y: 300 } }));
  writeFileSync(join(ws, '_DevProgress.md'), '旧英文名的进度');
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`);
  await sleep(1800);
  const card = async label => { for (const c of await page.$$('.card')) { const t = await c.$eval('.title', e => e.textContent).catch(() => ''); if (t.includes(label)) return c; } };
  const mid = b => [b.x + b.width / 2, b.y + b.height / 2];
  const save = () => page.$eval('.save', e => e.innerText);
  // 删除 → Ctrl+Z → 文件从 _过期的/ 搬回来，正文还在，边也在
  await page.mouse.click(...mid(await (await card('甲')).boundingBox())); await sleep(200);
  await page.keyboard.press('Delete'); await sleep(1600);
  ok(!existsSync(join(ws, '__synapsis', '甲.md')), '删除：甲.md 进了 _过期的/');
  await page.mouse.click(700, 700); await page.keyboard.press('Control+z'); await sleep(1800);
  const ja = existsSync(join(ws, '__synapsis', '甲.md')) ? readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8') : '';
  ok(ja.includes('甲的正文') && ja.includes('乙'), 'Ctrl+Z 撤销删除：正文和边都回来了 ' + await save());
  await page.keyboard.press('Control+Shift+z'); await sleep(1600);
  ok(!existsSync(join(ws, '__synapsis', '甲.md')), 'Ctrl+Shift+Z 重做删除');
  await page.keyboard.press('Control+z'); await sleep(1800);
  ok(readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8').includes('甲的正文'), '再撤销一次：又搬回来了（重做时记下了新的 _过期的/ 路径）');
  // 删除后页面刷新了（开发服务重启 / Ctrl+R）→ Ctrl+Z 仍能撤回（👤 2026-10-08 删了咕噜人，刷新后撤不回）
  await page.mouse.click(...mid(await (await card('丙')).boundingBox())); await sleep(200);
  await page.keyboard.press('Delete'); await sleep(1600);
  await page.reload(); await sleep(1800);
  await page.mouse.click(700, 700); await page.keyboard.press('Control+z'); await sleep(1800);
  ok(existsSync(join(ws, '__synapsis', '丙.md')) && !!(await card('丙')), '删除 → 刷新页面 → Ctrl+Z 仍能撤回 ' + await save());
  // 弃用 ❌：右键 → 文件 status: dropped，卡片灰 + 删除线，连着它的线变灰变淡；「—」清除；删除项带 🗑️
  await page.mouse.click(...mid(await (await card('乙')).boundingBox()), { button: 'right' }); await sleep(300);
  ok((await page.$eval('.ctx .mi.danger', e => e.innerText)).includes('🗑️'), '右键删除项是 🗑️');
  await page.click('.ctx .mi.row button:has-text("❌")'); await sleep(1500);
  ok(/^status: dropped$/m.test(readFileSync(join(ws, '__synapsis', '乙.md'), 'utf8')), '右键 ❌ → 文件 status: dropped');
  const yi = await card('乙');
  ok((await yi.getAttribute('class')).includes('dropped') && (await yi.$eval('.lab', e => getComputedStyle(e).textDecorationLine)) === 'line-through', '弃用卡片：.dropped + 删除线');
  await page.mouse.click(700, 760); await sleep(400); // 取消选中（选中时相连的线本来就变实）
  const eStyle = await page.$eval('.react-flow__edge[data-id="甲=>乙"] .react-flow__edge-path', p => ({ op: +p.style.opacity, stroke: p.style.stroke }));
  ok(eStyle.op <= 0.2 && eStyle.stroke === 'rgb(138, 138, 138)', '连着弃用节点的线：灰、更淡 ' + JSON.stringify(eStyle));
  await page.mouse.click(...mid(await (await card('乙')).boundingBox()), { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi.row button:has-text("—")'); await sleep(1500);
  ok(!/status:/.test(readFileSync(join(ws, '__synapsis', '乙.md'), 'utf8')) && !(await (await card('乙')).getAttribute('class')).includes('dropped'), '「—」清除状态');
  // 复制粘贴节点（👤 2026-10-08：Ctrl+C 没反应）：选 甲 + Ctrl 选 乙 → Ctrl+C → 鼠标处 Ctrl+V → 甲 2、乙 2（正文、内部边都在）→ Ctrl+Z 撤掉
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.keyboard.press('Escape');
  await page.mouse.click(...mid(await (await card('甲')).boundingBox())); await sleep(200);
  await page.keyboard.down('Control'); await page.mouse.click(...mid(await (await card('乙')).boundingBox())); await page.keyboard.up('Control'); await sleep(300);
  await page.keyboard.press('Control+c'); await sleep(300);
  ok((await save()).includes('已复制 2 个节点'), 'Ctrl+C 复制多选 ' + await save());
  await page.mouse.move(700, 650); await page.keyboard.press('Control+v'); await sleep(2000);
  const j2 = join(ws, '__synapsis', '甲 2.md');
  ok(existsSync(j2) && readFileSync(j2, 'utf8').includes('甲的正文') && /- 乙 2/.test(readFileSync(j2, 'utf8')) && existsSync(join(ws, '__synapsis', '乙 2.md')), 'Ctrl+V → 甲 2 / 乙 2，正文和内部边都跟着 ' + await save());
  ok(!!(await card('甲 2')) && !!(await card('乙 2')), '画布上出现两张新卡');
  await page.mouse.click(700, 760); await page.keyboard.press('Control+z'); await sleep(1800);
  ok(!existsSync(j2) && !existsSync(join(ws, '__synapsis', '乙 2.md')) && existsSync(join(ws, '__synapsis', '甲.md')), 'Ctrl+Z 撤销粘贴（新卡进 _过期的/，原件在）');
  // 拖动 → 撤销 → 坐标回去
  const lay = () => JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'));
  const x丁 = lay()['丁'].x;
  let [bx, by] = mid(await (await card('丁')).boundingBox());
  await page.mouse.move(bx, by); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(bx + i * 10, by + i * 5);
  await page.mouse.up(); await sleep(800);
  ok(lay()['丁'].x !== x丁, '拖动写进 _layout.json');
  await page.mouse.click(700, 760); await page.keyboard.press('Control+z'); await sleep(1000);
  ok(lay()['丁'].x === x丁, 'Ctrl+Z 撤销拖动');
  // Shift 框选 甲乙丙（同一行）→ 出现缩放框 → 拖右边往左到底 → 左对齐、往下排开、不重叠
  const boxes = await Promise.all(['甲', '乙', '丙'].map(async l => (await card(l)).boundingBox()));
  const top = Math.min(...boxes.map(b => b.y)) - 20, left = Math.min(...boxes.map(b => b.x)) - 20;
  const right = Math.max(...boxes.map(b => b.x + b.width)) + 20, bottom = Math.max(...boxes.map(b => b.y + b.height)) + 20;
  await page.keyboard.down('Shift'); await page.mouse.move(left, top); await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Shift'); await sleep(500);
  ok(!!(await page.$('.scaleframe')) && (await page.$$('.card.sel')).length === 3, 'Shift 框选 3 张 → 出现缩放框');
  const eh = await (await page.$('.scaleframe .sh-e')).boundingBox();
  await page.mouse.move(...mid(eh)); await page.mouse.down();
  // 拖过最左边再拖一段（挤到头之后继续收）→ 对齐成一列
  for (let i = 1; i <= 12; i++) await page.mouse.move(eh.x - (eh.x - left) * 2 * i / 12, eh.y);
  const modeTxt = await page.$eval('.scaleframe .shmode', e => e.innerText).catch(() => '');
  await page.mouse.up(); await page.evaluate(() => document.querySelector('.react-flow__pane').click()); await sleep(900); // 模拟浏览器在共同祖先上补的 click
  const L = lay(), xs = ['甲', '乙', '丙'].map(k => L[k].x), ys = ['甲', '乙', '丙'].map(k => L[k].y);
  ok(modeTxt === '对齐' && xs.every(x => x === xs[0]), '拖到底 → 左对齐 ' + modeTxt + ' ' + xs);
  ok(ys[0] < ys[1] && ys[1] < ys[2], '会重叠的往下依次排开（保持左右顺序） ' + ys);
  const cb = await Promise.all(['甲', '乙', '丙'].map(async l => (await card(l)).boundingBox()));
  ok(cb.every((b, i) => cb.slice(i + 1).every(q => b.y + b.height <= q.y || q.y + q.height <= b.y)), '排开后卡片互不重叠');
  ok((await page.$$('.card.sel')).length === 3 && !!(await page.$('.scaleframe')), '缩放完还保持选中（👤：点空白才退出） ' + (await page.$$('.card.sel')).length);
  await page.keyboard.press('Control+z'); await sleep(1000);
  ok(lay()['乙'].x === 400 && lay()['乙'].y === 0, '框选缩放也能 Ctrl+Z');
  // 项目文档：先检测；同名中文的默认不勾；只建勾上的
  await page.click('button:has-text("项目文档")'); await sleep(600);
  ok((await page.$eval('.scaffold', e => e.innerText)).includes('已有同类：_DevProgress.md'), '项目文档：检测到同类旧英文名');
  ok(!(await page.$eval('.scaflist li:has-text("_开发进度.md") input', e => e.checked)), '有同类的默认不勾');
  for (const li of await page.$$('.scaflist li')) { const t = await li.innerText(); const cbx = await li.$('input'); if (!t.includes('_TODO.md') && await cbx.isChecked() && !(await cbx.isDisabled())) await cbx.uncheck(); }
  await page.click('.scaffold button:has-text("创建勾选的")'); await sleep(800);
  ok(existsSync(join(ws, '_TODO.md')) && !existsSync(join(ws, '_开发进度.md')) && existsSync(join(ws, '_DevProgress.md')) && !existsSync(join(ws, 'AGENTS.md')), '只创建勾上的（_TODO.md）');
  ok(readFileSync(join(ws, '_DevProgress.md'), 'utf8') === '旧英文名的进度', '已有文件不动');
  // 传送门（↗ 别处的节点）也能框选排列（👤 2026-10-08 截图：一列 ↗ 框选后没反应）
  await page.keyboard.press('Escape');
  saveOutline(ws, '组\n  里面 -> 外一, 外二\n外一\n外二');
  await page.reload(); await sleep(1800);
  await page.mouse.dblclick(...mid(await (await card('组')).boundingBox())); await sleep(1000);
  const pb = await Promise.all((await page.$$('.card.portal')).map(c => c.boundingBox()));
  ok(pb.length === 2, '组里有 2 个传送门');
  const pl = Math.min(...pb.map(b => b.x)) - 15, pt = Math.min(...pb.map(b => b.y)) - 15;
  const pr = Math.max(...pb.map(b => b.x + b.width)) + 15, pbm = Math.max(...pb.map(b => b.y + b.height)) + 15;
  await page.keyboard.down('Shift'); await page.mouse.move(pl, pt); await page.mouse.down();
  await page.mouse.move(pr, pbm, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Shift'); await sleep(500);
  ok(!!(await page.$('.scaleframe')), '框选传送门 → 出现缩放框');
  const before = JSON.stringify(Object.entries(lay()).filter(([k]) => k.startsWith('@portal:')));
  const sh = await (await page.$('.scaleframe .sh-s')).boundingBox();
  await page.mouse.move(...mid(sh)); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(sh.x + 5, sh.y + 5 + i * 25);
  await page.mouse.up(); await sleep(900);
  ok(JSON.stringify(Object.entries(lay()).filter(([k]) => k.startsWith('@portal:'))) !== before, '拖缩放框 → 传送门坐标写进 _layout.json');
  // 传送门三档：只显示名字（悬停看路径）；显示 → 淡化 → 隐藏（隐藏时和选中节点相连的仍显示）
  const ptxt = await page.$$eval('.card.portal', cs => cs.map(c => c.textContent + '|' + c.title));
  ok(ptxt.some(t => t.startsWith('↗ 外一|') && t.includes('外一')), '传送门只显示名字，悬停（title）看路径 ' + ptxt);
  await page.mouse.click(700, 760); await sleep(200);
  await page.click('button.portalbtn'); await sleep(500);
  ok((await page.$$('.card.portal.faded')).length === 2 && (await page.$eval('button.portalbtn', e => e.textContent)).includes('淡化'), '点一下 → 淡化');
  await page.click('button.portalbtn'); await sleep(500);
  ok((await page.$$('.card.portal')).length === 0, '再点 → 隐藏');
  await page.mouse.click(...mid(await (await card('里面')).boundingBox())); await sleep(500);
  ok((await page.$$('.card.portal')).length === 2, '隐藏时选中「里面」→ 和它相连的传送门照样显示');
  await sleep(900);
  ok(JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8')).portalModes?.['组'] === 'hide', '每页的档位记进 view.json');
  await page.click('button.portalbtn'); await sleep(300);
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 调节连线（👤 2026-10-08：观察属性不是流进观察空间的数据）——
{
  console.log('== 调节线');
  const ws = mkdtempSync(join(tmpdir(), 'syn-mod-ui-')); noAi(ws);
  saveOutline(ws, '敌方 -> 观察空间\n观察空间\n观察属性');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 敌方: { x: 0, y: 200 }, 观察空间: { x: 300, y: 200 }, 观察属性: { x: 300, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`);
  await sleep(1800);
  const md = f => readFileSync(join(ws, '__synapsis', f), 'utf8');
  const hs = await (await page.$('.react-flow__node[data-id="观察属性"] .react-flow__handle.modh.source')).boundingBox();
  const ht = await (await page.$('.react-flow__node[data-id="观察空间"] .react-flow__handle.modh.target')).boundingBox();
  const c = b => [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(...c(hs)); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(c(hs)[0] + (c(ht)[0] - c(hs)[0]) * i / 10, c(hs)[1] + (c(ht)[1] - c(hs)[1]) * i / 10);
  await page.mouse.up(); await sleep(1800);
  ok(/观察空间\s*\|\s*\|\s*调节/.test(md('观察属性.md')), '从底下 ◆ 拖到顶上 ◆ → 边写成 kind 调节 ' + md('观察属性.md'));
  const ed = await page.$eval('.react-flow__edge[data-id="观察属性=>观察空间"] .react-flow__edge-path', p => p.style.strokeDasharray).catch(() => null);
  ok(/^2(px)?,? 4(px)?$/.test(ed || ''), '调节线 = 点线 ' + ed);
  ok((await page.$$eval('.react-flow__edges marker path', ps => ps.map(p => p.getAttribute('d')))).includes('M0,5 L5,0 L10,5 L5,10 z'), '调节线终点画 ◆');
  // 属性面板里点边的类型：调节 → 离散 → 普通
  await page.click('.react-flow__node[data-id="观察空间"] .lab'); await sleep(500);
  const kb = async () => page.$eval('.side .edges li:has-text("观察属性") button.ek', b => b.textContent);
  ok(await kb() === '调节', '属性面板显示边的类型');
  await page.click('.side .edges li:has-text("观察属性") button.ek'); await sleep(1500);
  ok(/观察空间\s*\|\s*\|\s*离散/.test(md('观察属性.md')) && await kb() === '离散', '点一下 → 离散');
  // Ctrl+F 搜索 → 跳过去选中（👤 2026-10-08）
  await page.mouse.click(700, 760); await page.keyboard.press('Control+f'); await sleep(300);
  ok(!!(await page.$('.finder input')), 'Ctrl+F 打开搜索框');
  await page.keyboard.type('观察属'); await sleep(200);
  ok((await page.$$eval('.finder li', ls => ls.map(l => l.innerText.split('\n')[0])))[0] === '观察属性', '搜索结果第一个 = 观察属性');
  await page.keyboard.press('Enter'); await sleep(800);
  ok(!(await page.$('.finder')) && (await page.$eval('.side h3 input', e => e.value)) === '观察属性', 'Enter → 关掉搜索框，选中它');
  // L = 连线到…：从 敌方 连到 观察属性
  await page.click('.react-flow__controls-fitview'); await sleep(500); // 跳过去会居中放大，先看全
  await page.click('.react-flow__node[data-id="敌方"] .lab'); await sleep(300);
  await page.keyboard.press('l'); await sleep(300);
  ok((await page.$eval('.finder .bar b', e => e.textContent)).includes('敌方'), 'L → 「连线到…」框');
  await page.keyboard.type('观察属性'); await page.keyboard.press('Enter'); await sleep(1800);
  ok(/观察属性/.test(md('敌方.md')), '选目标 → 连上（写进 敌方.md） ' + md('敌方.md'));
  // 删连线：属性面板 ✕；右键连线 → 删除
  await page.click('.side .edges li:has-text("观察属性") button.ex'); await sleep(1800);
  ok(!/观察属性/.test(md('敌方.md')), '属性面板 ✕ → 删掉连线');
  // 曲线中点（包围盒中心不一定在线上）
  const ept = await page.$eval('.react-flow__edge[data-id="敌方=>观察空间"] .react-flow__edge-path', p => { const q = p.getPointAtLength(p.getTotalLength() / 2), m = p.getScreenCTM(); return [q.x * m.a + q.y * m.c + m.e, q.x * m.b + q.y * m.d + m.f]; });
  await page.mouse.click(ept[0], ept[1], { button: 'right' }); await sleep(300);
  ok(!!(await page.$('.ctx .mi.danger:has-text("删除这条连线")')), '右键连线 → 删除菜单');
  await page.click('.ctx .mi.danger'); await sleep(1800);
  ok(!/观察空间/.test(md('敌方.md')), '右键删除 → 连线没了');
  // Alt + 拖连线一端（👤 2026-10-08）：放到别的节点 = 改接（类型跟过去），拖着右键 = 取消，放到空白 = 删除
  await page.mouse.click(700, 760); await sleep(200);
  const altDrag = async (edgeId, end, to, opts = {}) => {
    await page.keyboard.down('Alt'); await sleep(150);
    // 在线身上（离要拿的那端 1/4 处）按下，不是端点
    const pt = await page.$eval(`.react-flow__edge[data-id="${edgeId}"] .react-flow__edge-path`, (p, end) => { const L = p.getTotalLength(), q = p.getPointAtLength(end === 'source' ? L * 0.25 : L * 0.75), s = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM()); return [s.x, s.y]; }, end);
    const s = pt;
    await page.mouse.move(...s); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(s[0] + (to[0] - s[0]) * i / 10, s[1] + (to[1] - s[1]) * i / 10); if (opts.cancelAt === i) { await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); } }
    await page.mouse.up(); await page.keyboard.up('Alt'); await sleep(1800);
  };
  const enemyIn = await (await page.$('.react-flow__node[data-id="敌方"] .react-flow__handle.target:not(.modh)')).boundingBox();
  await altDrag('观察属性=>观察空间', 'target', [enemyIn.x + enemyIn.width / 2, enemyIn.y + enemyIn.height / 2], { cancelAt: 6 });
  ok(/观察空间\s*\|\s*\|\s*离散/.test(md('观察属性.md')), '拖着按右键 = 取消（连线不变）');
  await altDrag('观察属性=>观察空间', 'target', [enemyIn.x + enemyIn.width / 2, enemyIn.y + enemyIn.height / 2]);
  ok(/敌方\s*\|\s*\|\s*离散/.test(md('观察属性.md')) && !/观察空间/.test(md('观察属性.md')), 'Alt 拖终点到 敌方 → 改接，类型（离散）跟过去 ' + md('观察属性.md'));
  await altDrag('观察属性=>敌方', 'target', [700, 700]);
  ok(!/敌方/.test(md('观察属性.md')), 'Alt 拖到空白 → 删除');
  // 大纲树过滤
  await page.fill('.ofilter', '观察'); await sleep(300);
  ok((await page.$$eval('.orow', rs => rs.map(r => r.innerText.trim()))).join() .includes('观察属性') && (await page.$$('.orow')).length === 2 && (await page.$$('.orow.hit')).length === 2, '大纲过滤：只剩名字含「观察」的');
  await page.fill('.ofilter', ''); await sleep(200);
  ok((await page.$$('.orow')).length === 3, '清空过滤 → 全回来');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 分组原地展开成框（👤 2026-10-08）——
{
  console.log('== 展开成框');
  const ws = mkdtempSync(join(tmpdir(), 'syn-frame-ui-')); noAi(ws);
  saveOutline(ws, '组 -> 外\n  甲 -> 乙\n  乙\n外');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 组: { x: 0, y: 0 }, 外: { x: 220, y: 0 }, '组/甲': { x: 0, y: 0 }, '组/乙': { x: 300, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`);
  await sleep(1800);
  const lab = async l => { for (const t of await page.$$('.card .lab, .frame .fhead .lab')) if ((await t.textContent()) === l) return t; };
  const mid = b => [b.x + b.width / 2, b.y + b.height / 2];
  const lay = () => JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'));
  await page.mouse.click(...mid(await (await lab('组')).boundingBox())); await sleep(300);
  await page.mouse.click(...mid(await (await lab('组')).boundingBox()), { button: 'right' }); await sleep(300);
  ok(!!(await page.$('.ctx .mi:has-text("原地展开成框")')), '右键菜单有「原地展开成框」');
  await page.keyboard.press('Escape'); await page.mouse.click(...mid(await (await lab('组')).boundingBox())); await sleep(300);
  if (!(await page.$('.card.sel'))) await page.mouse.click(...mid(await (await lab('组')).boundingBox()));
  await page.keyboard.press('f'); await sleep(1500);
  const fr = await page.$('.react-flow__node-frame');
  ok(!!fr, 'F → 分组变成框');
  const fb = await fr.boundingBox();
  const inF = async l => { const b = await (await lab(l)).boundingBox(); return b.x >= fb.x && b.x + b.width <= fb.x + fb.width && b.y >= fb.y && b.y + b.height <= fb.y + fb.height; };
  ok(await inF('甲') && await inF('乙'), '子节点画在框里');
  ok((await page.$$eval('.react-flow__edge', es => es.map(e => e.dataset.id))).includes('组/甲=>组/乙'), '框里的线直接连（不再是传送门）');
  ok(lay()['外'].x > 220, '框压住的「外」被挪到右边 ' + JSON.stringify(lay()['外']));
  const zoom = await page.$eval('.react-flow__viewport', v => new DOMMatrix(getComputedStyle(v).transform).a);
  const [ax] = mid(await (await lab('甲')).boundingBox()), [bx0, by0] = mid(await (await lab('乙')).boundingBox());
  const card乙 = await (await lab('乙')).evaluateHandle(e => e.closest('.card'));
  const w甲 = await (await (await lab('甲')).evaluateHandle(e => e.closest('.card'))).evaluate(e => e.offsetWidth), w乙 = await card乙.evaluate(e => e.offsetWidth);
  ok(Math.abs((bx0 - w乙 * zoom / 2) - (ax - w甲 * zoom / 2) - 300 * zoom) < 4, '框里的相对位置 = 钻进分组那页的坐标（甲 0、乙 300）');
  const vb = await (await lab('乙')).boundingBox();
  await page.mouse.move(...mid(vb)); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(mid(vb)[0] - i * 10, mid(vb)[1] + i * 5); // 往左拖（往右会碰到画布边缘自动平移）
  await page.mouse.up(); await sleep(900);
  ok(Math.abs(lay()['组/乙'].x - (300 - 80 / zoom)) < 8, '在框里拖 乙 → 存的是分组页坐标 ' + JSON.stringify(lay()['组/乙']) + ' zoom=' + zoom.toFixed(2));
  await sleep(800);
  ok(JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8')).framed?.['组'] === true, '展开状态记进 view.json');
  await page.keyboard.press('Escape'); await page.mouse.click(...mid(await (await lab('组')).boundingBox())); await sleep(300);
  await page.keyboard.press('f'); await sleep(800);
  ok(!(await page.$('.react-flow__node-frame')), '再按 F 收起框');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// >v<✅自检-AI辅助-假的 LM Studio（字符袋嵌入；归类：含「惊慌」→ 第 2 行；精排固定打分）：状态 / 语义配色 / 潜在关联 + 精排 / 连线 / 生成词表写入；右键「在这里新建」落在鼠标处
{
  console.log('== AI 辅助');
  const bag = t => { const v = new Array(97).fill(0); for (const ch of t) v[ch.codePointAt(0) % 97] += 1; return v; };
  let words = '- 紫: 惊慌, 恐惧\n- 蓝: 观测\n';
  const srv = createServer((req, res) => {
    let s = ''; req.on('data', c => s += c); req.on('end', () => {
      const j = s ? JSON.parse(s) : {}, send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url === '/api/v0/models') return send({ data: [{ id: 'emb-x', type: 'embeddings' }, { id: 'chat-x', type: 'llm' }] });
      if (req.url === '/v1/embeddings') return send({ data: j.input.map((t, index) => ({ index, embedding: bag(t) })) });
      const sys = j.messages?.[0]?.content || '', user = j.messages?.at(-1)?.content || ''; // 最后一条 = 这次的话（前面可能是短记忆）
      const lines = user.split(/\r?\n/).map(l => l.match(/^(\d+)\. (.*)$/)).filter(Boolean);
      let out = '';
      const ref = name => (user.match(new RegExp('(n\\d+) ' + name)) || [])[1];
      if (/思维导图 \/ 节点图工具/.test(sys)) out = /对齐/.test(user) ? JSON.stringify({ say: '将左对齐', actions: [{ do: 'align', ids: [ref('惊慌失措'), ref('传感器')], edge: 'left' }, { do: 'delete', ids: ['n1'] }] })
        : /完成/.test(user) ? JSON.stringify({ say: '将标记完成', actions: [{ do: 'status', ids: [ref('咕噜人')], status: 'done' }] }) : '{"say":"删除请你自己来","actions":[]}';
      else if (/归类配色/.test(sys)) out = lines.map(m => `${m[1]}: ${/吓/.test(m[2]) ? 1 : 0}`).join('\n');
      else if (/值得连起来的关系/.test(sys)) out = lines.map(m => `${m[1]}. x | ${/情绪/.test(m[2]) ? 3 : 0} | ${/情绪/.test(m[2]) ? '都讲情绪' : '无关'}`).join('\n');
      else if (/配色/.test(sys)) out = words;
      else out = '它们都和情绪有关。';
      send({ choices: [{ message: { content: out } }] });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ws = mkdtempSync(join(tmpdir(), 'syn-ai-ui-')); noAi(ws, `http://127.0.0.1:${srv.address().port}/v1`);
  saveOutline(ws, '惊慌失措\n情绪恐惧\n情绪反应\n传感器\n咕噜人\n吓坏了');
  writeFileSync(join(ws, '__synapsis', '_配色.md'), words);
  setNodeBody(ws, '传感器', '# 读数\n\n| 名 | 值 |\n|---|---|\n| 视野 | **90** |\n\n- 第一条\n- 第二条');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 惊慌失措: { x: 0, y: 0 }, 情绪恐惧: { x: 260, y: 0 }, 情绪反应: { x: 520, y: 0 }, 传感器: { x: 0, y: 160 }, 咕噜人: { x: 260, y: 160 }, 吓坏了: { x: 520, y: 160 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(3000);
  const lab = async l => { for (const t of await page.$$('.card .lab')) if ((await t.textContent()) === l) return t; };
  const mid = b => [b.x + b.width / 2, b.y + b.height / 2];
  const col = label => page.$$eval('.card', (cs, l) => { const c = cs.find(x => x.querySelector('.title')?.textContent.includes(l)); return c && c.style.getPropertyValue('--c'); }, label);
  ok(await page.$('button.aibtn.on'), '顶栏 🤖 AI 亮（连上了）');
  ok(await col('惊慌失措') === PALETTE.紫, '词表里有「惊慌」→ 紫（词表）');
  ok(await col('吓坏了') === PALETTE.紫 && await col('咕噜人') !== PALETTE.紫, '语义配色：吓坏了 词表没命中、模型归到紫那行 → 紫；咕噜人 归「无」→ 不是紫');
  // 潜在关联：选 情绪恐惧 → 右边小签 → 点开 → 精排后 情绪反应 第一（理由），咕噜人 变淡
  await page.mouse.click(...mid(await (await lab('情绪恐惧')).boundingBox())); await sleep(400);
  ok(!!(await page.$('.reldock.tab')), '选中节点 → 右边出现「🔗 潜在关联」小签');
  await page.click('.reldock.tab'); await sleep(2500);
  const rows = await page.$$eval('.reldock li', ls => ls.map(l => ({ t: l.querySelector('.relrow a').textContent, weak: l.classList.contains('weak'), why: l.querySelector('.why')?.textContent || '' })));
  ok(rows[0]?.t === '情绪反应' && rows[0].why === '都讲情绪' && rows.find(r => r.t === '咕噜人')?.weak, '点开 → 精排：情绪反应 第一带理由，咕噜人 变淡 ' + JSON.stringify(rows));
  await page.click('.reldock li:first-child button:has-text("?")'); await sleep(1200);
  ok((await page.$eval('.reldock li:first-child', l => l.textContent)).includes('它们都和情绪有关'), '「?」→ 一句话说明');
  await page.click('.reldock li:first-child button:has-text("连")'); await sleep(1800);
  ok(/情绪反应/.test(readFileSync(join(ws, '__synapsis', '情绪恐惧.md'), 'utf8')), '「连」→ 连上线（写进 情绪恐惧.md）');
  // 生成词表 → 写入（旧的备份进 _过期的）
  words = '- 粉: 情绪, 惊慌\n- 蓝: 传感\n';
  await page.click('button.aibtn'); await sleep(800);
  ok((await page.$eval('.aistat', e => e.textContent)).includes('已连上'), 'AI 面板：已连上');
  await page.click('.aipanel button:has-text("生成词表")'); await sleep(1500);
  ok((await page.$eval('.aipanel textarea', e => e.value)).includes('- 粉: 情绪, 惊慌'), '生成词表 → 草稿出现在文本框');
  await page.click('.aipanel button:has-text("写入")'); await sleep(1500);
  ok(readFileSync(join(ws, '__synapsis', '_配色.md'), 'utf8').includes('- 粉: 情绪, 惊慌') && readdirSync(join(ws, '__synapsis', '_过期的')).some(f => f.startsWith('_配色_')), '写入 _配色.md，旧的备份进 _过期的/');
  await page.click('.aipanel .bar button'); await sleep(1500);
  ok(await col('惊慌失措') === PALETTE.粉, '新词表生效：惊慌失措 → 粉');
  // AI 指令框（Ctrl+J）：说 → 预览（✓ 能做 / ✗ 不做）→ Enter 执行 → 坐标对齐、进撤销；日志页有记录
  await page.mouse.click(700, 760); await page.keyboard.press('Control+j'); await sleep(500);
  ok(!!(await page.$('.agentbox textarea.ask')), 'Ctrl+J → AI 指令框');
  await page.keyboard.type('把惊慌失措和传感器左对齐'); await page.keyboard.press('Enter'); await sleep(1500);
  const plan = await page.$$eval('.agentbox .plan li', ls => ls.map(l => l.className + ':' + l.textContent));
  ok(plan.length === 2 && /^ok:✓ 对齐（左边）/.test(plan[0]) && /^no:✗ delete/.test(plan[1]), '预览：对齐 ✓，delete ✗（不执行） ' + plan);
  await page.keyboard.press('Enter'); await sleep(2000);
  const L = JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'));
  ok(L['惊慌失措'].x === L['传感器'].x, 'Enter 执行 → 两张卡左边对齐 ' + JSON.stringify([L['惊慌失措'], L['传感器']]));
  ok((await page.$$eval('.agentbox .done li', ls => ls.map(l => l.textContent))).some(t => t.includes('对齐')), '对话里记下做了什么');
  await page.keyboard.type('咕噜人完成了'); await page.keyboard.press('Enter'); await sleep(1500);
  await page.click('.agentbox button.go'); await sleep(2000);
  ok(/status:\s*done/.test(readFileSync(join(ws, '__synapsis', '咕噜人.md'), 'utf8')), '点「执行」→ 咕噜人 ✅');
  await page.mouse.click(700, 760); await sleep(200); await page.keyboard.press('Control+z'); await sleep(1800);
  ok(!/status:\s*done/.test(readFileSync(join(ws, '__synapsis', '咕噜人.md'), 'utf8')), 'Ctrl+Z 撤销 AI 的改动');
  await page.click('.agentbox .bar a:has-text("日志")'); await sleep(800);
  ok((await page.$$('.agentbox .logrow')).length >= 2 && (await page.$eval('.agentbox .logrow b', e => e.textContent)).includes('AI 指令'), '日志页：每次调用都有记录');
  await page.click('.agentbox .logrow .head'); await sleep(300);
  ok((await page.$eval('.agentbox .logrow', e => e.textContent)).includes('原始回答'), '点开日志 → 发出的消息 + 原始回答');
  await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(300);
  ok(!(await page.$('.agentbox')), '关闭指令框');
  // 卡片上显示人加的属性
  await page.mouse.click(700, 760); await sleep(200); // AI 预览时已选中它，再点一下会取消
  await page.mouse.click(...mid(await (await lab('咕噜人')).boundingBox())); await sleep(300);
  if (!(await page.$('.addrow'))) { await page.keyboard.press('i'); await sleep(500); }
  const gmd = () => readFileSync(join(ws, '__synapsis', '咕噜人.md'), 'utf8');
  const cardP = () => page.$$eval('.card', cs => cs.find(c => c.querySelector('.lab')?.textContent === '咕噜人')?.querySelector('.props')?.textContent || '');
  // 属性表：失焦也能加（不用回车）、改名、清空值不删、✕ 删
  await page.fill('.addrow td:first-child input', '血量'); await page.fill('.addrow td:nth-child(2) input', '120');
  await page.click('.side h3'); await sleep(1500);
  ok(/血量: 120/.test(gmd()) && (await cardP()).includes('血量120'), '新属性失焦就加上，并显示在卡片上 ' + await cardP());
  const keyIn = await page.$('.meta.edit input.mk');
  await keyIn.fill('生命'); await page.click('.side h3'); await sleep(1500);
  ok(/生命: 120/.test(gmd()) && !/血量/.test(gmd()), '属性名可以改（血量 → 生命）');
  const valIn = await page.$('.meta.edit tr:first-child td:nth-child(2) input');
  await valIn.fill(''); await page.click('.side h3'); await sleep(1500);
  ok(/生命: ""/.test(gmd()) && (await page.$$('.meta.edit input.mk')).length === 1, '清空值 → 属性还在（值留空） ' + gmd());
  await page.click('.meta.edit td.mx button'); await sleep(1500);
  ok(!/生命/.test(gmd()) && !(await page.$('.meta.edit input.mk')), '✕ → 删掉属性');
  await page.fill('.addrow td:first-child input', '血量'); await page.fill('.addrow td:nth-child(2) input', '120'); await page.press('.addrow td:nth-child(2) input', 'Enter'); await sleep(1500);
  ok((await cardP()).includes('血量120'), '回车也能加');
  // 底纹图案：词表认（传感器 → 点阵、情绪… → 波纹）；右键 → 图案 → 网格 写进 pattern:
  const patOf = l => page.$$eval('.card', (cs, l) => [...(cs.find(c => c.querySelector('.lab')?.textContent === l)?.classList || [])].find(x => x.startsWith('pat-')) || '', l);
  ok(await patOf('传感器') === 'pat-dots' && await patOf('情绪恐惧') === 'pat-wave', '图案词表：传感器 = 点阵，情绪恐惧 = 波纹 ' + await patOf('传感器') + ' ' + await patOf('情绪恐惧'));
  ok(existsSync(join(ws, '__synapsis', '_图案.md')), '打开工作区就放出 _图案.md');
  await page.mouse.click(...mid(await (await lab('吓坏了')).boundingBox()), { button: 'right' }); await sleep(300);
  await page.click('.ctx .pats button.pat-grid'); await sleep(1500);
  ok(/pattern: 网格/.test(readFileSync(join(ws, '__synapsis', '吓坏了.md'), 'utf8')) && await patOf('吓坏了') === 'pat-grid', '右键 → 图案 → 网格：写进 pattern:，卡片带网格底纹');
  // 📄 卡片里展开正文（md：标题 / 表格 / 列表）
  await page.mouse.click(700, 760); await sleep(200);
  const tb = await page.$$eval('.card', cs => cs.filter(c => c.querySelector('.textbadge')).map(c => c.querySelector('.lab').textContent));
  ok(tb.join() === '传感器', '只有有正文的卡片才有 📄 ' + tb);
  await page.click('.card .textbadge'); await sleep(600);
  const ct = await page.$eval('.card .cardtext', e => ({ h: !!e.querySelector('h4'), td: [...e.querySelectorAll('td')].map(t => t.textContent).join(), b: !!e.querySelector('td b'), li: e.querySelectorAll('li').length }));
  ok(ct.h && ct.td === '视野,90' && ct.b && ct.li === 2, '点 📄 → 正文在卡片里渲染（标题 / 表格 / 粗体 / 列表） ' + JSON.stringify(ct));
  await sleep(1000);
  ok(JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8')).textOpen?.['传感器'] === true, '展开状态记进 view.json');
  await page.click('.card .textbadge'); await sleep(400);
  ok(!(await page.$('.card .cardtext')), '再点 → 收起');
  await page.click('button:has-text("展开正文")'); await sleep(400);
  ok((await page.$$('.card .cardtext')).length === 1 && !!(await page.$('button:has-text("收起正文")')), '顶栏「📄 展开正文」→ 本页带正文的全展开');
  await page.click('button:has-text("收起正文")'); await sleep(400);
  ok(!(await page.$('.card .cardtext')), '「📄 收起正文」→ 全收起');
  // Shift + 拖 = 锁轴（斜着拖只横移）
  const y0 = JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'))['吓坏了'].y;
  const hb = await (await lab('吓坏了')).boundingBox(), hs = mid(hb);
  await page.mouse.move(...hs); await page.mouse.down(); // 先拖起来再按 Shift（先按 Shift 再按下 = 框选）
  for (let i = 1; i <= 8; i++) { await page.mouse.move(hs[0] - i * 12, hs[1] + i * 4); if (i === 2) await page.keyboard.down('Shift'); }
  await page.mouse.up(); await page.keyboard.up('Shift'); await sleep(1200);
  const L2 = JSON.parse(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'))['吓坏了'];
  ok(L2.y === y0 && L2.x < 520 - 40, 'Shift + 斜着拖 → 只横移（y 不变） ' + JSON.stringify(L2) + ' y0=' + y0);
  // 拖卡片到另一张卡上 = 放进去（目标高亮）；Ctrl+X → 回到根 Ctrl+V = 剪出来
  await page.mouse.click(700, 760); await sleep(200);
  const gb = mid(await (await lab('咕噜人')).boundingBox()), tgt = mid(await (await lab('情绪反应')).boundingBox());
  await page.mouse.move(...gb); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(gb[0] + (tgt[0] - gb[0]) * i / 10, gb[1] + (tgt[1] - gb[1]) * i / 10);
  ok(await page.$eval('.react-flow__node[data-id="情绪反应"]', e => e.classList.contains('droptarget')), '拖到 情绪反应 上 → 它高亮（要放进去了）');
  await page.mouse.up(); await sleep(2000);
  const moved = existsSync(join(ws, '__synapsis', '情绪反应', '咕噜人.md')) ? readFileSync(join(ws, '__synapsis', '情绪反应', '咕噜人.md'), 'utf8') : '';
  ok(/血量: 120/.test(moved) && !existsSync(join(ws, '__synapsis', '咕噜人.md')), '松手 → 咕噜人 进了 情绪反应 里（属性跟着走）');
  ok(!(await lab('咕噜人')), '根页上不再有 咕噜人');
  const gIn = join(ws, '__synapsis', '情绪反应', '咕噜人.md'), gOut = join(ws, '__synapsis', '咕噜人.md');
  await page.mouse.click(700, 760); await sleep(200); await page.keyboard.press('Control+z'); await sleep(2000);
  ok(existsSync(gOut) && !existsSync(gIn) && /血量: 120/.test(readFileSync(gOut, 'utf8')), 'Ctrl+Z → 咕噜人 回到根（属性跟着回来）');
  await page.keyboard.press('Control+y'); await sleep(2000);
  ok(existsSync(gIn) && !existsSync(gOut) && /血量: 120/.test(readFileSync(gIn, 'utf8')), 'Ctrl+Y → 又放回 情绪反应 里');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.mouse.dblclick(...mid(await (await lab('情绪反应')).boundingBox())); await sleep(1200);
  await page.mouse.click(...mid(await (await lab('咕噜人')).boundingBox())); await sleep(300);
  await page.keyboard.press('Control+x'); await sleep(300);
  await page.keyboard.press('Alt+ArrowUp'); await sleep(1200);
  await page.mouse.move(700, 650); await page.keyboard.press('Control+v'); await sleep(2000);
  ok(existsSync(join(ws, '__synapsis', '咕噜人.md')) && /血量: 120/.test(readFileSync(join(ws, '__synapsis', '咕噜人.md'), 'utf8')) && !existsSync(join(ws, '__synapsis', '情绪反应', '咕噜人.md')), 'Ctrl+X → 回到根 Ctrl+V = 剪出来（属性还在）');
  // 右键空白「在这里新建」→ 新卡片在鼠标处
  await page.mouse.click(700, 600); await sleep(200);
  await page.mouse.click(700, 600, { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi:has-text("在这里新建")'); await sleep(600);
  await page.keyboard.type('鼠标这里'); await page.keyboard.press('Enter'); await sleep(1800);
  const nb = await (await lab('鼠标这里'))?.boundingBox();
  ok(nb && Math.abs(nb.x - 700) < 60 && Math.abs(nb.y - 600) < 40, '右键「在这里新建」→ 卡片落在鼠标位置 ' + JSON.stringify(nb));
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close(); srv.close();
  rmSync(ws, { recursive: true, force: true });
}
await browser.close();
console.log(`ui:${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
