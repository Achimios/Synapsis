// >v<🤖AI指令-记忆-内置 AI 的长期记忆（👤 2026-10-08）。照 Claude Code 的分层：
//   项目级 = <工作区>/__synapsis/_AI记忆/*.md（跟项目走、进 git、人能看能改；下划线开头不会被当成节点）
//   用户级 = <Synapsis>/.synapsis/记忆/*.md（所有项目共用，不进 git）
//   会话级 = 短记忆 .synapsis/ai_chat.json（agent.js）
// 👤「项目记忆没必要 hook，不如让 AI 自己判断读不读」：强制附上的只有一张极短的索引（每条一行：名字 + 一句描述），
//   而且只在「新对话 / 清空后 / 最近 8 轮都没附过」时附 —— 👤「不是隔了很久没用（LLM 又不关注现实时间），是很多轮对话没读后」。
//   要看全文由 AI 自己回 {"read": [名字]}，服务端附上再问一轮；要记新东西用动作 remember（人确认才写）。
// 每份记忆 = 一个 md：可选 frontmatter description（索引里那一句），没有就取第一行非空文字。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, DIR } from './workspace.js';

export const LEVELS = { 项目: (home, root) => join(root, DIR, '_AI记忆'), 用户: home => join(home, '.synapsis', '记忆') };
export const badMemName = s => typeof s !== 'string' || !s.trim() || /[\\/:*?"<>|\r\n]/.test(s) || s.trim().length > 40;

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
      out.push({ level, name: f.replace(/\.md$/, ''), desc, file: join(dir, f), body: body.trim() });
    }
  }
  return out;
}

// 索引：一条一行；没有记忆 = ''
export const memoryIndex = (home, root) => listMemories(home, root).map(m => `- [${m.level}] ${m.name}：${m.desc}`).join('\n');

// AI 点名要看的几份全文（名字可以带或不带「[项目]」前缀）；每份最多 3000 字
export function readMemories(home, root, names) {
  const all = listMemories(home, root), want = (names || []).map(n => String(n).replace(/^\[(项目|用户)\]\s*/, '').trim());
  const got = all.filter(m => want.includes(m.name));
  return { names: got.map(m => m.name), text: got.map(m => `【${m.level}记忆·${m.name}】\n${m.body.slice(0, 3000)}`).join('\n\n') };
}

// 写一份记忆（人确认后由 applyPlan 调）。mode = append（默认，接在后面）| replace（旧的整份挪进同级 _过期的/，不删）
export function writeMemory(home, root, { level, name, text, desc, mode = 'append' }) {
  const dir = LEVELS[level](home, root), file = join(dir, name.trim() + '.md');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  if (existsSync(file) && mode === 'replace') {
    const old = join(dir, '_过期的'); mkdirSync(old, { recursive: true });
    renameSync(file, join(old, `${Date.now()}_${name.trim()}.md`));
  }
  if (existsSync(file)) writeFileSync(file, readFileSync(file, 'utf8').replace(/\s*$/, '\n') + `\n（${stamp}）${text.trim()}\n`);
  else writeFileSync(file, `---\ndescription: ${(desc || text).replace(/\s+/g, ' ').trim().slice(0, 60)}\n---\n（${stamp}）${text.trim()}\n`);
  return file;
}
