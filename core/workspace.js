// 工作区读写：<项目>/__synapsis/ 文件夹 ⇄ 图。纯 Node，无依赖。自检：core/test/workspace.test.js
// 布局约定（文件夹 = 层级）：
//   叶子节点      名字.md
//   有子节点的    名字/_node.md   （它自己的属性与正文）
//   以 _ 或 . 开头的文件/目录不是节点（_layout.json、_assets/、_过期的/、_synapsis.md）
//   节点的图片    _pics_名字/   （紧挨节点的 .md：叶子在同目录，分组在自己文件夹里；文件夹本身就是真源，往里丢图就显示）
//   散图          _pics/        （某一页上不属于任何节点的图：根页在 __synapsis/_pics/，分组页在 分组/_pics/；坐标在 _layout.json 的 @pic:路径）
// 节点文件 = frontmatter + 正文：
//   ---
//   status: done | partial | todo
//   order: 0                      （兄弟间顺序）
//   rate: 0.5–5 Hz                （其余键原样保留）
//   to:
//     - 决策空间 | 局势             （出边：目标 | 标签 | 类型）
//   ---
//   正文（人写的，Synapsis 不动）
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, rmdirSync, cpSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { parseOutline, toOutline, resolveLabel, shortRef, isDropped, withCopies, withEdge, withoutEdge, withMoved, ROOT } from './outline.js';
import { checkSpaces } from './space.js';
import { WORDS_FILE, DEFAULT_WORDS, parseColorWords } from './colors.js';

