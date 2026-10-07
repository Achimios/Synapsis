// 工作区读写：<项目>/__synapsis/ 文件夹 ⇄ 图。纯 Node，无依赖。自检：core/test/workspace.test.js
// 布局约定（文件夹 = 层级）：
//   叶子节点      名字.md
//   有子节点的    名字/_node.md   （它自己的属性与正文）
//   以 _ 或 . 开头的文件/目录不是节点（_layout.json、_assets/、_过期的/、_synapsis.md）
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
      const node = { id, label, parent, status, children: [], file, isGroup: isDir, meta: rest, body, order };
      nodes.set(id, node);
      kids.push(node);
      if (isDir) walk(abs, id);
    }
    kids.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh'));
    nodes.get(parent).children = kids.map(k => k.id);
  };
  walk(base, ROOT);
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
  return { root, base, graph: { nodes, edges, errors }, layout };
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
    writes.set(file, { content: serializeNode(meta, old ? old.body : ''), old });
  }

  // 1) 删掉的节点 → _过期的/
  const graveyard = join(base, '_过期的');
  for (const [id, n] of cur.nodes) {
    if (id === ROOT || used.has(id) || !n.file || !existsSync(n.file)) continue;
    mkdirSync(graveyard, { recursive: true });
    const dst = join(graveyard, `${stamp()}_${id.replace(/\//g, '～')}.md`);
    renameSync(n.file, dst);
    report.removed.push(relative(base, dst));
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
  writeLayout(base, layout);
  return report;
}

function writeLayout(base, layout) {
  const sorted = Object.fromEntries(Object.keys(layout).sort().map(k => [k, { x: Math.round(layout[k].x), y: Math.round(layout[k].y) }]));
  mkdirSync(base, { recursive: true });
  const file = join(base, '_layout.json');
  const content = JSON.stringify(sorted, null, 1) + '\n';
  if (!existsSync(file) || !sameText(readFileSync(file, 'utf8'), content)) writeFileSync(file, content);
}

export function saveLayout(root, positions) {
  const ws = loadWorkspace(root);
  writeLayout(ws.base, { ...ws.layout, ...positions });
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

export function saveAsset(root, id, dataUrl) {
  const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!m) throw new Error('不是图片 dataURL');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = `${id.replace(/[\/\\:*?"<>|]/g, '～')}_${stamp()}.${ext}`;
  const dir = join(root, DIR, '_assets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
  const rel = '_assets/' + name;
  setNodeMeta(root, id, { img: rel });
  return rel;
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

// >v<💾工作区-说明文件-每个 __synapsis/ 放一份 _synapsis.md：给人和 LLM 的格式说明 + CLI 用法（已存在不覆盖）
export function ensureWorkspaceReadme(root, cliPath) {
  const file = join(root, DIR, '_synapsis.md');
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# __synapsis/ —— 这个项目的结构图（Synapsis 工作区）

> 给人和 LLM 读的说明。图是**设计草稿**，不是代码；边多为设计估计（看 \`source:\`）。

## 怎么读（LLM 优先用 CLI，省 token）
\`\`\`bash
node "${cliPath}" overview --ws "${root.split('\\').join('/')}"     # 分组树 + 状态统计（先看这个）
node "${cliPath}" get "<节点id>" --ws "..."   # 单个节点：属性 + 入边/出边 + 正文
node "${cliPath}" export ["<节点id>"] --ws "..." # 节点卡
node "${cliPath}" check --ws "..."            # 悬空边、无状态、code 指向不存在的文件
\`\`\`
节点 id = 名称路径（\`游戏NPC状态空间组/决策/决策空间（战术目标）\`）。

## 文件格式（文件夹 = 层级）
- 叶子节点 \`名字.md\`；有子节点的 \`名字/_node.md\`
- 以 \`_\` 或 \`.\` 开头的不是节点：\`_layout.json\`（坐标）、\`_assets/\`（图片）、\`_过期的/\`（删除的节点，不真删）
- 名字里有 \`/\` 等非法字符 → 文件名用全角，原名在 frontmatter \`label:\`
\`\`\`
---
status: done | partial | todo
order: 0
rate: 0.5–5 Hz          # 其余属性随便加，Synapsis 原样保留
to:
  - 目标名字 | 边标签 | 类型（离散 / LLM）
---
正文：人写的，Synapsis 不改。
\`\`\`
- 连线目标按名字**就近**解析（先兄弟、再往上层找）；同名冲突时写完整 id。
- 改结构（增删改名、移动、连线）优先在 Synapsis 界面或 \`apply\` 里做；直接改文件也行，改完跑 \`check\`。
`);
  return true;
}
