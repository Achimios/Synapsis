// >v<🖼️图片-截帧弹窗-拖视频进来 / 右键「从视频截帧…」→ 弹窗里放视频，停在想要的时刻截一帧当图（👤 2026-10-24）
// 浏览器自己解码（不经 ffmpeg、不上传视频）：<video> 画到 canvas → jpg → 和贴图同一条路存（节点的 _pics_ 或散图），旁边同名 .md 记来源和 src_t。
//   ← → = 一帧（Shift = 1 秒），空格 = 播 / 停，Enter = 截这一帧（可以连截好几张），Esc = 关
import { useEffect, useRef, useState } from 'react';

const FPS = 24; // 只用来定一步多长；截的是视频当前画面
const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(2).padStart(5, '0'); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function FrameGrab({ file, targetLabel, onShot, onClose }) {
  const vid = useRef(null), [url] = useState(() => URL.createObjectURL(file));
  const [t, setT] = useState(0), [dur, setDur] = useState(0), [err, setErr] = useState(''), [shots, setShots] = useState([]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const seek = d => { const v = vid.current; if (!v) return; v.pause(); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  const shoot = () => {
    const v = vid.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const st = Math.round(v.currentTime * 1000) / 1000, stem = file.name.replace(/\.[^.]+$/, '');
    const note = [`# 截帧：${file.name} @ ${st.toFixed(2)} 秒`, '', `- 来源：${file.name}（拖进来的本机视频，Synapsis 不存视频本身）`, `- src_t：${st}（素材时间，秒；不是时间轴上的 t0 / t1）`, `- 尺寸：${v.videoWidth}×${v.videoHeight}`, `- 日期：${today()}`, ''].join('\n');
    onShot({ dataUrl: c.toDataURL('image/jpeg', 0.92), name: `${today()}_截帧_${stem}@${st.toFixed(2)}s`, note });
    setShots(s => [...s, st]);
  };
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS)); return; }
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); const v = vid.current; if (v) v.paused ? v.play() : v.pause(); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); shoot(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  return <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="framegrab">
      <div className="fghead"><b>从视频截帧</b><span className="hint">{file.name} → {targetLabel}</span><button onClick={onClose} title="Esc">✕</button></div>
      {err ? <div className="fgerr">{err}</div> : null}
      <video ref={vid} src={url} controls muted preload="auto" onLoadedMetadata={e => setDur(e.currentTarget.duration)} onTimeUpdate={e => setT(e.currentTarget.currentTime)} onSeeked={e => setT(e.currentTarget.currentTime)}
        onError={() => setErr('这个视频浏览器解不了（常见于 ProRes / HEVC / 部分 mov）。先转成 H.264 的 mp4，或用命令行 frame（走 ffmpeg）。')} />
      <div className="fgbar">
        <span className="mono">{fmt(t)} / {fmt(dur)}</span>
        <button onClick={() => seek(-1 / FPS)} title="←">◀ 1 帧</button><button onClick={() => seek(1 / FPS)} title="→">1 帧 ▶</button>
        <button className="primary" onClick={shoot} title="Enter">📸 截这一帧</button>
        <span className="hint">{shots.length ? `已截 ${shots.length} 张（${shots.map(s => s.toFixed(2) + 's').join('、')}）` : '← → 一帧 · Shift 一秒 · 空格 播 / 停 · Enter 截 · Esc 关'}</span>
      </div>
    </div>
  </div>;
}
