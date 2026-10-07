// >v<🔎搜索-全局搜索-Ctrl+K / 连线到… / 大纲树过滤共用（👤 2026-10-08）：名字、属性、正文；空格分开的几个词都要命中（可分布在不同地方）
// items = [{id, label, path, meta?, body?}]；返回按得分排好的 [{id, label, path, where, snippet, score}]
const lower = s => String(s || '').toLowerCase();
export function searchNodes(items, q, limit = 50) {
  const terms = lower(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const it of items) {
    const label = lower(it.label), path = lower(it.path);
    const meta = Object.entries(it.meta || {}).filter(([k]) => k !== 'to').map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('\n');
    const body = String(it.body || '');
    let score = 0, where = '名字', hit = null;
    for (const t of terms) {
      if (label === t) score += 100;
      else if (label.startsWith(t)) score += 60;
      else if (label.includes(t)) score += 40;
      else if (path.includes(t)) score += 15;
      else if (lower(meta).includes(t)) { score += 10; if (!hit) { where = '属性'; hit = [meta, lower(meta).indexOf(t), t.length]; } }
      else if (lower(body).includes(t)) { score += 5; if (!hit) { where = '正文'; hit = [body, lower(body).indexOf(t), t.length]; } }
      else { score = -1; break; }
    }
    if (score < 0) continue;
    const snippet = hit ? (hit[1] > 20 ? '…' : '') + hit[0].slice(Math.max(0, hit[1] - 20), hit[1] + hit[2] + 40).replace(/\s+/g, ' ') : '';
    out.push({ id: it.id, label: it.label, path: it.path, where: hit ? where : '名字', snippet, score: score - it.path.length * 0.01 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
// 大纲树过滤：命中的节点 + 它们的祖先（祖先要显示才能看到层级）
export function filterTree(graph, q) {
  const terms = lower(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const keep = new Set(), hits = new Set();
  for (const [id, n] of graph.nodes) {
    if (!id) continue;
    const l = lower(n.label);
    if (terms.every(t => l.includes(t))) { hits.add(id); for (let x = id; x; x = graph.nodes.get(x).parent) keep.add(x); }
  }
  return { keep, hits };
}
