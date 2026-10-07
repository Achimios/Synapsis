# 踩过的坑

1. **点目录对工具不可见**：ripgrep（含 Claude Code 的 Grep）默认跳过隐藏目录；Obsidian 也忽略点目录 → 图数据放 `__synapsis/`，本机状态才放 `.synapsis/`。
2. Git Bash 里 `mkdir -p -给人类的解释` 会把 `-给…` 当选项 → 用 `mkdir -p -- ./-给人类的解释`。
3. **tldraw 5 自定义形状必须实现 `getIndicatorPath`**（返回 Path2D）：旧的 `indicator()` 已废弃，缺了它在 pointer_down 时直接崩（`getIndicatorPath is not a function`）。
4. **tldraw `BaseBoxShapeUtil` 默认几何是空心的**：只有点到边框才算命中；点内部 = 点画布，双击还会新建文本框 → 覆写 `getGeometry` 返回 `Rectangle2d({ isFilled: true })`。
5. **tldraw 双击按目标分流**（shape / selection / canvas）：节点已选中时 `ShapeUtil.onDoubleClick` 不会被调用 → 监听 `editor.on('event')` 的 `double_click` + `phase==='down'`，用 `getShapesAtPoint` 自己找。
6. **React Flow 重建 nodes 时要保留旧对象的 `measured`**，否则节点被设为 `visibility:hidden` 直到重新测量。
7. **内置浏览器面板在后台时 `visibilityState=hidden`**，ResizeObserver 不触发、截图超时 → UI 验证改用 playwright-core + 本机 Edge 无头（`channel: 'msedge'`，不用下载浏览器）。
8. Git Bash 里 `cat > 文件` 后面没接 heredoc 会一直等 stdin 卡死；跑 node 脚本时加 `< /dev/null`。
9. sed 替换文本里含 Windows 路径时，`\U` `\a` `\L` 等会被当成转义/大小写指令，路径被吃掉 → 含反斜杠的内容用 Edit 工具或 node 写。
10. Git Bash 的 heredoc（即使 `<<'EOF'`）写进 JS 时 `\` 仍可能被吃成 `\` → 含反斜杠的代码一律用 Edit/Write 工具写。
11. `String.replace(a, b)` 的 b 里 `$$` `$&` `$1` 是替换模式（`$$` 变 `$`，playwright 的 `page.$$` 被吃）→ 用 `s.replace(a, () => b)` 或 split/join。
12. Windows 上 git checkout 把文件转成 CRLF → 「内容没变就不写」必须先统一换行再比（`sameText`），否则一次 apply 重写全部文件。
13. frontmatter 与正文之间固定空一行：不固定的话，人写的/导入的/工具写的格式不一致，往返会抖动（删掉空行也算改了正文）。
14. PowerShell 5.1 的 `FolderBrowserDialog` 是老式树形窗口；要资源管理器同款得 Add-Type 调 `IFileOpenDialog` + `FOS_PICKFOLDERS`。PS 脚本含中文必须带 BOM；读 node 的 UTF-8 输出前设 `[Console]::OutputEncoding`。
15. **Electron 单实例转交别解析 argv**：`second-instance` 收到的命令行被 Chromium 重排过，`--ws` 后面可能是它自己的开关（弹过「文件夹不存在：…--allow-file-access-from-files」）→ 用 `requestSingleInstanceLock(additionalData)` 直接传数据。
16. **拖放的 `dataTransfer` 只在事件同步阶段可读**：先 `getData` / 取 `files` 再 await；从浏览器拖来的图多半是网址（`text/uri-list` / `text/html`），不是文件。
17. **React 组件里 `useEffect` 的依赖数组在渲染时就求值**：引用了后面才 `useState` 的变量 → `Cannot access … before initialization`，整页白屏（2026-10-08 propsOpen）。状态声明放在所有用到它的 effect 之前。
18. **全局键盘处理是 if/else 链时，新加的分支要看前面有没有同键先吃掉**（Esc 先被「取消选中」吃了，快捷键页关不掉）。

19. **Git Bash 会改写以 `/` 开头的参数**（MSYS 路径转换）：`cli.js add / 名字` 收到的是 `C:/Program Files/Git/`。CLI 里根节点用 `.`，并把「像 Windows 绝对路径又不是节点」的参数当根。
20. **Windows 上 Python `open(p, 'w')` 默认写 CRLF，经 heredoc 喂中文也可能乱码** → 改源码只用 Edit 工具；生成物和模板比对前先统一换行（`manualText` 现在读模板就去 `\r`）。
