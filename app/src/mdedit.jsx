// >v<📝正文-实时预览编辑器（👤 2026-10-17 方案 B，定为终点：「最讨厌 Notion 那样根本看不到符号」）。CodeMirror 6，改的就是 md 原文本身（不经过富文本转换，不会悄悄改写文件）。
//   live = 实时预览：渲染好的样子（真粗体、标题按级别放大一点），光标进到哪一段，那一段的符号才露出来（行首的 # > 按行；** _ ` [](…) 按那一段）；没在编辑时全藏
//   src  = 全部源码：符号都显示（颜色照旧）。Ctrl+E 在两者之间切（外壳管）
//   快捷键（👤 定的）：Ctrl+B 粗体、Ctrl+I 斜体、Ctrl+K 链接、列表行里 Tab / Shift+Tab 缩进；Enter 就是换行（👤「自动接下一项太蠢了」）
//   每行带 data-ln = 文件里的行号（class ln，钉子跳过来的那行加 hl）：右栏切换时按行对齐、高亮钉子行
import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, EditorSelection } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, keymap, placeholder as phExt } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, insertNewline, indentMore, indentLess } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

const refresh = StateEffect.define(); // 外面的 mode / 行号偏移 / 高亮行变了 → 重算装饰
const LIST = /^\s*([-*+]|\d+[.)、])\s/;

// Ctrl+B / Ctrl+I：有选中 = 包上（已经包着 = 拆掉）；没选中 = 插一对，光标停中间
const wrap = m => view => {
  const { state } = view, n = m.length;
  view.dispatch(state.changeByRange(r => {
    const before = state.sliceDoc(r.from - n, r.from), after = state.sliceDoc(r.to, r.to + n), sel = state.sliceDoc(r.from, r.to);
    if (before === m && after === m) return { changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }], range: EditorSelection.range(r.from - n, r.to - n) };
    if (sel.length >= 2 * n && sel.startsWith(m) && sel.endsWith(m)) return { changes: { from: r.from, to: r.to, insert: sel.slice(n, -n) }, range: EditorSelection.range(r.from, r.to - 2 * n) };
    return { changes: { from: r.from, to: r.to, insert: m + sel + m }, range: EditorSelection.range(r.from + n, r.to + n) };
  }), { scrollIntoView: true, userEvent: 'input' });
  return true;
};
// Ctrl+K：选中的字 → [字]()，光标进括号填网址；没选中 → []()，光标进方括号
const link = view => {
  const { state } = view;
  view.dispatch(state.changeByRange(r => {
    const t = state.sliceDoc(r.from, r.to), ins = '[' + t + ']()';
    return { changes: { from: r.from, to: r.to, insert: ins }, range: EditorSelection.cursor(t ? r.from + ins.length - 1 : r.from + 1) };
  }), { scrollIntoView: true, userEvent: 'input' });
  return true;
};
const onList = view => LIST.test(view.state.doc.lineAt(view.state.selection.main.head).text);
const KEYS = [
  { key: 'Mod-b', run: wrap('**') }, { key: 'Mod-i', run: wrap('*') }, { key: 'Mod-k', run: link },
  { key: 'Tab', run: v => onList(v) && indentMore(v) }, { key: 'Shift-Tab', run: v => onList(v) && indentLess(v) },
  { key: 'Enter', run: insertNewline }, // 不接列表、不自动缩进
];

