// 内置 AI 语音：语音.md 解析 / 角色表（TTS bridge/roles.json）/ 提示词 / 念不出来时说清楚。node core/test/voice.test.js（不真的发声）
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseVoice, DEFAULT_VOICE, voicePrompt, loadVoice, saveVoice, speak, VOICE_MAX, MOODS, loadCatalog, withCatalog, setVoiceLine } from '../voice.js';
import { parseReply } from '../agent.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

const v = parseVoice(DEFAULT_VOICE);
ok(v.tts.endsWith('tts_v1.py') && v.role === 'hastings' && v.roles.includes('asuka') && v.short.includes('Hastings') && v.long.includes('底线'), '默认 md：脚本 / 声线 / 可用声线 / 短人格 / 长人格都读得出');
ok(!v.short.includes('（每次都给模型') && v.backend === '', '括号里的说明行不算人格；后端「自动」= 不指定');
ok(parseVoice('## 设置\n- 后端: edge').backend === 'edge' && parseVoice('## 设置\n- 后端: 乱写').backend === '', '后端只认 volc / edge / qwenf / qwenp');

// 角色表读不到 → 兜底：md 里的可用声线 + 六种情绪
const fb = withCatalog(v, null), pf = voicePrompt(fb);
ok(fb.moods.length === MOODS.length && fb.roles.includes('asuka'), '没有角色表：六种情绪 + md 里的可用声线');
ok(pf.includes('"voice"') && pf.includes('"mood"') && pf.includes(v.short) && pf.includes('look {"voice"') && !pf.includes(v.long.split('\n')[0]), '提示词：格式 + 情绪 + 短人格 + 怎么翻长人格（长人格本身不进）');
ok(!pf.includes('"role"'), '角色是人选的：提示词里不让模型换角色');

// 有角色表：情绪只给这个角色有的；没有就一个字不提
const cat = [{ name: 'hastings', backends: ['volc', 'edge'], languages: ['zh', 'en'], moods: [], description: '嘴毒的历史学家' }, { name: 'cortana', backends: ['volc'], languages: ['zh'], moods: ['usual', 'urgent'], description: 'AI' }];
const h = withCatalog(v, cat), c = withCatalog({ ...v, role: 'cortana' }, cat);
ok(h.moods.length === 0 && !voicePrompt(h).includes('mood') && h.desc === '嘴毒的历史学家', '黑斯廷斯没有情绪音色：提示词里不提 mood；描述带上');
ok(voicePrompt(c).includes('"mood": "usual | urgent"') && !voicePrompt(c).includes('wistful'), 'cortana：只列它有的两种');
ok(h.roles.join() === 'hastings,cortana' && h.backends.join() === 'volc,edge', '下拉列表 = 角色表里的角色 / 这个角色配了的后端');

// 角色表文件：<tts 所在目录>/bridge/roles.json
const tdir = mkdtempSync(join(tmpdir(), 'syn-tts-'));
mkdirSync(join(tdir, 'bridge'));
writeFileSync(join(tdir, 'bridge', 'roles.json'), JSON.stringify({ _说明: 'x', roles: cat }));
ok(loadCatalog(join(tdir, 'tts_v1.py'))?.[1].moods.includes('urgent') && loadCatalog(join(tdir, 'nope', 'tts_v1.py')) === null, 'roles.json 按脚本所在目录找；找不到 = null');
writeFileSync(join(tdir, 'bridge', 'roles.json'), '{坏的');
ok(loadCatalog(join(tdir, 'tts_v1.py')) === null, '坏 JSON 不崩，当没有');
rmSync(tdir, { recursive: true, force: true });

// 下拉框改设置里的一行
const t2 = setVoiceLine(DEFAULT_VOICE, '声线', 'cortana');
ok(parseVoice(t2).role === 'cortana' && parseVoice(t2).short === v.short, '改「声线」那一行，其余原样');
ok(parseVoice(setVoiceLine('## 设置\n- 声线: bt\n', '后端', 'edge')).backend === 'edge', '没有这一行 → 加在「## 设置」下面');

ok(parseReply('{"say":"嗯","actions":[],"voice":{"text":"严格来说","mood":"curious","lang":"en"}}').voice.mood === 'curious' && parseReply('{"say":"x","actions":[]}').voice === null, 'JSON 里的 voice 字段读得出，没有就是 null');

const home = mkdtempSync(join(tmpdir(), 'syn-voice-'));
ok(loadVoice(home).role === 'hastings' && !existsSync(join(home, '.synapsis', '语音.md')), '没有文件 = 默认，不凭空建');
ok(saveVoice(home, '## 设置\n- 声线: eva\n- TTS 脚本: C:/不存在/tts.py\n## 短人格\n温柔').role === 'eva' && existsSync(join(home, '.synapsis', '语音.md')), '保存后读回来');
const r = speak(loadVoice(home), { text: '你好' });
ok(!r.ok && /找不到 TTS 脚本/.test(r.why), '脚本不存在 → 说清楚，不崩');
ok(!speak(v, { text: '  ' }).ok, '空话不念');
ok(VOICE_MAX <= 200, '有长度上限');
rmSync(home, { recursive: true, force: true });

console.log(`voice: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
