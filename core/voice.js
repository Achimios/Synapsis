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

export const VOICE_MAX = 150; // 一条语音最多多少字（👤 2026-10-16 120 时常被截在半句上）
// 念之前去掉 Markdown（** ` # 列表符号 [文字](链接) 这些火山会照念）；~ 和 ___ 留着（TTS 的写台词技巧：拖尾 / 停顿有用）
export function plainVoice(t) {
  return String(t || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`+/g, '')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[，。！？,.!?])/g, '$1$2')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)、]\s+)/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}
// 超长的在句子边界截（。！？!?~…），不从半句中间断；实在没有句号才硬截
export function clipVoice(t, max = VOICE_MAX) {
  t = String(t || '').trim(); if (t.length <= max) return t;
  const cut = t.slice(0, max), k = Math.max(...['。', '！', '？', '!', '?', '~', '…', '. '].map(p => cut.lastIndexOf(p)));
  return k >= max * 0.4 ? cut.slice(0, k + 1).trim() : cut;
}
// 📢 开着、模型没写 voice、「」里也捞不到台词 → 念回答开头一两句（👤 2026-10-16「强制都发语音没有坏处」；不再多调一次模型，不花钱不变慢）
export function autoVoice(say) {
  const t = plainVoice(say); if (!t) return null;
  const m = t.match(/^.*?[。！？!?](.*?[。！？!?])?/);
  return { text: clipVoice(m ? m[0] : t) };
}
// 📢 开着、模型却没写 voice 字段，但嘴上说了「语音来了 / 念给你」并把台词写在「」里 → 把那段拿出来念（👤 2026-10-16 实测 8 轮里 5 轮这样）
export function rescueVoice(say) {
  const s = String(say || '');
  if (!/语音|念给|念出来|说给你听|开口/.test(s)) return null;
  const m = /「([^「」]{4,})」/.exec(s);
  return m ? { text: m[1] } : null;
}
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
  return { ...cfg, script: cfg.tts ? join(cfg.tts, TTS_SCRIPT) : '', ok: !error, error, catalog: catalog || [], roles: catalog ? catalog.map(r => r.name) : [], moods: arr(me?.moods), backends: arr(me?.backends), desc: String(me?.description || ''), persona: String(me?.persona || '').trim() };
}
// 角色表里某个角色（模型点名的）；没有 = null
const roleOf = (v, name) => (v.catalog || []).find(r => r.name === name) || null;
const arrOf = x => Array.isArray(x) ? x.map(String) : [];
// look {"persona": "角色名"}：借别的角色的口吻时，模型按需翻（每次从角色表现读）
export function personaOf(v, name) {
  const r = roleOf(v, String(name || '')) ;
  return r ? (String(r.persona || '').trim() || `（${r.name} 没有写口吻）`) : `（TTS 里没有角色「${name}」；可选：${(v.roles || []).join('、')}）`;
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

// 📢 开着、且能说时追加到在线版提示词的几行。👤 2026-10-16：下拉选的都只是「优先」——人在聊天里说换角色 / 后端 / 借谁的口吻，模型照做。
//   角色清单（名字 + 简介 + 情绪 + 后端）每次从角色表现读全列（10 个左右，一行一个）；口吻默认给优先角色的，别人的 look {"persona": 名} 按需翻
export const voicePrompt = v => {
  const brief = d => { const t = String(d || '').trim(); const k = t.search(/[，。；;,]/); return (k > 0 && k <= 24 ? t.slice(0, k) : t.slice(0, 24)) || '—'; }; // 简介只留半句，省 token
  const line = r => `${r.name}${r.name === v.role ? '（默认）' : ''}：${brief(r.description)}${arrOf(r.moods).length ? `（mood：${arrOf(r.moods).join('/')}）` : ''}`;
  return `

【语音】开了喇叭：输出 {"say": …, "actions": […], "voice": {"text": "要念的话"}}，voice 每轮必填（只有它会被念，say 里的人听不到）；没什么可说就一句短话。
- 纯文本，不用 Markdown；${VOICE_MAX} 字以内；不念代码、路径、列表；数字写中文。闲聊说台词，技术问题一两句口头总结。
- 可选：role 换声音、mood（只用该角色列出的）、lang（整句非中文时写）、pref 换后端、fx 音效。人点名就照做。
- 声音：${(v.catalog || []).map(line).join('；')}
- 口吻和声音分开：${v.persona ? `默认 ${v.role} 的口吻（见下）` : '默认无特别口吻'}，借别人的 look {"persona": "名字"}；只在闲聊玩梗时用。细节（后端、音效、标点节奏）look {"tts": "__TTS_调用方法(简洁).md"}。${v.persona ? `
${v.role} 的口吻：
${v.persona}` : ''}`;
};
// 选了 TTS 但人没开 📢：一句话，免得模型嘴上说「我发语音了」
export const voiceOffPrompt = `

【语音】人没开语音（指令框右上角 🔇 / 📢）。人要你说话时，提醒他点开 📢；别说你已经发了语音。`;

// 念出来：起 <TTS 文件夹>/tts_v1.py，stdin 喂一行 JSON（不经过 shell，中文直接 UTF-8）。不等播完
export function speak(v, voice, id) {
  if (!v.ok) return { ok: false, why: v.error };
  const text = clipVoice(plainVoice(voice?.text));
  if (!text) return { ok: false, why: '没有内容' };
  if (!existsSync(v.script)) return { ok: false, why: `TTS 文件夹里没有 ${TTS_SCRIPT}：点「寻找 TTS 文件夹位置」重新选` };
  const lang = /^[a-z]{2}$/.test(voice.lang || '') ? voice.lang : ''; // 模型说了是哪种语言就发，不然 TTS 自己猜
  // 这一句实际用谁：模型点名、且在角色表里 → 用它；不然用优先角色。情绪、后端都按实际用的那个角色查
  const who = roleOf(v, voice.role) || roleOf(v, v.role), role = who?.name || v.role, backs = arrOf(who?.backends);
  const pref = backs.includes(voice.pref) ? voice.pref : backs.includes(v.backend) ? v.backend : ''; // 模型写的后端要这个角色有；不然用优先后端（这个角色没有就让 TTS 自己选）
  const fx = typeof voice.fx === 'string' && voice.fx.trim().length <= 40 ? voice.fx.trim() : ''; // 音效预设名（对讲机 / 空房间…，+ 串联），TTS 认不出会自己忽略
  const job = { id: 'syn-' + (id || Date.now().toString(36)), role, text, ...(fx ? { fx } : {}), ...(arrOf(who?.moods).includes(voice.mood) ? { mood: voice.mood } : {}), ...(pref ? { pref } : {}), ...(lang ? { lang } : {}) };
  try {
    const p = spawn(process.env.SYN_PYTHON || 'python', [v.script, '--stdin'], { stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, PYTHONUTF8: '1' }, windowsHide: true });
    p.on('error', () => {});
    p.stdin.end(JSON.stringify(job), 'utf8');
  } catch (e) { return { ok: false, why: e.message }; }
  return { ok: true, role, text, job };
}
