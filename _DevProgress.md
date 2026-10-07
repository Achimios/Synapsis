# 开发进度

## 2026-10-07
- ✅ 项目骨架：AGENTS/CLAUDE、_Design（哲学 + v1 规格）、_TODO、_LEARNINGS、_DevIndex、-给人类的解释
- ✅ 画布对比原型 spikes/：React Flow 与 tldraw 5 共用外壳与核心
  - 【实测】`npm test` 17/17；`npm run test:ui` 28/28（两画布各 14：钻进、聚合边、选中入蓝出橙/淡化、拖动持久化、画布连线→大纲、Enter 新节点、LLM 导出、无页面报错）
  - 【未验】贴图（Ctrl+V）没有自动化测；手感只能用户亲手试
  - 【实测】tldraw 在 localhost 免 key 可跑，但右下角有「Get a license for production」水印；许可条款本身未读
- ⏳ 等用户试两个画布 → 选库 → 写 core/（一节点一 .md 的读写）+ server + CLI
- ✅ 视图记忆（每个范围各存平移+缩放，返回再进来还原）+ Alt+←/→ 历史；【实测】`test:ui` 38/38（含「缩放确实改变视图」的前置断言）
- ✅ `Synapsis_start.vbs` 无窗口启动；`Synapsis_stop.bat` 停（按端口 5410 杀）；心跳：网页全关 3 分钟自动退出（`SYN_IDLE_MS` 可调）。【实测】三者都跑过
- ✅ `_Design/Navigation.md`：导航原语、中键=基变换、标签/嵌入/结构度量（👤 Google 类比）
- 📝 画布选型对比（含 Gemini 意见）：tldraw 自定义形状也能放任意 React（Gemini 说「中等」偏重），但胶水多（3 个坑 + 箭头绑定同步，~150 行 vs RF ~60 行）；RF 边即数据、MIT；tldraw 自由手绘强、有生产水印。倾向 RF 做主干，手绘以后叠一层。**等用户手感**
- ✅ 项目构建引导 `bootstrap/`：规矩汇总（来自 ReadScreen / TTS / SimuWeb / Synapsis）+ 13 个模板 + `bootstrap.js` + 全局 skill `project-bootstrap`。【实测】临时目录生成：已有文件保留、二次运行全跳过、数字前缀去掉、git init
  - ✅ `_DevIndex` 格式改成用户范本（Underwater_Thruster）：标记包反引号 + 大标题一览表 + 每节小标题；代码补了 8 个大标题的锚点；引导与模板同步
