// >v<🎬时间轴-界面-时间轴页（timeline: true）的另一种视图：子节点按 t0 / t1 排成条，一行一条轨（👤 2026-10-24 剪辑真源在 Synapsis 节点）
// 同一批节点：画布视图自由摆，这里按时间排；不复制。V 切回画布。
//   拖条中间 = 平移（上下拖 = 换轨），拖左右边 = 改入点 / 出点；吸附到拍点和别的条的边（按住 Alt 不吸），对齐到帧（有 fps 时）
//   段落（子节点本身也是时间轴页，👤 定 A：时间由里面各段自动算）：▸ / S 展开出它的子轨；拖段落 = 里面所有段一起挪，不能拖边
//   A / D = 上一条 / 下一条；← → = 挪一帧（Shift = 10 帧）；Ctrl+← → = 改出点；↑ ↓ = 换轨。键盘连按停手 0.4 秒才存（一步撤销）
//   滚轮 = 左右滚，Ctrl+滚轮 = 缩放（以鼠标处为中心）；「没上轴」的拖到轴上 = 在那个时刻放一段（默认 2 秒）
//   embedded = 嵌在父页画布的卡片里（「时间轴卡」）：行矮一些、没有键盘（键盘归画布）、clipExtra 给每段条加连线点；
//     普通滚轮留给画布缩放，Ctrl+滚轮 = 缩放时间轴，Shift+滚轮 = 左右滚
import { useEffect, useMemo, useRef, useState } from 'react';
import { snapTime, round3 } from './timeline.js';

const EDGE = 7, NEW_LEN = 2;
const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(2).padStart(5, '0'); };

// 行（lane）：本页的每条轨 + 展开的段落的每条轨（缩进一层，跟在本页后面）
function buildLanes(info, infoOf, open, extra) {
  const lanes = [], items = [];
  const add = (inf, depth, anc) => {
    const n = Math.max(1, ...inf.items.map(i => i.track + 1)) + (depth === 0 && extra ? 1 : 0); // 顶层多一条空轨，好往下拖
    const first = lanes.length;
    for (let t = 0; t < n; t++) lanes.push({ page: inf.id, track: t, depth });
    for (const it of inf.items) items.push({ ...it, page: inf.id, depth, anc, lane: first + Math.min(it.track, n - 1) });
    for (const it of inf.items) if (it.group && open.has(it.id)) { const sub = infoOf(it.id); if (sub) add(sub, depth + 1, [...anc, it.id]); }
  };
  add(info, 0, []);
  return { lanes, items };
}