// 装饰：标题 / 粗体 / 斜体 / 删除线 / 代码 / 链接 上样式；live 时符号按光标藏起来
const HIDE = Decoration.replace({});
const mark = c => Decoration.mark({ class: c });
function decos(view, o) {
  const live = o.mode === 'live', { state } = view, out = [];
  const focus = view.hasFocus, sel = state.selection.ranges;
  const touches = (a, b) => focus && sel.some(r => r.from <= b && r.to >= a); // 光标 / 选区碰到这一段
  const curLine = new Set(focus ? sel.flatMap(r => { const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number; return Array.from({ length: b - a + 1 }, (_, i) => a + i); }) : []);
  const hideOr = (a, b, show, cls = 'cm-mk') => { if (a < b) out.push((live && !show ? HIDE : mark(cls)).range(a, b)); };
  for (const { from, to } of [view.viewport]) { // 整个渲染出来的范围（比看得见的多一圈）：滚进来的行早就带好 data-ln、符号也已经藏好
    syntaxTree(state).iterate({ from, to, enter: nd => {
      const n = nd.name, p = nd.node.parent;
      const h = /^ATXHeading(\d)$/.exec(n);
      if (h) { out.push(Decoration.line({ class: 'cm-h cm-h' + h[1] }).range(state.doc.lineAt(nd.from).from)); return; }
      switch (n) {
        case 'HeaderMark': { const ln = state.doc.lineAt(nd.from).number, sp = state.sliceDoc(nd.to, nd.to + 1) === ' ' ? 1 : 0; hideOr(nd.from, nd.to + sp, curLine.has(ln)); return; }
        case 'StrongEmphasis': out.push(mark('cm-strong').range(nd.from, nd.to)); return;
        case 'Emphasis': out.push(mark('cm-em').range(nd.from, nd.to)); return;
        case 'Strikethrough': out.push(mark('cm-strike').range(nd.from, nd.to)); return;
        case 'InlineCode': out.push(mark('cm-icode').range(nd.from, nd.to)); return;
        case 'Link': out.push(mark('cm-link').range(nd.from, nd.to)); return;
        case 'EmphasisMark': case 'StrikethroughMark': hideOr(nd.from, nd.to, p && touches(p.from, p.to)); return;
        case 'CodeMark': if (p?.name === 'InlineCode') hideOr(nd.from, nd.to, touches(p.from, p.to)); else out.push(mark('cm-mk').range(nd.from, nd.to)); return;
        case 'LinkMark': case 'URL': if (p?.name === 'Link') hideOr(nd.from, nd.to, touches(p.from, p.to)); return;
        case 'QuoteMark': out.push(mark('cm-mk').range(nd.from, nd.to), Decoration.line({ class: 'cm-quote' }).range(state.doc.lineAt(nd.from).from)); return;
        case 'ListMark': out.push(mark('cm-li').range(nd.from, nd.to)); return;
        case 'TaskMarker': out.push(mark('cm-li').range(nd.from, nd.to)); return;
        case 'FencedCode': { for (let l = state.doc.lineAt(nd.from).number, e = state.doc.lineAt(nd.to).number; l <= e; l++) out.push(Decoration.line({ class: 'cm-codeblock' }).range(state.doc.line(l).from)); return; }
        case 'CodeInfo': case 'HorizontalRule': case 'TableDelimiter': out.push(mark('cm-mk').range(nd.from, nd.to)); return;
      }
    } });
    // 每行：data-ln = 文件里的行号；钉子行加 hl
    for (let l = state.doc.lineAt(from).number, e = state.doc.lineAt(to).number; l <= e; l++) {
      const fl = o.ln + l - 1;
      out.push(Decoration.line({ attributes: { 'data-ln': String(fl) }, class: o.hl === fl ? 'ln hl' : 'ln' }).range(state.doc.line(l).from));
    }
  }
  return Decoration.set(out, true);
}
const livePlugin = opts => ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = decos(v, opts.current); }
  update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || u.transactions.some(t => t.effects.some(e => e.is(refresh)))) this.decorations = decos(u.view, opts.current); }
}, { decorations: v => v.decorations });

// value / onChange 受控；mode = live | src；ln = 第一行在文件里的行号；hl = 要高亮的文件行号；viewRef 拿到 EditorView（外面量行、放光标用）
export function MdEditor({ value, onChange, onBlur, onKeyDown, onContextMenu, mode = 'live', ln = 1, hl = null, readOnly = false, placeholder = '', autoFocus = false, className = '', viewRef }) {
  const host = useRef(null), view = useRef(null), opts = useRef({ mode, ln, hl }), cb = useRef({});
  cb.current = { onChange, onBlur };
  useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: value || '', extensions: [
        history(), keymap.of([...KEYS, ...historyKeymap, ...defaultKeymap]),
        markdown({ base: markdownLanguage, addKeymap: false }), EditorView.lineWrapping, livePlugin(opts),
        EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), ...(placeholder ? [phExt(placeholder)] : []),
        EditorView.updateListener.of(u => {
          if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
          if (u.focusChanged && !u.view.hasFocus) cb.current.onBlur?.(u.state.doc.toString());
        }),
      ] }),
    });
    view.current = v; if (viewRef) viewRef.current = v;
    if (autoFocus) { v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); }
    return () => { v.destroy(); view.current = null; if (viewRef) viewRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 外面换了内容（切节点 / 文件被外面改了）→ 整篇换掉；自己打字触发的 onChange 回来时内容一样，不动
  useEffect(() => { const v = view.current; if (v && value != null && value !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } }); }, [value]);
  useEffect(() => { opts.current = { mode, ln, hl }; view.current?.dispatch({ effects: refresh.of(null) }); }, [mode, ln, hl]);
  return <div ref={host} className={'mdedit ' + mode + ' ' + className} onKeyDown={onKeyDown} onContextMenu={e => {
    const v = view.current, r = v?.state.selection.main; if (!onContextMenu || !r || r.empty) return;
    onContextMenu(e, { text: v.state.doc.toString(), start: r.from, end: r.to });
  }} />;
}
// 光标放到第 line 行（文档里的第几行，从 1 开始）的行首，并滚到看得见
export function caretToLine(v, line, center = false) {
  if (!v) return;
  const l = v.state.doc.line(Math.max(1, Math.min(v.state.doc.lines, line)));
  v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: center ? 'center' : 'nearest' }) });
}
