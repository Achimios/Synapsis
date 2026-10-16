// >v<🤖AI指令-语音-👤 2026-10-12：内置 AI（在线宽松版）可以自己决定发语音。人在指令框右上角 📢 开关；关着时提示词里一个字都不提。
//   不给它命令行：它只在 JSON 里写 "voice": {"text": …}，服务端按这份 md 里的 TTS 路径 / 角色 / 后端去调（一次最多一条、限长）。
//   设置 + 人格在 Synapsis 目录的 .synapsis/语音.md（本机、不进 git，人在指令框「🔊 语音」页改）：
//   短人格每次都进提示词；长人格模型想细看时 look {"voice": "人格"} 自己翻
//   👤 2026-10-16 分工：人只选「角色」和「后端」（下拉，按 TTS 的 bridge/roles.json 生成）；情绪由模型挑，但只能挑这个角色真有的（没有就不提）；
//   语种模型显式发 lang 或让 TTS 自动猜。roles.json 读不到 → 退回 md 里手写的「可用声线」+ 六种情绪
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

export const voiceFile = home => join(home, '.synapsis', '语音.md');
export const VOICE_MAX = 120; // 一条语音最多多少字
export const BACKENDS = ['volc', 'edge', 'qwenf', 'qwenp']; // TTS 的 pref；「自动」= 不发 pref（TTS 默认火山，失败自动降级）

export const DEFAULT_VOICE = `# 🔊 内置 AI 的语音（本机，不进 git）

指令框右上角 📢 打开后，AI 自己决定什么时候发一句语音（不是把回答全念出来）。只给 ☁ 在线模型。
角色、后端在上面下拉框选（列表来自 TTS 的 bridge/roles.json）；情绪由 AI 从这个角色有的情绪里挑；语言留空 = 自动识别。
改完点「保存」就生效。下面「设置」里每行「- 键: 值」；语气只对 qwen 后端有效（留着备用）。

## 设置
- TTS 脚本: C:/Users/Administrator/Desktop/Vault_Automata/1_TTS/tts_v1.py
- 声线: hastings
- 后端: 自动
- 可用声线: hastings, cortana, asuka, eva, elizabeth, victor, bt, emma, klara, robot
- 语气: 英式、慢条斯理、阴阳怪气
- 语言:

## 短人格
（每次都给模型，一两句）
你是 Shaun Hastings 那种嘴毒的英国历史学家：冷幽默、刻薄、爱纠正别人，嫌弃归嫌弃，活儿干得一丝不苟。

## 长人格
（模型想细看时自己翻；随便写）
- 说话：英式冷幽默，一本正经地挖苦；先损一句，再给真正有用的东西
- 口头习惯：喜欢「严格来说……」「我就不评价了，但是……」这类句式；对含糊的说法要较真
- 对人：嘴上嫌弃人笨手笨脚，其实一直在帮忙；夸人也要拐个弯
- 底线：损的是做法和说法，不人身攻击；人真遇到麻烦时收起嘴毒，认真帮
- 语音：一句话，短，有梗；别念长段说明，别念代码和路径
`;

// TTS 的六种情绪（roles.json 读不到时的兜底；读得到就按角色自己的 moods）
export const MOODS = ['usual', 'wistful', 'comfort', 'urgent', 'confident', 'curious'];
const MOOD_ZH = { usual: '日常', wistful: '伤感', comfort: '安慰平静', urgent: '急促', confident: '自信', curious: '好奇' };

// md → { tts, role, backend, roles, style, lang, short, long }
export function parseVoice(text) {
  const sec = {}; let cur = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = h[1]; sec[cur] = []; continue; }
    if (cur) sec[cur].push(line);
  }
  const body = k => (sec[k] || []).filter(l => !/^（.*）$/.test(l.trim())).join('\n').trim();
  const kv = {};
  for (const l of sec['设置'] || []) { const m = /^\s*-\s*([^:：]+)[:：]\s*(.*)$/.exec(l); if (m) kv[m[1].trim()] = m[2].trim(); }
  const role = kv['声线'] || 'robot';
  const roles = (kv['可用声线'] || role).split(/[,，、\s]+/).filter(Boolean);
  const backend = BACKENDS.includes(kv['后端']) ? kv['后端'] : '';
  return { tts: kv['TTS 脚本'] || kv['TTS脚本'] || '', role, backend, roles: roles.includes(role) ? roles : [role, ...roles], style: kv['语气'] || '', lang: kv['语言'] || '', short: body('短人格'), long: body('长人格') };
}

