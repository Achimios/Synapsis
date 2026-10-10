// 外部文件节点：addFileNode 建一个带 file: 的普通节点；check 对它的特殊处理。node core/test/filenode.test.js
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, addFileNode, loadWorkspace, checkWorkspace } from '../workspace.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const root = mkdtempSync(join(tmpdir(), 'syn-filenode-'));
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', '笔记.md'), '# 笔记\n内容');
writeFileSync(join(root, 'docs', 'a,b.json'), '{"x":1}');
writeFileSync(join(root, '根文件.txt'), 'x');
saveOutline(root, '分组\n  甲\n乙');

const id1 = addFileNode(root, '分组', 'docs/笔记.md').id;
ok(id1 === '分组/笔记.md', '名字取文件名，建在指定父节点下 ' + id1);
let ws = loadWorkspace(root);
const n = ws.graph.nodes.get(id1);
ok(n && n.meta.file === 'docs/笔记.md', 'frontmatter 带 file: 相对路径');
ok(!n.status, '不带 status（引用外部文件不是待做的事，不进进度统计）');
ok(readFileSync(n.file, 'utf8').includes('file: docs/笔记.md'), '节点 md 里真的写了 file:');
ok(existsSync(join(root, 'docs', '笔记.md')) && readFileSync(join(root, 'docs', '笔记.md'), 'utf8') === '# 笔记\n内容', '原文件一个字没动');

const id2 = addFileNode(root, '分组', 'docs/笔记.md').id;
ok(id2 === '分组/笔记.md2', '同级重名自动加序号 ' + id2);
const id3 = addFileNode(root, '', '根文件.txt').id;
ok(id3 === '根文件.txt', '建在根上（父 = 空串）' + id3);
const id4 = addFileNode(root, '乙', 'docs/a,b.json').id;
ok(!/,/.test(id4.split('/').pop()), '文件名里的逗号会被换掉（否则大纲里被当成连线；Windows 文件名本来就不能有 >）' + id4);

for (const bad of ['不存在.md', '../外面.md', '__synapsis/_synapsis.md', 'docs']) {
  let err = null; try { addFileNode(root, '分组', bad); } catch (e) { err = e.message; }
  ok(!!err, '拒绝：' + bad + (err ? '（' + err + '）' : ''));
}

// check：有 file 的节点不报「没有 status」；文件没了 → 提示
ws = loadWorkspace(root);
let iss = checkWorkspace(ws);
ok(!iss.some(i => i.where === id1 && /没有 status/.test(i.msg)), 'check：file 节点不报没有 status');
ok(!iss.some(i => /file 指向/.test(i.msg)), 'check：文件都在 → 没有 file 提示');
rmSync(join(root, 'docs', '笔记.md'));
iss = checkWorkspace(loadWorkspace(root));
ok(iss.some(i => i.where === id1 && /file 指向不存在的文件/.test(i.msg)), 'check：文件被移走 → 提示（不是错误）');

rmSync(root, { recursive: true, force: true });
console.log(`filenode: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
