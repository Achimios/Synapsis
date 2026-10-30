// >v<✅自检-look-cli look 截图 + 量问题（不用先起服务，look 自己起）：node test/look.test.mjs
//   临时工作区留在系统临时目录（不删：删除一律走回收站，临时目录交给系统清）
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline } from '../../core/workspace.js';
import { runBatch } from '../../core/cli.js';
import { look, lookReport } from '../look.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

const ws = mkdtempSync(join(tmpdir(), 'syn-look-'));
mkdirSync(join(ws, '.synapsis'), { recursive: true });
writeFileSync(join(ws, '.synapsis', 'ai.json'), JSON.stringify({ url: 'http://127.0.0.1:9/v1', offline: true }));
saveOutline(ws, '甲 -> 乙\n乙\n丙\n镜头\n  入画\n  近景');
runBatch(ws, [['set', '镜头', 'timeline=true'], ['set', '镜头/入画', 't0=0', 't1=2'], ['set', '镜头/近景', 't0=2', 't1=4', 'track=1'], ['set', '乙', 'code=core/a_very_long_path/that/does/not/fit/on/one/card/line.js#someFunction']]);
// 丙和甲叠在一起（只差 10px），乙离得远
const layout = { 甲: { x: 0, y: 0 }, 乙: { x: 600, y: 0 }, 丙: { x: 10, y: 10 }, 镜头: { x: 0, y: 400 } };
writeFileSync(join(ws, '__synapsis', '_layout.json'), JSON.stringify(layout));
// 人上次停在「镜头」页：look 不能被 view.json 里记的页带偏
writeFileSync(join(ws, '.synapsis', 'view.json'), JSON.stringify({ scope: '镜头', viewports: { '': { x: 5000, y: 5000, zoom: 0.2 } } }));
const before = readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8'), viewBefore = readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8');

const t = Date.now();
const r = await look(ws, '');
console.log(lookReport(r, ''));
ok(existsSync(r.file) && statSync(r.file).size > 5000, '截图存在 ' + r.file);
ok(r.file.includes(join('.synapsis', 'look')), '图在 .synapsis/look/');
ok(r.cards.length === 4 && r.edges === 1, '4 张卡 1 条线 ' + r.cards.length + '/' + r.edges);
ok(r.overlaps.length === 1 && [r.overlaps[0].a, r.overlaps[0].b].sort().join() === '丙,甲', '量出甲丙互相盖住 ' + JSON.stringify(r.overlaps));
ok(!r.errors.length, '没有页面报错 ' + r.errors.join(' | '));
ok(/盖住：.*甲/.test(lookReport(r, '')), '报告里写了盖住');
ok(r.clipped.length === 1 && r.clipped[0].id === '乙' && r.clipped[0].what === '属性', '量出乙的属性被截 ' + JSON.stringify(r.clipped));

const tl = await look(ws, '镜头');
console.log(lookReport(tl, '镜头'));
ok(tl.timeline && tl.clips === 2, '时间轴页默认截时间轴，2 段 ' + tl.clips);
const cv = await look(ws, '镜头', { canvas: true });
ok(!cv.timeline && cv.cards.length === 2 && cv.file.endsWith('镜头.canvas.png'), '--canvas 截画布排布');
ok(cv.overlaps.length === 0, '时间轴页的画布按时间排开，不重叠');

ok(readFileSync(join(ws, '__synapsis', '_layout.json'), 'utf8') === before, '只读：_layout.json 没被改');
ok(readFileSync(join(ws, '.synapsis', 'view.json'), 'utf8') === viewBefore, '只读：view.json 没被改');
console.log(`look：${pass} 过，${fail} 挂（${((Date.now() - t) / 1000).toFixed(1)} 秒）`);
process.exit(fail ? 1 : 0);
