// 时间轴页（timeline: true，子节点 t0 / t1 / track）：timelineInfo / check / 吸附 / CLI timeline --json。node core/test/timeline.test.js
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, loadWorkspace, checkWorkspace, setNodeMeta, setNodeBody, addRefNode } from '../workspace.js';
import { isTimeline, parseTime, timelineInfo, parseBeats, snapTime } from '../timeline.js';
import { timeline } from '../cli.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

// 纯函数
ok(isTimeline({ timeline: 'true' }) && !isTimeline({ timeline: 'false' }) && !isTimeline({}), 'timeline: true 才算');
ok(parseTime('1.25') === 1.25 && parseTime('1:02.5') === 62.5 && parseTime('') === null && Number.isNaN(parseTime('abc')), 'parseTime：秒 / 分:秒 / 空 / 非数');
ok(snapTime(1.18, [0.36, 1.16, 1.54], 0.1) === 1.16, '吸附到最近的拍');
ok(snapTime(1.3, [0.36, 1.16, 1.54], 0.1) === 1.3, '离拍太远不吸');
ok(Math.abs(snapTime(1.13, [1.16], 0.1, 2 / 24) - (1.16 - 2 / 24)) < 1e-9, '提前 2 帧（24fps）');
const b = parseBeats({ fps: 24, events: { beats: [0.36, 0.74], downbeats: [0.36], phrases: [0.36], onsets: [0.35] } });
ok(b && b.fps === 24 && b.beats.length === 2 && b.downbeats[0] === 0.36, 'parseBeats 读 感官.json 的 events');
ok(parseBeats({}) === null, '格式不认识 → null');

// 工作区
const root = mkdtempSync(join(tmpdir(), 'syn-tl-'));
saveOutline(root, '素材库\n  爆炸\n镜头3\n  入画\n  第三\n  半写\n  坏的\n  叠上\n  没时间');
setNodeMeta(root, '镜头3', { timeline: 'true', beats: '感官.json' });
setNodeMeta(root, '镜头3/入画', { t0: '1.2', t1: '3.4804' });
setNodeMeta(root, '镜头3/第三', { t0: '5', t1: '6', track: '1' });
setNodeMeta(root, '镜头3/半写', { t0: '2' });
setNodeMeta(root, '镜头3/坏的', { t0: '4', t1: '3' });
setNodeMeta(root, '镜头3/叠上', { t0: '3', t1: '4' });
setNodeBody(root, '镜头3/入画', '人物从左入画，慢推');
writeFileSync(join(root, '感官.json'), JSON.stringify({ fps: 24, events: { beats: [0.36, 1.16], downbeats: [0.36], phrases: [0.36] } }));
mkdirSync(join(root, '__synapsis', '素材库', '_pics_爆炸'), { recursive: true });
writeFileSync(join(root, '__synapsis', '素材库', '_pics_爆炸', 'a.jpg'), 'x');
const ref = addRefNode(root, '镜头3', '素材库/爆炸');
setNodeMeta(root, ref.id, { t0: '6.5', t1: '7' });

let ws = loadWorkspace(root);
const meta = id => ws.graph.nodes.get(id)?.meta;
const info = timelineInfo(ws.graph, '镜头3', meta);
ok(info && info.items.map(i => i.label).join(',') === '入画,叠上,坏的,第三,↗ 爆炸', '按 t0 排 ' + info?.items.map(i => i.label));
ok(info.loose.map(id => ws.graph.nodes.get(id).label).sort().join(',') === '半写,没时间', '没写全的不上轴');
ok(timelineInfo(ws.graph, '素材库', meta) === null, '不是时间轴页 → null');

const iss = checkWorkspace(ws).filter(i => i.msg.startsWith('时间轴'));
ok(iss.some(i => i.where === '镜头3/半写' && /只写了一个/.test(i.msg)), 'check：只写了一个 ' + JSON.stringify(iss));
ok(iss.some(i => i.where === '镜头3/坏的' && /不小于/.test(i.msg)), 'check：t0 ≥ t1');
ok(iss.some(i => i.where === '镜头3/叠上' && /重叠/.test(i.msg)), 'check：同轨重叠（入画 1.2–3.48 和 叠上 3–4）');
ok(!iss.some(i => i.where === '镜头3/第三'), '另一条轨不算重叠');
ok(iss.every(i => i.level === 'warn'), '都只是警告');
ok(!checkWorkspace(ws).some(i => i.where.startsWith('镜头3/') && i.msg === '没有 status'), '时间轴上的条不是待办，不报「没有 status」');
ok(checkWorkspace(ws).some(i => i.where === '素材库/爆炸' && i.msg === '没有 status'), '别的页照旧报');

// CLI 导出
const r = timeline(ws, '镜头3').data;
ok(r.page === '镜头3' && r.unit === 's' && r.fps === 24 && r.beats === '感官.json', 'fps 没写 → 读 beats 那份 ' + JSON.stringify({ ...r, items: r.items.length }));
const it = r.items[0];
ok(it.id === '镜头3/入画' && it.t0 === 1.2 && it.t1 === 3.48 && it.track === 0 && it.body === '人物从左入画，慢推' && it.ref === null, '条目字段 ' + JSON.stringify(it));
const rc = r.items.find(i => i.ref);
ok(rc && rc.ref === '素材库/爆炸' && rc.pics.length === 1 && rc.pics[0].endsWith('/__synapsis/素材库/_pics_爆炸/a.jpg') && !rc.pics[0].includes('\\'), '传送门卡没图 → 用目标的图（绝对路径、正斜杠） ' + JSON.stringify(rc));
setNodeMeta(root, '镜头3', { fps: '25' }); ws = loadWorkspace(root);
ok(timeline(ws, '镜头3').data.fps === 25, '页面写了 fps 就用页面的');
ok(timeline(ws, '素材库').error && timeline(ws, '没有').error, '不是时间轴页 / 没这个节点 → 报错');
const all = timeline(ws).data;
ok(all.length === 1 && all[0].page === '镜头3' && all[0].items === 5, '不带页 id → 列出时间轴页 ' + JSON.stringify(all));
ok(/1\.200–3\.480  轨0  入画/.test(timeline(ws, '镜头3').text) && /没上轴/.test(timeline(ws, '镜头3').text), '文本版 ' + timeline(ws, '镜头3').text);

rmSync(root, { recursive: true, force: true });
console.log(`timeline: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
