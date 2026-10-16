// 内置 AI 语音：人的三个选择（语音.json）+ TTS 现读的角色表（bridge/roles.json）。Synapsis 不存 TTS 的任何数据。node core/test/voice.test.js（不真的发声）
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { voicePrompt, loadVoice, saveVoiceCfg, speak, VOICE_MAX, loadCatalog, resolveVoice } from '../voice.js';
import { parseReply } from '../agent.js';
import { loadSettings } from '../settings.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

// TTS 文件夹：tts_v1.py + bridge/roles.json（上游的数据，每次现读）
const tts = mkdtempSync(join(tmpdir(), 'syn-tts-'));
mkdirSync(join(tts, 'bridge')); writeFileSync(join(tts, 'tts_v1.py'), '# fake');
const roles = [{ name: 'hastings', backends: ['volc', 'edge'], languages: ['zh', 'en'], moods: [], description: '英国历史学家的声音', persona: '嘴毒的历史学家\n- 先损一句' }, { name: 'cortana', backends: ['volc'], languages: ['zh'], moods: ['usual', 'urgent'], description: 'AI', persona: '' }];
writeFileSync(join(tts, 'bridge', 'roles.json'), JSON.stringify({ _说明: 'x', roles }));
ok(loadCatalog(tts)?.length === 2 && loadCatalog(join(tts, 'nope')) === null, '角色表按 TTS 文件夹找；找不到 = null');

// 读不到就停用，不退回任何手写列表
const none = resolveVoice({ tts: '', role: 'hastings', backend: '' }, null);
ok(!none.ok && /寻找 TTS 文件夹/.test(none.error) && none.roles.length === 0 && none.moods.length === 0 && !none.persona, '没指定 TTS 文件夹：停用 + 提示去找，没有任何兜底');
ok(!resolveVoice({ tts, role: 'hastings', backend: '' }, null).ok, '角色表读不到：停用');
ok(/没有角色「bt」/.test(resolveVoice({ tts, role: 'bt', backend: '' }, roles).error), '选的角色 TTS 里没了：停用 + 说清楚');
ok(!speak(none, { text: '你好' }).ok && speak(none, { text: '你好' }).why === none.error, '停用时 speak 不念，原因照说');

const h = resolveVoice({ tts, role: 'hastings', backend: 'edge' }, roles), c = resolveVoice({ tts, role: 'cortana', backend: '' }, roles);
ok(h.ok && h.moods.length === 0 && h.desc === '英国历史学家的声音' && h.persona.startsWith('嘴毒') && h.backends.join() === 'volc,edge' && h.roles.join() === 'hastings,cortana', '读得到：角色 / 后端下拉、简介、口吻、情绪都来自角色表');
const ph = voicePrompt(h);
ok(ph.includes('"voice"') && !ph.includes('mood') && !ph.includes('"role"') && ph.includes('英国历史学家的声音') && ph.includes('- 先损一句') && /可选口吻.*严肃讨论时别用/.test(ph), '提示词：不提 mood（这个角色没有）、不让换角色、简介 + 可选口吻（合适时机才用）');
const pc = voicePrompt(c);
ok(pc.includes('"mood": "usual | urgent"') && !pc.includes('口吻'), 'cortana：只列它有的情绪；没有口吻就不提');

// 只存人的三个选择；TTS 数据不落地
const home = mkdtempSync(join(tmpdir(), 'syn-voice-'));
ok(!loadVoice(home).ok && !existsSync(join(home, 'settings.yaml')), '新机器：没选 TTS 文件夹 = 停用，不凭空建文件');
const v2 = saveVoiceCfg(home, { tts: join(tts, 'tts_v1.py'), role: 'cortana', backend: 'volc' });
ok(v2.ok && v2.tts === tts.split('\\').join('/') && v2.role === 'cortana' && v2.moods.includes('urgent'), '选到脚本本身也认成文件夹（路径统一正斜杠）；选完就读角色表');
const yaml = readFileSync(join(home, 'settings.yaml'), 'utf8');
const vs = loadSettings(home).voice;
ok(vs.role === 'cortana' && vs.backend === 'volc' && !!vs.tts && !/urgent|description|persona/.test(yaml) && !existsSync(join(home, '.synapsis')), '三个选择存进 settings.yaml 的 voice 段（不存角色 / 情绪 / 简介 / 口吻，也没有别的语音文件）');
const r = speak(loadVoice(home), { text: '你好', mood: 'urgent' });
ok(r.ok && r.job.mood === 'urgent' && r.job.pref === 'volc' && !('style' in r.job), '发出去：mood（这个角色有的）+ pref；不发 style');
ok(!('mood' in speak(h, { text: '嗯', mood: 'urgent' }).job), '角色没有的情绪不发');

ok(parseReply('{"say":"嗯","actions":[],"voice":{"text":"严格来说","mood":"curious","lang":"en"}}').voice.mood === 'curious' && parseReply('{"say":"x","actions":[]}').voice === null, 'JSON 里的 voice 字段读得出，没有就是 null');
ok(VOICE_MAX <= 200, '有长度上限');
for (const d of [home, tts]) rmSync(d, { recursive: true, force: true });

console.log(`voice: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
