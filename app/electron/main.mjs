// >v<🖥️桌面-托盘主进程-Electron（= Node + Chromium，和 Obsidian 同款）：内置 dev 服务、托盘、启动台、每个工作区一个窗口
// 启动：根目录 Synapsis_desktop.vbs；项目里的 Synapsis.vbs 也会优先用它（--ws <目录>）。单实例：再次启动只是把参数交给已开的那个。
import { app, BrowserWindow, Tray, Menu, dialog, nativeImage, ipcMain, screen } from 'electron';
import { createServer } from 'vite';
import { join, resolve, dirname, basename } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // app/
const HOME = resolve(APP, '..');                                      // Synapsis 根
const PORT = 5410, BASE = `http://localhost:${PORT}`;
const HIDDEN = !!process.env.SYN_TEST_HIDDEN;                         // 自动化测试：窗口不显示
process.env.SYN_DESKTOP = '1';
// 退出托盘时（不是关 vault 窗口）：把这次托盘期间各工作区删掉的东西（.junk/，只给 Ctrl+Z 用）送系统回收站。
// 关掉 vault 再从托盘打开，撤销栈（服务进程内存里）和 .junk/ 都还在，还能撤销。
// 开始时就把 core 载进来：退出时同步调用，赶得上（动态 import 在退出途中可能来不及）
const { clearGraveyard } = await import(pathToFileURL(join(HOME, 'core', 'workspace.js')).href);
const APP_START = Date.now() - 2000; // 只清这之后产生的（.junk 里时间戳只到秒，留 2 秒余量）；上次意外退出留下的由下次打开时问用户
const touched = new Set(); // 这次托盘期间打开过的工作区目录
const sweepTrash = dir => { try { clearGraveyard(dir, { since: APP_START }); } catch (e) { console.log('[synapsis] 清 .junk 失败：', e.message); } };

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
app.on('before-quit', () => { for (const dir of touched) sweepTrash(dir); }); // 托盘「退出」才清（同步执行，赶得上退出）

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
    const r = HIDDEN ? { response: 0 } : await dialog.showMessageBox({ type: 'question', buttons: ['挂上 Synapsis 并打开', '取消'], defaultId: 0, cancelId: 1, title: 'Synapsis', message: `「${basename(dir)}」还没挂上 Synapsis`, detail: '会在里面建 __synapsis/（图数据）、.synapsis/（本机状态）和「在Synapsis打开本项目」快捷方式。已有文件不会动。' });
    if (r.response !== 0) return;
    await initDir(dir);
  }
  launcherFor(dir);
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
  w.on('closed', () => wins.delete(dir)); // 关 vault 窗口不清 .junk、不丢撤销栈
  wins.set(dir, w); touched.add(dir);
  if (launcher && !launcher.isDestroyed()) launcher.hide();
  return w;
}

async function initDir(dir) {
  const { init } = await import(pathToFileURL(join(HOME, 'core', 'cli.js')).href);
  init(dir);
}

// 老项目根目录的 Synapsis.vbs → 换成快捷方式（后台做，失败不影响打开）
async function launcherFor(dir) {
  try { const { ensureLauncher } = await import(pathToFileURL(join(HOME, 'core', 'launcher.js')).href); ensureLauncher(dir); } catch (e) { console.log('[synapsis] 快捷方式：', e.message); }
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
    // 👤 2026-10-10 高频改代码时：改了服务端（vite.config.js / core/*.js）要重启才生效。不清 .junk（撤销栈还要用），重开当前的工作区
    { label: '重启 Synapsis（改了服务端代码后用）', click: () => { const dir = [...wins.keys()][0]; app.relaunch({ args: [...process.argv.slice(1).filter(a => a !== '--ws' && a !== dir), ...(dir ? ['--ws', dir] : [])] }); app.exit(0); } },
    { label: '退出 Synapsis', click: () => { for (const dir of touched) sweepTrash(dir); app.exit(0); } }, // app.exit 不触发 before-quit，所以这里直接清
  ]));
}

// >v<🚀启停-图标-把 png 丢进 <Synapsis>/_图标/ → 自动转出同名多尺寸 .ico（没有 ico 或 png 更新时）；客户端开着时盯着这个文件夹（👤 2026-10-08）
//   不是方形就居中补透明。ico 里每个尺寸存 PNG（Vista 起都认）。换了 客户端.png → 托盘当场换；转完刷新 Windows 图标缓存
//   黑底发光图想去黑底，还是用 core/tools/make_icon.py（要 Python）
const ICONS = process.env.SYN_ICONS || join(HOME, '_图标'), ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
function pngToIco(file) {
  let im = nativeImage.createFromPath(file); if (im.isEmpty()) return null;
  const { width: w, height: h } = im.getSize();
  if (w !== h) { // 居中补成方形（toBitmap 是 BGRA，逐行拷）
    const s = Math.max(w, h), src = im.toBitmap(), dst = Buffer.alloc(s * s * 4), ox = (s - w) >> 1, oy = (s - h) >> 1;
    for (let y = 0; y < h; y++) src.copy(dst, ((y + oy) * s + ox) * 4, y * w * 4, (y + 1) * w * 4);
    im = nativeImage.createFromBitmap(dst, { width: s, height: s });
  }
  const pngs = ICO_SIZES.map(n => im.resize({ width: n, height: n, quality: 'best' }).toPNG());
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i, n = ICO_SIZES[i] % 256; // 256 写成 0
    head[e] = n; head[e + 1] = n; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(p.length, e + 8); head.writeUInt32LE(off, e + 12); off += p.length;
  });
  return Buffer.concat([head, ...pngs]);
}
function syncIcons() {
  let made = [];
  try {
    for (const f of readdirSync(ICONS)) {
      if (!/\.png$/i.test(f)) continue;
      const png = join(ICONS, f), ico = png.replace(/\.png$/i, '.ico');
      if (existsSync(ico) && statSync(ico).mtimeMs >= statSync(png).mtimeMs) continue;
      const buf = pngToIco(png); if (buf) { writeFileSync(ico, buf); made.push(f); }
    }
  } catch (e) { console.log('[synapsis] 图标：', e.message); }
  if (!made.length) return made;
  console.log('[synapsis] png → ico：', made.join(' '));
  if (made.some(f => f === '客户端.png') && tray) { _icon = null; tray.setImage(trayIcon()); }
  try { spawn('ie4uinit.exe', ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* 刷不了缓存就等它自己过期 */ }
  return made;
}
function watchIcons() {
  let t = null;
  try { mkdirSync(ICONS, { recursive: true }); watch(ICONS, () => { clearTimeout(t); t = setTimeout(syncIcons, 800); }); } catch { /* 没法盯就只在启动时转 */ }
}

// 托盘图标：优先用 <Synapsis>/_图标/客户端.png（core/tools/make_icon.py 从任意图片生成）；没有就代码画一个 32×32 的圆
let _icon = null;
function trayIcon() {
  if (_icon) return _icon;
  const file = join(ICONS, '客户端.png');
  if (existsSync(file)) { const im = nativeImage.createFromPath(file); if (!im.isEmpty()) return (_icon = im); }
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
  launcherFor(HOME); // Synapsis 根目录的两个快捷方式，没有就补
  syncIcons(); watchIcons();
  tray = new Tray(trayIcon());
  tray.setToolTip('Synapsis');
  tray.on('click', showLauncher);
  refreshTray();
  const ws = wsArg(process.argv);
  if (ws) await openWorkspace(ws); else showLauncher();
});