export function TimelineView({ info, infoOf, labelOf, imgOf, colorOf, beats, fps, lead = 0, selected, onSelect, onCommit, onShift, onPlace, onOpen, embedded = false, clipExtra = null, open: openIn, onToggle }) {
  const ROW = embedded ? 44 : 64, HEAD = embedded ? 20 : 30;
  const box = useRef(null), drag = useRef(null), keyPend = useRef(null), keyTimer = useRef(null);
  const [live, setLive] = useState(null); // 拖动 / 键盘中的条：{id, t0, t1, track, group?, dt?}（还没存）
  const [openLocal, setOpenLocal] = useState(() => new Set());
  const open = openIn || openLocal, toggle = id => onToggle ? onToggle(id) : setOpenLocal(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const { lanes, items: raw } = useMemo(() => buildLanes(info, infoOf || (() => null), open, !embedded), [info, infoOf, open, embedded]);
  const laneOf = (page, track) => { const i = lanes.findIndex(l => l.page === page && l.track === track); return i >= 0 ? i : lanes.findLastIndex(l => l.page === page); };
  // 拖动中的段落：它里面展开着的段跟着挪
  const items = raw.map(it => !live ? it : live.id === it.id ? { ...it, t0: live.t0, t1: live.t1, track: live.track, lane: laneOf(it.page, live.track) } : live.group && it.anc.includes(live.id) ? { ...it, t0: it.t0 + live.dt, t1: it.t1 + live.dt } : it);
  const end = Math.max(10, ...items.map(i => i.t1)) + 4;
  const [z, setZ] = useState(null); // 每秒多少像素
  useEffect(() => { if (z === null && box.current) setZ(Math.min(400, Math.max(embedded ? 5 : 20, (box.current.clientWidth - 40) / end))); }, [z, end]);
  const zz = z || 60;
  const frame = fps ? 1 / fps : 0.04;
  const q = t => Math.max(0, fps ? Math.round(t * fps) / fps : round3(t)); // 对齐到帧

  // 吸附网格：拍点（强拍 / 乐句也在里面）+ 别的条的入点出点（拖段落时不吸自己里面的）
  const grid = useMemo(() => beats ? [...beats.beats, ...beats.downbeats, ...beats.phrases] : [], [beats]);
  const snapGrid = id => [...new Set([...grid, ...raw.filter(i => i.id !== id && !i.anc.includes(id)).flatMap(i => [i.t0 + lead, i.t1 + lead])])].sort((a, b) => a - b); // 条的边不提前（加回 lead 抵掉）
  const snap = (t, id, alt) => alt ? t : snapTime(t, snapGrid(id), 8 / zz, lead);
  const commit = (it, l) => {
    if (it.group) { const dt = round3(l.t0 - it.t0); if (dt || l.track !== it.track) onShift?.(it.id, dt, l.track); }
    else if (l.t0 !== it.t0 || l.t1 !== it.t1 || l.track !== it.track) onCommit(it.id, { t0: round3(l.t0), t1: round3(l.t1), track: l.track });
  };

  // 拖条
  useEffect(() => {
    const mv = e => {
      const d = drag.current; if (!d) return;
      const dt = (e.clientX - d.x0) / d.s / zz, alt = e.altKey; // d.s = 画布缩放（卡在画布里被整体缩放时，屏幕像素 ≠ 卡里的像素）
      let { t0, t1, track } = d.it;
      if (d.mode === 'move') {
        const len = t1 - t0, a = snap(t0 + dt, d.it.id, alt), b = snap(t1 + dt, d.it.id, alt) - len;
        t0 = q(Math.abs(a - (t0 + dt)) <= Math.abs(b - (t0 + dt)) ? a : b); t1 = d.it.group ? t0 + len : q(t0 + len);
        const pageLanes = lanes.filter(l => l.page === d.it.page).length; // 顶层已经多一条空轨；展开的段落允许往下多拖出一条
        track = Math.max(0, Math.min(d.it.depth === 0 ? pageLanes - 1 : pageLanes, d.it.track + Math.round((e.clientY - d.y0) / d.s / ROW)));
      } else if (d.mode === 'left') t0 = Math.min(q(snap(t0 + dt, d.it.id, alt)), t1 - frame);
      else t1 = Math.max(q(snap(t1 + dt, d.it.id, alt)), t0 + frame);
      d.moved = d.moved || Math.abs(e.clientX - d.x0) > 2 || Math.abs(e.clientY - d.y0) > 4;
      if (d.moved) { d.cur = { id: d.it.id, t0, t1, track, group: !!d.it.group, dt: t0 - d.it.t0 }; setLive(d.cur); }
    };
    const up = () => {
      const d = drag.current, l = d?.cur; drag.current = null; if (!d) return;
      setLive(null);
      if (l) commit(d.it, l);
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  });
  const down = (e, it) => {
    if (e.button !== 0 || e.target.closest('.tltog, .tlhandle')) return;
    e.preventDefault(); e.stopPropagation(); onSelect(it.id);
    const r = e.currentTarget.getBoundingClientRect(), s = r.width / (e.currentTarget.offsetWidth || r.width) || 1, x = (e.clientX - r.left) / s;
    drag.current = { it, s, mode: it.group ? 'move' : x < EDGE ? 'left' : x > r.width / s - EDGE ? 'right' : 'move', x0: e.clientX, y0: e.clientY, moved: false };
  };

  // 键盘（嵌在画布里时不接，键盘归画布）
  useEffect(() => {
    if (embedded) return;
    const k = e => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"], .cm-editor')) return;
      const order = [...raw].sort((a, b) => a.t0 - b.t0 || a.lane - b.lane), i = order.findIndex(x => x.id === selected);
      if (!e.ctrlKey && !e.altKey && (e.code === 'KeyA' || e.code === 'KeyD')) {
        e.preventDefault(); e.stopPropagation();
        const j = i < 0 ? 0 : Math.max(0, Math.min(order.length - 1, i + (e.code === 'KeyD' ? 1 : -1)));
        if (order[j]) { onSelect(order[j].id); scrollTo(order[j]); }
        return;
      }
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyS' && i >= 0 && order[i].group) { e.preventDefault(); e.stopPropagation(); toggle(order[i].id); return; }
      if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      const it = order[i];
      if (it.group && e.ctrlKey) return; // 段落的长短由里面定
      const cur = keyPend.current && keyPend.current.id === selected ? keyPend.current : { id: it.id, t0: it.t0, t1: it.t1, track: it.track, it };
      const step = frame * (e.shiftKey ? 10 : 1), dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'ArrowUp') cur.track = Math.max(0, cur.track - 1);
      else if (e.key === 'ArrowDown') cur.track += 1;
      else if (e.ctrlKey) cur.t1 = Math.max(cur.t0 + frame, q(cur.t1 + dir * step));
      else { const len = cur.t1 - cur.t0; cur.t0 = q(Math.max(0, cur.t0 + dir * step)); cur.t1 = it.group ? cur.t0 + len : q(cur.t0 + len); }
      keyPend.current = cur; setLive({ id: cur.id, t0: cur.t0, t1: cur.t1, track: cur.track, group: !!it.group, dt: cur.t0 - it.t0 });
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(flushKeys, 400);
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  });
  const flushKeys = () => { const c = keyPend.current; keyPend.current = null; setLive(null); if (c) commit(c.it, c); };
  useEffect(() => () => { clearTimeout(keyTimer.current); flushKeys(); }, []); // 切走时还没存的键盘改动照存
  const scrollTo = it => { const el = box.current; if (!el) return; const x = it.t0 * zz; if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = x - el.clientWidth / 3; };

  // 滚轮：左右滚 / Ctrl 缩放
  useEffect(() => {
    const el = box.current; if (!el) return;
    const w = e => {
      if (e.ctrlKey) {
        e.preventDefault(); e.stopPropagation();
        const r = el.getBoundingClientRect(), s = r.width / (el.offsetWidth || r.width) || 1, mx = (e.clientX - r.left) / s, t = (mx + el.scrollLeft) / zz, nz = Math.min(2000, Math.max(5, zz * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        setZ(nz); requestAnimationFrame(() => { el.scrollLeft = t * nz - mx; });
      } else if (embedded ? e.shiftKey : !e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); e.stopPropagation(); el.scrollLeft += e.deltaY || e.deltaX; } // 卡里：普通滚轮留给画布缩放，Shift+滚轮才左右滚
    };
    el.addEventListener('wheel', w, { passive: false });
    return () => el.removeEventListener('wheel', w);
  }, [zz]);

  // 刻度：间隔取 ≥ 60 像素的那一档
  const tick = [0.5, 1, 2, 5, 10, 15, 30, 60].find(s => s * zz >= 60) || 120;
  const ticks = []; for (let t = 0; t <= end; t += tick) ticks.push(t);
  const W = end * zz + 40, H = HEAD + lanes.length * ROW;
  const drop = e => {
    const id = e.dataTransfer.getData('text/x-syn-tl'); if (!id || !onPlace) return;
    e.preventDefault();
    const r = box.current.getBoundingClientRect(), s = r.width / (box.current.offsetWidth || r.width) || 1, t = q(snap(((e.clientX - r.left) / s + box.current.scrollLeft) / zz, id, e.altKey));
    const lane = lanes[Math.floor(((e.clientY - r.top) / s + box.current.scrollTop - HEAD) / ROW)];
    onPlace(id, { t0: round3(t), t1: round3(q(t + NEW_LEN)), track: lane && lane.page === info.id ? lane.track : 0 });
  };

  return <div className={'tlview' + (embedded ? ' emb' : '')}>
    {!embedded && <div className="tlbar">
      <b>时间轴</b>
      <span className="hint">{info.items.length} 段 · {fps ? fps + ' fps' : '没写 fps'}{beats ? ' · 拍点 ' + beats.beats.length : ' · 没有拍点（页面写 beats: 感官.json）'}{lead ? ` · 提前 ${lead.toFixed(3)} 秒` : ''}</span>
      <span className="hint">拖中间平移 · 拖两边改长短 · Alt 不吸 · A D 选 · S 展开段落 · ← → 挪 · Ctrl+← → 改出点 · ↑ ↓ 换轨 · Ctrl+滚轮缩放 · V 回画布</span>
      {info.loose.length > 0 && <span className="tlloose" title="没写 t0 / t1 的子节点：拖到轴上就放在那个时刻">没上轴：{info.loose.map(id =>
        <span key={id} className="chip" draggable onDragStart={e => { e.dataTransfer.setData('text/x-syn-tl', id); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onSelect(id)}>{labelOf(id)}</span>)}</span>}
    </div>}
    <div className={'tlscroll' + (embedded ? ' nodrag' : '')} ref={box} style={embedded ? { height: H + 14, flex: 'none' } : undefined} onDragOver={e => { if (e.dataTransfer.types.includes('text/x-syn-tl')) e.preventDefault(); }} onDrop={drop} onMouseDown={e => { if (e.target === e.currentTarget || e.target.closest('svg.tlgrid')) { if (embedded) e.stopPropagation(); onSelect(null); } }}>
      <div className="tlinner" style={{ width: W, height: H }}>
        <svg className="tlgrid" width={W} height={H}>
          {lanes.map((l, i) => <rect key={'r' + i} x={0} y={HEAD + i * ROW} width={W} height={ROW} className={(l.depth ? 'sub ' : '') + (i % 2 ? 'odd' : 'even')} />)}
          {beats && beats.beats.map((t, i) => <line key={'b' + i} x1={t * zz} x2={t * zz} y1={HEAD} y2={H} className="beat" />)}
          {beats && beats.downbeats.map((t, i) => <line key={'d' + i} x1={t * zz} x2={t * zz} y1={HEAD - 6} y2={H} className="down" />)}
          {beats && beats.phrases.map((t, i) => <line key={'p' + i} x1={t * zz} x2={t * zz} y1={0} y2={H} className="phrase" />)}
          {ticks.map(t => <g key={'t' + t}><line x1={t * zz} x2={t * zz} y1={HEAD - 8} y2={HEAD} className="tick" /><text x={t * zz + 3} y={embedded ? 10 : 12}>{fmt(t)}</text></g>)}
          {lanes.map((l, i) => l.depth > 0 && (i === 0 || lanes[i - 1].page !== l.page) ? <text key={'n' + i} x={4} y={HEAD + i * ROW + 11} className="lanelab">{'　'.repeat(l.depth - 1)}└ {labelOf(l.page)}</text> : null)}
          <line x1={0} x2={W} y1={HEAD} y2={HEAD} className="tick" />
        </svg>
        {items.map(it => {
          const img = it.group ? null : imgOf(it.id), bad = !(it.t0 < it.t1), on = open.has(it.id);
          return <div key={it.id} data-id={it.id} className={'tlclip' + (it.group ? ' group' : '') + (it.id === selected ? ' sel' : '') + (bad ? ' bad' : '') + (live?.id === it.id ? ' live' : '')}
            style={{ left: it.t0 * zz, width: Math.max(4, (it.t1 - it.t0) * zz), top: HEAD + it.lane * ROW + 4, height: ROW - 8, '--c': colorOf(it.id) || 'var(--accent)' }}
            title={`${labelOf(it.id)}${it.group ? '（段落：时间由里面 ' + it.leaves.length + ' 段自动算，拖 = 一起挪）' : ''}\n${fmt(it.t0)} – ${fmt(it.t1)}（${(it.t1 - it.t0).toFixed(2)} 秒${fps ? '，' + Math.round((it.t1 - it.t0) * fps) + ' 帧' : ''}）· 轨 ${it.track}${it.ref ? '\n↗ ' + it.ref : ''}`}
            onMouseDown={e => down(e, raw.find(x => x.id === it.id))} onDoubleClick={() => onOpen?.(it.id)}>
            {img && <div className="tlimg" style={{ backgroundImage: `url("${img}")` }} />}
            <div className="tllab">{it.group && <span className="tltog" title={on ? '收起它里面的段（S）' : '展开它里面的段（S）'} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); toggle(it.id); }}>{on ? '▾' : '▸'}</span>}{it.ref && !labelOf(it.id).startsWith('↗') ? '↗ ' : ''}{labelOf(it.id)}</div>
            {!embedded && <div className="tltime">{fmt(it.t0)} · {(it.t1 - it.t0).toFixed(2)}s{it.group ? ` · ${it.leaves.length} 段` : ''}</div>}
            {clipExtra?.(it)}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
