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
- ✅ **core/ 工作区读写**：`__synapsis/` 文件夹 = 层级、一节点一 .md（frontmatter：status/order/其余属性/to 出边带标签），正文永不改；改名搬文件、删除进 `_过期的/`、名字含 `/` 用全角文件名 + `label:`（往返自检抓到）。【实测】`core/test/workspace.test.js` 19/19
- ✅ **CLI** `core/cli.js`：overview / outline / export / get / check / apply / init。【实测】研究与 Synapsis 自身两个工作区跑通；Synapsis 自身 check 0 错（12 个 code 路径都存在）
- ✅ **界面接工作区**：自动保存（停手 0.7s）、坐标写 `_layout.json`、贴图存 `_assets/`、边标签与副标题（rate）来自文件；`?demo` 给测试。【实测】test:ui 52/52（含工作区模式：画布 Enter → 文件出现、拖动 → _layout.json）。【未验】贴图仍没自动化测
- ✅ **七丘落地**（👤 比喻：NPC 状态空间组 = 罗马的发源地）：`Life Games/研究/__synapsis/游戏NPC状态空间组/`，从空间图.html 导入 15 节点 28 边（说明、频率、数学类型、Life Games 现状、边标签/离散/LLM），6 个原分组如实保留
- ✅ **init + 启动器**：研究与 Synapsis 各有 `Synapsis.vbs` + `.synapsis/`（自带 `*` gitignore）。【实测】VBS 的 UTF-8 编码与 encodeURIComponent 逐字相等；【未验】双击 VBS 全流程（用户不在，没弹浏览器）
- 🐛 修：新节点压住老节点（自动布局不避让 + RF 保留旧本地坐标）→ 找空槽 + 自动位置立即固定 + RF 只在拖动中用本地坐标；断环改按大纲顺序（DFS 顺序把「内在」甩到最右）
- ✅ 新建节点可发现：工具栏「＋ 节点」、Enter/Tab 建完光标跳到大纲选中名字直接改名；原地展开子级（▸N/空格/全部展开，双击子项跳进去）。【实测】test:ui 72/72
- ✅ **画布定为 React Flow**（👤 问该定了，Claude 给证据：胶水代码/坑/体积/许可/未来矩阵与基变换需求）。`spikes/` → `app/`，tldraw 版进 `_过期的/tldraw_spike/`，卸 tldraw（打包 1.7MB → 416kB）。决定记录 `_Design/Decision_Canvas.md`。【实测】outline 18、workspace 19、ui 36、Synapsis 自身 check 0 错
- ✅ `Synapsis_init.bat`：拖项目文件夹上去 = init；init 重跑会按新模板刷新启动器（研究与 Synapsis 的启动器已刷新到 `app`）。【实测】中文路径（初始化测试）通过
- 🧪 嵌入实验 #1（`core/tools/embed_probe.js`）：nomic 在研究工作区，有连线 vs 没连线 效应量 0.86（名字+说明）/ 0.56（只名字）；中文分辨力差，候选多被代码片段带偏。判断：用多语种嵌入模型，8B 只做判断，代码/数学先走精确结构。见 `_Design/Navigation.md` §3.5
- ✅ 用户级 `~/.claude/CLAUDE.md`（👤要求，短）：反斜杠与中文的跨项目坑
- ✅ 右键菜单 / 删除（进 _过期的）/ 属性面板（分组显示经由子节点的连接，正文可改）/ 左栏文件页 + 预览。【实测】outline 22、ui 46
- 🧪 嵌入实验 #2：Qwen3-Embedding-0.6B（ModelScope 下载到 E:/2a_Code_Wares/LLMs，LM Studio 自动识别）。分布 0.38–0.72（nomic 0.75–0.86）、同组 vs 跨组 0.535/0.451（nomic 几乎无差）、只用名字效应量 0.74（nomic 0.56）。⭐机理：嵌入量的是「同类」不是「相连」——候选都是兄弟（敌方观察↔队友观察），而 AI 空间图的边多连不同类（观测→决策）→ 嵌入用于分组/搜索/找重复，连线建议要靠 LLM 判断或代码结构
