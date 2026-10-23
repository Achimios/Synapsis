#!/usr/bin/env node
// >v<🤖LLM接口-CLI-给 LLM（和人）读图、检查、导出；工作区默认取 .synapsis/config.json
// 完整说明见仓库根目录 __AI接入手册.md（= `node core/cli.js manual`）
export const USAGE = `用法：node core/cli.js <命令> [参数] [--ws <被规划项目根目录>]
读：
  overview                     分组树 + 状态统计（先看这个，省 token）
  outline                      完整大纲（可编辑后用 apply 整体写回）
  export [节点id]              节点卡（给 LLM 的结构化文本），默认全部
  get <节点id>                 单个节点：属性 + 入边/出边 + 正文
  find <关键词>                在名字 / 属性 / 正文里找
  check                        悬空边、无状态、code 指向不存在的文件 / 符号、时间轴 t0/t1 不对或同轨重叠
  timeline [页id] [--json]     时间轴页（timeline: true）上的条：t0 / t1（成片时间，秒）/ track / 图 / 正文，按 t0 排；
                               不带页id = 列出所有时间轴页。--json 给程序读（Eidolon edl.py 用这个）
写（每条都是原子的一小步；删除一律进 .junk/（关窗口时才清，期间能撤销），不真删）：
  add <父id|.> <名字> [--after <兄弟id>] [--if-missing]
                               新建节点，打印新 id；同级已有同名 → 报错（--if-missing 则直接返回已有 id）
                               根用 . （Git Bash 会把单独的 / 改写成 Git 安装目录）
  rename <id> <新名字>
  move <id> <新父id|.>          挪到别的父节点下（正文 / 属性 / 图片 / 连线跟着走，打印新 id）；目标里重名 → 报错
  status <id> <done|partial|todo|dropped|none>   dropped = 弃用 ❌（不算完成度，check 跳过）
  link <从id> <到id> [--label 标签] [--kind 类型]   连线（已有则只改标签）
  unlink <从id> <到id>
  body <id> <文件|->           用文件（- = 标准输入）替换正文
  set <id> 键=值 [键=值…]      改属性（值留空 = 删掉这个键）
  rm <id>                      删除节点和子孙
  frame <id> <视频> <时间>      从视频截一帧当这个节点的图（视频相对项目根或绝对路径；时间 = 秒或 分:秒，是素材时间）；
                               旁边同名 .md 记来源和 src_t。ffmpeg：SYN_FFMPEG > PATH > Eidolon 虚拟环境里那个
  batch <JSON文件|->           一次跑一批写命令（一个进程，不用每条 spawn）：
                               [["add",".","感知"],["set","感知","code=../a.js#see"],["body","感知","正文文本"]]
                               body 在 batch 里第三项直接是正文；末尾可带选项对象
                               {"label":…,"kind":…,"after":…,"ifMissing":true}；遇错停下，报告第几条
  apply <大纲文件>             用大纲文本整体写回（大改结构时用）
其它：
  launcher [目录]              重建项目根的快捷方式（换了 _图标/ 里的图标后用）
  manual                       打印 AI 接入手册
  init <项目目录>              给项目挂上 Synapsis`;