// TTS 自动生成的角色表：<tts_v1.py 所在目录>/bridge/roles.json → [{name, backends, languages, moods, description}]；读不到 = null
export function loadCatalog(tts) {
  if (!tts) return null;
  try {
    const j = JSON.parse(readFileSync(join(dirname(tts), 'bridge', 'roles.json'), 'utf8'));
    const list = Array.isArray(j?.roles) ? j.roles.filter(r => r && typeof r.name === 'string') : null;
    return list?.length ? list.map(r => ({ name: r.name, backends: Array.isArray(r.backends) ? r.backends : [], languages: Array.isArray(r.languages) ? r.languages : [], moods: Array.isArray(r.moods) ? r.moods : [], description: String(r.description || '') })) : null;
  } catch { return null; }
}

// 设置 + 角色表合起来：moods = 这个角色能用的情绪（[] = 不提），desc = 角色简介
export function withCatalog(v, catalog = loadCatalog(v.tts)) {
  const me = catalog?.find(r => r.name === v.role);
  return { ...v, catalog, roles: catalog ? catalog.map(r => r.name) : v.roles, moods: catalog ? (me?.moods || []) : MOODS, desc: me?.description || '', backends: catalog ? (me?.backends || []) : BACKENDS };
}

export function loadVoice(home) {
  const f = voiceFile(home);
  let text = DEFAULT_VOICE;
  try { if (existsSync(f)) text = readFileSync(f, 'utf8'); } catch { /* 读不到 = 默认 */ }
  return withCatalog({ text, file: f, ...parseVoice(text) });
}
export function saveVoice(home, text) {
  const f = voiceFile(home);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, String(text || ''));
  return loadVoice(home);
}

// 改「设置」里的一行（下拉框选角色 / 后端用）：有就替换，没有就加在「## 设置」下面；其余原样
export function setVoiceLine(text, key, value) {
  const lines = String(text || '').split(/\r?\n/), eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const re = new RegExp('^\\s*-\\s*' + key + '\\s*[:：]');
  const i = lines.findIndex(l => re.test(l));
  if (i >= 0) lines[i] = `- ${key}: ${value}`;
  else { const h = lines.findIndex(l => /^##\s+设置\s*$/.test(l)); if (h >= 0) lines.splice(h + 1, 0, `- ${key}: ${value}`); else lines.push('', '## 设置', `- ${key}: ${value}`); }
  return lines.join(eol);
}

// 📢 开着时追加到在线版提示词的几行（短）。角色是人选的，模型不换；情绪只列这个角色有的
export const voicePrompt = v => {
  const moods = v.moods || [];
  return `

【语音】人开了语音：你可以在 JSON 里加 "voice": {"text": "一句话"${moods.length ? `, "mood": "${moods.join(' | ')}"` : ''}}，会用 TTS 念给人听；整句不是中文时加 "lang"（en / ja / de / fr…，德语法语这类一定要写）。
- 自己决定要不要说：有梗、有情绪、值得说出口才说，大多数回合不用说；一次最多一句，${VOICE_MAX} 字以内；别念代码、路径、长列表；数字写成中文。${moods.length ? `
- mood：${moods.map(m => MOOD_ZH[m] ? `${m} ${MOOD_ZH[m]}` : m).join('、')}；不写 = ${moods.includes('usual') ? 'usual' : moods[0]}。` : ''}
- 人格：${v.short || '（没写）'}${v.long ? '\n- 想看更细的人格设定就 look {"voice": "人格"}。' : ''}`;
};

// 念出来：按 md 里的脚本路径起 python，stdin 喂一行 JSON（不经过 shell，中文直接 UTF-8）。不等播完
export function speak(v, voice, id) {
  const text = String(voice?.text || '').trim().slice(0, VOICE_MAX);
  if (!text) return { ok: false, why: '没有内容' };
  if (!v.tts || !existsSync(v.tts)) return { ok: false, why: '找不到 TTS 脚本：' + (v.tts || '（没写）') };
  const moods = v.moods || MOODS;
  const lang = /^[a-z]{2}$/.test(voice.lang || '') ? voice.lang : v.lang; // 模型说了是哪种语言就听它的，不然用 md 里的（空 = TTS 自己猜）
  const job = { id: 'syn-' + (id || Date.now().toString(36)), role: v.role, text, ...(moods.includes(voice.mood) ? { mood: voice.mood } : {}), ...(v.backend ? { pref: v.backend } : {}), ...(v.style ? { style: v.style } : {}), ...(lang ? { lang } : {}) };
  try {
    const p = spawn(process.env.SYN_PYTHON || 'python', [v.tts, '--stdin'], { stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, PYTHONUTF8: '1' }, windowsHide: true });
    p.on('error', () => {});
    p.stdin.end(JSON.stringify(job), 'utf8');
  } catch (e) { return { ok: false, why: e.message }; }
  return { ok: true, role: v.role, text, job };
}
