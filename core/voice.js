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
  const line = r => `  - ${r.name}${r.name === v.role ? '（默认）' : ''}：${String(r.description || '').trim() || '（没写简介）'}${arrOf(r.moods).length ? `；mood：${arrOf(r.moods).join(' / ')}` : ''}${arrOf(r.backends).length ? `；后端：${arrOf(r.backends).join(' / ')}` : ''}${String(r.persona || '').trim() ? '；有口吻' : ''}`;
  return `

【语音】人开了语音：想说话就在 JSON 里加 "voice": {"text": "一句话"}，TTS 会念出来。
- 自己决定要不要说：有梗、有情绪、值得说出口才说，大多数回合不说；一次一句，${VOICE_MAX} 字以内；别念代码、路径、列表；数字写成中文。
- 可选字段：role 换声音（不写 = ${v.role}；人点名用谁就用谁）、mood 情绪（只能用这一句所用角色列出的，没列就别写）、pref 后端（不写 = ${v.backend || '自动'}，人没要求别写）、lang（整句不是中文时写，德语法语必写）、fx 音效（如 对讲机 / 空房间，人要求或很合适才用）。
- 情绪靠 mood，标点只管节奏：急促多用逗号、顿号连着说；伤感 / 安慰用短句、句号断开，关键处放一个 ~。
- 角色清单（声音是谁）：
${(v.catalog || []).map(line).join('\n')}
- 口吻和声音分开：${v.persona ? `默认用 ${v.role} 的口吻（见下）` : '默认不带特别的口吻'}；借别的角色的口吻先 look {"persona": "角色名"}。口吻可选：闲聊、玩梗时用，严肃讨论别用，别硬套。
- 更多细节按需翻 TTS 的文档（只读）：look {"tts": "__TTS_调用方法(简洁).md"}（字段 / 音效）、{"tts": "__TTS_写台词技巧.md"}（标点节奏）、{"tts": "__TTS_角色表.md"}（角色和口吻全文）。${v.persona ? `
${v.role} 的口吻：
${v.persona}` : ''}`;
};
// 选了 TTS 但人没开 📢：一句话，免得模型嘴上说「我发语音了」
export const voiceOffPrompt = `

【语音】人没开语音（指令框右上角 🔇 / 📢）。人要你说话时，提醒他点开 📢；别说你已经发了语音。`;

// 念出来：起 <TTS 文件夹>/tts_v1.py，stdin 喂一行 JSON（不经过 shell，中文直接 UTF-8）。不等播完
export function speak(v, voice, id) {
  if (!v.ok) return { ok: false, why: v.error };
  const text = String(voice?.text || '').trim().slice(0, VOICE_MAX);
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
