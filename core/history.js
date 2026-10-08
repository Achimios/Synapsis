// >v<🧭导航-操作历史-撤销栈每一步写一句人话（👤 2026-10-08「不仅要有撤回，还得有操作历史」——文本查找误改时根本不知道改了啥）
//   大纲文本前后两版比一下：新建 / 删除 / 改名（服务端 report.moved 认的）/ 状态 / 连线；纯函数，Node 里能测
import { parseOutline } from './outline.js';

const STATUS = { done: '✅', partial: '◐', todo: '○', dropped: '❌' };
const short = id => id.split('/').pop();
const edgeKey = e => e.from + '→' + e.to;

// 返回 { desc, items[] }；desc = 最多 3 条 + 「等 N 处」
export function describeChange(oldText, newText, report = {}) {
  if (oldText === newText) return { desc: '（大纲没变）', items: [] };
  let a, b;
  try { a = parseOutline(oldText); b = parseOutline(newText); } catch { return { desc: '改了大纲文本', items: [] }; }
  const items = [];
  // 改名：服务端报的「旧路径 → 新路径」（文件被搬了）
  const renamed = new Map();
  for (const m of report.moved || []) {
    const [f, t] = m.split(' → ').map(s => s.replace(/^__synapsis\//, '').replace(/(\/_node)?\.md$/, ''));
    if (f && t && a.nodes.has(f) && b.nodes.has(t) && !b.nodes.has(f)) renamed.set(f, t);
  }
  const renamedTo = new Set(renamed.values());
  for (const [f, t] of renamed) items.push(short(f) === short(t) ? `移动 ${short(f)}（→ ${t.split('/').slice(0, -1).join('/') || '根'}）` : `改名 ${short(f)} → ${short(t)}`);
  for (const id of b.nodes.keys()) if (id && !a.nodes.has(id) && !renamedTo.has(id)) items.push('新建 ' + short(id));
  for (const id of a.nodes.keys()) if (id && !b.nodes.has(id) && !renamed.has(id)) items.push('删除 ' + short(id));
  for (const [id, n] of b.nodes) { const o = a.nodes.get(id); if (o && id && (o.status || '') !== (n.status || '')) items.push(`状态 ${short(id)} ${STATUS[n.status] || '清除'}`); }
  const ea = new Set(a.edges.map(edgeKey)), eb = new Set(b.edges.map(edgeKey));
  for (const e of b.edges) if (!ea.has(edgeKey(e)) && !renamedTo.has(e.from) && !renamedTo.has(e.to)) items.push(`连线 ${short(e.from)} → ${short(e.to)}`);
  for (const e of a.edges) if (!eb.has(edgeKey(e)) && !renamed.has(e.from) && !renamed.has(e.to)) items.push(`删连线 ${short(e.from)} → ${short(e.to)}`);
  if (!items.length) items.push('排序 / 缩进 / 文本细节');
  return { desc: items.slice(0, 3).join('；') + (items.length > 3 ? ` 等 ${items.length} 处` : ''), items };
}
