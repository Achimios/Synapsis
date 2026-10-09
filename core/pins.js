// >v<📌钉子-数据-临时翻阅用的「组」：一组钉子 = 一串指向节点的书签，带 ☐。存 <项目>/.synapsis/pins.json（本机，不进 git，退出托盘也在，人手动删才没）
//   👤 2026-10-09：钉子不是节点，是「我现在正在翻的这几样」；组空了不自动消失；当前组 = 高亮的那组，钉东西默认进它。
//   形状：{ v:1, current: 组id|null, groups: [{ id, name, collapsed, items: [条目] }] }
//   条目两种：{ id, kind:'node', node:'<节点id>', label, checked } = 钉一个节点；
//            { id, kind:'line', file:'<项目根相对路径>', node:'<这个文件是哪个节点的 md，没有 = null>', line, text:'<那一行，≤2000 字>', seg, label, checked } = 钉文件里的一行（含选中文字）
//   行钉子找回来的办法（locateLine）：原行号对得上就直接到；否则把存下的整行按 20 字一段，拿各段当探针去文件里做普通子串搜索（不要求对齐，前面插字也不怕），命中段最多的行胜、平手取离原行号近的
//   纯函数：每个操作拿旧 doc 返回新 doc（界面把「旧 doc / 新 doc」当一步存进撤销栈），不碰文件、不 import node 模块（浏览器也 import 它）。
//   读写文件（loadPins / savePins / migratePinsFile）在 core/workspace.js，紧挨着 loadView / saveView。

export const SEG = 20, MAXLINE = 2000;
export const emptyPins = () => ({ v: 1, current: null, groups: [] });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const lastSeg = id => String(id).split('/').pop();

// 读进来的东西不信：形状不对的丢掉（手改坏了也不该让界面崩）
export function cleanPins(d) {
  const groups = (Array.isArray(d?.groups) ? d.groups : []).filter(g => g && typeof g.id === 'string').map(g => ({
    id: g.id, name: String(g.name ?? '组'), collapsed: !!g.collapsed,
    items: (Array.isArray(g.items) ? g.items : []).filter(i => i && typeof i.id === 'string' && ((i.kind === 'node' && typeof i.node === 'string') || (i.kind === 'line' && typeof i.file === 'string' && Number.isFinite(i.line))))
      .map(i => i.kind === 'line'
        ? { id: i.id, kind: 'line', file: i.file, node: typeof i.node === 'string' ? i.node : null, line: Math.max(1, Math.floor(i.line)), text: String(i.text ?? '').slice(0, MAXLINE), seg: Math.max(0, Math.floor(i.seg) || 0), label: String(i.label ?? ''), checked: !!i.checked }
        : { id: i.id, kind: 'node', node: i.node, label: String(i.label ?? lastSeg(i.node)), checked: !!i.checked }),
  }));
  return { v: 1, current: groups.some(g => g.id === d?.current) ? d.current : (groups[0]?.id ?? null), groups };
}
const mapGroup = (doc, gid, f) => ({ ...doc, groups: doc.groups.map(g => g.id === gid ? f(g) : g) });

// 新组：不给名字就叫「组 N」（N 取第一个没用过的）；新组成为当前组
export function addGroup(doc, name) {
  let n = doc.groups.length + 1;
  const names = new Set(doc.groups.map(g => g.name));
  if (!name) while (names.has('组 ' + n)) n++;
  const g = { id: uid(), name: name || '组 ' + n, collapsed: false, items: [] };
  return { doc: { ...doc, groups: [...doc.groups, g], current: g.id }, id: g.id };
}
export const removeGroup = (doc, gid) => {
  const groups = doc.groups.filter(g => g.id !== gid);
  return { ...doc, groups, current: doc.current === gid ? (groups[0]?.id ?? null) : doc.current };
};
export const renameGroup = (doc, gid, name) => mapGroup(doc, gid, g => ({ ...g, name: String(name).trim() || g.name }));
export const setCurrent = (doc, gid) => doc.groups.some(g => g.id === gid) ? { ...doc, current: gid } : doc;
export const toggleCollapsed = (doc, gid) => mapGroup(doc, gid, g => ({ ...g, collapsed: !g.collapsed }));

// 往组里钉节点：同一个节点在同一组里只放一份；钉进哪组，哪组就成为当前组
// nodes = [{ node: 节点id, label }]
export function addNodes(doc, gid, nodes) {
  const g = doc.groups.find(x => x.id === gid);
  if (!g) return { doc, added: 0 };
  const have = new Set(g.items.map(i => i.node));
  const fresh = [];
  for (const n of nodes) if (n?.node && !have.has(n.node)) { have.add(n.node); fresh.push({ id: uid(), kind: 'node', node: n.node, label: n.label || lastSeg(n.node), checked: false }); }
  if (!fresh.length) return { doc: setCurrent(doc, gid), added: 0 };
  return { doc: setCurrent(mapGroup(doc, gid, x => ({ ...x, items: [...x.items, ...fresh] })), gid), added: fresh.length };
}
// 往组里钉「文件里的某一行」：同一个文件同一行在同一组里只放一份；钉进哪组，哪组就成为当前组。items = makeLinePin 的结果
export function addLines(doc, gid, items) {
  const g = doc.groups.find(x => x.id === gid);
  if (!g) return { doc, added: 0 };
  const have = new Set(g.items.filter(i => i.kind === 'line').map(i => i.file + ':' + i.line));
  const fresh = [];
  for (const it of items) { const k = it.file + ':' + it.line; if (!have.has(k)) { have.add(k); fresh.push({ ...it, id: uid(), checked: false }); } }
  if (!fresh.length) return { doc: setCurrent(doc, gid), added: 0 };
  return { doc: setCurrent(mapGroup(doc, gid, x => ({ ...x, items: [...x.items, ...fresh] })), gid), added: fresh.length };
}
// 改某个条目（找回来之后更新行号 / 文字；人在「找不到」里选了一行）
export const updateItem = (doc, gid, iid, patch) => mapGroup(doc, gid, g => ({ ...g, items: g.items.map(i => i.id === iid ? { ...i, ...patch } : i) }));
export const removeItem = (doc, gid, iid) => mapGroup(doc, gid, g => ({ ...g, items: g.items.filter(i => i.id !== iid) }));
export const toggleItem = (doc, gid, iid) => mapGroup(doc, gid, g => ({ ...g, items: g.items.map(i => i.id === iid ? { ...i, checked: !i.checked } : i) }));
export const clearGroup = (doc, gid) => mapGroup(doc, gid, g => ({ ...g, items: [] }));

