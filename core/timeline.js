// >v<🎬时间轴-核心-「时间轴」页：页面节点 timeline: true，子节点用 t0 / t1（成片时间，秒）+ 可选 track 排成条
// 纯函数，Node 和浏览器共用（CLI timeline 导出、check、界面的时间轴视图都从这里算）。照「空间」页的做法（space.js）：
// 不新设节点类型，时间就是属性；同一批节点在画布视图自由摆，在时间轴视图按时间排。
//
// 文件里长这样（👤 2026-10-24 定：剪辑真源在 Synapsis 节点，Eidolon 的 edl.py 读 `cli.js timeline --json`）：
//   镜头3/_node.md     timeline: true
//                      beats: 感官.json        ← 可选：拍点网格（相对项目根，读 events 的 beats / downbeats / phrases，只读）
//                      fps: 24                 ← 可选：不写就用 beats 那份的 fps
//   镜头3/人物入画.md   t0: 1.2
//                      t1: 3.48
//                      track: 0                ← 可选，0 = 主轨
// 同一素材用两次：别复制节点，用传送门卡（ref: 素材库/某节点），t0 / t1 写在传送门卡自己身上。
// 截帧的时间码是「素材时间」（说明里记 src_t），t0 / t1 是「成片时间」，两个别混。

export const isTimeline = meta => !!meta && /^(true|1|是|yes)$/i.test(String(meta.timeline ?? '').trim());

// 时间：数字（秒），也认 mm:ss.xxx；不是数 → NaN（check 会报）；没写 → null
export function parseTime(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  return m ? +m[1] * 60 + +m[2] : Number(s);
}
export const round3 = t => Math.round(t * 1000) / 1000;

// 段落（子节点本身也是时间轴页，👤 2026-10-24 定 A）：它的时间 = 里面各段最早 t0 ~ 最晚 t1，自己写的 t0 / t1 不算（check 提示）。
// 返回 [t0, t1] 或 null（里面一段都没上轴）；leaves = 里面所有真正带时间的节点（拖段落 = 它们一起平移）
export function spanOf(graph, id, getMeta, seen = new Set()) {
  if (seen.has(id)) return null; seen.add(id);
  let t0 = Infinity, t1 = -Infinity; const leaves = [];
  for (const c of graph.nodes.get(id)?.children || []) {
    const m = getMeta(c) || {};
    if (isTimeline(m)) { const s = spanOf(graph, c, getMeta, seen); if (s) { t0 = Math.min(t0, s.t0); t1 = Math.max(t1, s.t1); leaves.push(...s.leaves); } continue; }
    const a = parseTime(m.t0), b = parseTime(m.t1);
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    t0 = Math.min(t0, a); t1 = Math.max(t1, b); leaves.push(c);
  }
  return leaves.length ? { t0, t1, leaves } : null;
}

// 一页时间轴：items = 有 t0 和 t1 的子节点（按 t0、track 排），loose = 没上轴的子节点
//   子节点是段落（也是时间轴页）→ 时间自动算，item 带 group: true 和 leaves
export function timelineInfo(graph, id, getMeta) {
  const meta = getMeta(id);
  if (!isTimeline(meta)) return null;
  const items = [], loose = [];
  for (const c of graph.nodes.get(id).children) {
    const m = getMeta(c) || {}, tr = parseTime(m.track), track = tr === null ? 0 : tr;
    if (isTimeline(m)) {
      const s = spanOf(graph, c, getMeta);
      if (s) items.push({ id: c, label: graph.nodes.get(c).label, t0: s.t0, t1: s.t1, track, ref: m.ref ? String(m.ref) : null, group: true, leaves: s.leaves });
      else loose.push(c);
      continue;
    }
    const t0 = parseTime(m.t0), t1 = parseTime(m.t1);
    if (t0 === null || t1 === null) { loose.push(c); continue; }
    items.push({ id: c, label: graph.nodes.get(c).label, t0, t1, track, ref: m.ref ? String(m.ref) : null });
  }
  items.sort((a, b) => a.t0 - b.t0 || a.track - b.track);
  // fps / beats / lead 没写就沿上级时间轴页往上找（段落页一般不写，跟「剪辑」那页）
  const up = k => { for (let x = id; x != null; x = graph.nodes.get(x)?.parent) { const m = getMeta(x); if (!isTimeline(m)) break; if (m[k] != null && String(m[k]).trim() !== '') return String(m[k]).trim(); } return null; };
  const fps = parseTime(up('fps'));
  return { id, items, loose, fps: Number.isFinite(fps) && fps > 0 ? fps : null, beats: up('beats'), lead: up('lead') };
}

// 拍点源（感官.json）→ {fps, beats, downbeats, phrases, onsets}；格式不认识 → null
export function parseBeats(json) {
  const ev = json && json.events;
  if (!ev || typeof ev !== 'object') return null;
  const arr = k => Array.isArray(ev[k]) ? ev[k].filter(Number.isFinite) : [];
  return { fps: Number.isFinite(json.fps) ? json.fps : null, beats: arr('beats'), downbeats: arr('downbeats'), phrases: arr('phrases'), onsets: arr('onsets') };
}

// 吸附：t 附近 tol 秒内最近的网格点（grid 已排序），lead = 提前多少秒（「提前 1–2 帧」= frames / fps）
export function snapTime(t, grid, tol, lead = 0) {
  let best = t, d = tol;
  for (const g of grid) { const x = g - lead, e = Math.abs(x - t); if (e <= d) { d = e; best = x; } if (g - lead > t + tol) break; }
  return best;
}

// check：只提示不拦（👤 2026-10-24）。t0 / t1 不是数、t0 ≥ t1、只写了一个、同轨重叠
export function checkTimelines(graph, getMeta) {
  const issues = [];
  for (const [id] of graph.nodes) {
    const info = timelineInfo(graph, id, getMeta);
    if (!info) continue;
    for (const c of info.loose) {
      const m = getMeta(c) || {};
      if (!isTimeline(m) && (parseTime(m.t0) === null) !== (parseTime(m.t1) === null)) issues.push({ level: 'warn', where: c, msg: '时间轴：t0 / t1 只写了一个，没上轴' });
    }
    for (const c of graph.nodes.get(id).children) {
      const m = getMeta(c) || {};
      if (isTimeline(m) && (m.t0 != null || m.t1 != null)) issues.push({ level: 'info', where: c, msg: '时间轴：段落的时间由里面各段自动算，这里写的 t0 / t1 不算（可以删掉）' });
    }
    for (const it of info.items) {
      if (!Number.isFinite(it.t0) || !Number.isFinite(it.t1) || !Number.isFinite(it.track)) issues.push({ level: 'warn', where: it.id, msg: `时间轴：t0 / t1 / track 要写数字（秒，或 分:秒）` });
      else if (it.t0 >= it.t1) issues.push({ level: 'warn', where: it.id, msg: `时间轴：t0（${it.t0}）不小于 t1（${it.t1}）` });
    }
    const ok = info.items.filter(it => Number.isFinite(it.t0) && Number.isFinite(it.t1) && it.t0 < it.t1);
    for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
      const a = ok[i], b = ok[j];
      if (b.t0 >= a.t1) continue;
      if (a.track === b.track && b.t0 < a.t1 - 1e-6) issues.push({ level: 'warn', where: b.id, msg: `时间轴：和「${a.label}」在同一条轨上重叠（${round3(b.t0)}–${round3(Math.min(a.t1, b.t1))} 秒）` });
    }
  }
  return issues;
}
