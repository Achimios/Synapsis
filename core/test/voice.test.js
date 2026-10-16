// 内置 AI 语音：语音.md 解析 / 提示词 / 念不出来时说清楚。node core/test/voice.test.js（不真的发声）
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseVoice, DEFAULT_VOICE, voicePrompt, loadVoice, saveVoice, speak, VOICE_MAX } from '../voice.js';
import { parseReply } from '../agent.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };

const v = parseVoice(DEFAULT_VOICE);
ok(v.tts.endsWith('tts_v1.py') && v.role === 'hastings' && v.roles.includes('asuka') && v.short.includes('Hastings') && v.long.includes('底线'), '默认 md：脚本 / 声线 / 可用声线 / 短人格 / 长人格都读得出');
ok(!v.short.includes('（每次都给模型'), '括号里的说明行不算人格');
const p = voicePrompt(v);
ok(p.includes('"voice"') && p.includes(v.short) && p.includes('look {"voice"') && !p.includes(v.long.split('\n')[0]), '提示词：格式 + 短人格 + 怎么翻长人格（长人格本身不进）');
ok(parseVoice('## 设置\n- 声线: eva\n## 短人格\n嗨').roles[0] === 'eva', '可用声线没写 = 只有自己那个');
ok(parseReply('{"say":"嗯","actions":[],"voice":{"text":"严格来说","role":"asuka"}}').voice.role === 'asuka' && parseReply('{"say":"x","actions":[]}').voice === null, 'JSON 里的 voice 字段读得出，没有就是 null');

const home = mkdtempSync(join(tmpdir(), 'syn-voice-'));
ok(loadVoice(home).role === 'hastings' && !existsSync(join(home, '.synapsis', '语音.md')), '没有文件 = 默认，不凭空建');
ok(saveVoice(home, '## 设置\n- 声线: eva\n- TTS 脚本: C:/不存在/tts.py\n## 短人格\n温柔').role === 'eva' && existsSync(join(home, '.synapsis', '语音.md')), '保存后读回来');
const r = speak(loadVoice(home), { text: '你好' });
ok(!r.ok && /找不到 TTS 脚本/.test(r.why), '脚本不存在 → 说清楚，不崩');
ok(!speak(v, { text: '  ' }).ok, '空话不念');
ok(VOICE_MAX <= 200, '有长度上限');
ok(p.includes('"mood"') && p.includes('urgent'), '提示词里有 mood 六选一');
ok(parseReply('{"say":"x","actions":[],"voice":{"text":"嗯","mood":"curious","lang":"en"}}').voice.mood === 'curious', 'voice 里的 mood / lang 读得出');
rmSync(home, { recursive: true, force: true });

console.log(`voice: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
