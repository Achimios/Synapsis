// 内置 AI 语音：人的三个选择（语音.json）+ TTS 现读的角色表（bridge/roles.json）+ 人格（语音.md）。node core/test/voice.test.js（不真的发声）
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePersona, DEFAULT_PERSONA, voicePrompt, loadVoice, saveVoice, saveVoiceCfg, speak, VOICE_MAX, loadCatalog, resolveVoice } from '../voice.js';
import { parseReply } from '../agent.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

const per = parsePersona(DEFAULT_PERSONA);
ok(per.short.includes('Hastings') && per.long.includes('底线') && !per.short.includes('（每次都给模型'), '人格 md：短人格 / 长人格按标题切段，括号说明行不算');

// TTS 文件夹：tts_v1.py + bridge/roles.json（上游的数据，每次现读）
const tts = mkdtempSync(join(tmpdir(), 'syn-tts-'));
mkdirSync(join(tts, 'bridge')); writeFileSync(join(tts, 'tts_v1.py'), '# fake');
const roles = [{ name: 'hastings', backends: ['volc', 'edge'], languages: ['zh', 'en'], moods: [], description: '嘴毒的历史学家' }, { name: 'cortana', backends: ['volc'], languages: ['zh'], moods: ['usual', 'urgent'], description: 'AI' }];
writeFileSync(join(tts, 'bridge', 'roles.json'), JSON.stringify({ _说明: 'x', roles }));
ok(loadCatalog(tts)?.length === 2 && loadCatalog(join(tts, 'nope')) === null, '角色表按 TTS 文件夹找；找不到 = null');

// 读不到就停用，不退回任何手写列表
const none = resolveVoice({ tts: '', role: 'hastings', backend: '' }, null);
ok(!none.ok && /寻找 TTS 文件夹/.test(none.error) && none.roles.length === 0 && none.moods.length === 0, '没指定 TTS 文件夹：停用 + 提示去找，没有任何兜底列表');
ok(!resolveVoice({ tts, role: 'hastings', backend: '' }, null).ok, '角色表读不到：停用');
ok(/没有角色「bt」/.test(resolveVoice({ tts, role: 'bt', backend: '' }, roles).error), '选的角色 TTS 里没了：停用 + 说清楚');
ok(!speak(none, { text: '你好' }).ok && speak(none, { text: '你好' }).why === none.error, '停用时 speak 不念，原因照说');

const h = resolveVoice({ tts, role: 'hastings', backend: 'edge' }, roles), c = resolveVoice({ tts, role: 'cortana', backend: '' }, roles);
ok(h.ok && h.moods.length === 0 && h.desc === '嘴毒的历史学家' && h.backends.join() === 'volc,edge' && h.roles.join() === 'hastings,cortana', '读得到：角色 / 后端下拉、简介、情绪都来自角色表');
const ph = voicePrompt({ ...h, ...per });
ok(ph.includes('"voice"') && !ph.includes('mood') && !ph.includes('"role"') && ph.includes(per.short) && ph.includes('look {"voice"') && !ph.includes(per.long.split('\n')[0]), '黑斯廷斯没有情绪：提示词不提 mood；不让模型换角色；短人格进、长人格不进');
ok(voicePrompt({ ...c, ...per }).includes('"mood": "usual | urgent"'), 'cortana：只列它有的情绪');

// 人的三个选择存 语音.json；人格存 语音.md；TTS 数据不落地
const home = mkdtempSync(join(tmpdir(), 'syn-voice-'));
ok(!loadVoice(home).ok && !existsSync(join(home, '.synapsis', '语音.json')), '新机器：没选 TTS 文件夹 = 停用，不凭空建文件');
const v2 = saveVoiceCfg(home, { tts: join(tts, 'tts_v1.py'), role: 'cortana', backend: 'volc' });
ok(v2.ok && v2.tts === tts && v2.role === 'cortana' && v2.moods.includes('urgent'), '选到脚本本身也认成文件夹；选完就读角色表');
const saved = JSON.parse(readFileSync(join(home, '.synapsis', '语音.json'), 'utf8'));
ok(Object.keys(saved).sort().join() === 'backend,role,tts', '语音.json 只有人的三个选择（不存角色 / 情绪 / 简介）');
ok(saveVoice(home, '## 短人格\n温柔').short === '温柔' && loadVoice(home).role === 'cortana', '人格单独存，不影响选择');
const r = speak(loadVoice(home), { text: '你好', mood: 'urgent' });
ok(r.ok && r.job.mood === 'urgent' && r.job.pref === 'volc' && !('style' in r.job), '发出去：mood（这个角色有的）+ pref；不再发 style');
ok(!('mood' in speak(resolveVoice({ tts, role: 'hastings', backend: '' }, roles), { text: '嗯', mood: 'urgent' }).job), '角色没有的情绪不发');
// 旧版写在 语音.md「## 设置」里的选择：读一次带过来
const home2 = mkdtempSync(join(tmpdir(), 'syn-voice2-'));
mkdirSync(join(home2, '.synapsis')); writeFileSync(join(home2, '.synapsis', '语音.md'), `## 设置\n- TTS 脚本: ${join(tts, 'tts_v1.py')}\n- 声线: cortana\n- 后端: edge\n## 短人格\n嗨`);
ok(loadVoice(home2).ok && loadVoice(home2).role === 'cortana' && loadVoice(home2).backend === 'edge', '旧版 md 里的选择读得过来');

ok(parseReply('{"say":"嗯","actions":[],"voice":{"text":"严格来说","mood":"curious","lang":"en"}}').voice.mood === 'curious' && parseReply('{"say":"x","actions":[]}').voice === null, 'JSON 里的 voice 字段读得出，没有就是 null');
ok(VOICE_MAX <= 200, '有长度上限');
for (const d of [home, home2, tts]) rmSync(d, { recursive: true, force: true });

console.log(`voice: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
