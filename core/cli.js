#!/usr/bin/env node
// >v<🤖LLM接口-CLI-给 LLM（和人）读图、检查、导出；工作区默认取 .synapsis/config.json
// 用法：node core/cli.js <命令> [参数] [--ws <被规划项目根目录>]
//   overview            分组树 + 状态统计（先看这个，省 token）
//   outline             完整大纲（可直接编辑后用 apply 写回）
//   export [节点id]     节点卡（给 LLM 的结构化文本），默认全部
//   get <节点id>        单个节点：属性 + 入边/出边 + 正文
//   check               悬空边、无状态、code 指向不存在的文件
//   apply <大纲文件>    用大纲文本整体写回（保留正文/属性/边标签；删除进 _过期的/）
//   init <项目目录>     给项目挂上 Synapsis：__synapsis/ + _synapsis.md、.synapsis/（自带 gitignore）、根目录 Synapsis.vbs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, workspaceOutline, checkWorkspace, saveOutline, ensureWorkspaceReadme, DIR } from './workspace.js';
import { exportForLLM, ROOT } from './outline.js';

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = { done: '✅', partial: '◐', todo: '○' };

export function workspaceRoot(argv = []) {
  const i = argv.indexOf('--ws');
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]);
  if (process.env.SYN_WS) return resolve(process.env.SYN_WS);
  const cfg = join(HOME, '.synapsis', 'config.json');
  if (existsSync(cfg)) return JSON.parse(readFileSync(cfg, 'utf8')).workspace;
  throw new Error('没有工作区：用 --ws <目录>，或写 .synapsis/config.json {"workspace": "..."}');
}

function overview(ws) {
  const g = ws.graph, out = [];
  const count = id => { const c = { done: 0, partial: 0, todo: 0, none: 0 }; const walk = x => { for (const k of g.nodes.get(x).children) { const n = g.nodes.get(k); if (!n.children.length) c[n.status || 'none']++; walk(k); } }; walk(id); return c; };
  const walk = (id, depth) => {
    for (const k of g.nodes.get(id).children) {
      const n = g.nodes.get(k);
      if (!n.children.length && depth > 1) continue; // 深层叶子不列，只给分组
      const c = n.children.length ? count(k) : null;
      out.push('  '.repeat(depth) + (n.status ? ICON[n.status] + ' ' : '') + n.label + (c ? `  [✅${c.done} ◐${c.partial} ○${c.todo}${c.none ? ' ?' + c.none : ''}]` : ''));
      walk(k, depth + 1);
    }
  };
  walk(ROOT, 0);
  return `工作区：${ws.root}\n节点 ${g.nodes.size - 1}，边 ${g.edges.length}${g.errors.length ? `，⚠️解析错误 ${g.errors.length}` : ''}\n\n` + out.join('\n');
}

function get(ws, id) {
  const g = ws.graph, n = g.nodes.get(id);
  if (!n) return '没有这个节点：' + id + '（id = 名称路径，用 outline 或 export 查）';
  const lab = e => e.label ? `(${e.label}${e.kind ? '，' + e.kind : ''})` : '';
  return [
    `## [${id}] ${n.label}  状态:${n.status ? ICON[n.status] : '未标'}`,
    ...Object.entries(n.meta).filter(([k]) => k !== 'to').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`),
    '输入(←): ' + (g.edges.filter(e => e.to === id).map(e => `[${e.from}]${lab(e)}`).join(' | ') || '无'),
    '输出(→): ' + (g.edges.filter(e => e.from === id).map(e => `[${e.to}]${lab(e)}`).join(' | ') || '无'),
    n.children.length ? '包含: ' + n.children.map(c => g.nodes.get(c).label).join('、') : '',
    n.body ? '\n' + n.body.trim() : '',
  ].filter(Boolean).join('\n');
}

// >v<🚀启停-init-给项目挂上 Synapsis（已有的文件不覆盖）
export function init(root) {
  const made = [];
  const put = (rel, content) => { const f = join(root, rel); if (existsSync(f)) return; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); made.push(rel); };
  mkdirSync(join(root, DIR), { recursive: true });
  if (ensureWorkspaceReadme(root, join(HOME, 'core', 'cli.js').split('\\').join('/'))) made.push(DIR + '/_synapsis.md');
  put('.synapsis/.gitignore', '# 本机状态（视图、缓存），不进 git\n*\n');
  put('Synapsis.vbs', readFileSync(join(HOME, 'core', 'templates', 'Synapsis.vbs'), 'utf8').split('{{SYNAPSIS_HOME}}').join(HOME));
  console.log(made.length ? '已创建：\n  ' + made.join('\n  ') : '都已存在，没动');
  console.log('双击 ' + join(root, 'Synapsis.vbs') + ' 打开');
}

function main(argv) {
  const [cmd, arg] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ws');
  if (!cmd) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (cmd === 'init') return init(resolve(arg || '.'));
  const root = workspaceRoot(argv);
  const ws = loadWorkspace(root);
  if (cmd === 'overview') console.log(overview(ws));
  else if (cmd === 'outline') console.log(workspaceOutline(ws));
  else if (cmd === 'export') console.log(exportForLLM(ws.graph, arg || ROOT));
  else if (cmd === 'get') console.log(get(ws, arg));
  else if (cmd === 'check') {
    const issues = checkWorkspace(ws);
    for (const i of issues) console.log(`${i.level === 'error' ? '✗' : i.level === 'warn' ? '⚠' : '·'} [${i.where}] ${i.msg}`);
    console.log(`check: ${issues.filter(i => i.level === 'error').length} 错 / ${issues.filter(i => i.level === 'warn').length} 警告 / ${issues.filter(i => i.level === 'info').length} 提示`);
    process.exitCode = issues.some(i => i.level === 'error') ? 1 : 0;
  } else if (cmd === 'apply') {
    const r = saveOutline(root, readFileSync(arg, 'utf8'));
    console.log(JSON.stringify(r, null, 1));
    process.exitCode = r.ok ? 0 : 1;
  } else { console.log('未知命令：' + cmd); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
