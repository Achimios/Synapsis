// 工作区读写：<项目>/__synapsis/ 文件夹 ⇄ 图。纯 Node，无依赖。自检：core/test/workspace.test.js
// 布局约定（文件夹 = 层级）：
//   叶子节点      名字.md
//   有子节点的    名字/_node.md   （它自己的属性与正文）
//   以 _ 或 . 开头的文件/目录不是节点（_layout.json、_assets/、_过期的/、.junk/、_synapsis.md）
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
import { join, dirname, relative, isAbsolute, resolve, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PATTERN_FILE, DEFAULT_PATTERN_WORDS, parsePatternWords, WORDS_ALL, splitWords, DEFAULT_ALL, LOCAL_WORDS, joinWords, wordsHead } from './patterns.js';
import { parseOutline, toOutline, resolveLabel, labelIndex, shortRef, isDropped, withCopies, withEdge, withoutEdge, withMoved, withNode, ROOT } from './outline.js';
import { checkSpaces } from './space.js';
import { checkTimelines, isTimeline } from './timeline.js';
import { emptyPins, cleanPins, remapNodes } from './pins.js';
import { WORDS_FILE, DEFAULT_WORDS, OLD_DEFAULT_WORDS, parseColorWords } from './colors.js';

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
  // 每个文件夹只 readdir 一次（👤 2026-10-23 规模实测：3666 节点时逐个 existsSync / 试读 _pics_ 占了读库的大头）；listed = 文件夹 → 里面的名字
  const listed = new Map(), raw = new Map(); // raw = 文件 → 读到的原文（saveOutline 拿它判断「变没变」，不用再读一遍盘）
  const ls = dir => {
    if (!listed.has(dir)) { try { const l = readdirSync(dir, { withFileTypes: true }); l.names = new Set(l.map(d => d.name)); listed.set(dir, l); } catch { listed.set(dir, null); } }
    return listed.get(dir);
  };
  const has = (dir, name) => !!ls(dir)?.names.has(name);
  const picsOf = (file, label) => { const d = picsDir(file, label); return has(dirname(d), basename(d)) ? listPics(d, base) : []; };
  const walk = (dir, parent) => {
    const list = ls(dir);
    if (!list) return;
    const kids = [];
    for (const d of list) {
      const e = d.name;
      if (e.startsWith('_') || e.startsWith('.')) continue;
      const abs = join(dir, e);
      const isDir = d.isSymbolicLink() ? statSync(abs).isDirectory() : d.isDirectory();
      if (!isDir && !e.endsWith('.md')) continue;
      const file = isDir ? join(abs, NODE_FILE) : abs;
      const text = !isDir || has(abs, NODE_FILE) ? readFileSync(file, 'utf8') : null;
      if (text !== null) raw.set(file, text);
      const { meta, body } = text !== null ? parseFrontmatter(text) : { meta: {}, body: '' };
      const label = meta.label || (isDir ? e : e.slice(0, -3));
      const id = parent === ROOT ? label : parent + '/' + label;
      const status = STATUS_IN[meta.status] || null;
      const order = meta.order !== undefined && meta.order !== '' ? +meta.order : Infinity;
      const { status: _s, order: _o, label: _l, ...rest } = meta;
      const pics = picsOf(file, label);
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
  for (const n of nodes.values()) { const d = pageDir(base, n); const l = d && has(d, '_pics') ? listPics(join(d, '_pics'), base) : []; if (l.length) loose[n.id] = l; }
  const edges = [], idx = labelIndex(nodes);
  for (const n of nodes.values()) {
    for (const raw of n.meta.to || []) {
      const e = parseEdge(raw);
      const to = resolveLabel(nodes, n.id, e.to, idx);
      if (!to) { errors.push({ file: relative(base, n.file || base), msg: '找不到连线目标：' + e.to }); continue; }
      edges.push({ id: n.id + '->' + to, from: n.id, to, label: e.label, kind: e.kind });
    }
  }
  let layout = {};
  try { layout = JSON.parse(readFileSync(join(base, '_layout.json'), 'utf8')); } catch { /* 没有就空 */ }
  // 词表（👤 2026-10-12 合成一份）：每一层的 _词表.md 拆成 颜色 / 图案 两边；旧的 _配色.md / _图案.md 还在也照读（打开工作区时会迁进 _词表.md）
  //   colorWords / patternWords = 项目那份（null = 用默认）；colorWordsAt / patternWordsAt = {分组 id: 文本}（有文件就有键，哪怕那一边是空的）
  const oldWords = new Set(); // 还有旧 _配色.md / _图案.md 的文件夹（migrateWords 只看这些）
  const level = d => {
    const all = join(d, WORDS_ALL), oc = join(d, WORDS_FILE), op = join(d, PATTERN_FILE);
    if (has(d, WORDS_FILE) || has(d, PATTERN_FILE)) oldWords.add(d);
    if (!has(d, WORDS_ALL) && !has(d, WORDS_FILE) && !has(d, PATTERN_FILE)) return null;
    const hasAll = existsSync(all), sp = hasAll ? splitWords(readFileSync(all, 'utf8')) : { color: '', pattern: '' };
    const old = f => existsSync(f) ? '\n' + readFileSync(f, 'utf8') : '';
    // 哪一边既没有 _词表.md 也没有旧文件 → null（项目那份 = 用默认；分组 = 这层没有）
    return { color: hasAll || existsSync(oc) ? sp.color + old(oc) : null, pattern: hasAll || existsSync(op) ? sp.pattern + old(op) : null };
  };
  const top = level(base), colorWords = top ? top.color : null, patternWords = top ? top.pattern : null, wordsFiles = top ? [ROOT] : [];
  const colorWordsAt = {}, patternWordsAt = {};
  for (const n of nodes.values()) {
    if (n.id === ROOT || !n.isGroup) continue;
    const l = level(dirname(n.file));
    if (l) { if (l.color != null) colorWordsAt[n.id] = l.color; if (l.pattern != null) patternWordsAt[n.id] = l.pattern; wordsFiles.push(n.id); }
  }
  return { root, base, graph: { nodes, edges, errors }, layout, loose, colorWords, patternWords, colorWordsAt, patternWordsAt, wordsFiles, raw, oldWords };
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

// >v<💾工作区-写回-大纲 → 文件：保留正文/其余属性/边标签；改名=搬文件；删除=移进 .junk/（不真删，关窗口时才清）
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
  const outEdges = new Map(), idx = labelIndex(next.nodes);
  for (const e of next.edges) { if (!outEdges.has(e.from)) outEdges.set(e.from, []); outEdges.get(e.from).push(e); }
  // ↗ 传送门卡片的 ref: 指向的节点改名 / 搬家了 → 写的时候直接跟过去（以前写完再整库读一遍去改）
  const refBack = {};
  for (const [nid, cid] of map) if (cid && cid !== nid) refBack[cid] = nid;
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
    if (meta.ref && refBack[meta.ref]) meta.ref = refBack[meta.ref];
    const to = (outEdges.get(id) || []).map(e => {
      const oe = old && curEdge.get(old.id + '->' + map.get(e.to));
      return fmtEdge({ ref: shortRef(next, id, e.to, idx), label: oe ? oe.label : '', kind: oe ? oe.kind : '' });
    });
    if (to.length) meta.to = to; else delete meta.to;
    writes.set(file, { content: serializeNode(meta, old ? old.body : ''), old, label: n.label });
  }

  // 1) 删掉的节点 → .junk/
  const graveyard = join(base, TRASH);
  // 整棵子树都被删的分组 = 整个文件夹作为一项进去（保持层级，不拆成一堆平铺的文件）；有子孙被挪走（used）的分组照旧逐个文件处理
  const gone = new Map();
  const wholeGone = id => {
    if (!gone.has(id)) { const n = cur.nodes.get(id); gone.set(id, !used.has(id) && n.children.every(wholeGone)); }
    return gone.get(id);
  };
  const inWholeGone = new Set();
  for (const [id, n] of cur.nodes) {
    if (id === ROOT || !n.isGroup || !n.file || !wholeGone(id)) continue;
    if (n.parent !== ROOT && wholeGone(n.parent)) continue; // 外层整组都删了 → 由外层那一项带走
    const dir = dirname(n.file);
    if (!existsSync(dir)) continue;
    junkDir(graveyard);
    const dst = join(graveyard, `${stamp()}_${id.replace(/\//g, '～')}`);
    renameSync(dir, dst);
    report.removed.push(relative(base, dst));
    report.restore.push([relative(base, dst), relative(base, dir)]);
    const mark = x => { inWholeGone.add(x); for (const c of cur.nodes.get(x).children) mark(c); };
    mark(id);
  }
  for (const [id, n] of cur.nodes) {
    if (id === ROOT || used.has(id) || inWholeGone.has(id) || !n.file || !existsSync(n.file)) continue;
    junkDir(graveyard);
    const dst = join(graveyard, `${stamp()}_${id.replace(/\//g, '～')}.md`);
    renameSync(n.file, dst);
    report.removed.push(relative(base, dst));
    report.restore.push([relative(base, dst), relative(base, n.file)]);
    const pd = picsDir(n.file, n.label);
    if (existsSync(pd)) { renameSync(pd, dst.slice(0, -3) + '_pics'); report.restore.push([relative(base, dst.slice(0, -3) + '_pics'), relative(base, pd)]); }
    const lp = n.isGroup ? join(dirname(n.file), '_pics') : null; // 删掉的分组页上的散图
    if (lp && existsSync(lp)) { renameSync(lp, dst.slice(0, -3) + '_散图'); report.restore.push([relative(base, dst.slice(0, -3) + '_散图'), relative(base, lp)]); }
  }
  // 2) 写新内容（只写变了的）；读库时读到的原文直接拿来比，上面挪进 .junk/ 的那些除外（盘上已经没了）
  const junked = report.restore.map(([, from]) => join(base, from));
  const gonePath = f => junked.some(p => f === p || f.startsWith(p + sep));
  for (const [file, { content, old }] of writes) {
    const prev = ws.raw.has(file) && !gonePath(file) ? ws.raw.get(file) : existsSync(file) ? readFileSync(file, 'utf8') : null;
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
    let to = file.endsWith(NODE_FILE) ? join(dirname(file), '_pics') : picsDir(file, label);
    if (to === from || !existsSync(from)) continue; // 没挪的分组先跳过，不碰盘
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
  // 2c) 分组自己的词表（_词表.md，旧的 _配色.md / _图案.md，👤 2026-10-11 层级词表）跟着分组文件夹走；分组变叶子 / 被删 → 进 .junk/（只有分组才有词表）
  const back = new Map([...map].filter(([, c]) => c != null).map(([n, c]) => [c, n]));
  for (const [cid, n] of cur.nodes) {
    if (cid === ROOT || !n.isGroup || !n.file || inWholeGone.has(cid)) continue;
    const nid = back.get(cid), nn = nid != null ? next.nodes.get(nid) : null, to = nn && nn.children.length ? join(base, ...pathOf(nid)) : null;
    for (const f of [WORDS_ALL, WORDS_FILE, PATTERN_FILE]) {
      const from = join(dirname(n.file), f);
      if ((to && join(to, f) === from) || !existsSync(from)) continue;
      let dst = to ? join(to, f) : null;
      if (!dst || existsSync(dst)) { junkDir(graveyard); dst = join(graveyard, `${stamp()}_${cid.replace(/\//g, '～')}${f}`); report.restore.push([relative(base, dst), relative(base, from)]); }
      mkdirSync(dirname(dst), { recursive: true });
      renameSync(from, dst);
      report.moved.push(relative(base, from) + ' → ' + relative(base, dst));
    }
  }
  // 3) 搬走的旧文件删掉（内容已在新位置）
  const emptied = new Set(junked.map(p => dirname(p))); // 可能变空的文件夹：挪走过东西的地方
  for (const [, { old }] of writes) {
    if (old && old.file && !writes.has(old.file) && existsSync(old.file)) { unlinkSync(old.file); emptied.add(dirname(old.file)); }
  }
  // 4) 清空目录：只看挪走过东西的文件夹，空了就删、再看上一层（以前每次保存整棵树扫一遍，几千节点时很慢）
  const prunable = d => d.startsWith(base + sep) && !relative(base, d).split(sep).some(s => s.startsWith('_') || s.startsWith('.'));
  const prune = dir => { if (prunable(dir) && existsSync(dir) && !readdirSync(dir).length) { rmdirSync(dir); prune(dirname(dir)); } };
  for (const d of [...emptied].sort((a, b) => b.length - a.length)) prune(d);
  // 5) 布局跟着改名走
  const layout = {};
  // 新节点（cid = null）：前端可能先写了坐标（右键「在这里新建」），留着
  for (const [nid, cid] of map) if (cid !== null && ws.layout[cid]) layout[nid] = ws.layout[cid]; else if (cid === null && ws.layout[nid]) layout[nid] = ws.layout[nid];
  // 删掉的节点：坐标留着（撤销删除 / 从历史栏回去时卡片回原位；同名新建也接着用）。改名搬走的旧 id 不留
  const carried = new Set([...map.values()].filter(Boolean));
  for (const k of Object.keys(ws.layout)) if (!k.startsWith('@') && !carried.has(k) && !(k in layout)) layout[k] = ws.layout[k];
  for (const k of Object.keys(ws.layout)) if (k.startsWith('@portal:')) layout[k] = ws.layout[k];
  for (const k of Object.keys(ws.layout)) if (k.startsWith('@pic:')) {
    const p = k.slice(5), hit = Object.keys(picKeys).find(o => p.startsWith(o));
    layout['@pic:' + (hit ? picKeys[hit] + p.slice(hit.length) : p)] = ws.layout[k];
  }
  writeLayout(base, layout);
  try { migratePinsFile(root, map); } catch { /* 钉子文件坏了不该拦住保存 */ } // 📌 钉子指向的节点改名 / 搬家了 → 钉子跟着走（撤销时反向的对应表也走这里）
  return report;
}

// >v<💾工作区-撤销删除-把 saveOutline 移进 .junk/ 的文件搬回原处（之后再写回删除前的大纲，正文和属性就都在）
// 只搬 .junk/ 里的东西、只搬回 __synapsis/ 里面、目标已存在就跳过
export function restoreRemoved(root, pairs) {
  const base = join(root, DIR), grave = join(base, TRASH);
  const inside = (p, dir) => { const r = relative(dir, p); return r && !r.startsWith('..') && !isAbsolute(r); };
  const done = [];
  for (const [from, to] of pairs || []) {
    const src = join(base, from), dst = join(base, to);
    if (!inside(src, grave) || !inside(dst, base) || inside(dst, grave)) continue;
    if (!existsSync(src) || existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    if (IMG_EXT.test(src) && existsSync(sideOf(src)) && !existsSync(sideOf(dst))) renameSync(sideOf(src), sideOf(dst)); // 图的说明文件
    done.push(to);
  }
  return done;
}

// >v<💾工作区-删除回收-__synapsis/.junk/ = 程序删东西时的临时去处，只给「这一次打开期间」的 Ctrl+Z 用（👤 2026-10-08：别这么谨慎，思维快，不被过往束缚）：
//   · 关窗口 / 退出托盘时清空本次产生的（整个送系统回收站，只占回收站一项）；意外关闭没清 → 下次打开时问要不要清
//   · 不分大小，一视同仁（大图也是关了就清）
//   · 只送回收站、不永久删；不是 Windows / 回收站失败 → 原样留着，不降级成真删
//   · 不进 git（__synapsis/.gitignore，ensureGitignore）；图片文件夹也不进 git
//   · 和 _过期的/ 分开：_过期的/ 是人手动放旧东西的地方（分布式、不自动清）；程序删的一律进 .junk/
export const TRASH = '.junk';
// 建 .junk/，并在 Windows 上设成「隐藏」（👤 2026-10-08：默认隐藏，人不用看；界面文件树本来就跳过它）
function junkDir(g) {
  const fresh = !existsSync(g);
  mkdirSync(g, { recursive: true });
  if (fresh && process.platform === 'win32') try { spawnSync('attrib', ['+h', g], { windowsHide: true, timeout: 10000 }); } catch { /* 设不上就算了，只是资源管理器里看得见 */ }
}
const entrySize = p => { const st = statSync(p); return st.isDirectory() ? readdirSync(p).reduce((s, e) => s + entrySize(join(p, e)), 0) : st.size; };
const stampTime = name => { const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/.exec(name); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; }; // stamp() 用的是 UTC
export function graveyardInfo(root) {
  const g = join(root, DIR, TRASH);
  if (!existsSync(g)) return { entries: [], total: 0 };
  const entries = readdirSync(g).map(name => {
    const p = join(g, name);
    try { return { name, path: p, size: entrySize(p), time: stampTime(name) ?? statSync(p).mtimeMs }; } catch { return null; }
  }).filter(Boolean);
  return { entries, total: entries.reduce((s, e) => s + e.size, 0) };
}
function trashToRecycleBin(paths) {
  if (process.platform !== 'win32' || !paths.length) return;
  const ps = 'Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($p in ($env:SYN_TRASH -split [char]10)) { if (-not $p) { continue }; try { if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin") } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin") } } catch {} }';
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { env: { ...process.env, SYN_TRASH: paths.join('\n') }, windowsHide: true, timeout: 120000 });
}
let trashImpl = trashToRecycleBin;
export const setTrash = f => { trashImpl = f || trashToRecycleBin; }; // 测试用：换成假的回收站
// 送系统回收站；返回真正没了的路径（成没成以「文件还在不在」为准）
const trashPaths = paths => { trashImpl(paths); return paths.filter(p => !existsSync(p)); };
// 清空 .junk/：since（毫秒时间戳）= 只清这之后产生的（退出托盘时用，不动上次意外关闭留下的）；before = 只清这之前的（打开时问过用户后清「上次留下的」，不动这次的）；都不给 = 全清。
// 清的是全部 → 整个文件夹作为一项进回收站；否则逐项。返回 { count, size, left }
export function clearGraveyard(root, { since = null, before = null } = {}) {
  const info = graveyardInfo(root), g = join(root, DIR, TRASH);
  const pick = info.entries.filter(e => (since == null || e.time >= since) && (before == null || e.time < before));
  if (!pick.length) return { count: 0, size: 0, left: info.entries.length };
  const all = pick.length === info.entries.length;
  const gone = trashPaths(all ? [g] : pick.map(e => e.path));
  const ok = all ? (gone.length ? pick : []) : pick.filter(e => gone.includes(e.path));
  return { count: ok.length, size: ok.reduce((s, e) => s + e.size, 0), left: info.entries.length - ok.length };
}
// 图片和 .junk/ 不进 git（👤 2026-10-08）。没有才写；人改过就不动。想让图片进 git，删掉对应行
export function ensureGitignore(root) {
  const f = join(root, DIR, '.gitignore');
  if (existsSync(f) || !existsSync(join(root, DIR))) return false;
  writeFileSync(f, '# Synapsis 生成：图片和 .junk/（删除的临时去处）不进 git（想让图片进 git，删掉对应行；这份文件人改过就不会再动）\n.junk/\n_pics/\n_pics_*/\n');
  return true;
}

function writeLayout(base, layout) {
  const sorted = Object.fromEntries(Object.keys(layout).sort().map(k => [k, { x: Math.round(layout[k].x), y: Math.round(layout[k].y), ...(layout[k].w ? { w: Math.round(layout[k].w) } : {}), ...(layout[k].h ? { h: Math.round(layout[k].h) } : {}) }])); // w = 散图宽度 / 普通节点手动大小（👤 2026-10-12），h = 普通节点手动高度；null = 回到自动
  mkdirSync(base, { recursive: true });
  const file = join(base, '_layout.json');
  const content = JSON.stringify(sorted, null, 1) + '\n';
  if (!existsSync(file) || !sameText(readFileSync(file, 'utf8'), content)) writeFileSync(file, content);
}

export function saveLayout(root, positions) {
  const base = join(root, DIR); // 只读 _layout.json（以前整库读一遍，几千节点时拖一下卡片要 0.4 秒）
  let lay = {};
  try { lay = JSON.parse(readFileSync(join(base, '_layout.json'), 'utf8')); } catch { /* 没有就空 */ }
  // 按键合并（散图的 w 宽度和 x/y 分开更新时不互相覆盖）
  for (const [k, v] of Object.entries(positions)) lay[k] = { ...lay[k], ...v };
  writeLayout(base, lay);
}

// >v<💾工作区-改属性-单个节点的 frontmatter 合并（贴图、spec 等大纲表达不了的东西）
export function setNodeMeta(root, id, patch) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(id);
  if (!n || id === ROOT) throw new Error('没有这个节点：' + id);
  const meta = { ...n.meta, ...(fileName(n.label) !== n.label ? { label: n.label } : {}), ...(n.status ? { status: n.status } : {}), ...(n.order !== Infinity ? { order: String(n.order) } : {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete meta[k]; else meta[k] = v; }
  // 实测快照（审阅 §2.3）：标 evidence=实测（或实测的节点换了 code）时，记下 code 文件当时的内容 hash；之后 check 发现文件变了就提示。
  //   只在这两种改动时刷新 —— 改颜色、状态之类不动快照，否则「实测之后改过」会被悄悄抹掉。不是实测 → 快照没意义，删掉。
  if (meta.evidence !== '实测') delete meta[EVIDENCE_HASH];
  else if ('evidence' in patch || 'code' in patch) { const h = codeHash(codeFile(ws.root, meta.code)); if (h) meta[EVIDENCE_HASH] = h; else delete meta[EVIDENCE_HASH]; }
  writeFileSync(n.file, serializeNode(meta, n.body));
}
// >v<💾工作区-外部文件节点-把 __synapsis 外、项目里的文件当节点引进来：新建一个普通节点，frontmatter 写 file: 相对项目根的路径（👤 2026-10-10）
//   连线 / 改名 / 撤销 / 导出都照普通节点走；删节点只把这个小 md 送进 .junk/，不碰原文件。名字取文件名（去掉会被当成连线的 -> 和逗号），同级重名自动加序号
export function addFileNode(root, parent, rel) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = join(root, r);
  if (!r || r.split('/').includes('..') || !abs.startsWith(root) || !existsSync(abs) || !statSync(abs).isFile()) throw new Error('项目里没有这个文件：' + rel);
  if (r === DIR || r.startsWith(DIR + '/')) throw new Error('这个文件本来就在 ' + DIR + '/ 里，不用引入');
  const ws = loadWorkspace(root), g = ws.graph;
  if (parent !== ROOT && !g.nodes.has(parent)) throw new Error('没有这个节点：' + parent);
  const label = (r.split('/').pop() || r).replace(/->/g, '→').replace(/[,，]/g, '、').trim();
  const made = withNode(g, parent, null, label);
  const res = saveOutline(root, made.text);
  if (!res.ok) throw new Error('建节点失败：' + JSON.stringify(res.errors));
  setNodeMeta(root, made.id, { file: r, status: null }); // 引用外部文件不是一件待做的事：不带 status（新建节点默认 todo 会混进进度统计）
  return { id: made.id, report: res };
}
// >v<🖼️传送门卡片-引用节点-👤 2026-10-10：在这一页放一张卡，指向图里别处的一个节点（不用连线）。存成一个普通节点，frontmatter 带 ref: <目标节点 id>，名字 = ↗ 目标名；
//   和 file:（引用外部文件）并列：不带 status。目标改名 / 搬家 → saveOutline 里 migrateRefs 把 ref: 跟过去；目标删了 → 卡片留着，check 报「ref 指向不存在的节点」
export function addRefNode(root, parent, target) {
  const ws = loadWorkspace(root), g = ws.graph;
  if (parent !== ROOT && !g.nodes.has(parent)) throw new Error('没有这个节点：' + parent);
  const t = g.nodes.get(target);
  if (!t || target === ROOT) throw new Error('没有这个节点：' + target);
  const ref = t.meta?.ref ? String(t.meta.ref) : target; // 指向的本身是传送门卡片：直接指它的目标，别绕两层
  const label = ('↗ ' + (g.nodes.get(ref)?.label || t.label)).replace(/->/g, '→').replace(/[,，]/g, '、').trim();
  const made = withNode(g, parent, null, label);
  const res = saveOutline(root, made.text);
  if (!res.ok) throw new Error('建节点失败：' + JSON.stringify(res.errors));
  setNodeMeta(root, made.id, { ref, status: null });
  return { id: made.id, report: res };
}
export function migrateRefs(root, idMap) {
  const back = {}; // 旧 id → 新 id
  for (const [nid, cid] of idMap) if (cid && cid !== nid) back[cid] = nid;
  if (!Object.keys(back).length) return 0;
  const ws = loadWorkspace(root); let n = 0;
  for (const [id, node] of ws.graph.nodes) { const r = node.meta?.ref; if (r && back[r]) { setNodeMeta(root, id, { ref: back[r] }); n++; } }
  return n;
}
// >v<✅自检-实测快照-code 文件内容的短 hash（换行统一成 \n，免得 git 的 CRLF 转换被当成「改过」）；最小版：只比整个文件，不做依赖分析
export const EVIDENCE_HASH = 'evidence_hash';
export const codeFile = (root, code) => !code || code === 'null' ? null : join(root, String(code).split('#')[0]);
export function codeHash(file) {
  try { if (!file || !statSync(file).isFile()) return null; return createHash('sha1').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 10); } catch { return null; }
}

