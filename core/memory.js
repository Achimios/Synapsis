// >v<🤖AI指令-记忆-内置 AI 的长期记忆（👤 2026-10-08）。照 Claude Code 的分层：
//   项目级 = <工作区>/__synapsis/_AI记忆/*.md（跟项目走、进 git、人能看能改；下划线开头不会被当成节点）
//   用户级 = <Synapsis>/.synapsis/记忆/*.md（所有项目共用，不进 git）
//   会话级 = 短记忆 .synapsis/ai_chat.json（agent.js）
// 👤「项目记忆没必要 hook，不如让 AI 自己判断读不读」：强制附上的只有一张极短的索引（每条一行：名字 + 一句描述），
//   而且只在「新对话 / 清空后 / 最近 8 轮都没附过」时附 —— 👤「不是隔了很久没用（LLM 又不关注现实时间），是很多轮对话没读后」。
//   要看全文由 AI 自己回 {"read": [名字]}，服务端附上再问一轮；要记新东西用动作 remember（人确认才写）。
// 每份记忆 = 一个 md：可选 frontmatter description（索引里那一句），没有就取第一行非空文字。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, DIR } from './workspace.js';

export const LEVELS = { 项目: (home, root) => join(root, DIR, '_AI记忆'), 用户: home => join(home, '.synapsis', '记忆') };
export const badMemName = s => typeof s !== 'string' || !s.trim() || /[\\/:*?"<>|\r\n]/.test(s) || s.trim().length > 40;
// 类型（照 Claude Code 的 auto memory）：user = 关于这个人 | feedback = 他纠正过 / 认可过的做法 | project = 这个项目的事实和决定 | reference = 去哪儿能查到。可以不填
export const TYPES = ['user', 'feedback', 'project', 'reference'];
// 索引最多这么多条（超了只列最近改过的，并提醒整理）；快满（≥ 80%）时执行 remember 后提醒人整理
export const INDEX_MAX = 60;

export function listMemories(home, root) {
  const out = [];
  for (const [level, at] of Object.entries(LEVELS)) {
    const dir = at(home, root);
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')); } catch { continue; }
    for (const f of files.sort()) {
      let text = ''; try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      const { meta, body } = parseFrontmatter(text);
      const desc = String(meta.description || body.split(/\r?\n/).map(l => l.replace(/^[#>\-*\s]+/, '').trim()).find(Boolean) || '').slice(0, 60);
      let mtime = 0; try { mtime = statSync(join(dir, f)).mtimeMs; } catch { /* */ }
      out.push({ level, name: f.replace(/\.md$/, ''), desc, type: TYPES.includes(meta.type) ? meta.type : '', mtime, file: join(dir, f), body: body.trim() });
    }
  }
  return out;
}

// 索引：一条一行；没有记忆 = ''。超过 INDEX_MAX 条：只列最近改过的那些，末尾说明（让模型知道有被藏起来的、可以建议人整理）
export function memoryIndex(home, root, max = INDEX_MAX) {
  let all = listMemories(home, root);
  const hidden = Math.max(0, all.length - max);
  if (hidden) all = [...all].sort((a, b) => b.mtime - a.mtime).slice(0, max);
  const lines = all.map(m => `- [${m.level}] ${m.name}${m.type ? '（' + m.type + '）' : ''}：${m.desc}`);
  if (hidden) lines.push(`（索引放不下，另有 ${hidden} 条没列出来；记忆太多了，可以建议人整理：合并重复的、去掉过期的）`);
  return lines.join('\n');
}
export const indexStatus = (home, root, max = INDEX_MAX) => { const n = listMemories(home, root).length; return { n, max, near: n >= max * 0.8, over: n > max }; };

// AI 点名要看的几份全文（名字可以带或不带「[项目]」前缀）；每份最多 3000 字
export function readMemories(home, root, names) {
  const all = listMemories(home, root), want = (names || []).map(n => String(n).replace(/^\[(项目|用户)\]\s*/, '').trim());
  const got = all.filter(m => want.includes(m.name));
  return { names: got.map(m => m.name), text: got.map(m => `【${m.level}记忆·${m.name}】\n${m.body.slice(0, 3000)}`).join('\n\n') };
}

// 写一份记忆（人确认后由 applyPlan 调）。mode = append（默认，接在后面）| replace（旧的整份挪进同级 _过期的/，不删）
export function writeMemory(home, root, { level, name, text, desc, type, mode = 'append' }) {
  const dir = LEVELS[level](home, root), file = join(dir, name.trim() + '.md');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  if (existsSync(file) && mode === 'replace') {
    const old = join(dir, '_过期的'); mkdirSync(old, { recursive: true });
    renameSync(file, join(old, `${Date.now()}_${name.trim()}.md`));
  }
  if (existsSync(file)) writeFileSync(file, readFileSync(file, 'utf8').replace(/\s*$/, '\n') + `\n（${stamp}）${text.trim()}\n`);
  else writeFileSync(file, `---\ndescription: ${(desc || text).replace(/\s+/g, ' ').trim().slice(0, 60)}\n${TYPES.includes(type) ? `type: ${type}\n` : ''}---\n（${stamp}）${text.trim()}\n`);
  return file;
}
