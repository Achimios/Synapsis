// >v<🖥️桌面-托盘主进程-Electron（= Node + Chromium，和 Obsidian 同款）：内置 dev 服务、托盘、启动台、每个工作区一个窗口
// 启动：根目录 Synapsis_desktop.vbs；项目里的 Synapsis.vbs 也会优先用它（--ws <目录>）。单实例：再次启动只是把参数交给已开的那个。
import { app, BrowserWindow, Tray, Menu, dialog, nativeImage, ipcMain, screen } from 'electron';
import { createServer } from 'vite';
import { join, resolve, dirname, basename } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // app/
const HOME = resolve(APP, '..');                                      // Synapsis 根
const PORT = 5410, BASE = `http://localhost:${PORT}`;
const HIDDEN = !!process.env.SYN_TEST_HIDDEN;                         // 自动化测试：窗口不显示
process.env.SYN_DESKTOP = '1';

// 工作区参数：--ws <目录> 或 --ws=<目录>；后面紧跟的是另一个 -- 开关就不算
const wsArg = argv => {
  const eq = argv.find(a => a.startsWith('--ws='));
  if (eq) return eq.slice(5);
  const i = argv.indexOf('--ws'), v = i >= 0 ? argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
};
// 单实例：第二次启动把工作区经 additionalData 交给已开的那个。
// 别从 second-instance 的 argv 里解析 —— Chromium 会重排参数，--ws 后面可能变成它自己的开关（2026-10-07 弹出「文件夹不存在：…\--allow-file-access-from-files」）
// 自动化测试（SYN_TEST_HIDDEN）不抢单实例锁：否则用户开着 Synapsis 时，测试会把参数塞给用户的窗口
if (!HIDDEN && !app.requestSingleInstanceLock({ ws: wsArg(process.argv) })) app.quit();
app.on('second-instance', (_e, _argv, _cwd, data) => { const ws = data?.ws; ws ? openWorkspace(ws) : showLauncher(); });
app.on('window-all-closed', () => { /* 留在托盘里，不退出 */ });

// —— 最近打开（.synapsis/recent.json，本机状态）——
const RECENT = process.env.SYN_RECENT || join(HOME, '.synapsis', 'recent.json'); // 测试用 SYN_RECENT 指到临时文件
const readRecent = () => { try { return JSON.parse(readFileSync(RECENT, 'utf8')); } catch { return []; } };
const writeRecent = list => { mkdirSync(dirname(RECENT), { recursive: true }); writeFileSync(RECENT, JSON.stringify(list.slice(0, 20), null, 1)); };
const touchRecent = dir => writeRecent([{ dir, name: basename(dir), opened: new Date().toISOString() }, ...readRecent().filter(r => r.dir !== dir)]);

// —— 服务：直接在主进程里起 vite（端口被占 = 已有服务在跑，比如 VBS 起的，直接复用）——
async function startServer() {
  process.chdir(APP); // vite.config.js 里的相对路径以 app/ 为准
  try {
    // 只监听本机回环：不对局域网开放，也不该触发 Windows 防火墙「公共网络访问」弹窗
    const s = await createServer({ configFile: join(APP, 'vite.config.js'), root: APP, server: { host: '127.0.0.1', port: PORT, strictPort: true }, logLevel: 'warn' });
    await s.listen();
  } catch (e) { console.log('[synapsis] 端口已被占用，复用已有服务：', e.message); }
}

// —— 窗口 ——
const wins = new Map(); // dir -> BrowserWindow
let launcher = null, tray = null;
const winOpts = (w, h) => ({ width: w, height: h, show: !HIDDEN, autoHideMenuBar: true, icon: trayIcon(), backgroundColor: '#1c1c1c', webPreferences: { preload: join(APP, 'electron', 'preload.cjs'), contextIsolation: true } });

// 界面缩放：Electron 自带菜单的「放大」只认 Ctrl+Shift+=，Ctrl+= 没反应（👤 2026-10-08「只能 ctrl - 不能 ctrl +」）
function zoomKeys(w) {
  w.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' || !(i.control || i.meta) || i.alt) return;
    const z = w.webContents.getZoomLevel();
    if (i.key === '=' || i.key === '+' || i.code === 'NumpadAdd') w.webContents.setZoomLevel(Math.min(z + 0.5, 5));
    else if (i.key === '-' || i.key === '_' || i.code === 'NumpadSubtract') w.webContents.setZoomLevel(Math.max(z - 0.5, -5));
    else if (i.key === '0' || i.code === 'Numpad0') w.webContents.setZoomLevel(0);
    else return;
    e.preventDefault();
  });
  return w;
}

function showLauncher() {
  if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); return launcher; }
  launcher = zoomKeys(new BrowserWindow({ ...winOpts(560, 640), title: 'Synapsis' }));
  launcher.loadURL(`${BASE}/launcher.html`);
  return launcher;
}

