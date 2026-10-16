// >v<🤖AI指令-待办-👤 2026-10-16：AI 对话里说定的「以后要做的事」放这里，不放压缩摘要（摘要每次重写，会把没人要的建议写成待办、每轮念叨）。
//   文件 = 被规划项目的 .synapsis/AI待办.md，一行一条「- [ ] 事情」/「- [x] 事情」。人在指令框「📋 待办」页直接改；
//   在线模型每轮看到没做完的那几条，JSON 里 "todo": {"add": [...], "done": [...]} 增 / 勾。节点上的待办是人自己的，不归这里
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const todoFile = root => join(root, '.synapsis', 'AI待办.md');
export const TODO_HEAD = '# AI 待办\n\n人和 AI 在指令框里说定的「以后要做的事」。一行一条：- [ ] 没做 / - [x] 做完。可以直接改。\n\n';
export function loadTodo(root) { try { return readFileSync(todoFile(root), 'utf8'); } catch { return ''; } }
export function saveTodo(root, text) { mkdirSync(dirname(todoFile(root)), { recursive: true }); writeFileSync(todoFile(root), String(text ?? '')); return loadTodo(root); }

const ITEM = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/;
export const todoItems = text => String(text || '').split(/\r?\n/).map(l => ITEM.exec(l)).filter(Boolean).map(m => ({ done: m[1] !== ' ', text: m[2] }));
const norm = s => String(s || '').replace(/[\s，。,.!！？?「」“”"'`*]/g, '').toLowerCase();

// add = 新加的几条（已有同样的就不重复）；done = 勾掉（按原话找，差几个标点也认）。返回 { text, added, checked }
export function applyTodo(root, { add = [], done = [] } = {}) {
  let text = loadTodo(root);
  const added = [], checked = [];
  if (!text.trim()) text = TODO_HEAD;
  const lines = text.split(/\r?\n/);
  for (const d of done.map(String).filter(Boolean).slice(0, 10)) {
    const i = lines.findIndex(l => { const m = ITEM.exec(l); return m && m[1] === ' ' && (norm(m[2]) === norm(d) || norm(m[2]).includes(norm(d)) && norm(d).length >= 4); });
    if (i >= 0) { lines[i] = lines[i].replace('[ ]', '[x]'); checked.push(ITEM.exec(lines[i])[2]); }
  }
  const have = new Set(todoItems(lines.join('\n')).map(t => norm(t.text)));
  for (const a of add.map(s => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 10)) {
    if (have.has(norm(a))) continue;
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    lines.push('- [ ] ' + a); have.add(norm(a)); added.push(a);
  }
  if (added.length || checked.length) saveTodo(root, lines.join('\n') + '\n');
  return { text: loadTodo(root), added, checked };
}

// 给在线模型的一小段（只列没做完的；一条都没有也告诉它怎么记）
export function todoPrompt(text, native = false) {
  const open = todoItems(text).filter(t => !t.done).slice(0, 30);
  return `

【待办】${open.length ? '没做完的：\n' + open.map(t => '- ' + t.text).join('\n') : '（现在没有）'}
人让你记下以后要做的事、或你们说定以后要做的，就${native ? '调 todo 工具 {"add": ["一句话"]}' : '在 JSON 里加 "todo": {"add": ["一句话"]}'}；做完了 {"done": ["那条的原话"]}。人在指令框「📋 待办」页看得到、能改。`;
}
