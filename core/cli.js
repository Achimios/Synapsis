#!/usr/bin/env node
// >v<🤖LLM接口-CLI-给 LLM（和人）读图、检查、导出；工作区默认取 .synapsis/config.json
// 完整说明见仓库根目录 _AI_Manual.md（= `node core/cli.js manual`）
export const USAGE = `用法：node core/cli.js <命令> [参数] [--ws <被规划项目根目录>]
读：
  overview                     分组树 + 状态统计（先看这个，省 token）
  outline                      完整大纲（可编辑后用 apply 整体写回）
  export [节点id]              节点卡（给 LLM 的结构化文本），默认全部
  get <节点id>                 单个节点：属性 + 入边/出边 + 正文
  find <关键词>                在名字 / 属性 / 正文里找
  check                        悬空边、无状态、code 指向不存在的文件 / 符号
写（每条都是原子的一小步；删除一律进 _过期的/，不真删）：
  add <父id|.> <名字> [--after <兄弟id>] [--if-missing]
                               新建节点，打印新 id；同级已有同名 → 报错（--if-missing 则直接返回已有 id）
                               根用 . （Git Bash 会把单独的 / 改写成 Git 安装目录）
  rename <id> <新名字>
  status <id> <done|partial|todo|none>
  link <从id> <到id> [--label 标签] [--kind 类型]   连线（已有则只改标签）
  unlink <从id> <到id>
  body <id> <文件|->           用文件（- = 标准输入）替换正文
  set <id> 键=值 [键=值…]      改属性（值留空 = 删掉这个键）
  rm <id>                      删除节点和子孙
  batch <JSON文件|->           一次跑一批写命令（一个进程，不用每条 spawn）：
                               [["add",".","感知"],["set","感知","code=../a.js#see"],["body","感知","正文文本"]]
                               body 在 batch 里第三项直接是正文；末尾可带选项对象
                               {"label":…,"kind":…,"after":…,"ifMissing":true}；遇错停下，报告第几条
  apply <大纲文件>             用大纲文本整体写回（大改结构时用）
其它：
  manual                       打印 AI 接入手册
  init <项目目录>              给项目挂上 Synapsis`;
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, workspaceOutline, checkWorkspace, groupStatus, saveOutline, ensureWorkspaceReadme, setNodeMeta, setNodeBody, setEdgeLabel, findNodes, MANUAL_MARK, DIR } from './workspace.js';
import { spaceInfo, closestPairs } from './space.js';
import { exportForLLM, withNode, withLabel, withStatus, withEdge, withoutEdge, withoutNode, ROOT } from './outline.js';

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
      const st = c ? groupStatus(g, k) : n.status; // 分组显示子节点汇总，不信分组自己标的
      out.push('  '.repeat(depth) + (st ? ICON[st] + ' ' : '') + n.label + (c ? `  [✅${c.done} ◐${c.partial} ○${c.todo}${c.none ? ' ?' + c.none : ''}]` : ''));
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
    spaceText(g, id),
    n.body ? '\n' + n.body.trim() : '',
  ].filter(Boolean).join('\n');
}

const BLACKBOARD = '# 讨论黑板（人和各个 AI 讨论这个项目的设计）\n\n> 格式：`## YYYY-MM-DD · 谁 · 话题`，往下追加。定下来的结论搬进对应节点的正文 / 属性，这里的条目剪进 `_过期的/_Blackboard.md`。\n> Synapsis 工具本身的问题不写这里，写 Synapsis 仓库根目录的 `_Blackboard.md`。\n';
// 空间节点：轴、成员数、哪几个成员方向几乎一样（不正交的证据）
function spaceText(g, id) {
  const s = spaceInfo(g, id, x => g.nodes.get(x)?.meta);
  if (!s) return '';
  const pairs = closestPairs(s, 3).map(p => `${p.a}·${p.b} cos ${p.cos.toFixed(2)}`).join('；');
  return `空间: ${s.axes.length} 轴（${s.axes.join('、')}），${s.members.length} 个成员有坐标`
    + (pairs ? '\n最相近的成员方向: ' + pairs : '')
    + (s.maps.length ? '\n映射: ' + s.maps.map(m => `→${m.ref}（${m.W.length}×${m.W[0]?.length || 0}）`).join('、') : '');
}

