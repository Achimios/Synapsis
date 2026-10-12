// >v<🖥️桌面-启动台-像 Obsidian 的仓库切换器：最近打开的工作区 + 「打开文件夹…」（没挂上 Synapsis 的会先问要不要初始化）
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './launcher.css';

const D = window.synapsisDesktop; // 只有托盘程序（Electron）里才有

function Launcher() {
  const [recent, setRecent] = useState(null);
  const load = () => D && D.recent().then(setRecent);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);
  if (!D) return <div className="lw"><h1>Synapsis</h1><p className="hint">启动台要在托盘程序里用：双击 Synapsis 根目录的 <b>Synapsis_desktop.vbs</b>。</p></div>;
  return (
    <div className="lw">
      <h1>Synapsis</h1>
      <p className="hint">在自己脑海里导航和记录 —— 选一个项目文件夹开始</p>
      <button className="big" onClick={() => D.pickOpen().then(load)}>📂 打开文件夹…</button>
      <p className="hint small">新项目也用它：没挂上 Synapsis 的文件夹打开后会给你一张清单，勾要建哪些（只新建文件，不动已有的）。</p>
      <h2>最近打开</h2>
      {recent === null ? <p className="hint">…</p> : recent.length === 0 ? <p className="hint">还没有。</p> : (
        <ul className="recent">{recent.map(r => (
          <li key={r.dir} className={r.ok ? '' : 'gone'} onClick={() => r.ok && D.open(r.dir)} title={r.dir}>
            <div><b>{r.name}</b>{!r.ok && <span className="tag">找不到 __synapsis</span>}</div>
            <div className="dir">{r.dir}</div>
            <span className="x" title="从列表移除（不删文件）" onClick={e => { e.stopPropagation(); D.forget(r.dir).then(load); }}>✕</span>
          </li>))}</ul>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Launcher />);