async function openWorkspace(dir) {
  dir = resolve(dir);
  if (!existsSync(dir)) { dialog.showErrorBox('Synapsis', '文件夹不存在：\n' + dir); return; }
  if (!existsSync(join(dir, '__synapsis'))) {
    const r = HIDDEN ? { response: 0 } : await dialog.showMessageBox({ type: 'question', buttons: ['挂上 Synapsis 并打开', '取消'], defaultId: 0, cancelId: 1, title: 'Synapsis', message: `「${basename(dir)}」还没挂上 Synapsis`, detail: '会在里面建 __synapsis/（图数据）、.synapsis/（本机状态）和 Synapsis.vbs 启动器。已有文件不会动。' });
    if (r.response !== 0) return;
    await initDir(dir);
  }
  touchRecent(dir); refreshTray();
  const old = wins.get(dir);
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return old; }
  // 窗口位置大小按工作区记在 <项目>/.synapsis/window.json（本机状态）；屏幕变了（拔显示器）放不下就用默认
  const wfile = join(dir, '.synapsis', 'window.json');
  let saved = null; try { saved = JSON.parse(readFileSync(wfile, 'utf8')); } catch { /* 第一次 */ }
  const fits = b => b && screen.getAllDisplays().some(d => { const a = d.workArea; return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x + 200 <= a.x + a.width && b.y + 100 <= a.y + a.height; });
  const w = zoomKeys(new BrowserWindow({ ...winOpts(1500, 950), ...(fits(saved) ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : {}), title: 'Synapsis — ' + basename(dir) }));
  if (saved?.maximized && !HIDDEN) w.maximize();
  const keep = () => { try { mkdirSync(dirname(wfile), { recursive: true }); writeFileSync(wfile, JSON.stringify({ ...w.getNormalBounds(), maximized: w.isMaximized() })); } catch { /* 只读目录就算了 */ } };
  let kt = null; const keepSoon = () => { clearTimeout(kt); kt = setTimeout(keep, 500); };
  w.on('resize', keepSoon); w.on('move', keepSoon); w.on('close', keep);
  w.loadURL(`${BASE}/?ws=${encodeURIComponent(dir)}`);
  w.on('page-title-updated', e => e.preventDefault());
  w.on('closed', () => wins.delete(dir));
  wins.set(dir, w);
  if (launcher && !launcher.isDestroyed()) launcher.hide();
  return w;
}

async function initDir(dir) {
  const { init } = await import(pathToFileURL(join(HOME, 'core', 'cli.js')).href);
  init(dir);
}

async function pickFolder() {
  const last = readRecent()[0]?.dir;
  const r = await dialog.showOpenDialog({ title: '选择要用 Synapsis 规划的项目文件夹', properties: ['openDirectory'], defaultPath: last ? dirname(last) : app.getPath('desktop'), buttonLabel: '打开' });
  return r.canceled ? null : r.filePaths[0];
}

// —— 启动台用的接口（preload.cjs 暴露给页面）——
ipcMain.handle('syn:recent', () => readRecent().map(r => ({ ...r, ok: existsSync(join(r.dir, '__synapsis')) })));
// 注意：IPC 返回值要能被结构化克隆 —— 别把 BrowserWindow 传回页面
ipcMain.handle('syn:pick-open', async () => { const d = await pickFolder(); if (d) await openWorkspace(d); return d; });
ipcMain.handle('syn:open', async (_e, dir) => { await openWorkspace(dir); return true; });
ipcMain.handle('syn:forget', (_e, dir) => { writeRecent(readRecent().filter(r => r.dir !== dir)); refreshTray(); });
ipcMain.handle('syn:info', () => ({ home: HOME, version: app.getVersion?.() }));

// —— 托盘 ——
function refreshTray() {
  if (!tray) return;
  const recent = readRecent().slice(0, 8);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开启动台', click: showLauncher },
    { label: '打开文件夹…', click: async () => { const d = await pickFolder(); if (d) openWorkspace(d); } },
    { type: 'separator' },
    ...(recent.length ? recent.map(r => ({ label: r.name, sublabel: r.dir, click: () => openWorkspace(r.dir) })) : [{ label: '（还没有打开过的工作区）', enabled: false }]),
    { type: 'separator' },
    { label: '退出 Synapsis', click: () => app.exit(0) },
  ]));
}

// 托盘图标：代码画一个 32×32 的圆（不依赖图片文件）
let _icon = null;
function trayIcon() {
  if (_icon) return _icon;
  const S = 32, raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5), o = y * (S * 4 + 1) + 1 + x * 4;
      const ring = d < 15 && d > 11.5, core = d < 6.5, link = Math.abs(x - y) < 1.6 && d < 12;
      const on = ring || core || link;
      raw[o] = on ? 43 : 0; raw[o + 1] = on ? 123 : 0; raw[o + 2] = on ? 255 : 0; raw[o + 3] = on ? 255 : 0;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return (_icon = nativeImage.createFromBuffer(png));
}

app.whenReady().then(async () => {
  await startServer();
  tray = new Tray(trayIcon());
  tray.setToolTip('Synapsis');
  tray.on('click', showLauncher);
  refreshTray();
  const ws = wsArg(process.argv);
  if (ws) await openWorkspace(ws); else showLauncher();
});