// 节点改名 / 搬家后钉子跟着走：map = { 旧id: 新id }（同时换，a→b、b→a 互换也不会乱）
export function remapNodes(doc, map) {
  let changed = false;
  const groups = doc.groups.map(g => ({ ...g, items: g.items.map(i => {
    const to = i.node == null ? undefined : map[i.node];
    if (to === undefined || to === i.node) return i;
    changed = true;
    return i.kind === 'line' ? { ...i, node: to } : { ...i, node: to, label: lastSeg(to) }; // 行钉子的 file 是旧路径，界面按 node 去取新路径
  }) }));
  return changed ? { ...doc, groups } : doc;
}

// ── 文件里的一行 ──
// text 里第 offset 个字符落在第几行（1 起）、那一行的文字（去掉行尾 \r）、这一行从第几个字符开始
export function lineAt(text, offset) {
  const o = Math.max(0, Math.min(offset, text.length));
  let line = 1, start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < o; i = text.indexOf('\n', i + 1)) { line++; start = i + 1; }
  let end = text.indexOf('\n', start); if (end === -1) end = text.length;
  return { line, start, text: text.slice(start, end).replace(/\r$/, '') };
}
// 选中的那段 → 行钉子条目（还没有 id / checked，addLines 补）。selStart / selEnd 是在这一行文字里的下标；没选中文字 = 钉整行
// seg = 选中那段「中间那个字」落在第几个 20 字段（找回来时先拿这一段当探针）
export function makeLinePin({ file, node = null, line, lineText, selStart = 0, selEnd = 0 }) {
  const text = String(lineText).replace(/\r$/, '').slice(0, MAXLINE);
  const a = Math.min(selStart, text.length), b = Math.min(Math.max(selEnd, a), text.length);
  const seg = Math.min(Math.floor((a + b) / 2 / SEG), Math.max(0, Math.ceil(text.length / SEG) - 1));
  const label = (text.slice(a, b).trim() || text.trim()).replace(/\s+/g, ' ').slice(0, 40) || '（空行）';
  return { kind: 'line', file, node, line, text, seg, label };
}
// 在 lines（文件按行拆开）里找 item 那一行。返回 { line: 1 起的行号 | null, how: 'exact' | 'moved' | 'fuzzy' | 'lost', candidates: [{ line, score }] }
//   exact = 原行号上就是；moved = 整行原样在别处（行号变了）；fuzzy = 行里有改动但认得出；lost = 没把握，candidates 是最像的几行让人选
export function locateLine(lines, item) {
  const norm = s => String(s).replace(/\r$/, '');
  const text = norm(item.text), want = text.trim();
  if (lines[item.line - 1] !== undefined && norm(lines[item.line - 1]) === text) return { line: item.line, how: 'exact', candidates: [] };
  if (!want) return { line: null, how: 'lost', candidates: [] }; // 空行没法认
  const near = (a, b) => Math.abs(a - item.line) - Math.abs(b - item.line);
  const whole = []; lines.forEach((l, j) => { if (norm(l).trim() === want) whole.push(j + 1); });
  if (whole.length) return { line: whole.sort(near)[0], how: 'moved', candidates: [] };
  const chunks = []; for (let i = 0; i < text.length; i += SEG) chunks.push(text.slice(i, i + SEG));
  const order = [Math.min(item.seg || 0, chunks.length - 1)];
  for (let d = 1; d < chunks.length; d++) { if (order[0] - d >= 0) order.push(order[0] - d); if (order[0] + d < chunks.length) order.push(order[0] + d); }
  const probes = order.filter(i => chunks[i].trim().length >= 4); // 太短的段（行尾剩一两个字）区分不了
  const score = new Map(), hitMain = new Set();
  for (const i of probes) lines.forEach((l, j) => { if (l.includes(chunks[i])) { score.set(j + 1, (score.get(j + 1) || 0) + 1); if (i === order[0]) hitMain.add(j + 1); } });
  const ranked = [...score].map(([line, sc]) => ({ line, score: sc })).sort((a, b) => b.score - a.score || near(a.line, b.line));
  const best = ranked[0];
  if (best && (best.score >= 2 || hitMain.has(best.line) || probes.length === 1)) return { line: best.line, how: 'fuzzy', candidates: [] };
  return { line: null, how: 'lost', candidates: ranked.slice(0, 3) };
}