// >v<🎨画布-配色词表-没有 _配色.md 就按默认词表写一份（界面「词表…」按钮），返回它的路径
// >v<🎨画布-词表-每一层一份 _词表.md（👤 2026-10-12 合并）。scope = 分组 id → 那个分组自己的（没有就建一份空表）；'' = 项目那份（没有就按默认写）
export const LOCAL_HEAD = (kind, eg) => wordsHead(LOCAL_WORDS(''));
export const groupWordsFile = (root, scope, file = WORDS_ALL) => {
  const n = loadWorkspace(root).graph.nodes.get(scope);
  if (!n || !n.isGroup) throw new Error('只有分组（有子节点的）才能有自己的词表：' + scope);
  return join(dirname(n.file), file);
};
export function ensureWords(root, scope = ROOT, ws = null) {
  migrateWords(root, ws);
  if (scope) { const f = groupWordsFile(root, scope); if (!existsSync(f)) writeFileSync(f, LOCAL_WORDS(loadWorkspace(root).graph.nodes.get(scope).label)); return f; }
  const f = join(root, DIR, WORDS_ALL);
  if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, DEFAULT_ALL); }
  return f;
}
export const ensureColorWords = ensureWords, ensurePatternWords = ensureWords; // 旧名字
// 旧的两份（_配色.md / _图案.md）→ 并进同一层的 _词表.md，旧文件备份进 _过期的/（打开工作区 / 建词表时跑一次）
// ws 可以传刚读好的（读库时已记下哪几层还有旧词表 oldWords，没有就不用逐层看）
export function migrateWords(root, ws = null) {
  const base = join(root, DIR); if (!existsSync(base)) return [];
  ws = ws || loadWorkspace(root); const done = [];
  const levels = [[base, ROOT, ''], ...[...ws.graph.nodes.values()].filter(n => n.id !== ROOT && n.isGroup).map(n => [dirname(n.file), n.id, n.label])].filter(([d]) => !ws.oldWords || ws.oldWords.has(d));
  for (const [d, id, label] of levels) {
    const oc = join(d, WORDS_FILE), op = join(d, PATTERN_FILE), all = join(d, WORDS_ALL);
    if (!existsSync(oc) && !existsSync(op)) continue;
    const had = existsSync(all), cur = had ? readFileSync(all, 'utf8') : id === ROOT ? DEFAULT_ALL : LOCAL_WORDS(label);
    const none = { color: '', pattern: '' }, sp = splitWords(cur); // 还没有 _词表.md 时 cur 是模板（项目那份带默认词）
    const rd = f => existsSync(f) ? splitWords(readFileSync(f, 'utf8')) : none;
    const c = rd(oc), p = rd(op), cat = (...xs) => xs.filter(Boolean).join('\n');
    // 已有 _词表.md：旧的追加在后面；还没有：旧文件有哪一边就用旧的那一边（人改过的），没有的那一边用模板里的默认
    const col = had ? cat(sp.color, c.color, p.color) : existsSync(oc) ? cat(c.color, p.color) : cat(sp.color, p.color);
    const pat = had ? cat(sp.pattern, c.pattern, p.pattern) : existsSync(op) ? cat(c.pattern, p.pattern) : cat(sp.pattern, c.pattern);
    writeFileSync(all, joinWords(wordsHead(cur), col, pat));
    const keep = join(base, '_过期的'); mkdirSync(keep, { recursive: true });
    const tag = (id === ROOT ? '' : id.replace(/\//g, '～') + '_') + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    for (const f of [oc, op]) if (existsSync(f)) renameSync(f, join(keep, basename(f, '.md') + '_' + tag + '.md'));
    done.push(relative(base, all));
  }
  return done;
}

// >v<💾工作区-粘贴节点-复制 ids（子孙、状态、内部边）到 parent 下，再把属性（除结构字段）、正文、节点图片跟着拷（👤 2026-10-08）
//   srcRoot = 从另一个项目复制来的（跨项目粘贴，👤 2026-10-10）：从那个项目读节点（同一台机器上的路径），图片文件夹一起拷；file: / code: 这类相对路径属性原样带过来（目标项目里没有那个文件就会被 check 提示）
export function pasteNodes(root, ids, parent, srcRoot = root) {
  const ws = loadWorkspace(root);
  const cross = resolve(srcRoot) !== resolve(root);
  if (cross && !existsSync(join(srcRoot, DIR))) throw new Error('来源项目找不到（移走了？）：' + srcRoot);
  const src0 = cross ? loadWorkspace(srcRoot) : ws;
  const r = withCopies(src0.graph, ids, parent, ws.graph);
  if (!r) throw new Error('没有可复制的节点（不在来源工作区？）');
  const report = saveOutline(root, r.text);
  if (!report.ok) throw new Error('粘贴失败：' + JSON.stringify(report.errors || report));
  const now = loadWorkspace(root);
  for (const [o, n] of r.map) {
    const src = src0.graph.nodes.get(o), dst = now.graph.nodes.get(n);
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
//   👤 2026-10-20 AI 生成的图：opts.name = 文件名（日期_模型_简介，不带扩展名），opts.note = 说明，写进同名 .md（「图的说明文件」，见 sideOf；删 / 挪 / 撤销都跟着图走）
export const sideOf = p => p.replace(/\.[^./\\]+$/, '') + '.md';
function writeImage(dir, base, dataUrl, opts = {}) {
  const m = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
  if (!m) throw new Error('不是图片 dataURL');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1];
  mkdirSync(dir, { recursive: true });
  const stem = opts.name ? String(opts.name).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || stamp() : stamp();
  let name = `${stem}.${ext}`;
  for (let k = 2; existsSync(join(dir, name)) || (opts.note && existsSync(sideOf(join(dir, name)))); k++) name = `${stem}_${k}.${ext}`;
  writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
  if (opts.note) writeFileSync(sideOf(join(dir, name)), opts.note);
  return posix(relative(base, join(dir, name)));
}
export function saveAsset(root, id, dataUrl, opts = {}) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(id);
  if (!n || id === ROOT) throw new Error('没有这个节点：' + id);
  return writeImage(picsDir(n.file, n.label), ws.base, dataUrl, opts);
}
// >v<🖼️图片-散图-落在某页空白处、不属于任何节点的图：存进那一页的 _pics/（叶子页没有文件夹 → 归给叶子节点自己）。返回 {path, node?}
export function saveLooseImage(root, scope, dataUrl, opts = {}) {
  const ws = loadWorkspace(root);
  const n = ws.graph.nodes.get(scope);
  if (!n) throw new Error('没有这一页：' + scope);
  const d = pageDir(ws.base, n);
  if (!d) return { path: writeImage(picsDir(n.file, n.label), ws.base, dataUrl, opts), node: scope };
  return { path: writeImage(join(d, '_pics'), ws.base, dataUrl, opts) };
}
// 删一张图（散图 _pics/ 或节点的 _pics_名字/）= 移进 __synapsis/.junk/（不真删），坐标一并去掉。
// 返回 [.junk 里的路径, 原路径, 原坐标?]（路径相对 __synapsis），交给 restoreRemoved 就能搬回来（撤销用；坐标由调用方写回）
export function removePic(root, relPath, tag = '图') {
  const base = join(root, DIR), f = join(base, relPath);
  if (relPath.includes('..') || !/(^|\/)_pics(_[^/]+)?\/[^/]+$/.test(relPath) || !existsSync(f)) throw new Error('不是图片：' + relPath);
  const g = join(base, TRASH), name = `${stamp()}_${tag}_${relPath.replace(/\//g, '～')}`;
  junkDir(g);
  renameSync(f, join(g, name));
  if (existsSync(sideOf(f))) renameSync(sideOf(f), sideOf(join(g, name))); // 说明文件跟着进 .junk（restoreRemoved 搬回）
  const lay = { ...loadWorkspace(root).layout }, at = lay['@pic:' + relPath];
  if (at) { delete lay['@pic:' + relPath]; writeLayout(base, lay); }
  return at ? [TRASH + '/' + name, relPath, at] : [TRASH + '/' + name, relPath];
}
// 删散图：只收 _pics/ 里的
export function removeLooseImage(root, relPath) {
  if (!/(^|\/)_pics\/[^/]+$/.test(relPath)) throw new Error('不是散图：' + relPath);
  return removePic(root, relPath, '散图');
}

// >v<🖼️图片-归属-散图拖到卡片上 = 归给那个节点（进它的 _pics_名字/）；节点的图拖到空白 = 变成那一页的散图（进 _pics/）（👤 待办）
//   relPath = 相对 __synapsis 的图片路径（必须在某个 _pics/ 或 _pics_名字/ 里）；to = 节点 id，或 null（→ scope 页的散图）。返回 {path}
export function movePic(root, relPath, to, scope = ROOT) {
  const ws = loadWorkspace(root), base = ws.base, f = join(base, relPath);
  if (relPath.includes('..') || !/(^|\/)_pics(_[^/]+)?\/[^/]+$/.test(relPath) || !existsSync(f)) throw new Error('不是图片：' + relPath);
  let dir;
  if (to != null) { const n = ws.graph.nodes.get(to); if (!n || to === ROOT) throw new Error('没有这个节点：' + to); dir = picsDir(n.file, n.label); }
  else { const n = ws.graph.nodes.get(scope); if (!n) throw new Error('没有这一页：' + scope); const d = pageDir(base, n); dir = d ? join(d, '_pics') : picsDir(n.file, n.label); }
  if (dirname(f) === dir) return { path: relPath };
  mkdirSync(dir, { recursive: true });
  const ext = relPath.slice(relPath.lastIndexOf('.'));
  let name = relPath.split('/').pop();
  for (let k = 2; existsSync(join(dir, name)) || existsSync(sideOf(join(dir, name))); k++) name = `${stamp()}_${k}${ext}`;
  renameSync(f, join(dir, name));
  if (existsSync(sideOf(f))) renameSync(sideOf(f), sideOf(join(dir, name))); // 说明文件跟着走
  const lay = { ...loadWorkspace(root).layout };
  if (lay['@pic:' + relPath]) { delete lay['@pic:' + relPath]; writeLayout(base, lay); }
  return { path: posix(relative(base, join(dir, name))) };
}

// >v<📌钉子-存取-<项目>/.synapsis/pins.json（本机，不进 git）：整份读写；纯函数操作在 core/pins.js
const pinsFile = root => join(root, '.synapsis', 'pins.json');
const oldPinsFile = root => join(root, '.synapsis', 'hooks.json'); // 2026-10-09 改名「钉子」之前叫钩子：读得到旧的就接着用，下次保存时换成新文件
export function loadPins(root) {
  for (const f of [pinsFile(root), oldPinsFile(root)]) { try { return cleanPins(JSON.parse(readFileSync(f, 'utf8'))); } catch { /* 试下一个 */ } }
  return emptyPins();
}
export function savePins(root, doc) {
  const d = cleanPins(doc);
  mkdirSync(join(root, '.synapsis'), { recursive: true });
  writeFileSync(pinsFile(root), JSON.stringify(d, null, 1));
  try { unlinkSync(oldPinsFile(root)); } catch { /* 没有旧文件 */ }
  return d;
}
// saveOutline 保存时调：matchNodes 给的 Map(新id → 旧id|null)。只在钉子文件已存在且真有变化时才写
export function migratePinsFile(root, idMap) {
  if (!existsSync(pinsFile(root)) && !existsSync(oldPinsFile(root))) return false;
  const map = {};
  for (const [nid, cid] of idMap) if (cid && cid !== nid) map[cid] = nid;
  if (!Object.keys(map).length) return false;
  const d = loadPins(root), n = remapNodes(d, map);
  if (n === d) return false;
  savePins(root, n);
  return true;
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

// >v<✅自检-锚点读回-代码里的 >v< 标记 ⇄ 图里节点的 anchor:（FK 读回 L2，👤 2026-10-08）：双向对照，只提示、不改图。
//   只认代码文件里「注释符 + >v<」开头的行（文档里讲解 >v< 的不算）；一条锚点 = >v< 之后到行尾，键 = 前两段（emoji大标题-小标题）。
const ANCHOR_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|css|scss|html|vue|svelte|vbs|bat|ps1|sh|lua|gd|cs|java|kt|go|rs|c|cc|cpp|h|hpp)$/i;
const ANCHOR_LINE = /^\s*(?:\/\/|\/\*|#|--|<!--|;|'|rem)\s*>v<\s*(\S.*?)\s*(?:\*\/|-->)?\s*$/i;
export function scanAnchors(root) {
  const out = [];
  const walk = items => {
    for (const it of items) {
      if (it.dir) { if (it.name !== '_过期的') walk(it.children); continue; }
      if (!ANCHOR_EXT.test(it.name)) continue;
      let text;
      try { const f = join(root, it.path); if (statSync(f).size > 1e6) continue; text = readFileSync(f, 'utf8'); } catch { continue; }
      if (!text.includes('>v<')) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        const m = ANCHOR_LINE.exec(line);
        if (m) out.push({ text: m[1], key: m[1].split(/[（(\s]/)[0].split('-').slice(0, 2).join('-'), path: it.path, line: i + 1 });
      });
    }
  };
  walk(listTree(root, 3000).tree);
  return out;
}
// 节点 anchor 写法：「🤖AI指令-宽松版」，可以只写大标题，多个用 | 分开；开头带 >v< 也认
export const nodeAnchors = meta => String(meta?.anchor || '').split('|').map(s => s.replace(/^\s*>v<\s*/, '').trim()).filter(Boolean);
// 节点锚点 a 指向代码锚点 t：整句相同，或 a 是 t 的前缀且下一个字符是分隔（- 或空白）
export const anchorMatches = (a, t) => t === a || (t.startsWith(a) && /[-\s]/.test(t[a.length]));
export function checkAnchors(ws) {
  const issues = [], g = ws.graph;
  const code = scanAnchors(ws.root);
  const claims = []; // 非弃用节点的主张
  let anyAnchor = false;
  for (const n of g.nodes.values()) {
    if (n.id === ROOT) continue;
    const list = nodeAnchors(n.meta);
    if (!list.length) continue;
    anyAnchor = true;
    if (!isDropped(g, n.id)) claims.push({ n, list });
  }
  for (const { n, list } of claims) for (const a of list) {
    if (!code.some(c => anchorMatches(a, c.text)))
      issues.push({ level: 'warn', where: n.id, kind: 'anchor-missing', msg: `anchor「${a}」在代码里找不到（重构删掉了？改名了？）${n.status ? '——图里标的是 ' + n.status : ''}` });
  }
  if (!code.length) return issues;
  if (!anyAnchor) return issues; // 没人写 anchor: 就完全不吭声（👤 2026-10-08：图是思考草稿，和代码差得远是常态，不该默认提醒）
  // 按大标题合并成一条，免得一个没建模的区域刷出几十行；where 指到第一处
  const seen = new Set(), by = new Map();
  for (const c of code) {
    if (seen.has(c.key)) continue; seen.add(c.key);
    if ([...g.nodes.values()].some(n => n.id !== ROOT && nodeAnchors(n.meta).some(a => anchorMatches(a, c.text) || anchorMatches(a, c.key)))) continue;
    const big = c.key.split('-')[0];
    if (!by.has(big)) by.set(big, { first: c, subs: [] });
    by.get(big).subs.push(c.key.split('-')[1] || '');
  }
  for (const [big, { first, subs }] of by)
    issues.push({ level: 'info', where: `${first.path}:${first.line}`, kind: 'anchor-orphan', msg: `代码里有 >v<${big} 的 ${subs.length} 处没有节点认领：${subs.slice(0, 6).join('、')}${subs.length > 6 ? '…' : ''}（图落后于代码？认领 = 给某个节点写 anchor: ${big}）` });
  return issues;
}

// >v<✅自检-graph check-悬空边、无状态、节点 code 指向不存在的文件
export function checkWorkspace(ws) {
  const issues = [...ws.graph.errors.map(e => ({ level: 'error', where: e.file, msg: e.msg }))];
  for (const n of ws.graph.nodes.values()) {
    if (n.id === ROOT || isDropped(ws.graph, n.id)) continue; // 弃用的（含弃用分组的子孙）不查
    if (!n.status && !n.children.length && !n.meta.file && !n.meta.ref && !n.meta.ui && !isTimeline(ws.graph.nodes.get(n.parent)?.meta)) issues.push({ level: 'warn', where: n.id, msg: '没有 status' }); // 分组的状态由子节点汇总；引用外部文件的节点（file:）不是待做的事，不查
    if (n.meta.file && !existsSync(join(ws.root, String(n.meta.file)))) issues.push({ level: 'warn', where: n.id, msg: 'file 指向不存在的文件：' + n.meta.file + '（文件被移走或改名了？）' });
    if (n.meta.ref && !ws.graph.nodes.has(String(n.meta.ref))) issues.push({ level: 'warn', where: n.id, msg: 'ref 指向不存在的节点：' + n.meta.ref + '（目标被删了或改名没跟上？）' });
    if (n.meta.code && n.meta.code !== 'null') {
      const [f, sym] = n.meta.code.split('#');
      const p = join(ws.root, f);
      if (!existsSync(p)) issues.push({ level: 'error', where: n.id, msg: 'code 指向不存在的文件：' + f });
      else if (sym && statSync(p).isFile() && !new RegExp('(^|[^\\w$])' + sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w$])').test(readFileSync(p, 'utf8')))
        issues.push({ level: 'error', where: n.id, msg: `code 的符号 #${sym} 在 ${f} 里找不到` });
      // 实测之后代码改过：只提示，不作废（证据会过期，但不是一改就全废）
      if (n.meta.evidence === '实测' && n.meta[EVIDENCE_HASH] && existsSync(p)) {
        const h = codeHash(p);
        if (h && h !== n.meta[EVIDENCE_HASH]) issues.push({ level: 'info', where: n.id, msg: `实测之后 ${f} 改过，结论可能要重验（重验后 set ${n.id} evidence=实测 刷新快照）` });
      }
    } else if (n.status === 'done' && !n.isGroup) issues.push({ level: 'info', where: n.id, msg: '标了 done 但没写 code' });
    if (n.children.length && n.status) {
      const agg = groupStatus(ws.graph, n.id);
      if (agg && agg !== n.status) issues.push({ level: 'info', where: n.id, msg: `分组自己标的是 ${n.status}，子节点汇总是 ${agg}` });
    }
  }
  if (ws.colorWords != null) for (const l of parseColorWords(ws.colorWords).bad) issues.push({ level: 'warn', where: WORDS_ALL, msg: '认不出的一行（颜色写 蓝/紫/… 或 #rrggbb）：' + l });
  if (ws.patternWords != null) for (const l of parsePatternWords(ws.patternWords).bad) issues.push({ level: 'warn', where: WORDS_ALL, msg: '认不出的一行（图案只能是 网格 点阵 斜纹 横纹 波纹）：' + l });
  for (const [g, t] of Object.entries(ws.colorWordsAt || {})) for (const l of parseColorWords(t).bad) issues.push({ level: 'warn', where: g + '/' + WORDS_ALL, msg: '认不出的一行（颜色写 蓝/紫/… 或 #rrggbb）：' + l });
  for (const [g, t] of Object.entries(ws.patternWordsAt || {})) for (const l of parsePatternWords(t).bad) issues.push({ level: 'warn', where: g + '/' + WORDS_ALL, msg: '认不出的一行（图案只能是 网格 点阵 斜纹 横纹 波纹）：' + l });
  const g = ws.graph;
  issues.push(...checkSpaces(g, id => g.nodes.get(id)?.meta, (from, ref) => resolveLabel(g.nodes, from, ref) || (g.nodes.has(ref) ? ref : null)));
  issues.push(...checkAnchors(ws));
  issues.push(...checkTimelines(g, id => g.nodes.get(id)?.meta));
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
  return { ...report, roots: r.roots, moveMap: r.map, outline: workspaceOutline(loadWorkspace(root)) }; // moveMap 给撤销 / 重做用（同样不靠名字猜）
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
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.synapsis', '.junk', '.obsidian', 'Intermediate', 'Saved', 'DerivedDataCache', 'Binaries']);
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
// >v<📌钉子-找文件-行钉子指向的文件搬了位置：按文件名在项目里找（不含原路径本身），界面只在「只有一个」时自动用，多个就让人选
export function findFilesByName(root, rel) {
  const name = String(rel).replace(/\\/g, '/').split('/').pop();
  const out = [];
  const walk = items => { for (const it of items) { if (it.dir) walk(it.children); else if (it.name === name && it.path !== rel) out.push(it.path); } };
  walk(listTree(root, 20000).tree);
  return out.slice(0, 20);
}
// >v<🗂️外部区-搜内容-左栏「文件」页勾「也搜内容」：项目里的文本文件逐行找（不分大小写，空格分开的词都要在同一行），
//   跳过 listTree 跳过的目录、> 1MB 的、二进制的；每个文件最多 5 行，总共最多 200 行（👤 2026-10-08）
export function grepProject(root, q, { maxFiles = 3000, perFile = 5, max = 200 } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { hits: [], files: 0, truncated: false };
  const hits = [], files = new Set();
  const walk = items => {
    for (const it of items) {
      if (hits.length >= max) return;
      if (it.dir) { if (it.name !== '_过期的') walk(it.children); continue; } // 归档的旧版本不搜（同一段话会重复出现很多次）
      let buf;
      try { const f = join(root, it.path); if (statSync(f).size > 1e6) continue; buf = readFileSync(f); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0)) continue;
      let n = 0;
      buf.toString('utf8').split(/\r?\n/).some((line, i) => {
        const low = line.toLowerCase();
        if (!words.every(w => low.includes(w))) return false;
        const at = low.indexOf(words[0]), a = Math.max(0, at - 30);
        hits.push({ path: it.path, line: i + 1, text: (a ? '…' : '') + line.slice(a, a + 120).trim() });
        files.add(it.path);
        return ++n >= perFile || hits.length >= max;
      });
    }
  };
  walk(listTree(root, maxFiles).tree);
  return { hits, files: files.size, truncated: hits.length >= max };
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

// >v<🖼️UI节点-新建-空白处右键「新建 UI 框」：带 ui: 的普通节点，宽高 w / h（可在画布上拖角调）。不带 status（是设计元素，不是待办）
export function addUiNode(root, parent, { w = 220, h = 140, label = 'UI框' } = {}) {
  const ws = loadWorkspace(root), g = ws.graph;
  if (parent !== ROOT && !g.nodes.has(parent)) throw new Error('没有这个节点：' + parent);
  const made = withNode(g, parent, null, label);
  const res = saveOutline(root, made.text);
  if (!res.ok) throw new Error('建节点失败：' + JSON.stringify(res.errors));
  setNodeMeta(root, made.id, { ui: 'true', w: String(Math.round(w)), h: String(Math.round(h)), status: null });
  return { id: made.id, report: res };
}
