// 内置 AI 语音：人的三个选择（语音.json）+ TTS 现读的角色表（bridge/roles.json）。Synapsis 不存 TTS 的任何数据。node core/test/voice.test.js（不真的发声）
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { voicePrompt, voiceOffPrompt, clipVoice, rescueVoice, plainVoice, autoVoice, loadVoice, saveVoiceCfg, speak, VOICE_MAX, loadCatalog, resolveVoice, personaOf } from '../voice.js';
import { parseReply, lookAt } from '../agent.js';
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
ok(ph.includes('"voice"') && /voice 每轮必填/.test(ph) && ph.includes('role 换声音') && ph.includes('hastings（默认）：英国历史学家的声音（有口吻）') && ph.includes('cortana：AI（mood：usual/urgent）') && ph.length < 900, '提示词（短）：voice 必填、可以换角色 / 后端、角色清单（半句简介 + 有的才列情绪）');
ok(!ph.includes('先损一句') && ph.includes('hastings（默认）：英国历史学家的声音（有口吻）') && ph.includes('look {"persona"') && /别自己套口吻/.test(ph) && ph.includes('__TTS_调用方法(简洁).md'), '口吻全文不进提示词（只标「有口吻」），要用时 look {"persona"} 去 TTS 读；细节去 TTS 文档');
ok(!voicePrompt(c).includes('cortana：AI（mood：usual/urgent）（有口吻）'), '没写口吻的角色不标');

// 这一句实际用谁：模型点名且在表里 → 用它；情绪 / 后端按实际角色查
const sw = speak(h, { text: '嗯', role: 'cortana', mood: 'urgent', pref: 'edge' }).job;
ok(sw.role === 'cortana' && sw.mood === 'urgent' && !('pref' in sw), '换成 cortana：用它的情绪；edge 它没有 → 不发 pref（优先后端 edge 它也没有）');
const sx = speak(h, { text: '嗯', role: '不存在', mood: 'urgent' }).job;
ok(sx.role === 'hastings' && !('mood' in sx) && sx.pref === 'edge', '点了不存在的角色 → 退回优先角色；它没有情绪就不发；优先后端照发');
ok(personaOf(h, 'hastings').includes('先损一句') && /没有写口吻/.test(personaOf(h, 'cortana')) && /没有角色「bt」/.test(personaOf(h, 'bt')), 'look persona：借谁的口吻都能翻，没写 / 没这个人说清楚');

// 内置 AI 读 TTS 文件夹：白名单（根目录 .md + bridge/*.json），config 里的 key 一律不给
mkdirSync(join(tts, 'config')); writeFileSync(join(tts, 'config', 'cred.json'), '{"key":"sk-秘密"}'); writeFileSync(join(tts, '__TTS_角色表.md'), '# 角色表\n黑斯廷斯：嘴毒');
mkdirSync(join(tts, 'logs')); writeFileSync(join(tts, 'logs', 'x.md'), '日志');
const ctx0 = { scope: '', refs: new Map() }, root0 = mkdtempSync(join(tmpdir(), 'syn-root-'));
const lk = items => lookAt(root0, ctx0, items, { ttsDir: tts, voice: h }).text;
ok(lk([{ tts: '__TTS_角色表.md' }]).includes('黑斯廷斯：嘴毒') && lk([{ tts: 'bridge/roles.json' }]).includes('英国历史学家的声音'), '能读：根目录 .md、bridge/roles.json');
ok(!lk([{ tts: 'config/cred.json' }]).includes('sk-秘密') && !lk([{ tts: 'config\\cred.json' }]).includes('sk-秘密') && !lk([{ tts: 'bridge/../config/cred.json' }]).includes('sk-秘密') && !lk([{ tts: 'logs/x.md' }]).includes('日志'), '读不到：config 里的 key（换斜杠、.. 绕也不行）、logs');
ok(/还没指定 TTS 文件夹/.test(lookAt(root0, ctx0, [{ tts: 'bridge/roles.json' }], {}).text), '没指定 TTS 文件夹：说清楚');
ok(lk([{ persona: 'hastings' }]).includes('先损一句'), 'look persona 走角色表');
rmSync(root0, { recursive: true, force: true });

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
ok(autoVoice('**好**，挪完了。顺便说一句：第二句。第三句不念。').text === '好，挪完了。顺便说一句：第二句。' && autoVoice('') === null, '没写 voice 也捞不到台词 → 念回答开头一两句（去 Markdown）');
ok(plainVoice('**严格来说**，你看 `n32`：\n- 第一\n- 第二\n## 标题\n[链接](http://x) 嘿~ 停___顿') === '严格来说，你看 n32： 第一 第二 标题 链接 嘿~ 停___顿', '念之前去掉 Markdown（~ 和 ___ 留着）');
ok(!('x' in {}) && speak(h, { text: '**加粗** 的话' }).job.text === '加粗 的话', 'speak 发出去的是纯文本');
const longT = '这是一句完整的话，不长。'.repeat(20);
ok(clipVoice(longT).endsWith('。') && clipVoice(longT).length <= VOICE_MAX && clipVoice('短句。') === '短句。', '超长在句号处截，不截在半句上');
ok(rescueVoice('语音来了，黑斯廷斯：\n\n「Desmond，你又忘了保存，严格来说这是第三次了。」\n要不要记下？').text.startsWith('Desmond') && rescueVoice('「只是引用一句话，而且挺长的一句话」') === null && rescueVoice('语音来了，但没有引号') === null, '明说语音来了、台词在「」里 → 兜底拿出来；没说 / 没引号的不动');
ok(rescueVoice('能控制语言的只有语音的 lang 字段。「[中文]」「[English]」前缀是我加的') === null && rescueVoice('你说「发一段中文，发两次」，语音这块我先确认') === null, '只是提到「语音」、「」里是引用 / 短标签 → 不当台词');
ok(speak(h, { text: '嗯', fx: '对讲机' }).job.fx === '对讲机' && !('fx' in speak(h, { text: '嗯', fx: 'x'.repeat(80) }).job), 'fx 音效原样带上（太长的不要）');
ok(/没开语音/.test(voiceOffPrompt) && voiceOffPrompt.length < 120, '选了 TTS 但没开 📢：一句话提醒，别说已经发了');
ok(parseReply('{"say":"x","actions":[],"voice":{"text":"嗯","role":"bt","pref":"edge"}}').voice.pref === 'edge', 'JSON 里模型写的 role / pref 读得出');
for (const d of [home, tts]) rmSync(d, { recursive: true, force: true });

console.log(`voice: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
