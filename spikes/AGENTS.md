# spikes/ —— 画布库对比原型

同一份大纲、同一个外壳（`src/shell.jsx`），只换画布：`rf.jsx`（React Flow）vs `td.jsx`（tldraw 5）。
用户试完选定后，整个目录进 `../_过期的/`，`src/outline.js` 的逻辑搬进正式的 `core/`。

- 启动：根目录 `spikes.bat`，或 `npm run dev`（:5410）
- 自检：`npm test`（纯 Node，大纲解析/投影/布局）；`npm run test:ui`（无头 Edge 跑两个画布同一套交互，需先起 dev；可传截图目录）
- **大纲文本是唯一真源**：画布操作 → 改图 → `toOutline` 重新生成文本
- 已知简化：节点 id = 名称路径，改名会丢坐标；数据只存 localStorage
- tldraw 5 的坑见 `../_LEARNINGS.md` #3–#5
