// 真实工作区截图：右键菜单 + 属性面板 + 文件页（只看不改）。node test/shot_ui.mjs <输出目录>
import { chromium } from 'playwright-core';
const out = process.argv[2];
const sleep = t => new Promise(r => setTimeout(r, t));
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://localhost:5410/'); await sleep(2000);
const box = async label => { for (const c of await p.$$('.card')) { const t = await c.$eval('.title', e => e.textContent).catch(() => ''); if (t.includes(label)) return c.boundingBox(); } };
let bb = await box('游戏NPC状态空间组'); await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(900);
bb = await box('决策'); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(200);
await p.keyboard.press('i'); await sleep(500);
bb = await box('内在'); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: 'right' }); await sleep(400);
await p.screenshot({ path: `${out}/ui_menu_props.png` });
await p.keyboard.press('Escape');
await p.click('.bar.tabs a:has-text("文件")'); await sleep(800);
await p.click('.fi:has-text("用户笔记_AI空间.md")'); await sleep(800);
await p.screenshot({ path: `${out}/ui_files.png` });
await b.close();
console.log('ok');
