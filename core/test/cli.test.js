// >v<✅自检-CLI-临时工作区里跑一遍 LLM 写命令（真的起子进程，和别的 AI 调用方式一致）+ 根目录手册与模板一致
// node core/test/cli.test.js
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, parseFrontmatter, DIR } from '../workspace.js';
import { ROOT_MANUAL, rootManualText } from '../cli.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const root = mkdtempSync(join(tmpdir(), 'syn-cli-'));
const run = (...args) => { const r = spawnSync(process.execPath, [CLI, ...args, '--ws', root], { encoding: 'utf8', input: args.input }); return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status }; };
const node = id => loadWorkspace(root).graph.nodes.get(id);

try {
  spawnSync(process.execPath, [CLI, 'init', root], { encoding: 'utf8' });
  ok(existsSync(join(root, DIR, '_synapsis.md')) && readFileSync(join(root, DIR, '_synapsis.md'), 'utf8').includes('AI 接入手册'), 'init 写入 AI 接入手册（_synapsis.md）');

  let r = run('add', '/', '感知');
  ok(r.out === '感知' && node('感知'), 'add 顶层 ' + r.out + r.err);
  r = run('add', '感知', '视觉');
  ok(r.out === '感知/视觉' && node('感知/视觉'), 'add 子级 ' + r.out + r.err);
  run('add', '/', '决策');
  r = run('add', '感知', '听觉', '--after', '感知/视觉');
  ok(node('感知').children.join() === '感知/视觉,感知/听觉', 'add --after 顺序');
  r = run('status', '感知/视觉', 'done');
  ok(node('感知/视觉').status === 'done', 'status done');
  r = run('link', '感知/视觉', '决策', '--label', '敌人位置', '--kind', '离散');
  const e = loadWorkspace(root).graph.edges.find(x => x.from === '感知/视觉' && x.to === '决策');
  ok(e && e.label === '敌人位置' && e.kind === '离散', 'link 带标签和类型 ' + JSON.stringify(e) + r.err);
  r = run('rename', '感知/听觉', '听觉（声源）');
  ok(r.out === '感知/听觉（声源）' && node('感知/听觉（声源）') && !node('感知/听觉'), 'rename ' + r.out + r.err);
  ok(loadWorkspace(root).graph.edges.find(x => x.from === '感知/视觉')?.label === '敌人位置', '改别的节点名字不丢边标签');
  r = run('set', '感知/视觉', 'code=src/eye.js#see', 'rate=10 Hz');
  ok(node('感知/视觉').meta.code === 'src/eye.js#see' && node('感知/视觉').meta.rate === '10 Hz', 'set 属性');
  r = run('set', '感知/视觉', 'rate=');
  ok(node('感知/视觉').meta.rate === undefined, 'set 键= 删除属性');
  ok(run('set', '感知/视觉', 'status=done').code === 1, 'set 拒绝改 status（要用 status 命令）');
  const bodyFile = join(root, 'b.txt'); writeFileSync(bodyFile, '人写的想法。\n\n## AI 记录（2026-10-08）\n接上了 eye.js。');
  r = run('body', '感知/视觉', bodyFile);
  ok(node('感知/视觉').body.includes('AI 记录') && node('感知/视觉').meta.code === 'src/eye.js#see', 'body 替换正文，属性不丢');
  r = run('find', 'eye.js');
  ok(r.out.includes('[感知/视觉]'), 'find 找到属性里的词 ' + r.out);
  r = run('find', '人写的');
  ok(r.out.includes('正文'), 'find 找到正文 ' + r.out);
  r = run('unlink', '感知/视觉', '决策');
  ok(!loadWorkspace(root).graph.edges.length, 'unlink');
  r = run('rm', '感知/听觉（声源）');
  ok(!node('感知/听觉（声源）') && readdirSync(join(root, DIR, '_过期的')).length === 1, 'rm 进 _过期的/');
  r = run('status', '不存在的', 'done');
  ok(r.code === 1 && r.err.includes('没有这个节点'), '错 id → 退出码 1 + 说清楚');
  r = run('add', '/', 'A -> B');
  ok(r.code === 1, '名字含 -> 被拒');
  ok(run('check').out.includes('code 指向不存在的文件'), 'check 抓到 code 路径不存在');
  ok(run('manual').out.includes(root.split('\\').join('/')), 'manual 填好了工作区路径');
  // 必须相等的量：仓库根目录的 _AI_Manual.md = 模板渲染结果（改了模板忘了 manual --write 就会挂）
  ok(existsSync(ROOT_MANUAL) && readFileSync(ROOT_MANUAL, 'utf8').replace(/\r\n/g, '\n') === rootManualText(), '_AI_Manual.md 与模板一致（不一致就跑 node core/cli.js manual --write）');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`cli: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
