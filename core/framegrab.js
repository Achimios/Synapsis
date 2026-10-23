// >v<🖼️图片-截帧-从视频某个时刻截一帧，存进节点的 _pics_（👤 2026-10-24：画布上插视频不一定要，更有用的是选一个时刻截一帧当节点图）
// 旁边同名 .md 记 来源视频 / src_t（素材时间，别和时间轴的 t0 / t1 成片时间混）/ 日期，和 AI 配图的说明是同一套（sideOf）。
// ffmpeg：环境变量 SYN_FFMPEG > PATH 里的 ffmpeg > Eidolon 虚拟环境里 imageio_ffmpeg 带的那个（Desktop/Vault_Automata/4_Eidolon/.venv）
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, isAbsolute, basename, extname, relative } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { saveAsset } from './workspace.js';
import { parseTime } from './timeline.js';

const EIDOLON_FFMPEG = join(homedir(), 'Desktop', 'Vault_Automata', '4_Eidolon', '.venv', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
export function findFfmpeg() {
  if (process.env.SYN_FFMPEG && existsSync(process.env.SYN_FFMPEG)) return process.env.SYN_FFMPEG;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  try { const f = readdirSync(EIDOLON_FFMPEG).find(x => /^ffmpeg.*\.exe$/i.test(x)); if (f) return join(EIDOLON_FFMPEG, f); } catch { /* 没有 */ }
  return null;
}
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const fmtSrcT = t => t.toFixed(2);

// video = 相对项目根的路径或绝对路径；t = 秒或 分:秒；返回存下的图（相对 __synapsis）
export function grabFrame(root, id, video, t, { ffmpeg = findFfmpeg(), about = '' } = {}) {
  if (!ffmpeg) throw new Error('找不到 ffmpeg：装一个放进 PATH，或设环境变量 SYN_FFMPEG（Eidolon 的虚拟环境里有一个：' + EIDOLON_FFMPEG + '）');
  const src = isAbsolute(video) ? video : join(root, video);
  if (!existsSync(src)) throw new Error('没有这个视频：' + video);
  const sec = parseTime(t);
  if (sec === null || !Number.isFinite(sec) || sec < 0) throw new Error('时间要写秒或 分:秒：' + t);
  const tmp = mkdtempSync(join(tmpdir(), 'syn-frame-')), out = join(tmp, 'f.jpg');
  try {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(sec), '-i', src, '-frames:v', '1', '-q:v', '2', '-y', out], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0 || !existsSync(out)) throw new Error('截帧失败（时间超出视频长度？）' + (r.stderr || r.error?.message || '').trim().slice(-300));
    const shown = isAbsolute(video) ? (relative(root, video).startsWith('..') ? video : relative(root, video)) : video;
    const name = `${localDate()}_截帧_${basename(video, extname(video))}@${fmtSrcT(sec)}s`;
    const note = [`# 截帧：${basename(video)} @ ${fmtSrcT(sec)} 秒`, '', `- 来源：${shown.split('\\').join('/')}`, `- src_t：${Math.round(sec * 1000) / 1000}（素材时间，秒；不是时间轴上的 t0 / t1）`, `- 日期：${localDate()}`,
      ...(about ? ['', '## 描述', String(about).trim()] : []), ''].join('\n');
    return saveAsset(root, id, 'data:image/jpeg;base64,' + readFileSync(out).toString('base64'), { name, note });
  } finally { rmSync(tmp, { recursive: true, force: true }); } // 自己这一步刚生成的临时文件
}
