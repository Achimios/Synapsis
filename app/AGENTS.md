# app/ —— 界面（React Flow + 外壳 + dev 服务里的工作区 API）

- `src/shell.jsx`：外壳——左大纲（真源）、面包屑、导航、快捷键、新建/改名、原地展开、贴图、工作区读写与自动保存
- `src/main.jsx`：React Flow 画布（只显示 view + 回报操作）
- `src/outline.js`：转发 `../core/outline.js`
- `vite.config.js`：心跳自动退出 + 工作区 HTTP 接口（`?ws=` > `SYN_WS` > `../.synapsis/config.json`）

规矩：
- 画布选型已定 React Flow（`../_Design/Decision_Canvas.md`）；卡片里可交互的元素加 `nodrag`/`nowheel` 或拦 `pointerdown`
- 坐标以外壳的 layout 为准，React Flow 只在拖动中用本地坐标；重建 nodes 保留 `measured`
- 自检：`npm test`（纯 Node）；`npm run test:ui`（需先起 dev；无头 Edge；**只用 `?demo` 或临时 `?ws=`，别让测试碰真工作区**）；`test/shot.mjs` 给真实工作区截图
- 启动：被规划项目根目录 `Synapsis.vbs`；停：`../Synapsis_stop.bat`；或 `npm run dev`（:5410）
- 已知简化：节点 id = 名称路径（同父 1:1 改名能跟上）；视图记忆、展开状态还在浏览器 localStorage（该搬进 `.synapsis/`）
