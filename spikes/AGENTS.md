# spikes/ —— 画布库对比原型

同一份大纲、同一个外壳（`src/shell.jsx`），只换画布：`rf.jsx`（React Flow）vs `td.jsx`（tldraw 5）。
核心逻辑已在 `../core/`（`src/outline.js` 只是转发）。默认读写工作区（`?ws=` > `SYN_WS` > `../.synapsis/config.json`）；`?demo` = 样例 + localStorage，自动化测试只用它，别让测试碰真文件。

- 启动：被规划项目根目录的 `Synapsis.vbs`（`node core/cli.js init <项目>` 生成）；停：`../Synapsis_stop.bat`；或 `npm run dev`（:5410）
- 自检：`npm test`（纯 Node，大纲解析/投影/布局）；`npm run test:ui`（无头 Edge 跑两个画布同一套交互，需先起 dev；可传截图目录）
- **大纲文本是唯一真源**：画布操作 → 改图 → `toOutline` 重新生成文本
- 已知简化：节点 id = 名称路径（同父 1:1 改名能跟上）；视图记忆还在浏览器 localStorage（该搬进 `.synapsis/`）
- tldraw 5 的坑见 `../_LEARNINGS.md` #3–#5
