// 给真实工作区截图（会按界面行为写 _layout.json）：node test/shot.mjs <输出目录> [节点名…依次钻进]
import { chromium } from 'playwright-core';
const [out, ...path] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'msedge', headless: true });
for (const kind of ['reactflow', 'tldraw']) {
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  await p.goto(`http://localhost:5410/${kind}.html`);
  await new Promise(r => setTimeout(r, 2000));
  for (const label of path) {
    for (const c of await p.$$('.card')) if ((await c.innerText()).split('\n')[0].includes(label)) { const bb = await c.boundingBox(); await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2); break; }
    await new Promise(r => setTimeout(r, 900));
  }
  await p.screenshot({ path: `${out}/ws_${kind}.png` });
  console.log(kind, await p.$eval('.crumbs', e => e.innerText), '|', await p.$eval('.save', e => e.innerText));
  await p.close();
}
await b.close();