import { DEFAULT_ALL, WORDS_ALL } from './patterns.js';

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspace, workspaceOutline, checkWorkspace, groupStatus, saveOutline, ensureWorkspaceReadme, setNodeMeta, setNodeBody, setEdgeLabel, findNodes, moveNodes, ensureGitignore, MANUAL_MARK, DIR } from './workspace.js';
import { spaceInfo, closestPairs } from './space.js';
import { isTimeline, timelineInfo, parseBeats, round3 } from './timeline.js';
import { grabFrame } from './framegrab.js';
import { ensureLauncher, PROJECT_LNK } from './launcher.js';
import { loadSettings } from './settings.js';
import { scaffoldPlan, scaffoldWrite } from './scaffold.js';
import { exportForLLM, withNode, withLabel, withStatus, withEdge, withoutEdge, withoutNode, ROOT } from './outline.js';

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = { done: '✅', partial: '◐', todo: '○', dropped: '❌' };

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
  const count = id => { const c = { done: 0, partial: 0, todo: 0, none: 0, dropped: 0 }; const walk = x => { for (const k of g.nodes.get(x).children) { const n = g.nodes.get(k); if (n.status === 'dropped') { c.dropped++; continue; } if (!n.children.length) c[n.status || 'none']++; walk(k); } }; walk(id); return c; };
  const walk = (id, depth) => {
    for (const k of g.nodes.get(id).children) {
      const n = g.nodes.get(k);
      if (!n.children.length && depth > 1) continue; // 深层叶子不列，只给分组
      const c = n.children.length ? count(k) : null;
      const st = c ? groupStatus(g, k) : n.status; // 分组显示子节点汇总，不信分组自己标的
      out.push('  '.repeat(depth) + (st ? ICON[st] + ' ' : '') + n.label + (c ? `  [✅${c.done} ◐${c.partial} ○${c.todo}${c.none ? ' ?' + c.none : ''}${c.dropped ? ' ❌' + c.dropped : ''}]` : ''));
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

// >v<🎬时间轴-导出-CLI timeline：一页时间轴的条（给 Eidolon edl.py 读，👤 2026-10-24 剪辑真源在 Synapsis 节点）
// JSON 格式（和 ReadScreen 约定的，改了要先通知它）：
//   {page, unit: 's', fps, beats, items: [{id, label, t0, t1, track, pics: [绝对路径], body, ref, src?, speed?}]}，按 t0 排
//   传送门卡（ref:）自己没图 → 用它指向的节点的图；fps 没写就读 beats 那份的 fps
export function timeline(ws, page) {
  const g = ws.graph, meta = id => g.nodes.get(id)?.meta;
  if (!page) {
    const pages = [...g.nodes.keys()].filter(id => id !== ROOT && isTimeline(meta(id)));
    const data = pages.map(id => ({ page: id, items: timelineInfo(g, id, meta).items.length }));
    return { data, text: pages.length ? data.map(p => `[${p.page}] ${p.items} 条`).join('\n') : '没有时间轴页（页面节点写 timeline: true）' };
  }
  if (!g.nodes.has(page)) return { error: '没有这个节点：' + page };
  const info = timelineInfo(g, page, meta);
  if (!info) return { error: `${page} 不是时间轴页（它的属性里加 timeline: true）` };
  let src = null;
  if (info.beats) { try { src = parseBeats(JSON.parse(readFileSync(join(ws.root, info.beats), 'utf8'))); } catch { /* 读不到就当没有 */ } }
  const abs = p => join(ws.base, p).split('\\').join('/');
  const items = info.items.map(it => {
    const n = g.nodes.get(it.id), tgt = it.ref && g.nodes.get(it.ref);
    const pics = (n.pics?.length ? n.pics : tgt?.pics || []).map(abs);
    // src（剪辑表语法，如 样片:粒子海/20_….mp4@1.2、原片@0:52.5）/ speed：有才带；传送门卡自己没写 src 就用目标的（speed 是这一次用法，不继承）
    const src = n.meta.src ?? tgt?.meta?.src, speed = n.meta.speed;
    return { id: it.id, label: it.label, t0: round3(it.t0), t1: round3(it.t1), track: it.track, pics, body: (n.body || '').trim(), ref: it.ref, ...(src ? { src: String(src) } : {}), ...(speed ? { speed: String(speed) } : {}) };
  });
  const data = { page, unit: 's', fps: info.fps ?? src?.fps ?? null, beats: info.beats, items };
  const text = [`时间轴 [${page}]  fps ${data.fps ?? '未写'}${info.beats ? '  拍点 ' + info.beats + (src ? '' : '（读不到）') : ''}`,
    ...items.map(it => `${it.t0.toFixed(3)}–${it.t1.toFixed(3)}  轨${it.track}  ${it.label}${it.ref ? ' ↗' + it.ref : ''}${it.pics.length ? '  🖼' + it.pics.length : ''}`),
    info.loose.length ? '没上轴（没写 t0 / t1）：' + info.loose.map(c => g.nodes.get(c).label).join('、') : ''].filter(Boolean).join('\n');
  return { data, text };
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
// 挂 Synapsis 时可选的几样（界面「📄 项目文件…」对话框和命令行 init 共用）。exists = 已经有了，不会再写
export function synItems(root) {
  const has = rel => existsSync(join(root, rel));
  return [
    { key: 'manual', rel: DIR + '/_synapsis.md', exists: has(DIR + '/_synapsis.md') },
    { key: 'blackboard', rel: DIR + '/' + blackboardName(root), exists: has(DIR + '/' + blackboardName(root)) },
    { key: 'words', rel: DIR + '/' + WORDS_ALL, exists: has(DIR + '/' + WORDS_ALL) || has(DIR + '/_配色.md') },
    { key: 'launcher', rel: PROJECT_LNK, exists: has(PROJECT_LNK) },
  ];
}
// 挂上 Synapsis：__synapsis/ + .synapsis/ 总是建；keys 里的几样没有才写（已有的不覆盖）
export function synWrite(root, keys) {
  const want = new Set(keys || []), made = [];
  const put = (rel, content) => { const f = join(root, rel); if (existsSync(f)) return; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); made.push(rel); };
  if (!existsSync(join(root, DIR))) made.push(DIR + '/');
  mkdirSync(join(root, DIR), { recursive: true });
  if (want.has('manual') && ensureWorkspaceReadme(root, manualText(root))) made.push(DIR + '/_synapsis.md（AI 接入手册）');
  if (want.has('blackboard') && blackboardName(root) === '_Blackboard.md') put(DIR + '/_Blackboard.md', BLACKBOARD);
  if (want.has('words') && !existsSync(join(root, DIR, '_配色.md'))) put(DIR + '/' + WORDS_ALL, DEFAULT_ALL); // 👤 2026-10-12 颜色 + 图案合成一份 _词表.md（旧的 _配色.md 打开时会迁移过去）
  ensureGitignore(root);
  put('.synapsis/.gitignore', '# 本机状态（视图、缓存），不进 git\n*\n');
  // 启动器是生成物：根目录一个带图标的快捷方式 + 藏在 .synapsis/ 的兜底 vbs（core/launcher.js；Synapsis 搬家后重跑 init 即可修好）
  if (want.has('launcher')) made.push(...ensureLauncher(root, { force: true }));
  return made;
}
export function init(root, home = HOME) {
  const S = loadSettings(home).init; // settings.yaml 的 init 段：生成哪些（没有这个文件 = 默认）
  const made = synWrite(root, Object.keys(S).filter(k => S[k] === true));
  if (S.docs) made.push(...scaffoldWrite(root, scaffoldPlan(root).filter(i => !i.alike.length).map(i => i.rel)));
  console.log(made.length ? '已创建：\n  ' + made.join('\n  ') : '都已存在，没动');
  if (S.launcher) console.log('双击 ' + join(root, PROJECT_LNK) + ' 打开');
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
    const s = { done: 'done', partial: 'partial', todo: 'todo', dropped: 'dropped', none: null, '✅': 'done', '◐': 'partial', '○': 'todo', '❌': 'dropped' }[b?.replace(/\uFE0F/g, '')];
    if (s === undefined) throw new Error('状态只能是 done / partial / todo / dropped / none');
    commit(withStatus(g, need(a), s)); return a + ' → ' + (s || '无状态');
  }
  if (cmd === 'link') {
    need(a); need(b);
    if (!g.edges.some(e => e.from === a && e.to === b)) commit(withEdge(g, a, b));
    const label = flag(argv, '--label'), kind = flag(argv, '--kind');
    if (label !== undefined || kind !== undefined) setEdgeLabel(root, a, b, label || '', kind || '');
    return `${a} -> ${b}` + (label ? `（${label}${kind ? '·' + kind : ''}）` : '');
  }
  if (cmd === 'move') { need(a); return moveNodes(root, [a], isRoot(b) ? ROOT : need(b)).roots[0]; }
  if (cmd === 'unlink') { need(a); need(b); commit(withoutEdge(g, a, b)); return `已断开 ${a} -> ${b}`; }
  if (cmd === 'rm') { need(a); const r = commit(withoutNode(g, a)); return '已移进 .junk/：' + r.removed.join('、'); }
  if (cmd === 'body') { const text = argv.literalBody ? b ?? '' : !b || b === '-' ? readFileSync(0, 'utf8') : readFileSync(b, 'utf8'); setNodeBody(root, a, text); return a + ' 正文已替换（' + text.length + ' 字）'; }
  if (cmd === 'set') {
    need(a);
    const patch = {};
    for (const kv of args.slice(1)) { const i = kv.indexOf('='); if (i < 1) throw new Error('属性要写成 键=值：' + kv); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (['to', 'label', 'status', 'order'].includes(k)) throw new Error(k + ' 不能用 set 改（用 link / rename / status）'); patch[k] = v === '' ? null : v; }
    setNodeMeta(root, a, patch);
    const snap = ('evidence' in patch || 'code' in patch) && loadWorkspace(root).graph.nodes.get(a)?.meta.evidence_hash;
    return a + ' 属性已改：' + Object.keys(patch).join('、') + (snap ? `（实测：已记下 code 文件的快照，之后文件改了 check 会提示）` : '');
  }
  if (cmd === 'frame') { const p = grabFrame(root, a, b, args[2]); return '已截帧 → __synapsis/' + p + '（旁边同名 .md 记了来源和 src_t）'; }
  return null;
}

// >v<🤖LLM接口-batch-一批写命令一个进程跑完：[[命令, 参数…, {label,kind,after,ifMissing}?], …]；遇错停下
export const WRITE_CMDS = ['add', 'rename', 'move', 'status', 'link', 'unlink', 'body', 'set', 'rm', 'frame'];
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

// 工作区的讨论黑板：叫 _Blackboard.md（👤 2026-10-08：TODO / PLAN / Blackboard / LEARNINGS 用英文）；当天短暂用过中文名 _黑板.md，已有的就继续用它
export const blackboardName = root => root && existsSync(join(root, DIR, '_黑板.md')) && !existsSync(join(root, DIR, '_Blackboard.md')) ? '_黑板.md' : '_Blackboard.md';
export function manualText(root) {
  const cli = join(HOME, 'core', 'cli.js').split('\\').join('/');
  const ws = root ? root.split('\\').join('/') : '<被规划项目根目录>';
  const home = HOME.split('\\').join('/');
  const bb = blackboardName(root);
  return readFileSync(join(HOME, 'core', 'templates', 'AI_Manual.md'), 'utf8').replace(/\r\n/g, '\n').split('{{CLI}}').join(cli).split('{{WS}}').join(ws).split('{{HOME}}').join(home).split('{{USAGE}}').join(USAGE).split('{{BB}}').join(bb);
}
// 仓库根目录 __AI接入手册.md = 通用版（不填工作区）；自检会核对它和模板是否一致
export const ROOT_MANUAL = join(HOME, '__AI接入手册.md');
export const rootManualText = () => MANUAL_MARK + '\n' + manualText(null);

function main(argv) {
  const pos = argv.filter((a, i) => !a.startsWith('--') && !FLAGS.has(argv[i - 1]));
  const [cmd, arg] = pos;
  if (!cmd) { console.log(USAGE); return; }
  if (cmd === 'init') return init(resolve(arg || '.'));
  if (cmd === 'launcher') { const m = ensureLauncher(resolve(arg || '.'), { force: true }); console.log(m.length ? '已刷新：\n  ' + m.join('\n  ') : '没动'); return; }
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
  else if (cmd === 'timeline') { const r = timeline(ws, arg); if (r.error) { console.error('✗ ' + r.error); process.exitCode = 1; } else console.log(argv.includes('--json') ? JSON.stringify(r.data, null, 1) : r.text); }
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
