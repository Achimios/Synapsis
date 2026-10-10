// >v<✅自检-界面-无头 Edge 跑两个画布同一套交互
// 界面验收（React Flow；tldraw 对比版已退役，见 _过期的/tldraw_spike）
// 两个画布原型的同一套交互验收（无头 Edge）。先 npm run dev，再 node test/ui.test.js [截图目录]
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, setNodeBody, setNodeMeta } from '../../core/workspace.js';
import { runBatch } from '../../core/cli.js';
import { SAMPLE } from '../src/sample.js';
import { PALETTE } from '../../core/colors.js';
const BASE = 'http://localhost:5410';
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const sleep = t => new Promise(r => setTimeout(r, t));
// 临时工作区不碰真的 LM Studio：工作区级 .synapsis/ai.json 指到一个没人听的端口（AI 那段自检另起假服务）
const noAi = (ws, url = 'http://127.0.0.1:9/v1', extra = {}) => { mkdirSync(join(ws, '.synapsis'), { recursive: true }); writeFileSync(join(ws, '.synapsis', 'ai.json'), JSON.stringify({ url, offline: true, ...extra })); };

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
  await page.keyboard.press('Alt+KeyW'); await sleep(800);
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
  await page.keyboard.press('Shift+KeyA'); await sleep(400);
  ok(await selLabs() === '兜底,决策,行动', 'Shift+A = 沿入线扩一层 ' + await selLabs());
  await page.keyboard.press('Alt+Shift+KeyA'); await sleep(400);
  ok((await page.$$('.card.sel')).length === 5, 'Alt+Shift+A = 一直扩到头 ' + await selLabs());
  await page.keyboard.press('Escape'); await sleep(200);
  await page.keyboard.press('Control+KeyA'); await sleep(300);
  ok((await page.$$('.card.sel')).length === (await page.$$('.react-flow__node.react-flow__node-card, .card')).length && (await page.$$('.card.sel')).length > 1, 'Ctrl+A = 全选本页的卡');
  ok(!(await page.evaluate(() => String(getSelection()).trim())), 'Ctrl+A 不再选中界面文字');
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
  ok(!!(await page.$('.card input')) && !(await cards()).some(t => t.includes('新节点')), '选中了按 Enter = 重命名（不新建）');
  await page.keyboard.press('Escape'); await sleep(200);
  await page.keyboard.press('Shift+Enter'); await sleep(400);
  ok((await cards()).some(t => t.includes('新节点')), 'Shift+Enter 新建同级节点');
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
  await page.keyboard.press('Alt+KeyA'); await sleep(600);
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
  await page.keyboard.press('Alt+KeyW'); await sleep(800);
  ok((await page.$eval('.crumbs a', e => e.innerText)) === '根' && /^根( › [^›]+)?$/.test((await page.$eval('.crumbs', e => e.innerText)).trim()), 'Alt+↑ 返回上一级（面包屑回到根；选中刚离开的节点 → 后面多接它一段）');
  await page.keyboard.press('Alt+KeyA'); await sleep(800);
  ok((await page.$eval('.crumbs', e => e.innerText)).includes('游戏AI'), 'Alt+← 后退回游戏AI');
  ok(await cam() === camIn, `返回再进来视图还原 ${camIn} vs ${await cam()}`);
  await page.keyboard.press('Alt+KeyD'); await sleep(600);
  ok((await page.$eval('.crumbs', e => e.innerText)) === '根', 'Alt+→ 前进');
  await page.keyboard.press('Alt+KeyA'); await sleep(600);

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
  await page.keyboard.press('Shift+Enter'); await sleep(1800);
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
  ok(!existsSync(join(ws, '__synapsis', '游戏AI', '新节点.md')) && readdirSync(join(ws, '__synapsis', '.junk')).some(n => n.includes('新节点')), '右键删除 → 移进 .junk/');
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
  // 文件页搜索：文件名过滤 / 勾「内容」搜正文
  await page.fill('.ftools .ofilter', 'readme'); await sleep(300);
  const fl = await page.$$eval('.fi', fs => fs.map(f => f.innerText.trim()));
  ok(fl.some(t => t.includes('README_测试.md')) && !fl.some(t => t.includes('__synapsis')), '文件页过滤：只剩文件名含 readme 的 ' + fl);
  await page.fill('.ftools .ofilter', '游戏AI'); await sleep(300);
  const fl2 = await page.$$eval('.fi', fs => fs.map(f => f.innerText.trim()));
  ok(fl2.some(t => t.includes('游戏AI')) && !fl2.some(t => t.includes('_node.md')), '文件名过滤只看自己的名字：目录名命中不会把下面所有文件都列出来 ' + fl2);
  await page.check('.ftools input[type=checkbox]'); await page.fill('.ftools .ofilter', '外部区的文件'); await sleep(1200);
  const gh = await page.$$eval('.grep .gh', hs => hs.map(h => h.innerText));
  ok(gh.some(t => t.includes('README_测试.md') && t.includes('外部区的文件')), '勾「内容」→ 搜到正文里的字，列 路径:行 + 片段 ' + gh);
  await page.click('.grep .gh:has-text("README_测试.md")'); await sleep(600);
  ok((await page.$eval('.side.wide pre.raw', p => p.innerText)).includes('外部区的文件'), '点搜索结果 → 右侧预览');
  await page.uncheck('.ftools input[type=checkbox]'); await page.fill('.ftools .ofilter', '');
  // 文本页查找：Enter 跳到命中处（文本框里选中那段）
  await page.click('.bar.tabs a:has-text("文本")'); await sleep(300);
  await page.fill('.textfind .ofilter', '决策');
  const before = await page.$eval('.outline textarea', t => t.value);
  for (let i = 0; i < 3; i++) { await page.press('.textfind .ofilter', 'Enter'); await sleep(150); }
  const st = await page.evaluate(() => { const t = document.querySelector('.outline textarea'); return [document.activeElement?.className, t.value]; });
  const cnt = await page.$eval('.textfind .tcount', e => e.textContent);
  ok(st[0].includes('ofilter') && st[1] === before && /^\d+ \/ \d+$/.test(cnt) && !cnt.startsWith('–'), '文本查找：连按 Enter 焦点留在查找框、文本一个字都不变（第一版会把词换成换行） ' + cnt);
  ok(!!(await page.$('.tamirror mark.cur')) && (await page.$$('.tamirror mark')).length === Number(cnt.split('/ ')[1]), '命中处在文本后面高亮，当前那个更亮');
  ok((await page.$$('.textfind .tl')).length >= 1, '下面列出命中的行');
  await page.press('.textfind .ofilter', 'Escape'); await sleep(100);
  const st2 = await page.evaluate(() => { const t = document.querySelector('.outline textarea'); return [document.activeElement === t, t.selectionStart === t.selectionEnd]; });
  ok(st2[0] && st2[1], 'Esc → 回到文本框，光标停在命中处、不选中（打字不会吞掉它）');
  // 文本框里 Ctrl+Z：交给应用撤销栈（还没存盘 → 退回上次存的文本）
  await page.keyboard.type('乱打'); await sleep(100);
  await page.keyboard.press('Control+z'); await sleep(200);
  ok(await page.$eval('.outline textarea', t => t.value) === before, '文本框里 Ctrl+Z → 撤掉刚打的字');
  await page.fill('.textfind .ofilter', '');
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
  // 双击图 → 灯箱放大，Esc 关；不触发钻进
  const crumbBefore = await page.$eval('.crumbs', e => e.innerText);
  await page.dblclick('.card .pics img'); await sleep(500);
  ok(!!(await page.$('.lightbox img')) && await page.$eval('.crumbs', e => e.innerText) === crumbBefore, '双击图 → 灯箱放大（没有钻进去）');
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await page.$('.lightbox')), 'Esc 关灯箱');
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
  // 散图拖到卡片上 = 归给它；卡片里的图拖到空白 = 又变回散图
  await page.click('.react-flow__controls-fitview'); await sleep(600); // 卡片可能被平移到左栏底下
  const tc = await (await page.$('.react-flow__node[data-id="游戏AI/感知"] .lab')).boundingBox();
  let lb = await (await page.$('.loosepic')).boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(lb.x + lb.width / 2 + (tc.x + tc.width / 2 - lb.x - lb.width / 2) * i / 10, lb.y + lb.height / 2 + (tc.y + tc.height / 2 - lb.y - lb.height / 2) * i / 10);
  await page.mouse.up(); await sleep(1800);
  const sensePics = join(ws, '__synapsis', '游戏AI', '感知', '_pics_感知'); // 感知是分组 → 图在它自己的文件夹里
  ok(existsSync(sensePics) && readdirSync(sensePics).length === 1 && readdirSync(looseDir).length === 0 && !(await page.$('.loosepic')), '散图拖到「感知」上 → 归给它（进 _pics_感知/）');
  // 找一块真正的空白（画布变窄后固定坐标可能落在别的卡片上）
  const blank = await page.evaluate(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); const clear = (x, y) => [-130, 0, 130].every(dx => [-130, 0, 130].every(dy => { const el = document.elementFromPoint(r.left + x + dx, r.top + y + dy); return el && el.classList.contains('react-flow__pane'); })); for (let y = r.height * 0.55; y > 150; y -= 30) for (let x = r.width * 0.45; x < r.width - 160; x += 30) if (clear(x, y)) return { x, y }; for (let y = r.height * 0.55; y > 150; y -= 30) for (let x = r.width * 0.45; x > 160; x -= 30) if (clear(x, y)) return { x, y }; return { x: 120, y: 520 }; });
  await page.dragAndDrop('.react-flow__node[data-id="游戏AI/感知"] .pics img', '.react-flow__pane', { targetPosition: blank }); await sleep(1800);
  ok(readdirSync(looseDir).length === 1 && readdirSync(sensePics).length === 0 && (await page.$$('.loosepic')).length === 1, '卡片里的图拖到空白 → 又变成这一页的散图');
  lb = await (await page.$('.loosepic')).boundingBox();
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
  await page.mouse.dblclick(...mid(await (await (await card('情绪空间')).$('.lab')).boundingBox())); await sleep(1000);
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
  // 操作历史栏（Shift+`）：每一步一句人话；点一行 = 回到做完那一步
  await page.mouse.click(700, 700); await page.keyboard.press('Shift+Backquote'); await sleep(300);
  ok(!!(await page.$('.histcol')), 'Shift+` → 操作历史栏（大纲栏右边）');
  const hrows = () => page.$$eval('.histcol .hrow', rs => rs.map(r => r.className.replace('hrow', '').trim() + ':' + r.querySelector('.ht').textContent));
  let hr = await hrows();
  ok(hr.length === 1 && hr[0] === 'future:删除 丙', '历史里写着「删除 丙」，撤销掉了 → 灰的（还能重做）；删甲那几步在撤销后又删丙时被新分支替掉 ' + hr);

  await page.mouse.click(...mid(await (await card('丁')).boundingBox())); await sleep(200);
  await page.keyboard.press('Delete'); await sleep(1600);
  hr = await hrows();
  ok(hr[0].startsWith('cur:') && hr[0].includes('删除 丁') && !hr.some(t => t.startsWith('future:')), '新的一步排最上面、是「现在」；可重做的清掉了 ' + hr);
  await page.click('.histcol .hrow.base'); await sleep(4000);
  ok(existsSync(join(ws, '__synapsis', '甲.md')) && existsSync(join(ws, '__synapsis', '丁.md')) && !!(await card('丁')), '点「打开时的样子」→ 连续撤销到最开始：甲、丁都回来了 ' + await save());
  await page.click('.histcol .hrow.future >> nth=0'); await sleep(4000);
  ok(!existsSync(join(ws, '__synapsis', '丁.md')), '点最上面灰的那行 → 一路重做回来：丁又删了 ' + await save());
  await page.keyboard.press('Control+z'); await sleep(1800);
  await page.click('.histcol button[title^="关闭"]'); await sleep(200);
  ok(!(await page.$('.histcol')), '关闭历史栏');
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
  await page.mouse.dblclick(...mid(await (await (await card('组')).$('.lab')).boundingBox())); await sleep(1000);
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
  await page.click('.react-flow__node[data-id="敌方"] .lab', { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi.row2 a:has-text("连线到")'); await sleep(300);
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
  ok(!(await page.$('.ctx .expchips')), '右键菜单里不再有展开小按钮（挪到卡片标题右边了）');
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
      if (req.url === '/api/v0/models') return send({ data: [{ id: 'emb-x', type: 'embeddings' }, { id: 'chat-x', type: 'llm', state: 'loaded', loaded_context_length: 8192, max_context_length: 40960 }] });
      if (req.url === '/v1/embeddings') return send({ data: j.input.map((t, index) => ({ index, embedding: bag(t) })) });
      const sys = j.messages?.[0]?.content || '', user = j.messages?.at(-1)?.content || ''; // 最后一条 = 这次的话（前面可能是短记忆）
      const lines = user.split(/\r?\n/).map(l => l.match(/^(\d+)\. (.*)$/)).filter(Boolean);
      let out = '';
      const ref = name => (user.match(new RegExp('(n\\d+) ' + name)) || [])[1];
      const ask = user.replace(/【上一轮结果】[^\n]*\n?/, ''); // 判断「人这次说了什么」不能看【上一轮结果】那行（它会带着上次的动作名，比如「对齐」）
      if (/使用说明助手/.test(sys)) out = '- 按 L 搜索目标连线\n- 或者拖卡片边缘';
      else if (/思维导图 \/ 节点图工具/.test(sys)) out = /对齐/.test(ask) ? JSON.stringify({ say: '将左对齐', actions: [{ do: 'align', ids: [ref('惊慌失措'), ref('传感器')], edge: 'left' }, { do: 'delete', ids: ['n1'] }] })
        : /完成/.test(ask) ? JSON.stringify({ say: '将标记完成', actions: [{ do: 'status', ids: [ref('咕噜人')], status: 'done' }] }) : '{"say":"删除请你自己来","actions":[]}';
      else if (/归类配色/.test(sys)) out = lines.map(m => `${m[1]}: ${/吓/.test(m[2]) ? 1 : 0}`).join('\n');
      else if (/值得连起来的关系/.test(sys)) out = lines.map(m => `${m[1]}. x | ${/情绪/.test(m[2]) ? 3 : 0} | ${/情绪/.test(m[2]) ? '都讲情绪' : '无关'}`).join('\n');
      else if (/配色/.test(sys)) out = words;
      else out = '它们都和情绪有关。';
      send({ choices: [{ message: { content: out } }], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const ws = mkdtempSync(join(tmpdir(), 'syn-ai-ui-')); noAi(ws, `http://127.0.0.1:${srv.address().port}/v1`, { chat: 'chat-x', embed: 'emb-x', semColors: true }); // 显式打开：别受真实设置影响（项目根 .synapsis/ai.json 的 semColors 可能被人关了）
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
  // 顶栏两行：窗口窄 → 放不下的按钮收进「⋯」竖列表
  await page.setViewportSize({ width: 900, height: 850 }); await sleep(600);
  ok(!!(await page.$('.bar.tools .morebtn')) && !!(await page.$('.crumbs a')), '窗口变窄 → 第二行右端出现 ⋯，面包屑还在第一行');
  await page.click('.bar.tools .morebtn'); await sleep(300);
  ok((await page.$$('.moremenu button')).length >= 2, '点 ⋯ → 竖列表列出放不下的按钮');
  await page.keyboard.press('Escape'); await page.mouse.click(450, 800); await sleep(200);
  await page.setViewportSize({ width: 1400, height: 850 }); await sleep(600);
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
  ok(!(await page.$('.aipanel button:has-text("生成词表")')), '设置页只放设置：没有「生成词表」按钮');
  // 按用途细分（👤 2026-10-10）：7 个用途各一行，继承 / 本地 / 在线 + 模型；点「在线」存进 cfg.tasks
  ok((await page.$$('.aipanel .srcrow.task')).length === 7, 'AI 设置：7 个用途各一行 ' + (await page.$$('.aipanel .srcrow.task')).length);
  const semSel = '.aipanel .srcrow.task:has-text("语义配色归类") select';
  ok((await page.$eval(semSel, e => e.options[0].textContent)).includes('继承默认'), '每个用途一个下拉，第一项「继承默认」（不再有继承 / 本地 / 在线 + 模型两套控件）');
  ok((await page.$$('.aipanel .srcrow.task .seg')).length === 0, '用途行里没有单独的 本地 / 在线 按钮');
  await page.selectOption(semSel, 'online:'); await sleep(900);
  ok((await page.$eval(semSel, e => e.value)) === 'online:', '语义配色归类 单独选了「在线 · 默认在线模型」');
  ok((await page.$eval('.aipanel .srcrow.task:has-text("潜在关联精排") select', e => e.value)) === '', '别的用途仍是「继承默认」');
  await page.selectOption(semSel, ''); await sleep(900);
  await page.click('.aipanel .bar button'); await sleep(500);
  // 生成词表在指令框的「🎨 配色词表」页（👤「这种操作不该丢配置页面」）
  await page.mouse.click(700, 760); await page.keyboard.press('Shift+F'); await sleep(500);
  await page.click('.agentbox .bar a:has-text("配色词表")'); await sleep(300);
  await page.click('.agentbox .wordstab button:has-text("生成词表")'); await sleep(1500);
  ok((await page.$eval('.agentbox .wordstab textarea', e => e.value)).includes('- 粉: 情绪, 惊慌'), '生成词表 → 草稿出现在文本框');
  await page.click('.agentbox .wordstab textarea'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await sleep(200);
  ok(!(await page.$('.agentbox .plan')) && (await page.$eval('.agentbox .wordstab textarea', e => e.value)).endsWith('\n'), '词表文本框里 Enter = 换行，不会当成发指令');
  await page.click('.agentbox .wordstab button:has-text("写入")'); await sleep(1500);
  ok(readFileSync(join(ws, '__synapsis', '_配色.md'), 'utf8').includes('- 粉: 情绪, 惊慌') && readdirSync(join(ws, '__synapsis', '_过期的')).some(f => f.startsWith('_配色_')), '写入 _配色.md，旧的备份进 _过期的/');
  await page.click('.agentbox .bar a:has-text("对话")'); await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(1500);
  ok(await col('惊慌失措') === PALETTE.粉, '新词表生效：惊慌失措 → 粉');
  // AI 指令框（Ctrl+J）：说 → 预览（✓ 能做 / ✗ 不做）→ Enter 执行 → 坐标对齐、进撤销；日志页有记录
  await page.mouse.click(700, 760); await page.keyboard.press('Shift+F'); await sleep(500);
  ok(!!(await page.$('.agentbox textarea.ask')), 'Shift+F → AI 指令框');
  const meter0 = await page.$eval('.agentbox .ctxmeter', e => e.textContent).catch(() => '');
  ok(/^🧠 ≈\S+ \/ 8\.2k$/.test(meter0), '上下文：没问之前 = 估算 / 加载时设的容量 ' + meter0);
  await page.keyboard.type('把惊慌失措和传感器左对齐'); await page.keyboard.press('Enter'); await sleep(1500);
  ok((await page.$eval('.agentbox .ctxmeter', e => e.textContent)) === '🧠 940 / 8.2k', '上下文：问过 = LM Studio 报的真实用量');
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
  // 问用法 → 问答模式：多行回答，标出参考了快捷键表，没有执行预览
  await page.click('.agentbox textarea.ask'); await page.keyboard.type('怎么连线？'); await page.keyboard.press('Enter'); await sleep(3000); // 全量跑时机器忙，1.5 秒偶尔不够
  const lastA = await page.$$eval('.agentbox .turn', ts => { const t = ts.at(-1); return [t.querySelector('.a')?.textContent || '', t.querySelector('.know')?.textContent || '', !!t.querySelector('.a .mdlite')]; });
  ok(lastA[0].includes('按 L') && lastA[2] && /快捷键/.test(lastA[1]) && !(await page.$('.agentbox .plan')), '问「怎么连线？」→ 多行回答 + 📖 参考了快捷键，没有执行预览 ' + lastA);
  await page.click('.agentbox .bar a:has-text("日志")'); await sleep(800);
  ok((await page.$$('.agentbox .logrow')).length >= 2 && (await page.$$eval('.agentbox .logrow b', bs => bs.map(e => e.textContent))).some(t => t.includes('AI 指令')) && (await page.$$eval('.agentbox .logrow b', bs => bs.map(e => e.textContent))).some(t => t.includes('AI 问答')), '日志页：每次调用都有记录（做事 / 问答）');
  await page.click('.agentbox .logrow .head'); await sleep(300);
  ok((await page.$eval('.agentbox .logrow', e => e.textContent)).includes('原始回答'), '点开日志 → 发出的消息 + 原始回答');
  // 关掉框不丢（👤「退出后输入框里没发出的文字要保留…是否执行也要保留」）：存在服务进程内存（/ui/stash），托盘重启才清
  await page.click('.agentbox .bar a:has-text("对话")'); await sleep(200);
  await page.click('.agentbox textarea.ask'); await page.keyboard.type('还没发的半句话'); await sleep(600);
  await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(300);
  await page.mouse.click(700, 760); await page.keyboard.press('Shift+F'); await sleep(600);
  ok((await page.$eval('.agentbox textarea.ask', e => e.value)) === '还没发的半句话', '关掉再开：没发出的话还在');
  const stash = await page.evaluate(() => fetch('/api/ui/stash' + location.search.replace(/^\?/, '?')).then(r => r.json()));
  ok(stash['agent.text'] === '还没发的半句话', '存在服务端（关窗口也不丢） ' + JSON.stringify(stash).slice(0, 120));
  await page.fill('.agentbox textarea.ask', '咕噜人完成了'); await page.keyboard.press('Enter'); await sleep(1500);
  await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(300);
  await page.mouse.click(700, 760); await page.keyboard.press('Shift+F'); await sleep(800);
  ok(!!(await page.$('.agentbox .plan button.go')) && (await page.$eval('.agentbox textarea.ask', e => e.value)) === '', '关掉再开：待确认的「执行」还在，发出去的话不再留在输入框');
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await page.$('.agentbox .plan')) && !(await page.evaluate(() => fetch('/api/ui/stash' + location.search).then(r => r.json()))).plan, 'Esc 不要 → 待确认的也从暂存里清掉');
  // 拖标题栏移动框，位置记住；双击标题栏空白回默认
  const bb0 = await (await page.$('.agentbox')).boundingBox();
  await page.mouse.move(bb0.x + bb0.width * 0.55, bb0.y + 14); await page.mouse.down(); await page.mouse.move(bb0.x + bb0.width * 0.55 - 200, bb0.y - 200, { steps: 5 }); await page.mouse.up(); await sleep(300);
  const bb1 = await (await page.$('.agentbox')).boundingBox();
  ok(Math.abs(bb1.x - (bb0.x - 200)) < 3 && Math.abs(bb1.y - (bb0.y - 214)) < 3, '拖标题栏 → 框跟着走 ' + JSON.stringify([bb0, bb1].map(b => [Math.round(b.x), Math.round(b.y)])));
  await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(300);
  await page.mouse.click(700, 760); await page.keyboard.press('Shift+F'); await sleep(500);
  const bb2 = await (await page.$('.agentbox')).boundingBox();
  ok(Math.abs(bb2.x - bb1.x) < 3 && Math.abs(bb2.y - bb1.y) < 3, '关掉再开：还在拖过去的位置');
  await page.evaluate(() => { const b = document.querySelector('.agentbox .bar'); b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); await sleep(300);
  const bb3 = await (await page.$('.agentbox')).boundingBox();
  ok(Math.abs(bb3.x - bb0.x) < 3 && Math.abs(bb3.y + bb3.height - bb0.y - bb0.height) < 3, '双击标题栏空白 → 回默认位置（底部居中，高度随内容） ' + JSON.stringify([bb0, bb2, bb3].map(b => [b.x, b.y, b.width, b.height].map(Math.round))));
  await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(300);
  ok(!(await page.$('.agentbox')), '关闭指令框');
  // 卡片上显示人加的属性
  await page.mouse.click(700, 760); await sleep(200); // AI 预览时已选中它，再点一下会取消
  await page.mouse.click(...mid(await (await lab('咕噜人')).boundingBox())); await sleep(300);
  if (!(await page.$('.addrow'))) { await page.keyboard.press('Shift+Tab'); await sleep(500); }
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
  // 属性 / 正文编辑也能撤销
  await page.fill('.addrow td:first-child input', '射程'); await page.fill('.addrow td:nth-child(2) input', '30'); await page.press('.addrow td:nth-child(2) input', 'Enter'); await sleep(1200);
  await page.mouse.click(700, 760); await sleep(200);
  await page.mouse.click(...mid(await (await lab('咕噜人')).boundingBox())); await sleep(300);
  await page.keyboard.press('Control+z'); await sleep(1200);
  ok(!/射程/.test(gmd()) && /血量: 120/.test(gmd()), 'Ctrl+Z → 撤掉刚加的属性（之前的还在）');
  await page.keyboard.press('Control+y'); await sleep(1200);
  ok(/射程: 30/.test(gmd()), 'Ctrl+Y → 属性回来');
  await page.fill('.side textarea', '咕噜人的正文'); await page.click('.side h3'); await sleep(1200);
  ok(/咕噜人的正文/.test(gmd()), '正文失焦保存');
  await page.mouse.click(700, 760); await sleep(200); await page.keyboard.press('Control+z'); await sleep(1200);
  ok(!/咕噜人的正文/.test(gmd()), 'Ctrl+Z → 正文撤回去');
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
  await page.click('.expbar .expmore'); await sleep(150); await page.click('.expmenu .mi:has-text("本页正文")'); await sleep(400);
  ok((await page.$$('.card .cardtext')).length === 1, '竖栏 ⋯ →「展开本页正文」→ 本页带正文的全展开');
  await page.click('.expbar .expmore'); await sleep(150); await page.click('.expmenu .mi:has-text("本页正文")'); await sleep(400);
  ok(!(await page.$('.card .cardtext')), '再点「改」→ 全收起');
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
  await page.keyboard.press('Alt+KeyW'); await sleep(1200);
  await page.mouse.move(700, 650); await page.keyboard.press('Control+v'); await sleep(2000);
  ok(existsSync(join(ws, '__synapsis', '咕噜人.md')) && /血量: 120/.test(readFileSync(join(ws, '__synapsis', '咕噜人.md'), 'utf8')) && !existsSync(join(ws, '__synapsis', '情绪反应', '咕噜人.md')), 'Ctrl+X → 回到根 Ctrl+V = 剪出来（属性还在）');
  // 大纲树拖动（👤 2026-10-10）：只调同一层的次序，拖到别的行上不再「放进去」；行 → 画布卡片 = 放进那张卡
  const F = p => join(ws, '__synapsis', ...p.split('/')) + '.md';
  const orows = () => page.$$eval('.orow .olab', es => es.map(e => e.textContent));
  await page.dragAndDrop('.orow:has(.olab:text-is("吓坏了"))', '.orow:has(.olab:text-is("传感器"))', { targetPosition: { x: 40, y: 3 } }); await sleep(1800);
  ok(!existsSync(F('传感器/吓坏了')) && existsSync(F('吓坏了')), '大纲树：拖到另一行上 → 只调次序，不放进去');
  const first = (await orows())[0];
  await page.dragAndDrop('.orow:has(.olab:text-is("吓坏了"))', `.orow:has(.olab:text-is("${first}"))`, { targetPosition: { x: 40, y: 3 } }); await sleep(1800);
  ok((await orows())[0] === '吓坏了', '拖到第一行的上半 → 排到最前面 ' + (await orows()).slice(0, 3));
  await page.dragAndDrop('.orow:has(.olab:text-is("吓坏了"))', '.react-flow__node[data-id="惊慌失措"]'); await sleep(2000);
  ok(existsSync(F('惊慌失措/吓坏了')), '从大纲树拖到画布的卡片上 → 放进那张卡');
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
// —— 🔍 看清连线（👤 2026-10-09）：卡片缩成标题 + 变淡，线变粗变亮；选中的和相连的不淡；记进 view.json ——
{
  console.log('== 看清连线');
  const ws = mkdtempSync(join(tmpdir(), 'syn-see-ui-')); noAi(ws);
  saveOutline(ws, '甲 -> 乙\n乙\n丙');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 }, 乙: { x: 300, y: 0 }, 丙: { x: 600, y: 0 } }));
  setNodeMeta(ws, '甲', { owner: '某某' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  const card = async l => { for (const c of await page.$$('.card')) { const t = await c.$('.lab'); if (t && (await t.textContent()) === l) return c; } };
  const op = async l => Number(await (await card(l)).evaluate(e => getComputedStyle(e).opacity));
  const sw = () => page.$eval('.react-flow__edge path.react-flow__edge-path', p => parseFloat(getComputedStyle(p).strokeWidth));
  const w0 = await sw();
  ok(!!(await page.$('.expbar button.linebtn')) && !(await page.$('.canvas.seelines')), '左边竖栏有「🔍线」，默认关');
  await page.click('.expbar button.linebtn'); await sleep(500);
  ok(!!(await page.$('.canvas.seelines')) && (await op('丙')) < 0.5, '打开 → 没选中时所有卡片变淡 ' + (await op('丙')));
  ok((await sw()) > w0, '连线变粗 ' + w0 + ' → ' + (await sw()));
  await (await card('甲')).click(); await sleep(500);
  ok((await op('甲')) === 1 && (await op('乙')) === 1 && (await op('丙')) < 0.3, '选中甲 → 甲和相连的乙不淡，无关的丙更淡 ' + [await op('甲'), await op('乙'), await op('丙')]);
  await sleep(900);
  ok(JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8')).seeLines === true, '开关记进 view.json');
  await page.reload(); await sleep(2200);
  ok(!!(await page.$('.canvas.seelines')), '刷新后仍是开着的');
  await page.click('.expbar button.linebtn'); await sleep(400);
  ok(!(await page.$('.canvas.seelines')) && (await op('丙')) === 1, '再点 → 恢复');
  await page.mouse.click(1000, 700); await page.keyboard.press('q'); await sleep(400);
  ok(!!(await page.$('.canvas.seelines')), '按 Q → 打开');
  await page.keyboard.press('q'); await sleep(400);
  ok(!(await page.$('.canvas.seelines')), '再按 Q → 关');
  const tf = await page.$('.ofilter'); if (tf) { await tf.click(); await page.keyboard.type('q'); await sleep(300); ok(!(await page.$('.canvas.seelines')), '在输入框里打字 q → 不触发'); await tf.fill(''); }
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 展开竖栏（👤 2026-10-10）：四种展开 × 「改」（真改、进 Ctrl+Z）/「看」（本页临时盖一层，不改节点）；右键「展开 ▸」悬停二级菜单 ——
{
  console.log('== 展开竖栏');
  const ws = mkdtempSync(join(tmpdir(), 'syn-exp-ui-')); noAi(ws);
  saveOutline(ws, '甲\n  乙\n  丙\n丁\n戊');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 }, 丁: { x: 400, y: 0 }, 戊: { x: 800, y: 0 } }));
  setNodeBody(ws, '丁', '丁的正文');
  setNodeMeta(ws, '戊', { owner: '某某' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  const view = () => JSON.parse(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8'));
  const row = k => `.expbar .exprow:has-text("${k}")`;
  const chg = async k => { await page.click('.expbar .expmore'); await sleep(150); await page.click(`.expmenu .mi:has-text("本页${k}")`); };
  const nText = () => page.$$eval('.card .cardtext', e => e.length), nKids = () => page.$$eval('.card .kidlist', e => e.length), nProps = () => page.$$eval('.card .props', e => e.length);
  ok((await page.$$('.expbar .exprow')).length === 4 && !(await page.$('.bar.top button:has-text("展开正文")')), '画布左侧有 4 行展开竖栏，顶栏旧的展开按钮没了');
  ok(!!(await page.$('.expbar .expmore')) && (await page.$$eval('.expbar .exprow', e => e.map(x => x.textContent).join())) === '子图,子级,属性,正文', '最上面一个 ⋯，下面四行 子图 / 子级 / 属性 / 正文');
  ok((await nProps()) === 1, '默认卡片上显示属性（戊有 owner）');
  // 改：正文（丁）
  await chg('正文'); await sleep(500);
  ok((await nText()) === 1, '正文 改 → 展开');
  await sleep(900); ok(view().textOpen?.['丁'] === true, '改 = 真改，记进 view.json');
  await chg('正文'); await sleep(500);
  ok((await nText()) === 0, '再点改 → 全收起');
  // Ctrl+Z 撤销「改」
  await page.mouse.click(1000, 750); await page.keyboard.press('Control+z'); await sleep(900);
  ok((await nText()) === 1, 'Ctrl+Z → 回到展开');
  await page.keyboard.press('Control+z'); await sleep(900);
  ok((await nText()) === 0, '再 Ctrl+Z → 回到最初的收起');
  // 改：子级（甲有子级）+ 属性
  await chg('子级'); await sleep(500);
  ok((await nKids()) === 1, '子级 改 → 甲展开子级列表');
  await chg('属性'); await sleep(500);
  ok((await nProps()) === 0, '属性 改 → 先全部收起（原来是显示的）');
  await chg('属性'); await sleep(500);
  ok((await nProps()) === 1, '再点 → 全部展开');
  await chg('子级'); await sleep(400);
  // 看：不接管 → 展开 → 收起 → 不接管，节点自己的状态不动
  const see = row('正文');
  await page.click(see); await sleep(500);
  ok((await nText()) === 1, '正文 看 → 临时展开');
  await sleep(900); const v1 = view();
  ok(!v1.textOpen?.['丁'] && v1.seeModes && Object.values(v1.seeModes).some(m => m.text === 'on'), '看 不改节点自己的状态，只按页记 seeModes ' + JSON.stringify(v1.seeModes));
  await page.click(see); await sleep(500);
  ok((await nText()) === 0, '再点 → 临时收起');
  await chg('正文'); await sleep(500);
  ok((await nText()) === 0, '临时收起时，真改成展开也看不见（被盖着）');
  await page.click(see); await sleep(500);
  ok((await nText()) === 1, '第三次点 → 不接管，露出节点自己的状态（展开）');
  await chg('正文'); await sleep(400);
  // 看 · 子图：临时展开不挪别的卡、不写坐标（👤 2026-10-10「看」不能影响节点位置）
  const layoutFile = () => readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8');
  const posOf = async l => { for (const c of await page.$$('.react-flow__node')) { const t = await c.$('.lab'); if (t && (await t.textContent()) === l) { const b = await c.boundingBox(); return [Math.round(b.x), Math.round(b.y)].join(','); } } };
  await sleep(900); const L0 = layoutFile(), dp0 = await posOf('丁');
  await page.click(row('子图')); await sleep(1800);
  ok(!!(await page.$('.react-flow__node-frame')), '子图 看 → 甲临时展开成框');
  await sleep(900);
  ok(layoutFile() === L0, '看 · 子图 → _layout.json 一个字都没变（不存坐标）');
  ok((await posOf('丁')) === dp0, '看 · 子图 → 旁边的卡没被挪走 ' + dp0 + ' / ' + (await posOf('丁')));
  await page.click(row('子图')); await page.click(row('子图')); await sleep(900);
  ok(!(await page.$('.react-flow__node-frame')) && layoutFile() === L0, '再点两次 → 回到不接管，框没了，坐标文件还是原样');
  // 右键卡片：最上面「展开」四个小按钮；新建 / 钻进去收进悬停二级
  await page.mouse.click(...(m => [m.x + m.width / 2, m.y + m.height / 2])(await (await page.$('.card .lab')).boundingBox()), { button: 'right' }); await sleep(300);
  ok(!(await page.$('.ctx .expchips')), '节点右键：展开按钮已挪走');
  const mis = await page.$$eval('.ctx > .mi', e => e.map(x => x.textContent));
  ok(mis.filter(t => t.includes('新建')).length === 1 && mis.some(t => t.includes('新建子节点')) && !mis.some(t => t.includes('新建同级') || t.includes('钻进去')), '节点右键：只留一个「新建子节点」，没有二级 / 新建同级 / 钻进去 ' + mis);
  await page.mouse.move(600, 300); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(150); await page.click('.card .kids:not(.fr)'); await sleep(500);
  ok((await nKids()) === 1, '点卡片标题上的 ▸ → 子级展开');
  await page.mouse.click(600, 720, { button: 'right' }); await sleep(300);
  ok(!!(await page.$('.ctx .mi.sub:has-text("展开本页")')) && (await page.$$('.ctx .submenu .mi')).length === 4, '空白处右键 →「展开本页 ▸」里有 子图 / 子级 / 属性 / 正文 四项');
  await page.keyboard.press('Escape'); await sleep(200);
  // 做不了的项灰着、不隐藏：丁 没有子级，只有正文
  const c丁 = await (async () => { for (const t of await page.$$('.card .lab')) if ((await t.textContent()) === '丁') return t; })();
  const b丁 = await c丁.boundingBox(); await page.mouse.click(b丁.x + b丁.width / 2, b丁.y + b丁.height / 2, { button: 'right' }); await sleep(300);
  await page.keyboard.press('Escape'); await sleep(150);
  const badges = await page.$$eval('.card', cs => cs.map(c => [c.querySelector('.lab')?.textContent, !!c.querySelector('.kids:not(.fr)'), !!c.querySelector('.kids.fr'), !!c.querySelector('.textbadge')]));
  ok(!!badges.find(b => b[0] === '甲' && b[1] && b[2]) && !!badges.find(b => b[0] === '丁' && !b[1] && b[3]), '卡片标题右边：有子级的有 ▸ 和 ⊞，有正文的有 📄 ' + JSON.stringify(badges));
  const b戊 = await page.$('.card:has(.lab:text-is("戊")) .propbadge'); ok(!!b戊, '有属性的卡（戊）标题上有 ☰ 属性按钮');
  const p0 = await nProps(); await b戊.click(); await sleep(500);
  ok((await nProps()) === p0 - 1, '点 ☰ → 属性收起'); await b戊.click(); await sleep(500); ok((await nProps()) === p0, '再点 ☰ → 属性展开');
  await page.keyboard.press('Escape'); await sleep(200);
  // 数字键 1-4：选中了卡 = 切这张卡自己的；没选中 = 本页「看」
  { await page.mouse.click(b丁.x + b丁.width / 2, b丁.y + b丁.height / 2); await sleep(300);
    const n0 = await nText();
    await page.keyboard.press('Digit4'); await sleep(500);
    ok((await nText()) !== n0, '选中丁按 4 → 正文展开状态变了');
    await page.keyboard.press('Digit4'); await sleep(500);
    ok((await nText()) === n0, '再按 4 → 变回去');
    await page.keyboard.press('Escape'); await sleep(200);
    await page.keyboard.press('Digit4'); await sleep(500);
    ok((await nText()) !== n0, '没选中按 4 → 本页「看」正文');
    await page.keyboard.press('Digit4'); await sleep(300); await page.keyboard.press('Digit4'); await sleep(500);
    ok((await nText()) === n0, '看 三态轮一圈 → 回到不接管'); }
  // WASD 跳到最近的卡；Alt+S 钻进去
  { const sel1 = () => page.$eval('.card.sel .lab', e => e.textContent).catch(() => '');
    await page.keyboard.press('Escape'); await sleep(200);
    await page.keyboard.press('KeyW'); await sleep(300);
    ok(!!(await sel1()), '没选中按 W → 选中离中心最近的一张 ' + await sel1());
    if ((await sel1()) !== '丁') { await page.mouse.click(b丁.x + b丁.width / 2, b丁.y + b丁.height / 2); await sleep(300); }
    await page.keyboard.press('KeyD'); await sleep(300);
    ok((await sel1()) === '戊', '选中丁 按 D → 戊 ' + await sel1());
    await page.keyboard.press('KeyA'); await sleep(200); await page.keyboard.press('KeyA'); await sleep(300);
    ok((await sel1()) === '甲', '再按 A A → 甲 ' + await sel1());
    await page.keyboard.press('Alt+KeyS'); await sleep(800);
    ok(/甲/.test(await page.$eval('.crumbs', e => e.innerText)), 'Alt+S 钻进选中的卡 ' + await page.$eval('.crumbs', e => e.innerText));
    await page.keyboard.press('Alt+KeyW'); await sleep(600); }
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— ▭ UI 框 + 颜色饱和度档（👤 2026-10-10）：空白处右键「新建 UI 框」→ 线框，拖右下角改大小，存进 frontmatter；右键「复制 UI 布局」→ 四个角；右键颜色下面 25/50/75/100% ——
{
  console.log('== UI 框');
  const ws = mkdtempSync(join(tmpdir(), 'syn-uibox-ui-')); noAi(ws);
  saveOutline(ws, '甲');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  try { await page.context().grantPermissions(['clipboard-read', 'clipboard-write']); } catch {}
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  // 饱和度档：没选颜色时灰着；选了蓝 → 50% → color: 蓝/50
  await page.click('.card .lab:text-is("甲")', { button: 'right' }); await sleep(300);
  ok((await page.$$eval('.ctx .swatches.sat button', e => e.map(x => x.disabled))).every(x => !x) && (await page.$$('.ctx .swatches.sat button')).length === 4, '自动色时饱和度档也能点（不再灰着）');
  await page.click('.swatches:not(.sat):not(.pats) button[title="蓝"]'); await sleep(1200);
  await page.click('.card .lab:text-is("甲")', { button: 'right' }); await sleep(300);
  await page.click('.swatches.sat button[title="50%"]'); await sleep(1200);
  ok(/color: 蓝\/50/.test(readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8')), '选蓝再点 50% → 写进 color: 蓝/50');
  ok((await page.$eval('.card:has(.lab:text-is("甲"))', e => e.style.getPropertyValue('--c'))) !== '#4d9bff', '卡片颜色变淡了（不是原来的蓝）');
  await page.mouse.click(1000, 300); await sleep(300); await page.click('.card .lab:text-is("甲")'); await sleep(500);
  ok((await page.$$('aside.side .swatches.sat button')).length === 4, '右栏属性里也有饱和度一行');
  await page.click('aside.side .swatches.sat button[title="25%"]'); await sleep(1200);
  ok(/color: 蓝\/25/.test(readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8')), '右栏点 25% → 写进 color: 蓝/25');
  // 新建 UI 框
  await page.mouse.click(700, 600, { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi:has-text("新建 UI 框")'); await sleep(1500);
  await page.keyboard.type('主界面'); await page.keyboard.press('Enter'); await sleep(1500);
  const sz = () => page.$eval('.card.uibox', e => [Math.round(e.offsetWidth), Math.round(e.offsetHeight)]);
  ok(JSON.stringify(await sz()) === '[220,140]', '新建的 UI 框默认 220×140 ' + await sz());
  const md = join(ws, '__synapsis', '主界面.md');
  ok(existsSync(md) && /ui: true/.test(readFileSync(md, 'utf8')) && !/status/.test(readFileSync(md, 'utf8')), '节点 md 里写了 ui: true，没有 status');
  await page.mouse.click(60, 820); await sleep(600);
  const g = await (await page.$('.card.uibox .uigrip')).boundingBox();
  await page.mouse.move(g.x + 6, g.y + 6); await page.mouse.down(); await page.mouse.move(g.x + 106, g.y + 56, { steps: 6 }); await page.mouse.up(); await sleep(1500);
  const [w1, h1] = await sz();
  ok(w1 > 290 && h1 > 170, '拖右下角 → 变大 ' + [w1, h1]);
  ok(new RegExp('w: ' + w1 + '\\b').test(readFileSync(md, 'utf8')) && new RegExp('h: ' + h1 + '\\b').test(readFileSync(md, 'utf8')), '新宽高存进 frontmatter（w / h）');
  await page.reload(); await sleep(2200);
  ok(JSON.stringify(await sz()) === JSON.stringify([w1, h1]), '刷新后大小还在');
  ok(!(await page.$('.card.uibox .props')), 'ui / w / h 不当普通属性列在卡片上');
  // 复制 UI 布局
  await page.click('.card.uibox .lab', { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi:has-text("复制 UI 布局")'); await sleep(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok(/\[UI\] 主界面  左上\(/.test(clip) && new RegExp('宽' + w1 + ' 高' + h1).test(clip), '右键 → 复制 UI 布局：带四个角和宽高 ' + clip.split('\n')[1]);
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 空白处看父属性 + Enter（👤 2026-10-10）：没选中时右栏 = 当前进入的节点（根不算）；Enter 没选中不新建；UI 框选中 Enter = 改名；正文展开宽度跟最长一行 ——
{
  console.log('== 空白处属性与 Enter');
  const ws = mkdtempSync(join(tmpdir(), 'syn-blank-ui-')); noAi(ws);
  saveOutline(ws, '父\n  子甲\n  子乙\n  子丙');
  setNodeBody(ws, '父/子甲', '短行\n短二');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 父: { x: 0, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  await page.mouse.click(700, 700); await sleep(300);
  ok(/选中一个节点看它的属性/.test(await page.$eval('aside.side', e => e.innerText)), '根里没选中 → 还是「选中一个节点看它的属性」');
  await page.keyboard.press('Enter'); await sleep(800);
  ok((await page.$$('.card')).length === 1, '根里没选中按 Enter → 不新建节点');
  // 展开子级列表后，对着某个子节点右键 = 那个子节点的菜单（不是父卡的）
  await page.click('.card .kids:not(.fr)'); await sleep(500);
  await page.click('.kidlist li:has-text("子乙")', { button: 'right' }); await sleep(400);
  await page.click('.ctx .mi:has-text("删除")'); await sleep(1500);
  ok(existsSync(join(ws, '__synapsis', '父', '子甲.md')) && !existsSync(join(ws, '__synapsis', '父', '子乙.md')) && (await page.$$('.card .lab:text-is("父")')).length === 1, '右键展开列表里的「子乙」→ 删除删的是子乙，不是整个父卡');
  await page.dblclick('.card .lab:text-is("父")'); await sleep(1200);
  await page.mouse.click(700, 700); await sleep(500);
  ok((await page.$$('.card.sel')).length === 0, '进入「父」后点空白 → 没有选中的卡');
  ok((await page.$eval('aside.side', e => e.innerText)).includes('父'), '空白处右栏显示当前进入的节点「父」的属性 ' + (await page.$eval('aside.side', e => e.innerText)).slice(0, 40));
  await page.keyboard.press('Enter'); await sleep(800);
  ok((await page.$$('.card')).length === 2, '进入后没选中按 Enter → 也不新建 ' + (await page.$$('.card')).length);
  // 正文展开：宽度 = 最长一行，最多 420
  await page.click('.card .lab:text-is("子甲")'); await sleep(300);
  await page.keyboard.press('Digit4'); await sleep(700);
  const w = await page.$eval('.card:has(.lab:text-is("子甲"))', e => e.offsetWidth);
  ok(w > 0 && w < 300, '正文都是短行 → 卡片不撑到 420 宽 ' + w);
  // Shift+Enter 仍然新建同级
  await page.keyboard.press('Shift+Enter'); await sleep(900);
  ok((await page.$$('.card')).length === 3, '选中后 Shift+Enter 新建同级');
  await page.keyboard.press('Escape'); await sleep(300);
  // UI 框选中 Enter = 改名
  await page.mouse.click(900, 600, { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi:has-text("新建 UI 框")'); await sleep(1500);
  await page.keyboard.type('框框'); await page.keyboard.press('Enter'); await sleep(1500);
  ok(!!(await page.$('.card.uibox.sel')), '新建 UI 框（改完名）后它还是选中的');
  await page.keyboard.press('Enter'); await sleep(600);
  ok(!!(await page.$('.card.uibox input.rename')), '刚建完的 UI 框直接按 Enter → 出改名输入框');
  await page.keyboard.press('Escape'); await sleep(400);
  await page.mouse.click(60, 820); await sleep(300);
  const rc = await page.$eval('.card.uibox', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.keyboard.press('Escape'); await sleep(300);
  await page.mouse.click(rc[0], rc[1]); await sleep(400);
  ok(!!(await page.$('.card.uibox.sel')), '点 UI 框里面 → 选中它');
  const gb = await (await page.$('.card.uibox .uigrip')).boundingBox();
  await page.mouse.move(gb.x + 6, gb.y + 6); await page.mouse.down(); await page.mouse.move(gb.x + 26, gb.y + 16, { steps: 4 }); await page.mouse.up(); await sleep(1200);
  ok(!!(await page.$('.card.uibox.sel')), '拖右下角改大小后，UI 框还是选中的（之前会被当成再点一下 → 取消选中）');
  await page.keyboard.press('Enter'); await sleep(600);
  ok(!!(await page.$('.card.uibox input.rename')), 'UI 框选中按 Enter → 出改名输入框');
  await page.keyboard.press('Escape'); await sleep(300);
  const rc2 = await page.$eval('.card.uibox', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.dblclick(rc2[0], rc2[1]); await sleep(1200);
  ok((await page.$eval('.crumbs', e => e.innerText.replace(/\s+/g, ''))).includes('框框'), '双击 UI 框中间（不是标题）→ 进到框里面');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— UI 框展开子级 / 子图（👤 2026-10-10）：新建的 UI 框默认展开子图（没子级时小小的）；子图里的东西以包围盒中点对准框中点；选中后滚轮缩放框内、不缩放整页 ——
{
  console.log('== UI 框展开');
  const ws = mkdtempSync(join(tmpdir(), 'syn-uifr-ui-')); noAi(ws);
  saveOutline(ws, '甲');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  await page.mouse.click(700, 500, { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi:has-text("新建 UI 框")'); await sleep(1500);
  await page.keyboard.type('框'); await page.keyboard.press('Enter'); await sleep(1500);
  ok(!(await page.$('.card.uibox .kids')), '新建的 UI 框里没东西 → 没有展开按钮');
  ok(JSON.stringify(await page.$eval('.card.uibox', e => [e.offsetWidth, e.offsetHeight])) === '[220,140]', '刚建出来小小的（220×140）');
  await page.keyboard.press('Control+Enter'); await sleep(1200);
  await page.keyboard.type('内'); await page.keyboard.press('Enter'); await sleep(1500);
  ok(!(await page.$('.card.uibox .kidlist')) && !!(await page.$('.card.uibox .kids.fr')) && !(await page.$('.react-flow__node-frame')), '加子节点 → 默认展开的是子图（不是子级列表），框还是 UI 框的样子');
  const box = async () => (await (await page.$('.card.uibox')).boundingBox()), kid = async () => (await (await page.$('.card:has(.lab:text-is("内")):not(.uibox)'))?.boundingBox());
  let ub = await box(), cb = await kid();
  ok(!!cb && cb.x >= ub.x && cb.y >= ub.y && cb.x + cb.width <= ub.x + ub.width + 1 && cb.y + cb.height <= ub.y + ub.height + 1, '子节点画在框里面 ' + JSON.stringify([ub, cb].map(b => b && [b.x, b.y, b.width, b.height].map(Math.round))));
  ok(Math.abs(cb.x + cb.width / 2 - (ub.x + ub.width / 2)) < 40 && Math.abs(cb.y + cb.height / 2 - (ub.y + ub.height / 2)) < 40, '子图里东西的包围盒中点对准框的中点（一个子节点 = 它在框正中）');
  // 选中框 + 滚轮 → 缩放框内（子节点变大），页面本身的缩放不变
  await page.mouse.click(60, 820); await sleep(200);
  await page.click('.card.uibox .lab'); await sleep(300);
  const vp0 = await page.$eval('.react-flow__viewport', e => e.style.transform), w0 = (await kid()).width;
  await page.mouse.move(ub.x + ub.width / 2, ub.y + ub.height - 10); for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await sleep(120); } await sleep(500);
  const w1 = (await kid()).width;
  ok(w1 > w0 * 1.2, '选中展开子图的框，在框上滚轮向上 → 框内子节点变大 ' + [w0, w1].map(Math.round));
  ok((await page.$eval('.react-flow__viewport', e => e.style.transform)) === vp0, '整页的缩放 / 平移没变');
  await page.mouse.move(480, 680); await page.mouse.wheel(0, 300); await sleep(1500);
  ok((await page.$eval('.react-flow__viewport', e => e.style.transform)) !== vp0, '鼠标不在框上 → 滚轮照旧缩放整页');
  // 鼠标中键拖 = 平移框内；左下角 all = 复位（回到全部显示、居中）
  await page.click('.card.uibox .lab'); await sleep(200);
  ub = await box(); const kx0 = (await kid()).x;
  await page.mouse.move(ub.x + ub.width / 2, ub.y + ub.height - 12); await page.mouse.down({ button: 'middle' }); await page.mouse.move(ub.x + ub.width / 2 + 40, ub.y + ub.height - 12, { steps: 4 }); await page.mouse.up({ button: 'middle' }); await sleep(400);
  ok((await kid()).x - kx0 > 20, '选中框，鼠标中键在框里拖 → 框内画布平移（子节点跟着动） ' + ((await kid()).x - kx0));
  ok(!!(await page.$('.card.uibox .uiall')), '展开子图的 UI 框左下角有 all');
  await page.click('.card.uibox .uiall'); await sleep(500);
  const cb3 = await kid(); ub = await box();
  ok(cb3.x >= ub.x && cb3.x + cb3.width <= ub.x + ub.width + 1 && Math.abs(cb3.x + cb3.width / 2 - (ub.x + ub.width / 2)) < 12, '点 all → 复位：子节点回到框里、水平居中 ' + [cb3.x, cb3.width, ub.x, ub.width].map(Math.round));
  // ⊟ 收起子图、▸ 展开子级列表
  await page.click('.card.uibox .kids.fr'); await sleep(800);
  ub = await box(); const cb2 = await kid();
  ok(!cb2 || cb2.x + cb2.width <= ub.x || cb2.y >= ub.y + ub.height || cb2.x >= ub.x + ub.width || cb2.y + cb2.height <= ub.y, '点 ⊟ → 子图收起（子节点不再画在框里）');
  await page.click('.card.uibox .kids:not(.fr)'); await sleep(600);
  ok(!!(await page.$('.card.uibox .kidlist li:has-text("内")')), '点 ▸ → 列出子级');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— ↗ 传送门卡片（👤 2026-10-10）：右键空白「引入…」→ 节点页签选一个别处的节点 → 这一页放一张指向它的卡；双击跳过去；本页的节点不列 ——
{
  console.log('== 传送门卡片');
  const ws = mkdtempSync(join(tmpdir(), 'syn-ref-ui-')); noAi(ws);
  saveOutline(ws, '设计\n  战斗\n页面');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 设计: { x: 0, y: 0 }, 页面: { x: 300, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  await page.mouse.click(700, 650, { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi:has-text("引入…")'); await sleep(800);
  await page.fill('.finder input', '页面'); await sleep(400);
  ok((await page.$$('.finder li b')).length === 0, '本页的节点（页面）不列：引入的是别处的节点，不是复制');
  await page.fill('.finder input', '战斗'); await sleep(400);
  ok((await page.$$eval('.finder li b', e => e.map(x => x.textContent))).join() === '战斗', '别处的节点（设计/战斗）能搜到');
  await page.click('.finder li'); await sleep(1500);
  ok(!!(await page.$('.card.refcard')) && (await page.$eval('.card.refcard .lab', e => e.textContent)) === '↗ 战斗', '这一页多了一张虚线框的传送门卡片「↗ 战斗」');
  const md = join(ws, '__synapsis', '↗ 战斗.md');
  ok(existsSync(md) && /ref: 设计\/战斗/.test(readFileSync(md, 'utf8')) && !/status/.test(readFileSync(md, 'utf8')), '节点 md 里写了 ref:，没有 status');
  ok(!!(await page.$('.card.refcard .refsub:has-text("设计/战斗")')), '卡片上有「↗ 设计/战斗」小字');
  const lb = await (await page.$('.card.refcard .lab')).boundingBox();
  await page.mouse.dblclick(lb.x + lb.width / 2, lb.y + lb.height / 2); await sleep(1200);
  ok((await page.$eval('.crumbs', e => e.innerText.replace(/\s+/g, ''))).includes('设计') && (await page.$eval('.card.sel .lab', e => e.textContent)) === '战斗', '双击传送门卡片 → 跳到「设计」那一页并选中战斗');
  await page.keyboard.press('Alt+KeyW'); await sleep(800);
  await page.click('.card.refcard .lab', { button: 'right' }); await sleep(300);
  ok(!!(await page.$('.ctx .mi:has-text("跳到它指的节点")')), '右键传送门卡片有「↗ 跳到它指的节点」');
  await page.keyboard.press('Escape'); await sleep(200);
  await page.mouse.click(700, 700); await page.keyboard.press('Control+z'); await sleep(1500);
  ok(!(await page.$('.card.refcard')), 'Ctrl+Z → 传送门卡片没了');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 📎 外部文件节点（👤 2026-10-10）：右键空白「引入外部文件」→ 选文件 → 建一个带 file: 的普通节点；双击打开原文件；撤销 ——
{
  console.log('== 外部文件节点');
  const ws = mkdtempSync(join(tmpdir(), 'syn-fn-ui-')); noAi(ws);
  saveOutline(ws, '甲\n乙');
  mkdirSync(join(ws, 'docs'), { recursive: true });
  writeFileSync(join(ws, 'docs', '设计笔记.md'), '# 笔记\n笔记正文XYZ');
  writeFileSync(join(ws, 'docs', '数据.json'), '{"a":1}');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 }, 乙: { x: 300, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  await page.mouse.click(600, 720, { button: 'right' }); await sleep(300);
  ok(!!(await page.$('.ctx .mi:has-text("引入…")')), '右键空白有「📎 引入…」');
  await page.click('.ctx .mi:has-text("引入…")'); await sleep(800);
  ok(!!(await page.$('.finder .ftabs')), '弹出和「连线到…」一样的两页签窗口');
  await page.keyboard.press('Tab'); await sleep(200);
  await page.fill('.finder input', '数据'); await sleep(400);
  const listed = await page.$$eval('.finder li b', e => e.map(x => x.textContent));
  ok(listed.length === 1 && listed[0].includes('数据.json'), '项目文件页：能搜到项目里的文件 ' + listed.join('|'));
  await page.fill('.finder input', '笔记'); await sleep(400);
  ok((await page.$$('.finder li b')).length === 1, '打字过滤 → 只剩一个');
  await page.click('.finder li'); await sleep(1500);
  const card = (await page.$$('.card')).length === 3;
  ok(card && !!(await page.$('.card .filesub:has-text("docs/设计笔记.md")')), '画布上多了一张卡，带 📎 路径小字');
  const nodeMd = join(ws, '__synapsis', '设计笔记.md.md');
  ok(existsSync(nodeMd) && /file: docs\/设计笔记\.md/.test(readFileSync(nodeMd, 'utf8')) && !/status/.test(readFileSync(nodeMd, 'utf8')), '节点 md 里写了 file:，没有 status');
  ok(readFileSync(join(ws, 'docs', '设计笔记.md'), 'utf8') === '# 笔记\n笔记正文XYZ', '原文件一个字没动');
  // 双击 → 打开原文件
  const lb = await (await page.$('.card:has(.filesub) .lab')).boundingBox();
  await page.mouse.dblclick(lb.x + lb.width / 2, lb.y + lb.height / 2); await sleep(1200);
  ok((await page.textContent('body')).includes('笔记正文XYZ'), '双击这张卡 → 打开那个文件的内容');
  // 右键 → 打开引用的文件
  await page.keyboard.press('Escape'); await sleep(200);
  await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2, { button: 'right' }); await sleep(300);
  ok(!!(await page.$('.ctx .mi:has-text("打开引用的文件")')), '右键这张卡有「📎 打开引用的文件」');
  await page.keyboard.press('Escape'); await sleep(200);
  // 撤销
  await page.mouse.click(600, 720); await page.keyboard.press('Control+z'); await sleep(1500);
  ok((await page.$$('.card')).length === 2 && existsSync(join(ws, 'docs', '设计笔记.md')), 'Ctrl+Z → 卡片没了，原文件还在');
  // Ctrl+F 跳转：同样两个页签，Tab 切到项目文件，选一个 = 打开那个文件的预览
  await page.mouse.click(600, 720); await page.keyboard.press('Control+f'); await sleep(700);
  ok(!!(await page.$('.finder .ftabs')) && (await page.textContent('.finder .bar')).includes('Tab') && !(await page.textContent('.finder .bar')).includes('Esc'), 'Ctrl+F：页签永远在，提示只留「名字 / 属性 / 正文 · Tab」');
  await page.fill('.finder input', '设计笔记'); await page.keyboard.press('Tab'); await sleep(400);
  await page.click('.finder li:has-text("设计笔记.md")'); await sleep(1200);
  ok((await page.textContent('body')).includes('笔记正文XYZ'), 'Ctrl+F → 项目文件页选文件 → 打开预览');
  await page.keyboard.press('Escape'); await sleep(200);
  // 连线到… 也能选外部文件：自动引成节点再连线
  const c甲 = await (async () => { for (const t of await page.$$('.card .lab')) if ((await t.textContent()) === '甲') return t; })();
  const b甲 = await c甲.boundingBox(); await page.mouse.click(b甲.x + b甲.width / 2, b甲.y + b甲.height / 2, { button: 'right' }); await sleep(300);
  await page.click('.ctx .mi.row2 a:has-text("连线到")'); await sleep(800);
  ok(!!(await page.$('.finder')) && !!(await page.$('.finder .ftabs')) && !(await page.textContent('.finder .bar')).includes('也能选'), 'L → 连线搜索框，有「节点 / 项目文件」页签，标题不啰嗦');
  await page.fill('.finder input', '数据'); await sleep(500);
  ok(!!(await page.$('.finder .ftabs')) && (await page.textContent('.finder .ftabs a.on')).includes('节点'), '有「节点 / 项目文件」两个页签，默认在节点页');
  ok(!(await page.$$eval('.finder li b', e => e.map(x => x.textContent))).some(t => t.includes('数据.json')), '文件不混进节点页');
  await page.keyboard.press('Tab'); await sleep(300);
  ok((await page.textContent('.finder .ftabs a.on')).includes('项目文件') && (await page.$$eval('.finder li b', e => e.map(x => x.textContent))).some(t => t.includes('数据.json')), '按 Tab → 切到「项目文件」页，搜「数据」→ 列出 数据.json');
  await page.keyboard.press('Tab'); await sleep(200);
  ok((await page.textContent('.finder .ftabs a.on')).includes('节点'), '再按 Tab → 切回节点页');
  await page.click('.finder .ftabs a:has-text("项目文件")'); await sleep(300);
  ok((await page.textContent('.finder .ftabs a.on')).includes('项目文件'), '点页签也能切');
  await page.click('.finder li:has-text("数据.json")'); await sleep(2500);
  ok(existsSync(join(ws, '__synapsis', '数据.json.md')) && /file: docs\/数据\.json/.test(readFileSync(join(ws, '__synapsis', '数据.json.md'), 'utf8')), '选中 → 自动建了带 file: 的节点');
  ok(/数据\.json/.test(readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8')) && /to:/.test(readFileSync(join(ws, '__synapsis', '甲.md'), 'utf8')), '并且 甲 连到了它');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 跨项目复制（👤 2026-10-10）：复制时剪贴板里带来源项目路径；在另一个项目里粘贴 = 服务端按来源路径读节点（连子孙 / 正文 / 属性 / 内部边）——
{
  console.log('== 跨项目复制');
  const A = mkdtempSync(join(tmpdir(), 'syn-xsrc-')), B = mkdtempSync(join(tmpdir(), 'syn-xdst-')); noAi(A); noAi(B);
  saveOutline(A, '组\n  甲 -> 乙\n  乙');
  setNodeBody(A, '组/甲', '甲的正文XYZ');
  saveOutline(B, '丙');
  writeFileSync(join(B, '__synapsis', '_layout.json'), JSON.stringify({ 丙: { x: 0, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(B)}`); await sleep(2200);
  const payload = 'synapsis-nodes:' + JSON.stringify({ ids: ['组'], src: A });
  await page.mouse.click(600, 720); await sleep(200);
  await page.evaluate(txt => { const dt = new DataTransfer(); dt.setData('text/plain', txt); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, payload);
  await sleep(2200);
  const outlineB = readFileSync(join(B, '__synapsis', '组', '_node.md'), 'utf8');
  ok(existsSync(join(B, '__synapsis', '组', '甲.md')) && existsSync(join(B, '__synapsis', '组', '乙.md')), '另一个项目的「组」连子孙粘贴进来了');
  ok(readFileSync(join(B, '__synapsis', '组', '甲.md'), 'utf8').includes('甲的正文XYZ'), '正文跟着');
  ok(/乙/.test(readFileSync(join(B, '__synapsis', '组', '甲.md'), 'utf8')), '内部的边保留（甲 → 乙）');
  ok((await page.$$('.card .lab')).length >= 2 && (await page.textContent('body')).includes('已从另一个项目粘贴'), '界面提示「已从另一个项目粘贴」');
  ok(existsSync(join(A, '__synapsis', '组', '甲.md')), '来源项目没动');
  // 来源路径不存在 → 报错提示，不崩
  const bad = 'synapsis-nodes:' + JSON.stringify({ ids: ['组'], src: join(tmpdir(), 'syn-nonexistent-zzz') });
  await page.evaluate(txt => { const dt = new DataTransfer(); dt.setData('text/plain', txt); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, bad);
  await sleep(1200);
  ok((await page.textContent('body')).includes('粘贴失败'), '来源项目找不到 → 提示失败');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  for (const d of [A, B]) rmSync(d, { recursive: true, force: true });
}
// —— ⚙ 设置（👤 2026-10-10）：左上角 ⚙ → init 生成哪些（存 Synapsis 目录的 settings.yaml）。测试会改真文件 → 先备份、测完写回 ——
{
  console.log('== 设置');
  const SF = join(process.cwd(), '..', 'settings.yaml'), had = existsSync(SF), backup = had ? readFileSync(SF, 'utf8') : null;
  const ws = mkdtempSync(join(tmpdir(), 'syn-set-ui-')); noAi(ws);
  saveOutline(ws, '甲\n乙');
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  try {
    await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
    ok(!!(await page.$('.bar.tabs a.gear')), '左栏最左上有 ⚙');
    await page.click('.bar.tabs a.gear'); await sleep(700);
    const rows = await page.$$eval('.settings .srow b', e => e.map(x => x.textContent));
    ok(rows.length === 5 && rows.includes('AI 接入手册') && rows.includes('启动快捷方式'), '设置窗里列出 init 的 5 项 ' + rows.join('|'));
    const first = '.settings .srow:has-text("黑板") input';
    const was = await page.isChecked(first);
    await page.click(first); await sleep(900);
    ok((await page.isChecked(first)) === !was, '点一下 → 勾选翻转');
    ok(new RegExp('blackboard: ' + !was).test(readFileSync(SF, 'utf8')), '立刻写进 settings.yaml');
    await page.click(first); await sleep(900);
    ok(new RegExp('blackboard: ' + was).test(readFileSync(SF, 'utf8')), '再点回来');
    await page.click('.settings .bar button'); await sleep(300);
    ok(!(await page.$('.settings')), '✕ 关掉');
  } finally {
    if (had) writeFileSync(SF, backup); else if (existsSync(SF)) rmSync(SF);
  }
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— ⌨ 快捷键页双搜索（👤 2026-10-10）：左边按一下键查键位，右边搜文字，两个都要满足 ——
{
  console.log('== 快捷键搜索');
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?demo`); await sleep(1800);
  await page.click('button:has-text("快捷键")'); await sleep(400);
  const all = (await page.$$('.helpgrid tr')).length;
  ok(all > 25 && !!(await page.$('.help input.hkey')) && !!(await page.$('.help input.htext')), '快捷键页有两个搜索框，默认显示全部 ' + all);
  const helpText = await page.textContent('.helpgrid');
  ok(!helpText.includes('双击图片') && !helpText.includes('散图拖到卡片上') && !helpText.includes('顶栏 ☀') && !(await page.$$eval('.helpgrid h4', h => h.some(x => x.textContent.includes('图片')))), '基础操作（双击图片、散图拖到卡片上、顶栏主题按钮……）不在快捷键页里，「图片」组也没了');
  await page.click('.help input.hkey'); await page.keyboard.press('Control+z'); await sleep(300);
  const v1 = await page.$eval('.help input.hkey', e => e.value), n1 = (await page.$$('.helpgrid tr')).length;
  ok(v1 === 'Ctrl+Z' && n1 > 0 && n1 < all && (await page.$$eval('.helpgrid tr', r => r.some(x => x.textContent.includes('撤销')))), '按 Ctrl+Z → 框里记下 Ctrl+Z，只剩用到它的条目 ' + n1);
  ok(await page.$$eval('.helpgrid section', s => s.length) < 14, '没有匹配的分组整个隐藏');
  await page.fill('.help input.htext', '重做'); await sleep(300);
  const n2 = (await page.$$('.helpgrid tr')).length;
  ok(n2 > 0 && n2 <= n1 && n2 < 4, '再搜「重做」→ 两个条件取交集 ' + n2);
  await page.fill('.help input.htext', '一定没有这个词'); await sleep(300);
  ok((await page.$$('.helpgrid tr')).length === 0 && !!(await page.$('.helpgrid .hint')), '没有符合的 → 提示');
  await page.fill('.help input.htext', ''); await page.click('.help input.hkey'); await page.keyboard.press('Backspace'); await sleep(300);
  ok((await page.$eval('.help input.hkey', e => e.value)) === '' && (await page.$$('.helpgrid tr')).length === all, 'Backspace 清掉键位 → 回到全部');
  await page.keyboard.press('Shift+Tab'); await page.click('.help input.hkey'); await page.keyboard.press('q'); await sleep(300);
  ok((await page.$$eval('.helpgrid tr', r => r.some(x => x.textContent.includes('看清连线') || x.textContent.includes('竖栏')))), '按 Q → 能找到看清连线那一条');
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await page.$('.help')), '在键位框里按 Esc → 关掉快捷键页');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
}
// —— 📌 钉子（👤 2026-10-09）：右键钉到… → 反引号开窗 → ☐ / 双击跳转 / 清空 / 删组 → 撤销 → 改名后钉子跟着走 → 刷新还在 ——
{
  console.log('== 钉子');
  const ws = mkdtempSync(join(tmpdir(), 'syn-pin-ui-')); noAi(ws);
  saveOutline(ws, '甲\n乙\n丙\n  丁');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 }, 乙: { x: 260, y: 0 }, 丙: { x: 520, y: 0 }, '丙/丁': { x: 0, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  const lab = async l => { for (const t of await page.$$('.card .lab')) if ((await t.textContent()) === l) return t; };
  const mid = b => [b.x + b.width / 2, b.y + b.height / 2];
  const hk = () => JSON.parse(readFileSync(join(ws, '.synapsis', 'pins.json'), 'utf8'));
  const names = () => hk().groups.map(g => g.name + ':' + g.items.map(i => i.node).join('+')).join(' | ');
  const rclick = async l => { await page.mouse.click(...mid(await (await lab(l)).boundingBox()), { button: 'right' }); await sleep(300); };
  ok(!!(await page.$('.expbar button.pinbtn')) && !(await page.$('.pinbox')), '左边竖栏有 📌钉 按钮，窗口默认不开');
  // 右键 甲 → 还没有组 → 只有「钉到新组」
  await rclick('甲');
  ok(!!(await page.$('.ctx .mi:has-text("钉到新组")')) && !(await page.$('.ctx .mi:has-text("钉到「")')), '还没有组 → 右键只有「📌 钉到新组」');
  await page.click('.ctx .mi:has-text("钉到新组")'); await sleep(900);
  ok(names() === '组 1:甲', '钉到新组 → 写进 .synapsis/pins.json ' + names());
  // 再右键 乙 → 第一项 = 钉到「组 1」（当前），另有灰字「钉到新组」
  await rclick('乙');
  ok(!!(await page.$('.ctx .mi:has-text("钉到「组 1」")')) && !!(await page.$('.ctx .mi.quiet:has-text("钉到新组")')), '有组了 → 第一项是当前组「组 1」，灰字「＋ 钉到新组」');
  await page.click('.ctx .mi:has-text("钉到「组 1」")'); await sleep(900);
  ok(names() === '组 1:甲+乙', '钉到当前组 ' + names());
  await rclick('乙'); await page.click('.ctx .mi:has-text("钉到「组 1」")'); await sleep(700);
  ok(names() === '组 1:甲+乙', '同一个节点在同一组里不重复');
  // 再建一个新组钉 丙；它成为当前组，右键里 组 1 变成灰字
  await rclick('丙'); await page.click('.ctx .mi.quiet:has-text("钉到新组")'); await sleep(900);
  ok(names() === '组 1:甲+乙 | 组 2:丙' && hk().current === hk().groups[1].id, '钉到新组 → 组 2，成为当前组 ' + names());
  await rclick('甲');
  ok(!!(await page.$('.ctx .mi:has-text("钉到「组 2」")')) && !!(await page.$('.ctx .mi.quiet:has-text("钉到「组 1」")')), '右键：第一项 = 当前组（组 2），其他组灰字');
  await page.keyboard.press('Escape'); await sleep(200);
  // 反引号开窗
  await page.mouse.click(700, 800); await page.keyboard.press('Backquote'); await sleep(500);
  ok(!!(await page.$('.pinbox')) && (await page.$$('.pinbox .hgroup')).length === 2, '反引号 → 钉子窗口，两个组');
  ok((await page.$eval('.pinbox .hgroup.cur .hgname', e => e.textContent)) === '组 2', '当前组高亮 = 组 2');
  const box = await page.$eval('.pinbox', e => e.getBoundingClientRect().toJSON()), side = await page.$eval('.side', e => e.getBoundingClientRect().toJSON());
  ok(box.right <= side.left + 1, '默认位置不盖住右栏属性面板 ' + Math.round(box.right) + ' vs ' + Math.round(side.left));
  // 点组 1 的标题 = 设成当前组
  await page.click('.pinbox .hgroup:nth-child(1) .hghead .hgname'); await sleep(700);
  ok(hk().current === hk().groups[0].id, '点组标题 → 设成当前组（写盘）');
  // ☐ 勾
  await page.click('.pinbox .hgroup:nth-child(1) li:nth-child(2) input[type=checkbox]'); await sleep(700);
  ok(hk().groups[0].items[1].checked === true && !!(await page.$('.pinbox .hlab.done')), '☐ 勾上 → 划线 + 写盘');
  // 双击名字 → 跳过去选中
  await page.dblclick('.pinbox .hgroup:nth-child(1) li:nth-child(2) .hlab'); await sleep(900);
  ok((await page.$eval('.side h3 input', e => e.value)) === '乙', '双击钉子 → 跳到并选中 乙');
  // 折叠（不进历史）
  await page.click('.pinbox .hgroup:nth-child(2) .hgtog'); await sleep(500);
  ok(hk().groups[1].collapsed === true && !(await page.$('.pinbox .hgroup:nth-child(2) li')), '折叠组 2');
  await page.click('.pinbox .hgroup:nth-child(2) .hgtog'); await sleep(400);
  // 钉一个别的页的节点：钻进 丙，右键 丁 → 钉到当前组（组 1）；回上一层，双击钉子 → 回到 丙 并选中 丁
  await page.dblclick('.react-flow__node[data-id="丙"] .lab'); await sleep(900);
  await rclick('丁'); await page.click('.ctx .mi:has-text("钉到「组 1」")'); await sleep(900);
  ok(names() === '组 1:甲+乙+丙/丁 | 组 2:丙', '在别的页钉 丁 → 组 1 ' + names());
  await page.mouse.click(700, 800); await page.keyboard.press('Alt+KeyW'); await sleep(900);
  await page.dblclick('.pinbox .hgroup:nth-child(1) li:nth-child(3) .hlab'); await sleep(1200);
  ok((await page.$eval('.crumbs', e => e.innerText)).includes('丙') && (await page.$eval('.side h3 input', e => e.value)) === '丁', '双击别页的钉子 → 换页并选中 丁');
  await page.mouse.click(700, 800); await page.keyboard.press('Alt+KeyW'); await sleep(700);
  // 撤销 / 重做：撤销刚才钉 丁；操作历史里有一句人话
  await page.mouse.click(700, 800); await page.keyboard.press('Control+z'); await sleep(900);
  ok(names() === '组 1:甲+乙 | 组 2:丙', 'Ctrl+Z → 撤销钉 丁 ' + names());
  await page.keyboard.press('Control+Shift+z'); await sleep(900);
  ok(names() === '组 1:甲+乙+丙/丁 | 组 2:丙', 'Ctrl+Shift+Z → 重做 ' + names());
  await page.keyboard.press('Shift+Backquote'); await sleep(500);
  ok((await page.$$eval('.histcol .hrow', ls => ls.map(l => l.innerText)).catch(() => [])).some(t => t.includes('钉到「组 1」')), '操作历史栏里记着「钉到「组 1」…」');
  await page.keyboard.press('Shift+Backquote'); await sleep(300);
  // 清空 → 组留着；撤销 → 钉子回来
  await page.click('.pinbox .hgroup:nth-child(1) .hghead a:has-text("清空")'); await sleep(800);
  ok(hk().groups.length === 2 && hk().groups[0].items.length === 0, '清空 → 钉子没了，组还在');
  await page.mouse.click(700, 800); await page.keyboard.press('Control+z'); await sleep(800);
  ok(hk().groups[0].items.length === 3, '撤销清空 → 钉子回来');
  // 双击组名改名
  await page.dblclick('.pinbox .hgroup:nth-child(2) .hgname'); await sleep(300);
  await page.keyboard.press('Control+a'); await page.keyboard.type('翻NPC'); await page.keyboard.press('Enter'); await sleep(800);
  ok(hk().groups[1].name === '翻NPC', '双击组名 → 改名 ' + names());
  // 删组 → 撤销
  await page.click('.pinbox .hgroup:nth-child(2) .hghead a[title^="删除这个组"]'); await sleep(800);
  ok(hk().groups.length === 1, '🗑 删组');
  await page.mouse.click(700, 800); await page.keyboard.press('Control+z'); await sleep(800);
  ok(hk().groups.length === 2 && hk().groups[1].name === '翻NPC', '撤销删组 → 组回来');
  // 画布上改名 甲 → 甲改：钉子跟着走，窗口里不显示「找不到」
  await page.mouse.click(...mid(await (await lab('甲')).boundingBox())); await sleep(300);
  await page.keyboard.press('F2'); await sleep(300);
  await page.keyboard.press('Control+a'); await page.keyboard.type('甲改'); await page.keyboard.press('Enter'); await sleep(2500);
  ok(hk().groups[0].items.some(i => i.node === '甲改') && !hk().groups[0].items.some(i => i.node === '甲'), '改名 甲→甲改：pins.json 里钉子跟着改 ' + names());
  ok(!/找不到/.test(await page.$eval('.pinbox', e => e.innerText)) && (await page.$eval('.pinbox', e => e.innerText)).includes('甲改'), '窗口里也跟着，没有「找不到」');
  // 刷新页面：钉子还在，窗口还开着（stash）
  await page.reload(); await sleep(2500);
  ok(!!(await page.$('.pinbox')) && (await page.$$('.pinbox .hgroup')).length === 2 && (await page.$eval('.pinbox', e => e.innerText)).includes('甲改'), '刷新后：窗口还开着，两个组都在');
  // 窗口缩小：浮窗整个留在屏幕里（默认位置会跟着右栏 / 窗口走；拖过的位置显示时拉回来，窗口放大再回去）
  const inside = async () => { const b = await page.$eval('.pinbox', e => e.getBoundingClientRect().toJSON()), v = page.viewportSize(); return b.left >= -1 && b.top >= -1 && b.right <= v.width + 1 && b.bottom <= v.height + 1; };
  for (const [w, h] of [[900, 600], [700, 480], [420, 320]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(500);
    ok(await inside(), `窗口缩到 ${w}×${h}：钉子窗口整个还在屏幕里（默认位置）`);
  }
  await page.setViewportSize({ width: 1400, height: 850 }); await sleep(500);
  // 拖到右下角，再缩小：拉回来；不污染 AI 框的位置记录
  const bar = await page.$eval('.pinbox .bar', e => e.getBoundingClientRect().toJSON());
  await page.mouse.move(bar.left + 20, bar.top + 8); await page.mouse.down(); await page.mouse.move(1100, 700, { steps: 6 }); await page.mouse.up(); await sleep(400);
  ok(await page.evaluate(() => !!localStorage.getItem('syn.pinbox') && localStorage.getItem('syn.agentbox') === null), '拖过：位置记在 syn.pinbox，没碰 AI 框的 syn.agentbox');
  for (const [w, h] of [[900, 600], [500, 400]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(500);
    ok(await inside(), `拖过的钉子窗口，窗口缩到 ${w}×${h}：也被拉回屏幕里`);
  }
  await page.setViewportSize({ width: 1400, height: 850 }); await sleep(500);
  ok(await inside(), '窗口放回 1400×850：还在屏幕里');
  await page.dblclick('.pinbox .bar b'); await sleep(300);
  // 跳转要快：别页的钉子，双击后 450ms 内目标卡片已经居中（以前固定等 400ms + 300ms 动画）
  await page.mouse.click(700, 800); await sleep(100);
  const ctr = async l => { const cb = await (await lab(l))?.boundingBox(), rb = await page.$eval('.react-flow', e => e.getBoundingClientRect().toJSON()); return cb ? Math.hypot(cb.x + cb.width / 2 - (rb.left + rb.width / 2), cb.y + cb.height / 2 - (rb.top + rb.height / 2)) : 9999; };
  await page.dblclick('.pinbox .hgroup:nth-child(1) li:nth-child(3) .hlab'); await sleep(450);
  ok((await ctr('丁')) < 220, '双击别页的钉子 → 450ms 内换页并居中 ' + Math.round(await ctr('丁')));
  await page.mouse.click(700, 800); await page.keyboard.press('Alt+KeyW'); await sleep(500);
  // AI 指令框也一样（和钉子窗口共用同一套拖动 / 缩放）：缩小窗口 → 默认位置和拖过的位置都拉回屏幕里
  await page.mouse.click(700, 800); await page.keyboard.press('Shift+F'); await sleep(600);
  const aiIn = async () => { const b = await page.$eval('.agentbox', e => e.getBoundingClientRect().toJSON()), v = page.viewportSize(); return b.left >= -1 && b.top >= -1 && b.right <= v.width + 1 && b.bottom <= v.height + 1; };
  for (const [w, h] of [[800, 500], [420, 320]]) { await page.setViewportSize({ width: w, height: h }); await sleep(500); ok(await aiIn(), `AI 框（默认位置）：窗口缩到 ${w}×${h} 还在屏幕里`); }
  await page.setViewportSize({ width: 1400, height: 850 }); await sleep(500);
  const abar = await page.$eval('.agentbox .bar', e => e.getBoundingClientRect().toJSON());
  await page.mouse.move(abar.left + 12, abar.top + 8); await page.mouse.down(); await page.mouse.move(1250, 760, { steps: 6 }); await page.mouse.up(); await sleep(400);
  for (const [w, h] of [[900, 600], [500, 400]]) { await page.setViewportSize({ width: w, height: h }); await sleep(500); ok(await aiIn(), `AI 框（拖到右下角后）：窗口缩到 ${w}×${h} 被拉回屏幕里`); }
  await page.setViewportSize({ width: 1400, height: 850 }); await sleep(500);
  await page.click('.agentbox .bar button[title^="关闭"]'); await sleep(400);
  // 反引号收起
  await page.mouse.click(700, 800); await page.keyboard.press('Backquote'); await sleep(400);
  ok(!(await page.$('.pinbox')), '反引号 → 收起');
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 📌 钉子 第 2 步：文件里的某一行（选中文字右键钉；文件改了还能找回；找不到让人选）——
{
  console.log('== 行钉子');
  const ws = mkdtempSync(join(tmpdir(), 'syn-pinline-ui-')); noAi(ws);
  saveOutline(ws, '甲\n乙');
  setNodeMeta(ws, '甲', { 备注: '测试' }); // 让 md 有 frontmatter：正文框里的行号和真文件的行号不一样
  setNodeBody(ws, '甲', '开头一行\n第二行：这是一段比较长的话，用来测试按二十个字一段做探针的搜索方法，改动之后还能不能找回来。\n结尾一行');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 甲: { x: 0, y: 0 }, 乙: { x: 260, y: 0 } }));
  writeFileSync(join(ws, '笔记.txt'), '头\n中间有一句话要记住：别忘了测试文件预览里的钉子\n尾');
  const mdFile = join(ws, '__synapsis', '甲.md'), txtFile = join(ws, '笔记.txt');
  const mdLines = () => readFileSync(mdFile, 'utf8').split('\n'), lineOf = s => mdLines().findIndex(l => l.includes(s)) + 1;
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  const pins = () => JSON.parse(readFileSync(join(ws, '.synapsis', 'pins.json'), 'utf8'));
  const items = () => pins().groups.flatMap(g => g.items);
  const lab = async l => { for (const t of await page.$$('.card .lab')) if ((await t.textContent()) === l) return t; };
  const mid = b => [b.x + b.width / 2, b.y + b.height / 2];
  // 在 pre.raw 里选中第 ln 行的 [a, b) 字，右键选区中央
  const selectRaw = async (scope, ln, a, b) => {
    await page.evaluate(([sc, ln, a, b]) => { const span = document.querySelector(`${sc} [data-ln="${ln}"]`), tn = span.firstChild, r = document.createRange(); r.setStart(tn, a); r.setEnd(tn, b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }, [scope, ln, a, b]);
    const c = await page.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(c[0], c[1], { button: 'right' }); await sleep(400);
  };
  // 1) 原文页里选中 → 右键 → 钉到新组
  await page.mouse.click(...mid(await (await lab('甲')).boundingBox())); await sleep(400);
  await page.click('.side .tabs a:has-text("原文")'); await sleep(900);
  const L2 = lineOf('第二行');
  await selectRaw('pre.raw', L2, 3, 15);
  ok((await page.$eval('.ctx .mh', e => e.textContent).catch(() => '')) === '选中的文字', '原文页里选中一段文字，右键 → 出现「选中的文字」菜单（不是浏览器自己的）');
  await page.click('.ctx .mi:has-text("钉到新组")'); await sleep(900);
  let it = items()[0];
  ok(it?.kind === 'line' && it.file === '__synapsis/甲.md' && it.node === '甲' && it.line === L2 && it.text.startsWith('第二行') && it.seg === 0, '钉到新组 → 行钉子：文件 / 节点 / 行号 / 整行文字 / 段号 ' + JSON.stringify(it));
  // 2) 正文框里选中 → 右键 → 钉到当前组：行号要加上 frontmatter 的行数
  await page.click('.side .tabs a:has-text("概览")'); await sleep(500);
  await page.evaluate(() => { const ta = document.querySelector('textarea.body'); ta.focus(); const i = ta.value.indexOf('结尾一行'); ta.setSelectionRange(i, i + 4); const r = ta.getBoundingClientRect(); ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 30 })); });
  await sleep(400);
  ok((await page.$eval('.ctx .mh', e => e.textContent).catch(() => '')) === '选中的文字', '正文框里选中文字右键 → 同一个菜单');
  await page.click('.ctx .mi:has-text("钉到「组 1」")'); await sleep(900);
  ok(items().length === 2 && items()[1].line === lineOf('结尾一行') && items()[1].line > 3, '正文框里的钉子：行号是真文件里的行号（带上 frontmatter） ' + items()[1]?.line + ' vs ' + lineOf('结尾一行'));
  // 没选中文字时右键 = 浏览器自己的菜单（我们不抢）
  await page.evaluate(() => { const ta = document.querySelector('textarea.body'); ta.setSelectionRange(2, 2); window.__ctxPrevented = null; ta.addEventListener('contextmenu', e => { window.__ctxPrevented = e.defaultPrevented; }, { once: false }); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); ta.dispatchEvent(ev); window.__ctxPrevented = ev.defaultPrevented; });
  ok(await page.evaluate(() => window.__ctxPrevented) === false && !(await page.$('.ctx')), '没选中文字 → 不拦右键');
  // 3) 文件在外面被改：上面插了两行 → 双击钉子，高亮到新位置，钉子里的行号更新
  writeFileSync(mdFile, readFileSync(mdFile, 'utf8').replace('开头一行', '新加的一行\n又一行\n开头一行'));
  await page.mouse.click(700, 800); await page.keyboard.press('Backquote'); await sleep(500);
  await page.dblclick('.pinbox li:nth-child(1) .hlab'); await sleep(1200);
  const L2b = lineOf('第二行');
  ok(L2b === L2 + 2 && (await page.$eval('pre.raw .ln.hl', e => e.dataset.ln).catch(() => '')) === String(L2b), '文件上面插了两行 → 双击钉子，原文页高亮到新位置（第 ' + L2b + ' 行）');
  ok((await page.$eval('pre.raw .ln.hl', e => e.textContent).catch(() => '')).startsWith('第二行'), '高亮的就是那一行');
  ok(items()[0].line === L2b, '钉子里的行号顺手更新成新的 ' + items()[0].line);
  ok((await page.$eval('.pinbox li:nth-child(1) .hlab.two .hsub', e => e.textContent).catch(() => '')).includes('甲') && (await page.$eval('.pinbox li:nth-child(1) .hlab.two .htxt', e => e.textContent).catch(() => '')) === items()[0].label && items()[0].label.length > 3, '文字钉两行：第一行灰字节点名 + 行号，第二行是钉的那段文字');
  ok((await page.$eval('.pinbox li:nth-child(1) .hlab', e => getComputedStyle(e).cursor)) === 'pointer', '鼠标在钉子上是手指（不是文字光标）');
  ok(!!(await page.$('.react-flow__node[data-id="甲"] .cardtext')), '双击文字钉 → 画布上那个节点的卡片展开了正文');
  { const nb = await (await page.$('.react-flow__node[data-id="甲"]')).boundingBox(), pb = await (await page.$('.react-flow__pane')).boundingBox();
    ok(Math.abs(nb.x + nb.width / 2 - (pb.x + pb.width / 2)) < pb.width * 0.3 && Math.abs(nb.y + nb.height / 2 - (pb.y + pb.height / 2)) < pb.height * 0.35, '双击文字钉 → 画布把那个节点移到视野中间 ' + JSON.stringify([Math.round(nb.x + nb.width / 2 - pb.x - pb.width / 2), Math.round(nb.y + nb.height / 2 - pb.y - pb.height / 2)])); }
  ok((await page.$eval('.react-flow__node[data-id="甲"] .cardtext .pinflash', e => e.textContent).catch(() => '')).startsWith('第二行'), '卡片里滚到那一行，并闪一下高亮');
  // 4) 行中间被改了几个字 → 照样认得出
  writeFileSync(mdFile, readFileSync(mdFile, 'utf8').replace('按二十个字一段做探针', '按二十个字一段做【改动】'));
  await page.dblclick('.pinbox li:nth-child(1) .hlab'); await sleep(1000);
  ok((await page.$eval('pre.raw .ln.hl', e => e.dataset.ln).catch(() => '')) === String(L2b) && items()[0].text.includes('【改动】'), '行中间改了几个字 → 还是找到，钉子里的文字也跟着更新');
  // 5) 那一行整个被删了 → 找不到：列最像的几行让人选；「都不是」收起
  writeFileSync(mdFile, readFileSync(mdFile, 'utf8').split('\n').filter(l => !l.startsWith('第二行')).join('\n'));
  await page.dblclick('.pinbox li:nth-child(1) .hlab'); await sleep(1000);
  ok(!!(await page.$('.pinbox .pinask')), '那一行被删了 → 钉子下面出现「找不到原来的那一行」');
  await page.click('.pinbox .pinask .cand.dim'); await sleep(300);
  ok(!(await page.$('.pinbox .pinask')), '点「都不是」收起');
  // 6) 节点改名：md 文件跟着搬，行钉子按节点找到新路径
  // 甲 已经被上一步的跳转选中了（再点一下卡片反而会取消选中）
  await page.keyboard.press('F2'); await sleep(300); await page.keyboard.press('Control+a'); await page.keyboard.type('甲改'); await page.keyboard.press('Enter'); await sleep(2500);
  ok(items()[1].node === '甲改', '节点改名 甲→甲改：行钉子的 node 跟着改 ' + items()[1].node);
  await page.dblclick('.pinbox li:nth-child(2) .hlab'); await sleep(1300);
  ok((await page.$eval('pre.raw .ln.hl', e => e.textContent).catch(() => '')).startsWith('结尾一行'), '改名之后双击行钉子：还是找到那一行（按节点取新路径）');
  // 7) 文件预览里选中 → 钉；文件被改后双击 → 文件预览里高亮
  await page.click('a[title^="项目根目录的文件"]'); await sleep(800);
  await page.click('.fi:has-text("笔记.txt")'); await sleep(900);
  await selectRaw('.side.wide pre.raw', 2, 6, 12);
  await page.click('.ctx .mi:has-text("钉到「组 1」")'); await sleep(800);
  it = items().find(i => i.file === '笔记.txt');
  ok(it && it.node === null && it.line === 2 && it.text.startsWith('中间有一句话'), '文件预览里选中 → 钉：普通文件（不是节点）也行 ' + JSON.stringify(it));
  writeFileSync(txtFile, '新的第一行\n' + readFileSync(txtFile, 'utf8'));
  await page.click('.side.wide .bar button'); await sleep(400);
  ok(!(await page.$('.side.wide')), '关掉文件预览');
  await page.dblclick('.pinbox li:nth-child(3) .hlab'); await sleep(1300);
  ok((await page.$eval('.side.wide pre.raw .ln.hl', e => e.dataset.ln).catch(() => '')) === '3', '文件被改（上面多了一行）→ 双击钉子 → 重新打开文件预览，高亮第 3 行');
  // 8) 文件搬了位置：按文件名找（项目里只有一个同名文件就用它）
  mkdirSync(join(ws, '子目录'), { recursive: true });
  writeFileSync(join(ws, '子目录', '笔记.txt'), readFileSync(txtFile, 'utf8')); rmSync(txtFile);
  await page.click('.side.wide .bar button'); await sleep(300);
  await page.dblclick('.pinbox li:nth-child(3) .hlab'); await sleep(1300);
  ok((await page.$eval('.side.wide .bar b', e => e.textContent).catch(() => '')).includes('子目录/笔记.txt') && items().find(i => i.text.startsWith('中间有一句话')).file === '子目录/笔记.txt', '文件搬进「子目录」→ 按文件名找到，钉子里的路径更新');
  // 9) 文件被删：明说，不崩
  rmSync(join(ws, '子目录'), { recursive: true, force: true });
  await page.click('.side.wide .bar button'); await sleep(300);
  await page.dblclick('.pinbox li:nth-child(3) .hlab'); await sleep(1000);
  ok(/找不到文件/.test(await page.$eval('.save', e => e.textContent).catch(() => '')), '文件被删 → 状态栏说找不到文件');
  await page.mouse.click(700, 800);
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
// —— 🔁 Ctrl+H 替换节点名 + 双击只在标题行钻进去（👤 2026-10-10）——
{
  console.log('== 替换节点名');
  const ws = mkdtempSync(join(tmpdir(), 'syn-repl-ui-')); noAi(ws);
  saveOutline(ws, '敌人A\n敌人B\n友军\n  敌人C');
  writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify({ 敌人A: { x: 0, y: 0 }, 敌人B: { x: 300, y: 0 }, 友军: { x: 600, y: 0 } }));
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?ws=${encodeURIComponent(ws)}`); await sleep(2200);
  const labs = () => page.$$eval('.card .lab', e => e.map(x => x.textContent).sort().join(','));
  const crumb = () => page.$eval('.crumbs', e => e.innerText.replace(/\s+/g, ''));
  // 双击标题上的小图标不进入，双击节点名才进入
  await page.dblclick('.card .kids:not(.fr)'); await sleep(700);
  ok((await crumb()) === '根', '双击 ▸ 小图标 → 不钻进去 ' + await crumb());
  const l友 = await (async () => { for (const t of await page.$$('.card .lab')) if ((await t.textContent()) === '友军') return t; })();
  await l友.dblclick(); await sleep(900);
  ok((await crumb()).includes('友军'), '双击节点名 → 钻进去 ' + await crumb());
  await page.keyboard.press('Alt+KeyW'); await sleep(800);
  // Ctrl+H
  await page.mouse.click(700, 700); await page.keyboard.press('Control+KeyH'); await sleep(300);
  ok(!!(await page.$('.replbar')), 'Ctrl+H → 出现替换条');
  await page.fill('.replbar .rfind', '敌人'); await sleep(400);
  ok((await page.$eval('.replbar .rcount', e => e.textContent)) === '1 / 2', '本页两个匹配（子页的敌人C 不算） ' + await page.$eval('.replbar .rcount', e => e.textContent));
  await page.fill('.replbar .rto', '怪物');
  await page.click('.replbar button:text-is("替换")'); await sleep(1800);
  ok((await labs()).includes('怪物A') && (await labs()).includes('敌人B'), '替换 = 只改当前这个 ' + await labs());
  ok(/1 \/ 1/.test(await page.$eval('.replbar .rcount', e => e.textContent)), '替换完剩 1 个 ' + await page.$eval('.replbar .rcount', e => e.textContent));
  await page.fill('.replbar .rfind', '敌人'); await page.fill('.replbar .rto', '兵'); await sleep(300);
  await page.click('.replbar button:text-is("全部替换")'); await sleep(1800);
  ok((await labs()) === '兵B,友军,怪物A', '全部替换（剩下的敌人B） ' + await labs());
  await page.click('.replbar .rx'); await sleep(300);
  ok(!(await page.$('.replbar')), '✕ 关掉替换条');
  await page.mouse.click(700, 700); await page.keyboard.press('Control+z'); await sleep(1800);
  ok((await labs()) === '友军,怪物A,敌人B', 'Ctrl+Z → 全部替换一步撤回 ' + await labs());
  ok(errs.length === 0, '无页面报错 ' + errs.join(' | '));
  await page.close();
  rmSync(ws, { recursive: true, force: true });
}
await browser.close();
console.log(`ui:${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