// >v<🚀启停-init-给项目挂上 Synapsis（已有的文件不覆盖）
export function init(root) {
  const made = [];
  const put = (rel, content) => { const f = join(root, rel); if (existsSync(f)) return; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); made.push(rel); };
  mkdirSync(join(root, DIR), { recursive: true });
  if (ensureWorkspaceReadme(root, manualText(root))) made.push(DIR + '/_synapsis.md（AI 接入手册）');
  put(DIR + '/_Blackboard.md', BLACKBOARD);
  put('.synapsis/.gitignore', '# 本机状态（视图、缓存），不进 git\n*\n');
  // 启动器是生成物：内容和最新模板不同就刷新（Synapsis 搬家/改目录后重跑 init 即可修好旧项目）
  const vbs = join(root, 'Synapsis.vbs');
  const fresh = readFileSync(join(HOME, 'core', 'templates', 'Synapsis.vbs'), 'utf8').split('{{SYNAPSIS_HOME}}').join(HOME);
  if (!existsSync(vbs)) { writeFileSync(vbs, fresh); made.push('Synapsis.vbs'); }
  else if (readFileSync(vbs, 'utf8') !== fresh) { writeFileSync(vbs, fresh); made.push('Synapsis.vbs（按新模板刷新）'); }
  console.log(made.length ? '已创建：\n  ' + made.join('\n  ') : '都已存在，没动');
  console.log('双击 ' + join(root, 'Synapsis.vbs') + ' 打开');
}

