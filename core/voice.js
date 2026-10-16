// >v<🤖AI指令-语音-👤 2026-10-12：内置 AI（在线宽松版）可以自己决定发语音。人在指令框右上角 📢 开关；关着时提示词里一个字都不提。
//   不给它命令行：它只在 JSON 里写 "voice": {"text": …}，服务端按人选的 TTS 文件夹 / 角色 / 后端去调（一次最多一条、限长）。
// 👤 2026-10-16 Synapsis 是 TTS 的调用端：TTS 是上游，数据（角色、情绪、简介）每次都从 <TTS 文件夹>/bridge/roles.json 现读，
//   Synapsis 不存副本、不约束它的格式（字段变了这边适配）；读不到 = 语音停用，提示人去「寻找 TTS 文件夹位置」，不退回任何手写列表。
//   Synapsis 只存人的三个选择：.synapsis/语音.json {tts: 文件夹, role, backend}。
//   人格（给模型的，不是 TTS 的数据）在 .synapsis/语音.md：短人格每次进提示词，长人格模型 look {"voice": "人格"} 自己翻
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';

export const voiceFile = home => join(home, '.synapsis', '语音.md');        // 人格
export const voiceCfgFile = home => join(home, '.synapsis', '语音.json');   // 人的三个选择
export const VOICE_MAX = 120; // 一条语音最多多少字
export const TTS_SCRIPT = 'tts_v1.py';
const CFG0 = { tts: '', role: 'hastings', backend: '' }; // backend '' = 自动（不发 pref）

export const DEFAULT_PERSONA = `# 🔊 内置 AI 的人格（本机，不进 git）

给内置 AI 的人设：「短人格」每次都给模型，「长人格」它想细看才翻。角色 / 后端 / TTS 文件夹在上面选，不写在这里。

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

// 人格 md → { short, long }（按 ## 标题切段；单独一行的（…）是说明，不算）
export function parsePersona(text) {
  const sec = {}; let cur = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = h[1]; sec[cur] = []; continue; }
    if (cur) sec[cur].push(line);
  }
  const body = k => (sec[k] || []).filter(l => !/^（.*）$/.test(l.trim())).join('\n').trim();
  return { short: body('短人格'), long: body('长人格'), legacy: sec['设置'] || [] };
}

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
  return { ...cfg, script: cfg.tts ? join(cfg.tts, TTS_SCRIPT) : '', catalog, ok: !error, error, roles: catalog ? catalog.map(r => r.name) : [], moods: arr(me?.moods), backends: arr(me?.backends), desc: String(me?.description || '') };
}

const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export function loadVoiceCfg(home) {
  const saved = readJson(voiceCfgFile(home));
  if (saved) return { ...CFG0, ...saved };
  // 旧版把选择写在 语音.md 的「## 设置」里：读一次带过来（只拿人的选择：TTS 位置 / 声线 / 后端）
  try {
    const legacy = parsePersona(readFileSync(voiceFile(home), 'utf8')).legacy, kv = {};
    for (const l of legacy) { const m = /^\s*-\s*([^:：]+)[:：]\s*(.*)$/.exec(l); if (m) kv[m[1].trim()] = m[2].trim(); }
    const s = kv['TTS 脚本'] || kv['TTS脚本'] || '';
    return { ...CFG0, tts: s ? dirname(s) : '', role: kv['声线'] || CFG0.role, backend: ['volc', 'edge', 'qwenf', 'qwenp'].includes(kv['后端']) ? kv['后端'] : '' };
  } catch { return { ...CFG0 }; }
}
export function saveVoiceCfg(home, patch) {
  const cur = loadVoiceCfg(home), next = { ...cur };
  for (const k of ['tts', 'role', 'backend']) if (patch && k in patch) next[k] = String(patch[k] ?? '').trim();
  if (next.tts) next.tts = next.tts.replace(/[\\/]+$/, '').replace(new RegExp('[\\\\/]' + TTS_SCRIPT.replace('.', '\\.') + '$', 'i'), ''); // 选到了脚本本身也认
  mkdirSync(dirname(voiceCfgFile(home)), { recursive: true });
  writeFileSync(voiceCfgFile(home), JSON.stringify(next, null, 1));
  return loadVoice(home);
}

export function loadVoice(home) {
  const f = voiceFile(home);
  let text = DEFAULT_PERSONA;
  try { if (existsSync(f)) text = readFileSync(f, 'utf8'); } catch { /* 读不到 = 默认 */ }
  const cfg = loadVoiceCfg(home);
  const { short, long } = parsePersona(text);
  return { text, file: f, short, long, ...resolveVoice(cfg, loadCatalog(cfg.tts)) };
}
export function saveVoice(home, text) { // 存人格
  const f = voiceFile(home);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, String(text || ''));
  return loadVoice(home);
}

// 📢 开着、且能说时追加到在线版提示词的几行（短）。角色是人选的，模型不换；情绪只列这个角色在 TTS 里有的
export const voicePrompt = v => {
  const moods = v.moods || [];
  return `

【语音】人开了语音：你可以在 JSON 里加 "voice": {"text": "一句话"${moods.length ? `, "mood": "${moods.join(' | ')}"` : ''}}，会用 TTS 念给人听；整句不是中文时加 "lang"（en / ja / de / fr…，德语法语这类一定要写）。
- 自己决定要不要说：有梗、有情绪、值得说出口才说，大多数回合不用说；一次最多一句，${VOICE_MAX} 字以内；别念代码、路径、长列表；数字写成中文。${moods.length ? `
- mood 只能从上面这几个里挑，不写 = ${moods[0]}。` : ''}
- 人格：${v.short || '（没写）'}${v.long ? '\n- 想看更细的人格设定就 look {"voice": "人格"}。' : ''}`;
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
