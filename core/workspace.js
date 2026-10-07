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
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { parseOutline, toOutline, resolveLabel, shortRef, ROOT } from './outline.js';

export const DIR = '__synapsis';
const NODE_FILE = '_node.md';
const STATUS_IN = { done: 'done', partial: 'partial', todo: 'todo', '✅': 'done', '◐': 'partial', '○': 'todo' };
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
    else { meta[k.trim()] = v.trim(); listKey = null; }
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
  return { root, base, graph: { nodes, edges, errors }, layout, loose };
}

export const workspaceOutline = ws => toOutline(ws.graph);

// 把新图的每个节点对到旧节点（同 id，或同父下 1:1 的改名），自顶向下，父改名时子节点跟着走
function matchNodes(cur, next) {
  const map = new Map([[ROOT, ROOT]]); // newId -> curId | null
  const used = new Set([ROOT]);
  const visit = newParent => {
    const curParent = map.get(newParent);
    const newKids = next.nodes.get(newParent).children;
    const curKids = curParent !== null && cur.nodes.has(curParent) ? cur.nodes.get(curParent).children : [];
    const unmatchedNew = [];
    for (const nk of newKids) {
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
  return { map, used };
}

// Windows 上 git checkout 会把文件转成 CRLF → 按字节比会把没改的文件全重写一遍（2026-10-07 自身工作区 apply 抓到）
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');

// >v<💾工作区-写回-大纲 → 文件：保留正文/其余属性/边标签；改名=搬文件；删除=移进 _过期的/（不真删）
export function saveOutline(root, text) {
  const next = parseOutline(text);
  if (next.errors.length) return { ok: false, errors: next.errors };
  const ws = loadWorkspace(root);
  const cur = ws.graph, base = ws.base;
  const { map, used } = matchNodes(cur, next);
  const curEdge = new Map(cur.edges.map(e => [e.from + '->' + e.to, e]));
  const report = { ok: true, written: [], moved: [], removed: [] };

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
    const pd = picsDir(n.file, n.label);
    if (existsSync(pd)) renameSync(pd, dst.slice(0, -3) + '_pics');
    const lp = n.isGroup ? join(dirname(n.file), '_pics') : null; // 删掉的分组页上的散图
    if (lp && existsSync(lp)) renameSync(lp, dst.slice(0, -3) + '_散图');
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
  for (const [nid, cid] of map) if (cid !== null && ws.layout[cid]) layout[nid] = ws.layout[cid];
  for (const k of Object.keys(ws.layout)) if (k.startsWith('@portal:')) layout[k] = ws.layout[k];
  for (const k of Object.keys(ws.layout)) if (k.startsWith('@pic:')) {
    const p = k.slice(5), hit = Object.keys(picKeys).find(o => p.startsWith(o));
    layout['@pic:' + (hit ? picKeys[hit] + p.slice(hit.length) : p)] = ws.layout[k];
  }
  writeLayout(base, layout);
  return report;
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
    if (n.id === ROOT) continue;
    if (!n.status && !n.children.length) issues.push({ level: 'warn', where: n.id, msg: '没有 status' }); // 分组的状态由子节点汇总
    if (n.meta.code && n.meta.code !== 'null') {
      const f = n.meta.code.split('#')[0];
      if (!existsSync(join(ws.root, f))) issues.push({ level: 'error', where: n.id, msg: 'code 指向不存在的文件：' + f });
    } else if (n.status === 'done' && !n.isGroup) issues.push({ level: 'info', where: n.id, msg: '标了 done 但没写 code' });
  }
  return issues;
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
