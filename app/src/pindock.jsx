// >v<📌钉子-窗口-临时翻阅组的浮窗：拖标题栏移动、拖右下角改大小（位置记在本机）、双击标题栏空白回默认；反引号 ` 或顶栏 📌 开关
//   👤 2026-10-09：能鼠标做的都在界面里做，不加复杂快捷键。组的标题点一下 = 设成当前组（右键「钉到…」默认进它）；双击组名改名；
//   钉子：☐ 单击勾 / 取消，双击跳过去（节点 = 跳到卡片；📄 行钉子 = 打开文件、高亮那一行，找不到时在下面列最像的几行让人选），✕ 删。组空了不自动消失，要手动点 🗑 删组。每一步都进操作历史（Ctrl+Z）。
import { useState, useLayoutEffect } from 'react';
import { useBoxGeometry } from './ai.jsx';
import { addGroup, removeGroup, renameGroup, setCurrent, toggleCollapsed, removeItem, toggleItem, clearGroup } from './pins.js';

export function PinDock({ doc, graph, edit, view, jump, ask, onChoose, onIgnore, onClose }) {
  const geo = useBoxGeometry('syn.pinbox');
  // 没拖过 = 自动贴在右栏（属性面板）的左边，不盖住它；右栏收起 / 拖宽 / 窗口缩放都跟着调；太窄就往左挪，保证整个框看得见（拖过的位置由 useBoxGeometry 管）
  const [defRight, setDefRight] = useState(12);
  useLayoutEffect(() => {
    const measure = () => { const l = document.querySelector('.side')?.getBoundingClientRect().left || innerWidth; const r = Math.max(12, Math.min(innerWidth - l + 12, innerWidth - 270 - 12)); setDefRight(x => x === r ? x : r); };
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
  });
  const [renaming, setRenaming] = useState(null);
  const total = doc.groups.reduce((s, g) => s + g.items.length, 0);
  const newGroup = () => { const r = addGroup(doc); edit(r.doc, `新建钉子组「${r.doc.groups.at(-1).name}」`); setRenaming(r.id); };
  return (
    <div className={'pinbox' + (geo.style ? ' placed' : '')} ref={geo.ref} style={geo.style || { right: defRight }}>
      <div className="bar" onPointerDown={geo.drag} onDoubleClick={e => !e.target.closest('a, button, input') && geo.reset()} title="拖这条移动；拖右下角改大小；双击空白处回到默认位置">
        <b>📌 钉子</b><span className="hint">{total}</span>
        <span className="grow" />
        <button onClick={newGroup} title="新建一个组（新组成为当前组）">＋ 新组</button>
        <a onClick={onClose} title="收起（反引号 ` 再开）">✕</a>
      </div>
      <div className="hbody">
        {!doc.groups.length && <div className="hint hempty">还没有钉子。在卡片上右键 → 📌 钉到…，或者点上面「＋ 新组」。</div>}
        {doc.groups.map(g => {
          const cur = g.id === doc.current, done = g.items.filter(i => i.checked).length;
          return (
            <div key={g.id} className={'hgroup' + (cur ? ' cur' : '')}>
              <div className="hghead" onClick={() => !cur && view(setCurrent(doc, g.id))} title={cur ? '当前组：右键「钉到…」默认进这里' : '点一下设成当前组'}>
                <a className="hgtog" onClick={e => { e.stopPropagation(); view(toggleCollapsed(doc, g.id)); }} title={g.collapsed ? '展开' : '折叠'}>{g.collapsed ? '▸' : '▾'}</a>
                {renaming === g.id
                  ? <input className="hgname" autoFocus defaultValue={g.name} onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = g.name; e.target.blur(); } }}
                      onBlur={e => { const n = e.target.value.trim(); setRenaming(null); if (n && n !== g.name) edit(renameGroup(doc, g.id, n), `钉子组改名「${g.name}」→「${n}」`); }} />
                  : <span className="hgname" onDoubleClick={e => { e.stopPropagation(); setRenaming(g.id); }} title="双击改名">{g.name}</span>}
                <span className="hint hgcount">{g.items.length ? `${done}/${g.items.length}` : '空'}</span>
                <span className="grow" />
                {g.items.length > 0 && <a onClick={e => { e.stopPropagation(); edit(clearGroup(doc, g.id), `清空钉子组「${g.name}」`); }} title="清空这组的钉子（组留着）">清空</a>}
                <a onClick={e => { e.stopPropagation(); edit(removeGroup(doc, g.id), `删除钉子组「${g.name}」`); }} title="删除这个组（Ctrl+Z 能撤销）">🗑️</a>
              </div>
              {!g.collapsed && (
                <ul>
                  {g.items.map(i => {
                    const line = i.kind === 'line', n = line ? null : graph.nodes.get(i.node), label = line ? i.label : (n ? n.label : i.label), ok = line || !!n;
                    const asking = ask && ask.iid === i.id;
                    return [
                      <li key={i.id} className={ok ? '' : 'miss'}
                        title={line ? `${i.file} 第 ${i.line} 行（双击跳过去）` : n ? i.node.split('/').join(' / ') + '（双击跳过去）' : '找不到这个节点：被删了，或在外面改过名。Ctrl+Z 撤销删除后会重新对上'}>
                        <input type="checkbox" checked={i.checked} onChange={() => edit(toggleItem(doc, g.id, i.id), `${i.checked ? '取消勾' : '勾上'}钉子「${label}」`)} />
                        {line
          ? <span className={'hlab two' + (i.checked ? ' done' : '')} onDoubleClick={() => ok && jump(g.id, i)}><span className="hsub">📄 {(i.node && graph.nodes.get(i.node)?.label) || i.file.split('/').pop()} · 第 {i.line} 行</span><span className="htxt">{label}</span></span>
          : <span className={'hlab' + (i.checked ? ' done' : '')} onDoubleClick={() => ok && jump(g.id, i)}>{label}{!ok && ' （找不到）'}</span>}
                        <a className="hx" onClick={() => edit(removeItem(doc, g.id, i.id), `删除钉子「${label}」`)} title="删掉这个钉子">✕</a>
                      </li>,
                      asking && <li key={i.id + '?'} className="pinask">
                        <div className="hint">找不到原来的那一行了（文件改过）。是这几行之一吗？</div>
                        {ask.cands.map(c => <a key={c.line} className="cand" onClick={() => onChoose(c)} title={c.text}>第 {c.line} 行：{c.text.trim().slice(0, 36) || '（空行）'}</a>)}
                        {!ask.cands.length && <div className="hint">没有相近的行。</div>}
                        <a className="cand dim" onClick={onIgnore}>都不是</a>
                      </li>,
                    ];
                  })}
                  {!g.items.length && <li className="hint hempty">（空）右键卡片 → 钉到…</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
