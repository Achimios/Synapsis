// AI 待办（.synapsis/AI待办.md）：加 / 勾 / 不重复 / 给模型的那一小段。node core/test/todo.test.js
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTodo, saveTodo, applyTodo, todoItems, todoPrompt, todoFile } from '../todo.js';
import { parseReply } from '../agent.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const root = mkdtempSync(join(tmpdir(), 'syn-todo-'));

ok(loadTodo(root) === '' && !existsSync(todoFile(root)), '没有文件 = 空，不凭空建');
ok(/现在没有/.test(todoPrompt('')) && todoPrompt('').includes('"todo"'), '空的也告诉模型怎么记');
const r1 = applyTodo(root, { add: ['把孤岛卡挪进主体', '给 NPC 配图'] });
ok(r1.added.length === 2 && todoItems(loadTodo(root)).length === 2 && loadTodo(root).startsWith('# AI 待办'), '加两条（第一次带上文件头）');
ok(applyTodo(root, { add: ['把孤岛卡挪进主体。'] }).added.length === 0, '同一条（差个标点）不重复加');
const r2 = applyTodo(root, { done: ['孤岛卡挪进主体'] });
ok(r2.checked.length === 1 && todoItems(loadTodo(root)).find(t => t.text.includes('孤岛')).done, '按原话（差几个字也认）勾掉');
ok(applyTodo(root, { done: ['完全没这条'] }).checked.length === 0, '找不到的不乱勾');
const p = todoPrompt(loadTodo(root));
ok(p.includes('给 NPC 配图') && !p.includes('孤岛'), '给模型的只列没做完的');
saveTodo(root, '- [ ] 人自己写的\n- [x] 写完的\n');
ok(todoItems(loadTodo(root)).length === 2 && todoPrompt(loadTodo(root)).includes('人自己写的'), '人直接改的也认');
ok(parseReply('{"say":"好","actions":[],"todo":{"add":["记一条"],"done":"那条"}}').todo.done[0] === '那条' && parseReply('{"say":"x","actions":[]}').todo === null, 'JSON 里的 todo 读得出（done 写成字符串也认）');

rmSync(root, { recursive: true, force: true });
console.log(`todo: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
