# 开发进度（只写现状；流水账在 `_过期的/_DevProgress.md`）

> 规矩见 `_ProjectRules.md` §2：修好的小 bug、技术过程当轮就剪去过期；机理进 `_LEARNINGS.md`。
> 最近一次全量自检（2026-10-08）：workspace 37、cli 21、outline 22、ui 79、desktop 9 —— 全过。

| 模块 | 状态 | ⚠️ 还没验到 |
|---|---|---|
| **core/ 工作区读写** | ✅ `__synapsis/` 一节点一 md（文件夹 = 层级、frontmatter、正文不动）；改名搬文件、删除进 `_过期的/`；图片 `_pics_名字/` 跟着走；视图 `.synapsis/view.json` | 稳定 id（跨父移动 + 改名会断关联） |
| **CLI**（LLM 接口）`core/cli.js` | ✅ 读：overview / outline / export / get / find / check；写：add / rename / status / link（带标签）/ unlink / body / set / rm / apply；manual | 包成 MCP（见 TODO） |
| **AI 接入手册** | ✅ 源头 `core/templates/AI_Manual.md` → 根目录 `_AI_Manual.md`（通用）+ 每个工作区 `__synapsis/_synapsis.md`（填好路径，打开工作区 / init 时自动刷新）；别的 AI 有问题写 `_Blackboard.md` | 第一次被另一个 Claude 真用（Life Games，2026-10-08） |
| **画布**（React Flow，👤 已定） | ✅ 钻进、跨层边聚合 + portal、原地展开、拖动连线、右键菜单、选中入蓝出橙 | 手感只能用户亲手试 |
| **左栏** | ✅ 大纲树（点 = 导航 + 看概览，双击 / F2 = 改名，键盘走）、文本页（成片打字）、文件页（含 `__synapsis`，节点 md → 跳过去看原文） | —— |
| **右栏属性面板** | ✅ 默认开着（👤）；概览（状态、属性、出入边、正文可改）/ 原文（md 全文 + 资源管理器 / 默认程序打开） | 资源管理器 / 默认程序打开需人眼 |
| **图片** | ✅ 节点图 `_pics_名字/`（粘贴 / 拖到卡片上）；**散图** `_pics/`（拖到空白处 / 没选中时粘贴，👤：不必变成节点）；拖文件、拖网页图（服务端代下）；拖角调大小；单卡 / 全局收起；单张不限高；Del 删散图进 `_过期的/` | 真实鼠标拖放（测试用合成事件） |
| **键位** | ✅ Tab 左栏、Insert / Ctrl+Enter 子级、Enter 同级、鼠标侧键后退前进、? / F1 快捷键页（`KEYMAP` 一张表） | 真实鼠标侧键；自定义键位（暂不做） |
| **外观** | ✅ PureRef 风深色高密度（👤），颜色全在 `:root` 变量 | 浅色备选（TODO） |
| **托盘程序**（Electron） | ✅ 启动台、最近打开、每个工作区一个窗口、单实例（additionalData 传参）、窗口位置记忆 | 托盘图标与右键菜单、原生选文件夹框需人眼 |
| **构建引导** `bootstrap/` | ✅ 规矩 + 模板（含 `_ProjectRules.md`）+ 生成脚本 + 全局 skill | —— |
| **调研 / 实验** | ✅ 嵌入实验 #1 #2（结论：嵌入量「同类」不是「相连」）；工具调研（`_Design/Research_Landscape.md`） | E1 换基 / E2 扩散激活 / E3 JSON Canvas 等 👤 挑 |

## 👤 决定（引用用，推翻要显式说）
- 画布 React Flow；一节点一 md；先只做游戏 AI 行为一个案例（建罗马巴黎不建迈阿密）
- 七丘 = 游戏NPC状态空间组；Synapsis 由用户和 Claude 一起维护，Claude 代记
- PureRef 风；Tab = 侧栏开关；鼠标侧键 = 前进后退；属性面板默认开；人格 = 伊丽莎白