// >v<🤖LLM接口-写命令-add/rename/status/link/unlink/body/set/rm：都走「改大纲文本 → saveOutline」同一条路，和界面一致
const FLAGS = new Set(['--ws', '--label', '--kind', '--after']);
const UNFW = { '／': '/', '＼': '\\', '：': ':', '＊': '*', '？': '?', '＂': '"', '＜': '<', '＞': '>', '｜': '|' };
const flag = (argv, f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
export function runWrite(root, cmd, args, argv = []) {
  const g = loadWorkspace(root).graph;
  const need = id => {
    if (id && !g.nodes.has(id)) { const alt = id.replace(/[／＼：＊？＂＜＞｜]/g, c => UNFW[c]); if (g.nodes.has(alt)) return alt; } // 接受文件名的全角写法
    if (!g.nodes.has(id) || id === ROOT) throw new Error('没有这个节点：' + id + '（id = 名称路径；用 find / outline 查）');
    return id;
  };
  const isRoot = x => !x || x === '/' || x === '.' || (/^[A-Za-z]:[\\/]/.test(x) && !g.nodes.has(x)); // 后者 = Git Bash 改写过的 /
  const commit = text => { if (!text) throw new Error('没有变化（同名、已存在或不合法）'); const r = saveOutline(root, text); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r; };
  let [a, b] = args;
  if (cmd !== 'add') a = a && need(a);
  if (cmd === 'link' || cmd === 'unlink') b = need(b);
  if (cmd === 'add') {
    const parent = isRoot(a) ? ROOT : need(a);
    if (!b || /->|[,，]/.test(b)) throw new Error('名字不能空，也不能含 -> 或逗号');
    b = b.trim();
    const twin = g.nodes.get(parent).children.find(c => g.nodes.get(c).label === b);
    if (twin) { if (argv.includes('--if-missing')) return twin; throw new Error('同级已有同名节点：' + twin + '（要幂等就加 --if-missing）'); }
    const after = flag(argv, '--after');
    const r = withNode(g, parent, after ? need(after) : null, b.trim());
    commit(r.text); return r.id;
  }
  if (cmd === 'rename') { need(a); commit(withLabel(g, a, b || '')); const p = g.nodes.get(a).parent; return p === ROOT ? b.trim() : p + '/' + b.trim(); }
  if (cmd === 'status') {
    const s = { done: 'done', partial: 'partial', todo: 'todo', none: null, '✅': 'done', '◐': 'partial', '○': 'todo' }[b];
    if (s === undefined) throw new Error('状态只能是 done / partial / todo / none');
    commit(withStatus(g, need(a), s)); return a + ' → ' + (s || '无状态');
  }
  if (cmd === 'link') {
    need(a); need(b);
    if (!g.edges.some(e => e.from === a && e.to === b)) commit(withEdge(g, a, b));
    const label = flag(argv, '--label'), kind = flag(argv, '--kind');
    if (label !== undefined || kind !== undefined) setEdgeLabel(root, a, b, label || '', kind || '');
    return `${a} -> ${b}` + (label ? `（${label}${kind ? '·' + kind : ''}）` : '');
  }
  if (cmd === 'unlink') { need(a); need(b); commit(withoutEdge(g, a, b)); return `已断开 ${a} -> ${b}`; }
  if (cmd === 'rm') { need(a); const r = commit(withoutNode(g, a)); return '已移进 _过期的/：' + r.removed.join('、'); }
  if (cmd === 'body') { const text = argv.literalBody ? b ?? '' : !b || b === '-' ? readFileSync(0, 'utf8') : readFileSync(b, 'utf8'); setNodeBody(root, a, text); return a + ' 正文已替换（' + text.length + ' 字）'; }
  if (cmd === 'set') {
    need(a);
    const patch = {};
    for (const kv of args.slice(1)) { const i = kv.indexOf('='); if (i < 1) throw new Error('属性要写成 键=值：' + kv); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (['to', 'label', 'status', 'order'].includes(k)) throw new Error(k + ' 不能用 set 改（用 link / rename / status）'); patch[k] = v === '' ? null : v; }
    setNodeMeta(root, a, patch); return a + ' 属性已改：' + Object.keys(patch).join('、');
  }
  return null;
}

// >v<🤖LLM接口-batch-一批写命令一个进程跑完：[[命令, 参数…, {label,kind,after,ifMissing}?], …]；遇错停下
export const WRITE_CMDS = ['add', 'rename', 'status', 'link', 'unlink', 'body', 'set', 'rm'];
export function runBatch(root, ops) {
  if (!Array.isArray(ops)) throw new Error('batch 要一个 JSON 数组：[["add",".","名字"], …]');
  const out = [];
  ops.forEach((op, i) => {
    if (!Array.isArray(op) || !WRITE_CMDS.includes(op[0])) throw new Error(`第 ${i + 1} 条不是写命令：${JSON.stringify(op)}`);
    const opt = op.length > 1 && typeof op[op.length - 1] === 'object' ? op.pop() : {};
    const argv = [];
    for (const k of ['label', 'kind', 'after']) if (opt[k] !== undefined) argv.push('--' + k, String(opt[k]));
    if (opt.ifMissing) argv.push('--if-missing');
    argv.literalBody = true;
    try { out.push(runWrite(root, op[0], op.slice(1).map(String), argv)); }
    catch (e) { throw new Error(`第 ${i + 1} 条 ${JSON.stringify(op)} 失败：${e.message}（前 ${i} 条已写入）`); }
  });
  return out.join('\n');
}

export function manualText(root) {
  const cli = join(HOME, 'core', 'cli.js').split('\\').join('/');
  const ws = root ? root.split('\\').join('/') : '<被规划项目根目录>';
  const home = HOME.split('\\').join('/');
  return readFileSync(join(HOME, 'core', 'templates', 'AI_Manual.md'), 'utf8').replace(/\r\n/g, '\n').split('{{CLI}}').join(cli).split('{{WS}}').join(ws).split('{{HOME}}').join(home).split('{{USAGE}}').join(USAGE);
}
// 仓库根目录 _AI_Manual.md = 通用版（不填工作区）；自检会核对它和模板是否一致
export const ROOT_MANUAL = join(HOME, '_AI_Manual.md');
export const rootManualText = () => MANUAL_MARK + '\n' + manualText(null);

function main(argv) {
  const pos = argv.filter((a, i) => !a.startsWith('--') && !FLAGS.has(argv[i - 1]));
  const [cmd, arg] = pos;
  if (!cmd) { console.log(USAGE); return; }
  if (cmd === 'init') return init(resolve(arg || '.'));
  if (cmd === 'manual' && argv.includes('--write')) { writeFileSync(ROOT_MANUAL, rootManualText()); console.log('已写 ' + ROOT_MANUAL); return; }
  if (cmd === 'manual') { let r = null; try { r = workspaceRoot(argv); } catch { /* 没工作区就给通用版 */ } console.log(manualText(r)); return; }
  const root = workspaceRoot(argv);
  if (WRITE_CMDS.includes(cmd) || cmd === 'batch') {
    try { console.log(cmd === 'batch' ? runBatch(root, JSON.parse(readFileSync(!arg || arg === '-' ? 0 : arg, 'utf8'))) : runWrite(root, cmd, pos.slice(1), argv)); }
    catch (e) { console.error('✗ ' + e.message); process.exitCode = 1; }
    return;
  }
  const ws = loadWorkspace(root);
  if (cmd === 'find') { const r = findNodes(ws, arg || ''); console.log(r.length ? r.map(x => `[${x.id}]（${x.where}）…${x.snippet}…`).join('\n') : '没找到'); }
  else if (cmd === 'overview') console.log(overview(ws));
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