export const DIR = '__synapsis';
const NODE_FILE = '_node.md';
const STATUS_IN = { done: 'done', partial: 'partial', todo: 'todo', dropped: 'dropped', '✅': 'done', '◐': 'partial', '○': 'todo', '❌': 'dropped' };
const KEY_ORDER = ['label', 'status', 'order'];
// 名字里有文件名非法字符（如 NN/LLM 的 /，会被当成路径）→ 文件名换全角，原名存 frontmatter label:
const FW = { '/': '／', '\\': '＼', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' };
export const fileName = label => label.replace(/[\/\\:*?"<>|]/g, c => FW[c]).replace(/[. ]+$/, m => m.replace(/./g, '＿'));
// 图片文件夹用 _ 不用 .：Obsidian 不索引点开头的文件夹，正文里 ![](...) 会断
export const picsDir = (file, label) => join(dirname(file), '_pics_' + fileName(label));
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
// 一页的文件夹：根 = __synapsis/，分组 = 它自己的文件夹；叶子没有自己的文件夹（返回 null）
export const pageDir = (base, n) => !n || n.id === ROOT ? base : n.isGroup ? dirname(n.file) : null;
const posix = p => p.split('\\').join('/');
const listPics = (dir, base) => { try { return readdirSync(dir).filter(f => IMG_EXT.test(f)).sort().map(f => relative(base, join(dir, f)).split('\\').join('/')); } catch { return []; } };

// >v<💾工作区-frontmatter-最小 YAML 子集：key: value 与 key: + "  - 项" 列表
export function parseFrontmatter(text) {
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return { meta: {}, body: t };
  const end = t.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: t };
  const meta = {};
  let listKey = null;
  for (const line of t.slice(4, end).split('\n')) {
    const item = line.match(/^\s+-\s*(.*)$/);
    if (item && listKey) { meta[listKey].push(item[1].trim()); continue; }
    const kv = line.match(/^([^:\s][^:]*):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (v === '') { meta[k.trim()] = []; listKey = k.trim(); }
    else { meta[k.trim()] = v.trim() === '""' ? '' : v.trim(); listKey = null; }
  }
  const body = t.slice(end + 4).replace(/^\n+/, '');
  return { meta, body };
}

export function serializeNode(meta, body) {
  const keys = [...KEY_ORDER.filter(k => k in meta), ...Object.keys(meta).filter(k => !KEY_ORDER.includes(k) && k !== 'to').sort(), ...('to' in meta ? ['to'] : [])];
  const lines = ['---'];
  for (const k of keys) {
    const v = meta[k];
    if (Array.isArray(v)) { if (!v.length) continue; lines.push(k + ':'); for (const x of v) lines.push('  - ' + x); }
    else if (v === '' && !KEY_ORDER.includes(k)) lines.push(`${k}: ""`); // 人加的属性可以先空着值（👤 2026-10-08：清空值不该删掉属性）
    else if (v !== undefined && v !== null && v !== '') lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  // frontmatter 与正文之间固定空一行（读的时候去掉开头空行）→ 人手写的、导入的、Synapsis 写的格式一致，往返不抖动
  return lines.join('\n') + (body ? '\n' + body.replace(/\s+$/, '') + '\n' : '');
}

const parseEdge = s => { const [to, label = '', kind = ''] = s.split('|').map(x => x.trim()); return { to, label, kind }; };
const fmtEdge = e => [e.ref, e.label, e.kind].join(' | ').replace(/( \| )+$/, '');

// >v<💾工作区-读取-__synapsis/ → 图（与大纲同构：id = 名称路径），附带 file/meta/body
export function loadWorkspace(root) {
  const base = join(root, DIR);
  const nodes = new Map([[ROOT, { id: ROOT, label: '根', parent: null, status: null, children: [], meta: {}, body: '' }]]);
  const errors = [];
  const readNode = file => existsSync(file) ? parseFrontmatter(readFileSync(file, 'utf8')) : { meta: {}, body: '' };
  const walk = (dir, parent) => {
    if (!existsSync(dir)) return;
    const kids = [];
    for (const e of readdirSync(dir)) {
      if (e.startsWith('_') || e.startsWith('.')) continue;
      const abs = join(dir, e);
      const isDir = statSync(abs).isDirectory();
      if (!isDir && !e.endsWith('.md')) continue;
      const file = isDir ? join(abs, NODE_FILE) : abs;
      const { meta, body } = readNode(file);
      const label = meta.label || (isDir ? e : e.slice(0, -3));
      const id = parent === ROOT ? label : parent + '/' + label;
      const status = STATUS_IN[meta.status] || null;
      const order = meta.order !== undefined && meta.order !== '' ? +meta.order : Infinity;
      const { status: _s, order: _o, label: _l, ...rest } = meta;
      const pics = listPics(picsDir(file, label), base);
      const node = { id, label, parent, status, children: [], file, isGroup: isDir, meta: rest, body, order, pics };
      nodes.set(id, node);
      kids.push(node);
      if (isDir) walk(abs, id);
    }
    kids.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh'));
    nodes.get(parent).children = kids.map(k => k.id);
  };
  walk(base, ROOT);
  // 散图：每一页的 _pics/
  const loose = {};
  for (const n of nodes.values()) { const d = pageDir(base, n); const l = d ? listPics(join(d, '_pics'), base) : []; if (l.length) loose[n.id] = l; }
  const edges = [];
  for (const n of nodes.values()) {
    for (const raw of n.meta.to || []) {
      const e = parseEdge(raw);
      const to = resolveLabel(nodes, n.id, e.to);
      if (!to) { errors.push({ file: relative(base, n.file || base), msg: '找不到连线目标：' + e.to }); continue; }
      edges.push({ id: n.id + '->' + to, from: n.id, to, label: e.label, kind: e.kind });
    }
  }
  let layout = {};
  try { layout = JSON.parse(readFileSync(join(base, '_layout.json'), 'utf8')); } catch { /* 没有就空 */ }
  const wf = join(base, WORDS_FILE), colorWords = existsSync(wf) ? readFileSync(wf, 'utf8') : null; // 配色词表（没有 = 用默认）
  return { root, base, graph: { nodes, edges, errors }, layout, loose, colorWords };
}

export const workspaceOutline = ws => toOutline(ws.graph);

// 把新图的每个节点对到旧节点（同 id，或同父下 1:1 的改名），自顶向下，父改名时子节点跟着走
// hint = Map(新 id → 旧 id)：调用方确切知道的对应（移动节点时），先认这些，不靠名字猜
function matchNodes(cur, next, hint = null) {
  const map = new Map([[ROOT, ROOT]]); // newId -> curId | null
  const used = new Set([ROOT]);
  const pre = new Set();
  if (hint) for (const [nid, cid] of hint) if (next.nodes.has(nid) && cur.nodes.has(cid) && !used.has(cid)) { map.set(nid, cid); used.add(cid); pre.add(nid); }
  const visit = newParent => {
    const curParent = map.get(newParent);
    const newKids = next.nodes.get(newParent).children;
    const curKids = curParent !== null && cur.nodes.has(curParent) ? cur.nodes.get(curParent).children : [];
    const unmatchedNew = [];
    for (const nk of newKids) {
      if (pre.has(nk)) continue;
      const label = next.nodes.get(nk).label;
      const hit = curKids.find(ck => cur.nodes.get(ck).label === label && !used.has(ck));
      if (hit) { map.set(nk, hit); used.add(hit); } else unmatchedNew.push(nk);
    }
    const unmatchedCur = curKids.filter(ck => !used.has(ck));
    const paired = unmatchedNew.length === unmatchedCur.length;
    unmatchedNew.forEach((nk, i) => { if (paired) { map.set(nk, unmatchedCur[i]); used.add(unmatchedCur[i]); } else map.set(nk, null); });
    for (const nk of newKids) visit(nk);
  };
  visit(ROOT);
  // 跨父移动（👤 2026-10-08 要把 队长 / 斥候 挪进 小队）：同父下没对上的新节点，若全图只有一个同名的旧节点也没被用上 → 认作搬家
  // （以前这里会当成「删旧建新」：正文、属性进 _过期的/，新位置是空节点）
  const order = [];
  const dfs = id => { for (const c of next.nodes.get(id).children) { order.push(c); dfs(c); } };
  dfs(ROOT);
  for (const nk of order) {
    if (map.get(nk) !== null) continue;
    const label = next.nodes.get(nk).label;
    const cands = [...cur.nodes.keys()].filter(ck => ck !== ROOT && !used.has(ck) && cur.nodes.get(ck).label === label);
    const twins = order.filter(x => map.get(x) === null && next.nodes.get(x).label === label);
    if (cands.length !== 1 || twins.length !== 1) continue;
    map.set(nk, cands[0]); used.add(cands[0]);
    visit(nk); // 它的子节点跟着重新对
  }
  return { map, used };
}

// Windows 上 git checkout 会把文件转成 CRLF → 按字节比会把没改的文件全重写一遍（2026-10-07 自身工作区 apply 抓到）
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');

// >v<💾工作区-写回-大纲 → 文件：保留正文/其余属性/边标签；改名=搬文件；删除=移进 _过期的/（不真删）
export function saveOutline(root, text, hint = null) {
  const next = parseOutline(text);
  if (next.errors.length) return { ok: false, errors: next.errors };
  const ws = loadWorkspace(root);
  const cur = ws.graph, base = ws.base;
  const { map, used } = matchNodes(cur, next, hint);
  const curEdge = new Map(cur.edges.map(e => [e.from + '->' + e.to, e]));
  const report = { ok: true, written: [], moved: [], removed: [], restore: [] }; // restore = [[过期的里的路径, 原路径]…]（相对 base），给撤销用

  // 目标路径与内容
  const pathOf = id => {
    const segs = [];
    for (let c = id; c !== ROOT; c = next.nodes.get(c).parent) segs.unshift(fileName(next.nodes.get(c).label));
    return segs;
  };
  const writes = new Map(); // abs -> content
  for (const [id, n] of next.nodes) {
    if (id === ROOT) continue;
    const old = map.get(id) ? cur.nodes.get(map.get(id)) : null;
    const segs = pathOf(id);
    const isGroup = n.children.length > 0;
    const file = isGroup ? join(base, ...segs, NODE_FILE) : join(base, ...segs.slice(0, -1), segs.at(-1) + '.md');
    const meta = { ...(old ? old.meta : {}) };
    if (fileName(n.label) !== n.label) meta.label = n.label; else delete meta.label;
    if (n.status) meta.status = n.status; else delete meta.status;
    meta.order = String(next.nodes.get(n.parent).children.indexOf(id));
    const to = next.edges.filter(e => e.from === id).map(e => {
      const oe = old && curEdge.get(old.id + '->' + map.get(e.to));
      return fmtEdge({ ref: shortRef(next, id, e.to), label: oe ? oe.label : '', kind: oe ? oe.kind : '' });
    });
    if (to.length) meta.to = to; else delete meta.to;
    writes.set(file, { content: serializeNode(meta, old ? old.body : ''), old, label: n.label });
  }

  // 1) 删掉的节点 → _过期的/
  const graveyard = join(base, '_过期的');
  for (const [id, n] of cur.nodes) {
    if (id === ROOT || used.has(id) || !n.file || !existsSync(n.file)) continue;
    mkdirSync(graveyard, { recursive: true });
    const dst = join(graveyard, `${stamp()}_${id.replace(/\//g, '～')}.md`);
    renameSync(n.file, dst);
    report.removed.push(relative(base, dst));
    report.restore.push([relative(base, dst), relative(base, n.file)]);
    const pd = picsDir(n.file, n.label);
    if (existsSync(pd)) { renameSync(pd, dst.slice(0, -3) + '_pics'); report.restore.push([relative(base, dst.slice(0, -3) + '_pics'), relative(base, pd)]); }
    const lp = n.isGroup ? join(dirname(n.file), '_pics') : null; // 删掉的分组页上的散图
    if (lp && existsSync(lp)) { renameSync(lp, dst.slice(0, -3) + '_散图'); report.restore.push([relative(base, dst.slice(0, -3) + '_散图'), relative(base, lp)]); }
  }
  // 2) 写新内容（只写变了的）
  for (const [file, { content, old }] of writes) {
    const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (prev !== null && sameText(prev, content)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    report.written.push(relative(base, file));
    if (old && old.file !== file) report.moved.push(relative(base, old.file) + ' → ' + relative(base, file));
  }
  // 2a) 散图文件夹 _pics/ 跟着分组文件夹走；分组变叶子 → 并进它自己的 _pics_名字/；坐标键 @pic:旧前缀 → 新前缀
  const picKeys = {}; // 旧前缀 -> 新前缀（相对 base，正斜杠）
  for (const [file, { old, label }] of writes) {
    if (!old || !old.isGroup) continue;
    const from = join(dirname(old.file), '_pics');
    if (!existsSync(from)) continue;
    let to = file.endsWith(NODE_FILE) ? join(dirname(file), '_pics') : picsDir(file, label);
    if (to === from) continue;
    if (existsSync(to)) to = join(graveyard, `${stamp()}_${label}_散图`);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    picKeys[posix(relative(base, from)) + '/'] = posix(relative(base, to)) + '/';
    report.moved.push(relative(base, from) + ' → ' + relative(base, to));
  }
  // 2b) 图片文件夹跟着节点走（改名、移动、叶子⇄分组）
  for (const [file, { old, label }] of writes) {
    if (!old || !old.file) continue;
    const from = picsDir(old.file, old.label), to = picsDir(file, label);
    if (from === to || !existsSync(from) || existsSync(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    report.moved.push(relative(base, from) + ' → ' + relative(base, to));
  }
  // 3) 搬走的旧文件删掉（内容已在新位置）
  for (const [, { old }] of writes) {
    if (old && old.file && !writes.has(old.file) && existsSync(old.file)) unlinkSync(old.file);
  }
  // 4) 清空目录
  const prune = dir => {
    for (const e of readdirSync(dir)) {
      if (e.startsWith('_') || e.startsWith('.')) continue;
      const abs = join(dir, e);
      if (statSync(abs).isDirectory()) { prune(abs); if (!readdirSync(abs).length) rmdirSync(abs); }
    }
  };
  if (existsSync(base)) prune(base);
  // 5) 布局跟着改名走
  const layout = {};
  // 新节点（cid = null）：前端可能先写了坐标（右键「在这里新建」），留着
  for (const [nid, cid] of map) if (cid !== null && ws.layout[cid]) layout[nid] = ws.layout[cid]; else if (cid === null && ws.layout[nid]) layout[nid] = ws.layout[nid];
  for (const k of Object.keys(ws.layout)) if (k.startsWith('@portal:')) layout[k] = ws.layout[k];
  for (const k of Object.keys(ws.layout)) if (k.startsWith('@pic:')) {
    const p = k.slice(5), hit = Object.keys(picKeys).find(o => p.startsWith(o));
    layout['@pic:' + (hit ? picKeys[hit] + p.slice(hit.length) : p)] = ws.layout[k];
  }
  writeLayout(base, layout);
  return report;
}

// >v<💾工作区-撤销删除-把 saveOutline 移进 _过期的/ 的文件搬回原处（之后再写回删除前的大纲，正文和属性就都在）
// 只搬 _过期的/ 里的东西、只搬回 __synapsis/ 里面、目标已存在就跳过
export function restoreRemoved(root, pairs) {
  const base = join(root, DIR), grave = join(base, '_过期的');
  const inside = (p, dir) => { const r = relative(dir, p); return r && !r.startsWith('..') && !isAbsolute(r); };
  const done = [];
  for (const [from, to] of pairs || []) {
    const src = join(base, from), dst = join(base, to);
    if (!inside(src, grave) || !inside(dst, base) || inside(dst, grave)) continue;
    if (!existsSync(src) || existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    done.push(to);
  }
  return done;
}

function writeLayout(base, layout) {
  const sorted = Object.fromEntries(Object.keys(layout).sort().map(k => [k, { x: Math.round(layout[k].x), y: Math.round(layout[k].y), ...(layout[k].w ? { w: Math.round(layout[k].w) } : {}) }]));
  mkdirSync(base, { recursive: true });
  const file = join(base, '_layout.json');
  const content = JSON.stringify(sorted, null, 1) + '\n';
  if (!existsSync(file) || !sameText(readFileSync(file, 'utf8'), content)) writeFileSync(file, content);
}

export function saveLayout(root, positions) {
  const ws = loadWorkspace(root);
  // 按键合并（散图的 w 宽度和 x/y 分开更新时不互相覆盖）
  const lay = { ...ws.layout };
  for (const [k, v] of Object.entries(positions)) lay[k] = { ...lay[k], ...v };
  writeLayout(ws.base, lay);
}

// >v<💾工作区-改属性-单个节点的 frontmatter 合并（贴图、spec 等大纲表达不了的东西）
export function setNodeMeta(root, id, patch) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(id);
  if (!n || id === ROOT) throw new Error('没有这个节点：' + id);
  const meta = { ...n.meta, ...(fileName(n.label) !== n.label ? { label: n.label } : {}), ...(n.status ? { status: n.status } : {}), ...(n.order !== Infinity ? { order: String(n.order) } : {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete meta[k]; else meta[k] = v; }
  writeFileSync(n.file, serializeNode(meta, n.body));
}

// >v<🎨画布-配色词表-没有 _配色.md 就按默认词表写一份（界面「词表…」按钮），返回它的路径
export function ensureColorWords(root) {
  const f = join(root, DIR, WORDS_FILE);
  if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, DEFAULT_WORDS); }
  return f;
}

// >v<💾工作区-粘贴节点-复制 ids（子孙、状态、内部边）到 parent 下，再把属性（除结构字段）、正文、节点图片跟着拷（👤 2026-10-08）
export function pasteNodes(root, ids, parent) {
  const ws = loadWorkspace(root);
  const r = withCopies(ws.graph, ids, parent);
  if (!r) throw new Error('没有可复制的节点（不在这个工作区？）');
  const report = saveOutline(root, r.text);
  if (!report.ok) throw new Error('粘贴失败：' + JSON.stringify(report.errors || report));
  const now = loadWorkspace(root);
  for (const [o, n] of r.map) {
    const src = ws.graph.nodes.get(o), dst = now.graph.nodes.get(n);
    if (!src || !dst) continue;
    const extra = Object.fromEntries(Object.entries(src.meta).filter(([k]) => !['to', 'label', 'status', 'order'].includes(k)));
    const meta = { ...dst.meta, ...extra, ...(fileName(dst.label) !== dst.label ? { label: dst.label } : {}), ...(dst.status ? { status: dst.status } : {}), ...(dst.order !== Infinity ? { order: String(dst.order) } : {}) };
    writeFileSync(dst.file, serializeNode(meta, src.body));
    const pf = picsDir(src.file, src.label), pt = picsDir(dst.file, dst.label);
    if (existsSync(pf) && !existsSync(pt)) cpSync(pf, pt, { recursive: true });
  }
  return { ...report, map: r.map, roots: r.roots, outline: r.text };
}

// >v<🖼️图片-贴图落盘-存进节点旁边的 _pics_名字/（不写 frontmatter：文件夹就是真源）
function writeImage(dir, base, dataUrl) {
  const m = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
  if (!m) throw new Error('不是图片 dataURL');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1];
  mkdirSync(dir, { recursive: true });
  let name = `${stamp()}.${ext}`;
  for (let k = 2; existsSync(join(dir, name)); k++) name = `${stamp()}_${k}.${ext}`;
  writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
  return posix(relative(base, join(dir, name)));
}
export function saveAsset(root, id, dataUrl) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(id);
  if (!n || id === ROOT) throw new Error('没有这个节点：' + id);
  return writeImage(picsDir(n.file, n.label), ws.base, dataUrl);
}
// >v<🖼️图片-散图-落在某页空白处、不属于任何节点的图：存进那一页的 _pics/（叶子页没有文件夹 → 归给叶子节点自己）。返回 {path, node?}
export function saveLooseImage(root, scope, dataUrl) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(scope);
  if (!n) throw new Error('没有这一页：' + scope);
  const d = pageDir(ws.base, n);
  if (!d) return { path: writeImage(picsDir(n.file, n.label), ws.base, dataUrl), node: scope };
  return { path: writeImage(join(d, '_pics'), ws.base, dataUrl) };
}
// 删散图 = 移进 __synapsis/_过期的/（不真删），坐标一并去掉
export function removeLooseImage(root, relPath) {
  const base = join(root, DIR), f = join(base, relPath);
  if (relPath.includes('..') || !/(^|\/)_pics\/[^/]+$/.test(relPath) || !existsSync(f)) throw new Error('不是散图：' + relPath);
  const g = join(base, '_过期的');
  mkdirSync(g, { recursive: true });
  renameSync(f, join(g, `${stamp()}_散图_${relPath.replace(/\//g, '～')}`));
  const lay = { ...loadWorkspace(root).layout };
  delete lay['@pic:' + relPath];
  writeLayout(base, lay);
}

// >v<🧭导航-视图记忆-每个工作区的 .synapsis/view.json：各页平移缩放、上次所在页、展开状态、左栏（本机状态，不进 git）
export function loadView(root) {
  try { return JSON.parse(readFileSync(join(root, '.synapsis', 'view.json'), 'utf8')); } catch { return {}; }
}
export function saveView(root, patch) {
  const v = { ...loadView(root), ...patch };
  mkdirSync(join(root, '.synapsis'), { recursive: true });
  const gi = join(root, '.synapsis', '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '# 本机状态（视图、缓存），不进 git\n*\n');
  writeFileSync(join(root, '.synapsis', 'view.json'), JSON.stringify(v, null, 1) + '\n');
  return v;
}

// >v<✅自检-graph check-悬空边、无状态、节点 code 指向不存在的文件
export function checkWorkspace(ws) {
  const issues = [...ws.graph.errors.map(e => ({ level: 'error', where: e.file, msg: e.msg }))];
  for (const n of ws.graph.nodes.values()) {
    if (n.id === ROOT || isDropped(ws.graph, n.id)) continue; // 弃用的（含弃用分组的子孙）不查
    if (!n.status && !n.children.length) issues.push({ level: 'warn', where: n.id, msg: '没有 status' }); // 分组的状态由子节点汇总
    if (n.meta.code && n.meta.code !== 'null') {
      const [f, sym] = n.meta.code.split('#');
      const p = join(ws.root, f);
      if (!existsSync(p)) issues.push({ level: 'error', where: n.id, msg: 'code 指向不存在的文件：' + f });
      else if (sym && statSync(p).isFile() && !new RegExp('(^|[^\\w$])' + sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w$])').test(readFileSync(p, 'utf8')))
        issues.push({ level: 'error', where: n.id, msg: `code 的符号 #${sym} 在 ${f} 里找不到` });
    } else if (n.status === 'done' && !n.isGroup) issues.push({ level: 'info', where: n.id, msg: '标了 done 但没写 code' });
    if (n.children.length && n.status) {
      const agg = groupStatus(ws.graph, n.id);
      if (agg && agg !== n.status) issues.push({ level: 'info', where: n.id, msg: `分组自己标的是 ${n.status}，子节点汇总是 ${agg}` });
    }
  }
  if (ws.colorWords != null) for (const l of parseColorWords(ws.colorWords).bad) issues.push({ level: 'warn', where: WORDS_FILE, msg: '认不出的一行（颜色写 蓝/紫/… 或 #rrggbb）：' + l });
  const g = ws.graph;
  issues.push(...checkSpaces(g, id => g.nodes.get(id)?.meta, (from, ref) => resolveLabel(g.nodes, from, ref) || (g.nodes.has(ref) ? ref : null)));
  return issues;
}

// >v<💾工作区-分组状态汇总-看所有叶子：全 done = done，全 todo/未标 = todo，其余 partial（分组自己标的状态不算数，只做对照；弃用的不算）
export function groupStatus(g, id) {
  const c = { done: 0, partial: 0, todo: 0 };
  const walk = x => { for (const k of g.nodes.get(x).children) { const n = g.nodes.get(k); if (n.status === 'dropped') continue; if (n.children.length) walk(k); else c[n.status || 'todo']++; } };
  walk(id);
  const total = c.done + c.partial + c.todo;
  if (!total) return null;
  return c.done === total ? 'done' : c.done + c.partial ? 'partial' : 'todo';
}

// >v<💾工作区-说明文件-每个 __synapsis/ 放一份 _synapsis.md = AI 接入手册（填好本工作区路径）。生成物：带标记就按最新手册刷新，人改过（去掉标记）就不动
export const MANUAL_MARK = '<!-- synapsis:generated —— 这份由 Synapsis 生成，会被刷新；想自己改就删掉这一行 -->';
export function ensureWorkspaceReadme(root, content) {
  const file = join(root, DIR, '_synapsis.md');
  const body = MANUAL_MARK + '\n' + content;
  if (existsSync(file)) {
    const cur = readFileSync(file, 'utf8');
    const generated = cur.includes(MANUAL_MARK) || cur.startsWith('# __synapsis/ —— 这个项目的结构图'); // 旧版生成物没有标记，认标题
    if (!generated || sameText(cur, body)) return false;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  return true;
}

// >v<🎨画布-调节连线-连线并写类型（界面拖调节口 = kind 调节）：没有这条边就先加进大纲，再写标签 / 类型
export function linkNodes(root, from, to, label = '', kind = '') {
  const ws = loadWorkspace(root);
  let report = { ok: true, removed: [], restore: [] };
  if (!ws.graph.edges.some(e => e.from === from && e.to === to)) {
    const t = withEdge(ws.graph, from, to);
    if (!t) throw new Error(`连不上：${from} -> ${to}`);
    report = saveOutline(root, t);
    if (!report.ok) throw new Error('连线失败：' + JSON.stringify(report.errors));
  }
  if (label || kind) setEdgeLabel(root, from, to, label, kind);
  return { ...report, outline: workspaceOutline(loadWorkspace(root)) };
}

// >v<💾工作区-移动节点-拖进节点 / 剪切粘贴（👤 2026-10-08）：大纲里挪过去，并把「新 id ↔ 旧 id」明确告诉 saveOutline
//   → 正文、属性、图片、坐标、连线都跟着走，不靠「全图唯一同名」去猜（重名的节点以前会被当成删旧建新）
export function moveNodes(root, ids, parent) {
  const ws = loadWorkspace(root);
  const r = withMoved(parseOutline(workspaceOutline(ws)), ids, parent);
  if (r.error) throw new Error(r.error);
  const hint = new Map(r.map.map(([o, n]) => [n, o]));
  const report = saveOutline(root, r.text, hint);
  if (!report.ok) throw new Error('移动失败：' + JSON.stringify(report.errors));
  return { ...report, roots: r.roots, outline: workspaceOutline(loadWorkspace(root)) };
}

// >v<🎨画布-改接连线-Alt 拖连线的一端到别的节点：删旧边、连新边，标签和类型跟过去（👤 2026-10-08）
export function rewireEdge(root, from, to, nf, nt) {
  const ws = loadWorkspace(root), old = ws.graph.edges.find(e => e.from === from && e.to === to);
  if (!old) throw new Error(`没有这条边：${from} -> ${to}`);
  const t1 = withoutEdge(ws.graph, from, to), t2 = withEdge(parseOutline(t1), nf, nt);
  if (!t2) throw new Error(`连不上：${nf} -> ${nt}（自己连自己，或者已经有这条边）`);
  const report = saveOutline(root, t2);
  if (!report.ok) throw new Error('改接失败：' + JSON.stringify(report.errors));
  if (old.label || old.kind) setEdgeLabel(root, nf, nt, old.label || '', old.kind || '');
  return { ...report, outline: workspaceOutline(loadWorkspace(root)) };
}

// >v<🤖LLM接口-边标签-给已有的边写标签 / 类型（大纲只表达「有没有边」，标签存在出发节点 frontmatter 的 to: 里）
export function setEdgeLabel(root, from, to, label = '', kind = '') {
  const ws = loadWorkspace(root), g = ws.graph, n = g.nodes.get(from);
  if (!n || !g.edges.some(e => e.from === from && e.to === to)) throw new Error(`没有这条边：${from} -> ${to}`);
  const list = g.edges.filter(e => e.from === from).map(e => fmtEdge({ ref: shortRef(g, from, e.to), label: e.to === to ? label : e.label, kind: e.to === to ? kind : e.kind }));
  setNodeMeta(root, from, { to: list });
}

// >v<🤖LLM接口-查找-名字 / 正文 / 属性里的关键词（不区分大小写）；以后接嵌入做语义搜索
export function findNodes(ws, q) {
  const k = q.toLowerCase(), out = [];
  for (const n of ws.graph.nodes.values()) {
    if (n.id === ROOT) continue;
    const meta = Object.entries(n.meta).filter(([key]) => key !== 'to').map(([key, v]) => key + ': ' + v).join('\n');
    const hay = [n.label, meta, n.body || ''].join('\n'), i = hay.toLowerCase().indexOf(k);
    if (i >= 0) out.push({ id: n.id, where: i < n.label.length ? '名字' : i <= n.label.length + meta.length ? '属性' : '正文', snippet: hay.slice(Math.max(0, i - 20), i + k.length + 30).replace(/\s+/g, ' ') });
  }
  return out;
}

// >v<💾工作区-改正文-属性面板里改节点正文（Synapsis 唯一会写正文的地方：用户亲手改的）
export function setNodeBody(root, id, body) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(id);
  if (!n || id === ROOT) throw new Error('没有这个节点：' + id);
  const meta = { ...n.meta, ...(fileName(n.label) !== n.label ? { label: n.label } : {}), ...(n.status ? { status: n.status } : {}), ...(n.order !== Infinity ? { order: String(n.order) } : {}) };
  writeFileSync(n.file, serializeNode(meta, body));
}

// >v<🗂️外部区-文件树-项目根目录的只读文件树（含 __synapsis：节点 md 也能直接看）
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.synapsis', '.obsidian', 'Intermediate', 'Saved', 'DerivedDataCache', 'Binaries']);
export function listTree(root, maxEntries = 3000) {
  let count = 0;
  const walk = (dir, rel) => {
    const out = [];
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, 'zh'));
    for (const e of entries) {
      if (SKIP.has(e.name) || count >= maxEntries) continue;
      count++;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) out.push({ name: e.name, path: r, dir: true, children: walk(join(dir, e.name), r) });
      else out.push({ name: e.name, path: r });
    }
    return out;
  };
  return { tree: walk(root, ''), truncated: count >= maxEntries };
}
export function readProjectFile(root, rel, maxBytes = 300000) {
  const f = join(root, rel);
  if (!f.startsWith(join(root)) || rel.includes('..')) throw new Error('路径越界');
  const st = statSync(f);
  if (st.size > maxBytes) return { path: rel, size: st.size, text: null, note: `文件太大（${(st.size / 1e6).toFixed(1)} MB），不预览` };
  const buf = readFileSync(f);
  if (buf.subarray(0, 8000).includes(0)) return { path: rel, size: st.size, text: null, note: '二进制文件，不预览' };
  return { path: rel, size: st.size, text: buf.toString('utf8') };
}
