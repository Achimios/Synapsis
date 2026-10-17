// >v<📝正文-带高亮的源码（👤 2026-10-17 方案 C：先 C，以后再看要不要 B 实时预览 / A 所见即所得）
//   正文框背后垫一层同样排版的镜像，镜像上色、正文框字透明（只留光标和选区）：md 符号（# ** ` > - |）灰着，标题 / 粗体 / 斜体 / 代码各一个颜色。
//   ⚠ 只改颜色，不改字号 / 字重 / 字体（粗体用 text-shadow 假装加粗）：宽度一变，光标就和字对不上了。
//   一行一个 span（data-ln = 文件里的行号）：右栏切换预览 / 源码时量行的位置、钉子跳过来时高亮那一行
const mk = (t, k) => <span key={k} className="mk">{t}</span>;
// 行内：**粗** *斜* _斜_ ~~删~~ `码` [字](链接)
const INL = /\*\*([^*\n]+?)\*\*|~~([^~\n]+?)~~|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]*)\)|(?<![*\w])\*(?![\s*])([^*\n]+?)\*(?![*\w])|(?<![_\w])_(?![\s_])([^_\n]+?)_(?![_\w])/g;
function inline(s, k) {
  const out = []; let i = 0, n = 0;
  for (const m of s.matchAll(INL)) {
    if (m.index > i) out.push(s.slice(i, m.index));
    const key = k + '.' + n++;
    if (m[1] != null) out.push(mk('**', key + 'a'), <span key={key} className="b">{m[1]}</span>, mk('**', key + 'z'));
    else if (m[2] != null) out.push(mk('~~', key + 'a'), <span key={key} className="s">{m[2]}</span>, mk('~~', key + 'z'));
    else if (m[3] != null) out.push(mk('`', key + 'a'), <span key={key} className="c">{m[3]}</span>, mk('`', key + 'z'));
    else if (m[4] != null) out.push(mk('[', key + 'a'), <span key={key} className="a">{m[4]}</span>, mk('](' + m[5] + ')', key + 'z'));
    else { const q = m[6] != null ? '*' : '_'; out.push(mk(q, key + 'a'), <span key={key} className="i">{m[6] ?? m[7]}</span>, mk(q, key + 'z')); }
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}
// 整篇 → 每行的内容（代码块要跨行记状态）
export function mdHighlight(text) {
  let code = false;
  return String(text).split('\n').map((l, i) => {
    const k = 'r' + i;
    if (/^\s*```/.test(l)) { code = !code; return [mk(l, k)]; }
    if (code) return [<span key={k} className="c">{l}</span>];
    let m;
    if ((m = /^(#{1,6}\s+)(.*)$/.exec(l))) return [mk(m[1], k + 'm'), <span key={k} className="h">{inline(m[2], k)}</span>];
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) return [mk(l, k)];
    if ((m = /^(\s*)([-*+]|\d+[.、]|- \[[ xX]\])(\s+)(.*)$/.exec(l))) return [m[1], <span key={k + 'm'} className="li">{m[2]}</span>, m[3], ...inline(m[4], k)];
    if ((m = /^(>\s?)(.*)$/.exec(l))) return [mk(m[1], k + 'm'), <span key={k} className="q">{inline(m[2], k)}</span>];
    if (/^\s*\|.*\|\s*$/.test(l)) return l.split(/(\|)/).map((p, j) => p === '|' ? mk('|', k + j) : /^\s*:?-{2,}:?\s*$/.test(p) ? mk(p, k + j) : <span key={k + j}>{inline(p, k + j)}</span>);
    return inline(l, k);
  });
}
// 正文框 + 背后的上色镜像。框跟着内容长高（不自己滚），滚动交给外面的容器
export function SrcArea({ value, onChange, taRef, ln = 1, hl = null, className = '', taClass = '', ...ta }) {
  const rows = mdHighlight(value), last = rows.length - 1;
  return <div className={'srcwrap ' + className}>
    <div className="mirror" aria-hidden="true">{rows.map((r, i) => <span key={i} data-ln={ln + i} className={hl === ln + i ? 'ln hl' : 'ln'}>{r.length ? r : '​'}{i < last ? '\n' : '​'}</span>)}</div>
    <textarea ref={taRef} className={taClass} value={value} onChange={onChange} spellCheck={false} {...ta} />
  </div>;
}
