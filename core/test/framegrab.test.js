// 截帧：视频某个时刻 → 节点的 _pics_ + 同名说明。node core/test/framegrab.test.js（没有 ffmpeg 就跳过）
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { saveOutline, loadWorkspace, sideOf } from '../workspace.js';
import { findFfmpeg, grabFrame } from '../framegrab.js';
import { runWrite } from '../cli.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const ff = findFfmpeg();
if (!ff) { console.log('framegrab: 没有 ffmpeg，跳过'); process.exit(0); }
const root = mkdtempSync(join(tmpdir(), 'syn-frame-'));
saveOutline(root, '素材库\n  爆炸');
// 自己造一段 3 秒的测试视频（彩条），不碰真素材
spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=160x90:rate=24', '-pix_fmt', 'yuv420p', join(root, '样片.mp4')]);
ok(existsSync(join(root, '样片.mp4')), '造了测试视频');

const p = grabFrame(root, '素材库/爆炸', '样片.mp4', '1.5', { ffmpeg: ff });
ok(/^素材库\/_pics_爆炸\/\d{4}-\d{2}-\d{2}_截帧_样片@1\.50s\.jpg$/.test(p), '存进节点的 _pics_，名字 = 日期_截帧_视频名@时间 ' + p);
const img = readFileSync(join(root, '__synapsis', p));
ok(img[0] === 0xff && img[1] === 0xd8, '是 jpg');
const note = readFileSync(join(root, '__synapsis', sideOf(p)), 'utf8');
ok(note.includes('来源：样片.mp4') && note.includes('src_t：1.5'), '说明记了来源和 src_t ' + note);
ok(loadWorkspace(root).graph.nodes.get('素材库/爆炸').pics.length === 1, '节点看得到这张图（说明 .md 不算图）');
grabFrame(root, '素材库/爆炸', join(root, '样片.mp4'), '0:2.5', { ffmpeg: ff });
const p2 = readdirSync(join(root, '__synapsis', '素材库', '_pics_爆炸')).find(f => f.includes('@2.50s.jpg'));
ok(!!p2, '绝对路径 + 分:秒 也行 ' + readdirSync(join(root, '__synapsis', '素材库', '_pics_爆炸')));
let e = ''; try { grabFrame(root, '素材库/爆炸', '样片.mp4', '99', { ffmpeg: ff }); } catch (x) { e = x.message; }
ok(/截帧失败/.test(e), '超出视频长度 → 报错 ' + e);
e = ''; try { grabFrame(root, '素材库/爆炸', '没有.mp4', '1', { ffmpeg: ff }); } catch (x) { e = x.message; }
ok(/没有这个视频/.test(e), '视频不存在 → 报错');
e = ''; try { grabFrame(root, '素材库/爆炸', '样片.mp4', 'abc', { ffmpeg: ff }); } catch (x) { e = x.message; }
ok(/时间要写/.test(e), '时间不是数 → 报错');
ok(/已截帧/.test(runWrite(root, 'frame', ['素材库/爆炸', '样片.mp4', '0.5'])), 'CLI frame');

rmSync(root, { recursive: true, force: true });
console.log(`framegrab: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
