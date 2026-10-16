// >v<🤖AI指令-语音-👤 2026-10-12：内置 AI（在线宽松版）可以自己决定发语音。人在指令框右上角 📢 开关；关着时提示词里一个字都不提。
//   不给它命令行：它只在 JSON 里写 "voice": {"text": …}，服务端按人选的 TTS 文件夹 / 角色 / 后端去调（一次最多一条、限长）。
// 👤 2026-10-16 Synapsis 只是 TTS 的调用端，项目要干净、层级要清楚：TTS 的数据（角色、情绪、简介、口吻 persona）每次从
//   <TTS 文件夹>/bridge/roles.json 现读，Synapsis 不存任何副本、不约束它的格式（字段变了这边适配）；读不到 = 语音停用，提示人去找文件夹。
//   persona 是可选口吻：闲聊、玩梗时才用，严肃讨论别用；description 比 persona 优先。
//   Synapsis 只记人的三个选择：settings.yaml 的 voice 段 {tts: 文件夹, role, backend}
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSettings, saveSettings } from './settings.js';
import { spawn } from 'node:child_process';

export const VOICE_MAX = 120; // 一条语音最多多少字
export const TTS_SCRIPT = 'tts_v1.py';
const CFG0 = { tts: '', role: 'hastings', backend: '' }; // backend '' = 自动（不发 pref）

// TTS 的角色表（上游的数据，原样用；只认得出数组和 name）。读不到 = null
export function loadCatalog(ttsDir) {
  if (!ttsDir) return null;
  try {
    const j = JSON.parse(readFileSync(join(ttsDir, 'bridge', 'roles.json'), 'utf8'));
    const list = Array.isArray(j?.roles) ? j.roles.filter(r => r && typeof r.name === 'string') : null;
    return list?.length ? list : null;
  } catch { return null; }
}

// 人的选择 + TTS 现读的数据 → 这次能不能说、怎么说
export function resolveVoice(cfg, catalog) {
  const me = catalog?.find(r => r.name === cfg.role);
  const error = !cfg.tts ? '还没指定 TTS 文件夹：点「寻找 TTS 文件夹位置」'
    : !catalog ? `找不到 TTS 的角色表（${cfg.tts}/bridge/roles.json）：点「寻找 TTS 文件夹位置」重新选`
    : !me ? `TTS 里没有角色「${cfg.role}」了：在下拉里重新选一个` : '';
  const arr = x => Array.isArray(x) ? x.map(String) : [];
  return { ...cfg, script: cfg.tts ? join(cfg.tts, TTS_SCRIPT) : '', ok: !error, error, roles: catalog ? catalog.map(r => r.name) : [], moods: arr(me?.moods), backends: arr(me?.backends), desc: String(me?.description || ''), persona: String(me?.persona || '').trim() };
}

// 人的三个选择存在 Synapsis 的设置里（settings.yaml 的 voice 段，👤 2026-10-16），没有单独的语音文件
export function loadVoiceCfg(home) {
  const v = loadSettings(home).voice || {};
  return { ...CFG0, ...Object.fromEntries(['tts', 'role', 'backend'].map(k => [k, v[k] == null ? CFG0[k] : String(v[k])])) };
}
export function saveVoiceCfg(home, patch) {
  const next = {};
  for (const k of ['tts', 'role', 'backend']) if (patch && k in patch) next[k] = String(patch[k] ?? '').trim();
  if (next.tts) next.tts = next.tts.replace(/\\/g, '/').replace(/\/+$/, '').replace(new RegExp('/' + TTS_SCRIPT.replace('.', '\\.') + '$', 'i'), ''); // 选到了脚本本身也认；路径统一正斜杠
  if (Object.keys(next).length) saveSettings(home, { voice: next });
  return loadVoice(home);
}
export function loadVoice(home) {
  const cfg = loadVoiceCfg(home);
  return resolveVoice(cfg, loadCatalog(cfg.tts));
}

// 📢 开着、且能说时追加到在线版提示词的几行（短）。角色是人选的，模型不换；情绪只列这个角色在 TTS 里有的
export const voicePrompt = v => {
  const moods = v.moods || [];
  return `

【语音】人开了语音：你可以在 JSON 里加 "voice": {"text": "一句话"${moods.length ? `, "mood": "${moods.join(' | ')}"` : ''}}，会用 TTS 念给人听；整句不是中文时加 "lang"（en / ja / de / fr…，德语法语这类一定要写）。
- 自己决定要不要说：有梗、有情绪、值得说出口才说，大多数回合不用说；一次最多一句，${VOICE_MAX} 字以内；别念代码、路径、长列表；数字写成中文。${moods.length ? `
- mood 只能从上面这几个里挑，不写 = ${moods[0]}。` : ''}${v.desc ? `
- 念的声音：${v.desc}` : ''}${v.persona ? `
- 可选口吻（不是必须）：闲聊、玩梗的时候可以用这种口吻说话，严肃讨论时别用，别硬套：
${v.persona}` : ''}`;
};

// 念出来：起 <TTS 文件夹>/tts_v1.py，stdin 喂一行 JSON（不经过 shell，中文直接 UTF-8）。不等播完
export function speak(v, voice, id) {
  if (!v.ok) return { ok: false, why: v.error };
  const text = String(voice?.text || '').trim().slice(0, VOICE_MAX);
  if (!text) return { ok: false, why: '没有内容' };
  if (!existsSync(v.script)) return { ok: false, why: `TTS 文件夹里没有 ${TTS_SCRIPT}：点「寻找 TTS 文件夹位置」重新选` };
  const lang = /^[a-z]{2}$/.test(voice.lang || '') ? voice.lang : ''; // 模型说了是哪种语言就发，不然 TTS 自己猜
  const job = { id: 'syn-' + (id || Date.now().toString(36)), role: v.role, text, ...(v.moods.includes(voice.mood) ? { mood: voice.mood } : {}), ...(v.backend ? { pref: v.backend } : {}), ...(lang ? { lang } : {}) };
  try {
    const p = spawn(process.env.SYN_PYTHON || 'python', [v.script, '--stdin'], { stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, PYTHONUTF8: '1' }, windowsHide: true });
    p.on('error', () => {});
    p.stdin.end(JSON.stringify(job), 'utf8');
  } catch (e) { return { ok: false, why: e.message }; }
  return { ok: true, role: v.role, text, job };
}
