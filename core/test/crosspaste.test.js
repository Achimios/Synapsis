// 跨项目粘贴：pasteNodes(目标, ids, parent, 来源项目)。node core/test/crosspaste.test.js
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, setNodeBody, setNodeMeta, pasteNodes, loadWorkspace } from '../workspace.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const A = mkdtempSync(join(tmpdir(), 'syn-src-')), B = mkdtempSync(join(tmpdir(), 'syn-dst-'));

// 来源：组（甲 -> 乙）+ 外；甲有正文 / 属性 / 图片
saveOutline(A, '组\n  甲 -> 乙\n  乙\n外 -> 组');
setNodeBody(A, '组/甲', '甲的正文');
setNodeMeta(A, '组/甲', { owner: '某某', status: 'done' });
mkdirSync(join(A, '__synapsis', '组', '_pics_甲'), { recursive: true });
writeFileSync(join(A, '__synapsis', '组', '_pics_甲', 'a.png'), 'PNGDATA');
// 目标：已有同名「组」，测试重名加序号
saveOutline(B, '组\n  丙\n容器');

const r = pasteNodes(B, ['组'], '容器', A);
ok(r.roots.length === 1 && r.roots[0] === '容器/组', '粘到目标的「容器」下 ' + r.roots);
const ws = loadWorkspace(B), g = ws.graph;
ok(g.nodes.has('容器/组/甲') && g.nodes.has('容器/组/乙'), '子孙一起过来');
ok(g.nodes.get('容器/组/甲').body.includes('甲的正文'), '正文跟着');
ok(g.nodes.get('容器/组/甲').meta.owner === '某某' && g.nodes.get('容器/组/甲').status === 'done', '属性、状态跟着');
ok(g.edges.some(e => e.from === '容器/组/甲' && e.to === '容器/组/乙'), '被复制范围内部的边保留');
ok(!g.edges.some(e => e.to === '容器/组' && e.from === '外'), '连到范围外（来源里的「外」）的边不带');
ok(!g.nodes.has('外'), '范围外的节点没被带过来');
ok(existsSync(join(B, '__synapsis', '容器', '组', '_pics_甲', 'a.png')), '节点的图片文件夹跟着拷');
ok(g.nodes.has('组/丙') && g.nodes.has('容器'), '目标原有的东西没动');
ok(existsSync(join(A, '__synapsis', '组', '甲.md')) || existsSync(join(A, '__synapsis', '组', '甲', '_node.md')) , '来源项目一个字没动（复制不是剪切）');

// 目标根下粘贴，同名加序号
const r2 = pasteNodes(B, ['组'], '', A);
ok(r2.roots[0] === '组 2', '粘到根上，目标已有「组」→ 加序号 ' + r2.roots);

// 来源不是工作区 / 路径不存在 → 报错，不写任何东西
let err = null; try { pasteNodes(B, ['组'], '', join(tmpdir(), 'syn-nonexistent-xyz')); } catch (e) { err = e.message; }
ok(err && /来源项目找不到/.test(err), '来源路径不存在 → 报错 ' + err);
let err2 = null; try { pasteNodes(B, ['不存在的节点'], '', A); } catch (e) { err2 = e.message; }
ok(!!err2, '来源里没有这个节点 → 报错');

// 同一个项目照旧（不传来源）
const r3 = pasteNodes(B, ['容器/组'], '容器', undefined);
ok(r3.roots[0] === '容器/组 2', '同项目复制照旧 ' + r3.roots);

rmSync(A, { recursive: true, force: true }); rmSync(B, { recursive: true, force: true });
console.log(`crosspaste: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
