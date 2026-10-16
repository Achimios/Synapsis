// >v<🎨画布-卡片正文-极简 markdown → React 元素（不用 innerHTML，不执行任何东西）：# 标题、- / 1. 列表、| 表格 |、``` 代码块 ```、> 引用、**粗体**、*斜体*、~~删除线~~、`代码`。
//   认不出的按普通段落显示。给「卡片里直接展开正文」用（👤 2026-10-08：战术参考表这类节点该直接展开看）
//   ln = 第一行在文件里是第几行（👤 2026-10-17 右栏预览 / 源码切换）：给了就在每块（列表是每一项）上标 data-ln，切换时按行对齐滚动
const inline = (s, k) => {
  const out = []; let i = 0, n = 0;
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|~~([^~]+)~~|(?<![*\w])\*(?![\s*])([^*]+?)\*(?![*\w])|(?<![_\w])_(?![\s_])([^_]+?)_(?![_\w])/g;
  for (let m; (m = re.exec(s));) {
    if (m.index > i) out.push(s.slice(i, m.index));
    const key = k + '-' + n++;
    out.push(m[1] != null ? <b key={key}>{m[1]}</b> : m[2] != null ? <code key={key}>{m[2]}</code> : m[3] != null ? <s key={key}>{m[3]}</s> : <i key={key}>{m[4] ?? m[5]}</i>);
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
};
const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

export function MdLite({ text, ln }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n'), out = [];
  const at = i => ln != null ? { 'data-ln': ln + i } : {};
  for (let i = 0; i < lines.length;) {
    const l = lines[i], k = 'l' + i;
    if (/^```/.test(l)) { // 代码块
      const s = i, buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(<pre key={k} {...at(s)}>{buf.join('\n')}</pre>); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) { // 表格：表头 + 分隔行 + 若干行
      const s = i, head = cells(l), rows = []; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push([i, cells(lines[i++])]);
      out.push(<table key={k}><thead><tr {...at(s)}>{head.map((c, j) => <th key={j}>{inline(c, k + j)}</th>)}</tr></thead>
        <tbody>{rows.map(([ri, r]) => <tr key={ri} {...at(ri)}>{r.map((c, j) => <td key={j}>{inline(c, k + ri + '-' + j)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const T = 'h' + Math.min(6, h[1].length + 3); out.push(<T key={k} {...at(i)}>{inline(h[2], k)}</T>); i++; continue; }
    if (/^\s*([-*]|\d+[.、])\s+/.test(l)) { // 列表（连续的行合成一个）
      const items = [], ordered = /^\s*\d/.test(l);
      while (i < lines.length && /^\s*([-*]|\d+[.、])\s+/.test(lines[i])) { items.push([i, lines[i].replace(/^\s*([-*]|\d+[.、])\s+/, '')]); i++; }
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={k}>{items.map(([j, t]) => <li key={j} {...at(j)}>{inline(t, k + j)}</li>)}</L>); continue;
    }
    if (/^>\s?/.test(l)) { out.push(<blockquote key={k} {...at(i)}>{inline(l.replace(/^>\s?/, ''), k)}</blockquote>); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push(<hr key={k} {...at(i)} />); i++; continue; }
    if (!l.trim()) { i++; continue; }
    out.push(<p key={k} {...at(i)}>{inline(l, k)}</p>); i++;
  }
  return <div className="mdlite">{out}</div>;
}
