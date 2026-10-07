// >v<✅自检-桌面-Playwright 驱动 Electron（窗口隐藏）：--ws 直接开工作区、启动台、最近列表、托盘、未初始化的文件夹自动挂上
// node test/desktop.test.js（不需要先起 dev，主进程自己起；5410 被占则复用）
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { saveOutline } from '../../core/workspace.js';
import { SAMPLE } from '../src/sample.js';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const sleep = t => new Promise(r => setTimeout(r, t));
const tmp = mkdtempSync(join(tmpdir(), 'syn-desk-'));
const ws = join(tmp, '工作区 一'); mkdirSync(ws); saveOutline(ws, SAMPLE);
const fresh = join(tmp, '还没挂上'); mkdirSync(fresh);
const env = { ...process.env, SYN_TEST_HIDDEN: '1', SYN_RECENT: join(tmp, 'recent.json') };

try {
  // 1) --ws：直接开工作区窗口
  let eapp = await electron.launch({ executablePath: EXE, args: [join(APP, 'electron', 'main.mjs'), '--ws', ws], env });
  let win = await eapp.firstWindow();
  await win.waitForSelector('.save', { timeout: 20000 }); await sleep(1500);
  ok(win.url().includes('?ws=') && (await win.$eval('.save', e => e.innerText)).includes('已加载'), '--ws 打开工作区窗口 ' + win.url());
  ok((await win.$$('.card')).length === 3, '工作区画布有 3 个顶层节点');
  ok(await eapp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()) === 'Synapsis — 工作区 一', '窗口标题 = 工作区名');
  const recent = JSON.parse(readFileSync(join(tmp, 'recent.json'), 'utf8'));
  ok(recent[0]?.dir === ws, '记进最近列表');
  // 界面缩放：Ctrl+= 放大（Electron 默认菜单只认 Ctrl+Shift+=，👤 2026-10-08），Ctrl+- 缩小，Ctrl+0 还原
  const zoomAfter = key => eapp.evaluate(async ({ BrowserWindow }, key) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
    await new Promise(r => setTimeout(r, 300));
    return wc.getZoomLevel();
  }, key);
  const z1 = await zoomAfter('=');
  ok(z1 > 0, 'Ctrl+= 放大 ' + z1);
  const z2 = await zoomAfter('-');
  ok(z2 < z1, 'Ctrl+- 缩小 ' + z2);
  ok(await zoomAfter('0') === 0, 'Ctrl+0 还原');
  await eapp.close();

  // 2) 无参数：启动台；从启动台打开未初始化的文件夹 → 自动挂上（测试模式跳过确认框）
  eapp = await electron.launch({ executablePath: EXE, args: [join(APP, 'electron', 'main.mjs')], env });
  win = await eapp.firstWindow();
  await win.waitForLoadState('domcontentloaded'); await sleep(1500);
  ok(win.url().endsWith('/launcher.html'), '无参数 → 启动台 ' + win.url());
  ok(await win.evaluate(() => typeof window.synapsisDesktop?.recent === 'function'), '启动台拿到桌面接口（preload）');
  ok((await win.$$eval('.recent li', ls => ls.map(l => l.innerText))).some(t => t.includes('工作区 一')), '启动台列出最近打开');
  await win.evaluate(d => window.synapsisDesktop.open(d), fresh); await sleep(2500);
  ok(existsSync(join(fresh, '__synapsis')) && existsSync(join(fresh, 'Synapsis.vbs')), '打开未初始化的文件夹 → 自动 init');
  ok(await eapp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.getTitle() === 'Synapsis — 还没挂上')), '并打开它的窗口');
  await eapp.close();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`desktop: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
