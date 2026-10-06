# 踩过的坑

1. **点目录对工具不可见**：ripgrep（含 Claude Code 的 Grep）默认跳过隐藏目录；Obsidian 也忽略点目录 → 图数据放 `__synapsis/`，本机状态才放 `.synapsis/`。
2. Git Bash 里 `mkdir -p -给人类的解释` 会把 `-给…` 当选项 → 用 `mkdir -p -- ./-给人类的解释`。
3. **tldraw 5 自定义形状必须实现 `getIndicatorPath`**（返回 Path2D）：旧的 `indicator()` 已废弃，缺了它在 pointer_down 时直接崩（`getIndicatorPath is not a function`）。
4. **tldraw `BaseBoxShapeUtil` 默认几何是空心的**：只有点到边框才算命中；点内部 = 点画布，双击还会新建文本框 → 覆写 `getGeometry` 返回 `Rectangle2d({ isFilled: true })`。
5. **tldraw 双击按目标分流**（shape / selection / canvas）：节点已选中时 `ShapeUtil.onDoubleClick` 不会被调用 → 监听 `editor.on('event')` 的 `double_click` + `phase==='down'`，用 `getShapesAtPoint` 自己找。
6. **React Flow 重建 nodes 时要保留旧对象的 `measured`**，否则节点被设为 `visibility:hidden` 直到重新测量。
7. **内置浏览器面板在后台时 `visibilityState=hidden`**，ResizeObserver 不触发、截图超时 → UI 验证改用 playwright-core + 本机 Edge 无头（`channel: 'msedge'`，不用下载浏览器）。
8. Git Bash 里 `cat > 文件` 后面没接 heredoc 会一直等 stdin 卡死；跑 node 脚本时加 `< /dev/null`。
