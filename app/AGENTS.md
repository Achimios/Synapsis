# app/ —— 界面（React Flow + 外壳 + dev 服务里的工作区 API）

- `src/shell.jsx`：外壳——左大纲（真源）、面包屑、导航、快捷键、新建/改名、原地展开、贴图、工作区读写与自动保存
- `src/main.jsx`：React Flow 画布（只显示 view + 回报操作）
- `src/outline.js`：转发 `../core/outline.js`
- `electron/main.mjs` + `preload.cjs`：托盘程序（主进程里起 vite；单实例；`--ws <目录>` 直接开工作区；关窗口留在托盘）；`launcher.html` + `src/launcher.jsx`：启动台
- `src/panels.jsx`：右键菜单、属性面板、文件树、文件预览
- `vite.config.js`：心跳自动退出 + 工作区 HTTP 接口（`?ws=` > `SYN_WS` > `../.synapsis/config.json`）

规矩：
- 画布选型已定 React Flow（`../_设计/Decision_Canvas.md`）；卡片里可交互的元素加 `nodrag`/`nowheel` 或拦 `pointerdown`
- 坐标以外壳的 layout 为准，React Flow 只在拖动中用本地坐标；重建 nodes 保留 `measured`
- 自检：`npm run test:desktop`（Electron，窗口隐藏，最近列表重定向到临时文件）；`npm test`（纯 Node）；`node test/ui_par.mjs [块名片段…]`（并行版：只跑相关块十几秒，不带参数 = 全部块几分钟；`--list` 看块名）、`npm run test:ui`（串行全量，慢；需先起 dev；无头 Edge；**只用 `?demo` 或临时 `?ws=`，别让测试碰真工作区**）；`test/shot.mjs` 给真实工作区截图
- 启动：被规划项目根目录 `Synapsis.vbs`；停：`../Synapsis_stop.bat`；或 `npm run dev`（:5410）
- 已知简化：节点 id = 名称路径（同父 1:1 改名能跟上）。视图记忆在 `<项目>/.synapsis/view.json`（`?demo` 仍用 localStorage）
- 主题颜色全在 `src/shell.css` 的 `:root` 变量里，别在组件里写死颜色
