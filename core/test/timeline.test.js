// 时间轴页（timeline: true，子节点 t0 / t1 / track）：timelineInfo / check / 吸附 / CLI timeline --json。node core/test/timeline.test.js
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, loadWorkspace, checkWorkspace, setNodeMeta, setNodeBody, addRefNode } from '../workspace.js';
import { isTimeline, parseTime, timelineInfo, parseBeats, snapTime, tlCardEdges } from '../timeline.js';
import { projectView } from '../outline.js';
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
const runSet = l => l.forEach(([id, m]) => setNodeMeta(root, id, m));
const ref = addRefNode(root, '镜头3', '素材库/爆炸');
setNodeMeta(root, ref.id, { t0: '6.5', t1: '7', speed: '0.5' });
setNodeMeta(root, '素材库/爆炸', { src: '样片:粒子海/20_a.mp4@1.2', speed: '2' });
setNodeMeta(root, '镜头3/第三', { src: '原片@0:52.5' });

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
ok(!('src' in it) && !('speed' in it), '没写 src / speed 就不带这两个键');
ok(r.items.find(i => i.label === '第三').src === '原片@0:52.5', '节点自己的 src');
ok(rc.src === '样片:粒子海/20_a.mp4@1.2' && rc.speed === '0.5', '传送门卡：src 继承目标，speed 用卡自己的 ' + JSON.stringify(rc));
setNodeMeta(root, '镜头3', { fps: '25' }); ws = loadWorkspace(root);
ok(timeline(ws, '镜头3').data.fps === 25, '页面写了 fps 就用页面的');
ok(timeline(ws, '素材库').error && timeline(ws, '没有').error, '不是时间轴页 / 没这个节点 → 报错');
const all = timeline(ws).data;
ok(all.length === 1 && all[0].page === '镜头3' && all[0].items === 5, '不带页 id → 列出时间轴页 ' + JSON.stringify(all));
ok(/1\.200–3\.480  轨0  入画/.test(timeline(ws, '镜头3').text) && /没上轴/.test(timeline(ws, '镜头3').text), '文本版 ' + timeline(ws, '镜头3').text);

// 段落嵌套（👤 2026-10-24 定 A）：剪辑 → 段落（也是时间轴页）→ 镜头；段落时间 = 里面镜头的最早 ~ 最晚，自己写的不算
saveOutline(root, '参考图 -> 剪辑\n剪辑\n  段一\n    镜1 -> 参考图\n    镜2 -> 参考图, 镜1\n  段二\n    镜3 -> 参考图\n  空段\n    没时间 -> 参考图');
runSet([['剪辑', { timeline: 'true', fps: '24', beats: '感官.json', lead: '1' }], ['剪辑/段一', { timeline: 'true', t0: '99', t1: '100' }], ['剪辑/段二', { timeline: 'true', track: '1' }], ['剪辑/空段', { timeline: 'true' }],
  ['剪辑/段一/镜1', { t0: '0', t1: '2' }], ['剪辑/段一/镜2', { t0: '2', t1: '5.5' }], ['剪辑/段二/镜3', { t0: '6', t1: '8' }]]);
ws = loadWorkspace(root);
const m2 = id => ws.graph.nodes.get(id)?.meta;
const top = timelineInfo(ws.graph, '剪辑', m2);
ok(top.items.map(i => `${i.label} ${i.t0}-${i.t1} 轨${i.track}${i.group ? ' 段' : ''}`).join(' | ') === '段一 0-5.5 轨0 段 | 段二 6-8 轨1 段', '段落时间自动算、自己写的 99-100 不算 ' + top.items.map(i => i.label + i.t0 + '-' + i.t1));
ok(top.items[0].leaves.join() === '剪辑/段一/镜1,剪辑/段一/镜2', '段落带 leaves（拖段落 = 它们一起挪）');
ok(top.loose.includes('剪辑/空段'), '里面一段都没上轴的段落 = 没上轴');
const sub = timelineInfo(ws.graph, '剪辑/段一', m2);
ok(sub.fps === 24 && sub.beats === '感官.json' && sub.lead === '1', '段落页没写 fps / beats / lead → 跟上级时间轴页 ' + JSON.stringify([sub.fps, sub.beats, sub.lead]));
const ci = checkWorkspace(ws).filter(i => i.msg.startsWith('时间轴') && i.where.startsWith('剪辑'));
ok(ci.some(i => i.where === '剪辑/段一' && i.level === 'info' && /自动算/.test(i.msg)) && !ci.some(i => i.where === '剪辑/段二'), 'check：段落自己写了 t0 / t1 → 提示不算（info） ' + JSON.stringify(ci));
const ex = timeline(ws, '剪辑').data.items;
ok(ex[0].group === true && ex[0].t0 === 0 && ex[0].t1 === 5.5 && !('group' in timeline(ws, '剪辑/段一').data.items[0]), '导出：段落带 group: true、时间自动算；镜头不带 group');

// 时间轴卡的连线：镜头 → 参考 的线落在卡里那段条上
const v = projectView(ws.graph, '', new Set());
const io = id => timelineInfo(ws.graph, id, m2);
const ed = o => tlCardEdges(ws.graph, v, ['剪辑'], io, o).edges.map(e => `${e.from}${e.fromH ? '#' + e.fromH : ''}→${e.to}${e.toH ? '#' + e.toH : ''}×${e.count}`).sort().join(' | ');
ok(ed({}) === '剪辑#剪辑/段一→参考图×2 | 剪辑#剪辑/段二→参考图×1 | 剪辑→参考图×1 | 参考图→剪辑×1', '段落没展开：镜头的线落在段落条上（同段聚合），没上轴的落在卡上，卡自己的线照旧 ' + ed({}));
ok(ed({ 剪辑: ['剪辑/段一'] }) === '剪辑#剪辑/段一/镜1→参考图×1 | 剪辑#剪辑/段一/镜2→参考图×1 | 剪辑#剪辑/段二→参考图×1 | 剪辑→参考图×1 | 参考图→剪辑×1', '展开段一：落在各自的镜头条上；卡里面互相连的（镜2→镜1）不画 ' + ed({ 剪辑: ['剪辑/段一'] }));
ok(tlCardEdges(ws.graph, v, [], io).edges === v.edges, '没有卡 = 原样');

rmSync(root, { recursive: true, force: true });
console.log(`timeline: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
