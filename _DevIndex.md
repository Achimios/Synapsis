# 开发索引表

代码里用 `>v<` 开头的注释做标记，方便直接 grep/glob 定位到具体功能，不用翻文件结构。

**格式**：`>v<[emoji]大标题-小标题-一句话注释`
例：`>v<🔭视图投影-范围投影-只显示当前范围的子节点，子孙边提升聚合，范围外端点变 portal`

**怎么用**：想改哪块功能，先在本表找到大标题，再全局搜那个大标题字符串，所有相关位置一次列全。

```bash
grep -rn ">v<💾工作区" core app bootstrap --include=*.js --include=*.jsx
```

> ⚠️ 在本文件里写标记一律包反引号：行首的 `>` 会被 Markdown 当成引用块。
> 文档（`_Design/` 等）不进本表，见 `AGENTS.md` 的目录表。
> `.vbs` / `.bat` 必须纯 ASCII，不能写 emoji 标记 → 在这里登记文件名代替。

---

## 大标题一览

| 标记 | 涉及范围 | 说明 |
|---|---|---|
| `>v<🌳大纲模型` | `core/outline.js` `app/src/panels.jsx`(OutlineTree) `app/src/shell.jsx` | 大纲文本 ⇄ 图；画布编辑后回写大纲；左栏大纲树（导航 / 原地改名） |
| `>v<🔭视图投影` | `core/outline.js` | 范围投影（跨层边聚合、portal）、自动布局 |
| `>v<📤LLM导出` | `core/outline.js` | 节点卡格式的结构化文本 |
| `>v<💾工作区` | `core/workspace.js` `app/vite.config.js` `app/src/shell.jsx` `core/tools/` | `__synapsis/` 文件夹 ⇄ 图、HTTP 接口、界面自动保存、导入空间图 |
| `>v<🤖LLM接口` | `core/cli.js` | overview / outline / export / get / check / apply / init |
| `>v<🧭导航` | `app/src/shell.jsx` `core/workspace.js`(loadView/saveView) | 钻进/退出、后退前进、视图记忆（`<项目>/.synapsis/view.json`）、快捷键 |
| `>v<🎨画布` | `app/src/main.jsx` `app/src/td.jsx` `app/src/shell.jsx` | 两个画布实现、贴图 |
| `>v<🚀启停` | `app/vite.config.js` `app/src/shell.jsx` `core/cli.js`(init) + `core/templates/Synapsis.vbs` `Synapsis_stop.bat` `Synapsis_init.vbs` `core/tools/init_picker.ps1` | 无窗口启动、按端口停止、心跳自动退出 |
| `>v<🗂️外部区` | `core/workspace.js`(listTree/readProjectFile) `app/src/panels.jsx` `app/src/shell.jsx` | 左栏「文件」页：项目根目录只读文件树（含 __synapsis）+ 右侧预览；节点 ⇄ md（看原文、资源管理器、默认程序打开） |
| `>v<🖼️图片` | `core/workspace.js`(picsDir/saveAsset) `app/src/shell.jsx` | 节点图片 = 紧挨 md 的 `_pics_名字/` 文件夹；贴图 / 拖图进卡片；改名删除跟着走 |
| `>v<🎨外观` | `app/src/shell.css` `app/src/launcher.css` | PureRef 风深色高密度主题（颜色全是 `:root` 变量） |
| `>v<🖥️桌面` | `app/electron/` `app/src/launcher.jsx` `Synapsis_desktop.vbs` `core/templates/Synapsis.vbs` | 托盘程序：内置服务、托盘菜单、启动台、每个工作区一个窗口、单实例 |
| `>v<✅自检` | `app/test/` `core/test/` `core/workspace.js`(checkWorkspace) | 纯 Node 核心自检 + 无头 Edge 界面自检 |
| `>v<🧪嵌入实验` | `core/tools/embed_probe.js` | 本地嵌入模型（LM Studio）× 工作区：有连线 vs 没连线的相似度效应量、最像但没连线的候选 |
| `>v<🏗️构建引导` | `bootstrap/bootstrap.js` `bootstrap/template/` | 给新项目铺骨架，已有文件跳过 |

---

## `>v<🌳大纲模型`

小标题：

- **解析** —— `parseOutline`：缩进 = 子级，`-> 名称` = 连线，行首 ✅◐○ = 状态。连线目标按名称**就近**解析（从自己的父开始逐级向上找子树里同名的），所以跨分组写名字就行；同名冲突时写完整路径。
- **序列化** —— `toOutline`：能用名称唯一解析回去就写名称，否则写完整路径。⭐「parse(toOutline(g)) == g」是免费的必须相等量，自检里有。
- **新建节点** —— `shell.jsx` 的 `addNode`：Enter 同级 / Tab 子级（父节点原地展开，不再钻进去）/ 工具栏「＋ 节点」；建完用 `lineOf` 找到大纲那一行，**名字选中、焦点进大纲**，直接打字就是改名（画布上没有原地改名，这是替代）。
- **画布编辑** —— `withEdge` / `withNode`：画布上的操作不直接改画布，而是改图 → 生成新大纲 → 重新解析。大纲是唯一真源。
- ⚠️ id = 名称路径（原型简化），**改名会丢坐标**；正式版 core/ 要换稳定 id。

## `>v<🔭视图投影`

小标题：

- **范围投影** —— `projectView`：只显示当前范围的直接子节点；子孙之间的边提升到可见祖先上并聚合（`count`，画成 ×N）；端点在范围外 → `@portal:<id>` 节点，双击跳过去。
- **原地展开** —— 卡片 `▸N` 点一下或选中后空格：子节点列在卡片里（状态 + 孙辈数）；双击子项 = 跳进去并选中；「全部展开/收起」。展开状态存 localStorage `syn.exp`。⚠️卡片里可点的元素要拦 `pointerdown`，否则 React Flow 当成选中或拖动。
- **自动布局** —— `autoLayout`：最长路径分层（左→右）；⭐**大纲顺序 = 流向提示**：指向前面兄弟的边算回边（↺）忽略（DFS 断环曾把「内在」甩到最右）；奇数层下错 70px；没坐标的节点在自己那列找**空槽**，不压已有节点（新节点压住「兜底」导致拖错）。界面会把自动位置立即固定存盘。

## `>v<📤LLM导出`

小标题：

- **节点卡** —— `exportForLLM`：每个节点一节，带 `[id]`、状态、入边、出边、包含。完整规范见 `Life Games/研究/有向图软件_需求与方案.md` §0.6；格式优劣**还没测**（`_TODO.md` 里的小实验）。

## `>v<💾工作区`

小标题：

- **读取 / 写回** —— `loadWorkspace` / `saveOutline`：文件夹 = 层级（叶子 `名字.md`，分组 `名字/_node.md`）；以 `_`/`.` 开头的不是节点。写回时按「同 id，或同父下 1:1 改名」配对旧节点，保留正文、其余属性、边标签；只写变了的文件；节点消失 → 移进 `_过期的/`（不真删）；空目录清掉；坐标跟着改名走。⭐往返逐字相等有自检。
- **文件名** —— `fileName`：名字含 `/ \ : * ? " < > |` → 全角，原名存 `label:`（`NN/LLM` 曾被拆成两层，往返自检抓到）。
- **frontmatter** —— 最小 YAML 子集（`key: value`、`key:` + `  - 项`），键顺序 label/status/order/其余(字母序)/to，稳定好 diff。出边 `目标 | 标签 | 类型`，目标按名字就近解析。
- **说明文件** —— `ensureWorkspaceReadme`：每个 `__synapsis/` 一份 `_synapsis.md`（格式 + CLI 用法），给人和 LLM。
- **HTTP接口** —— `vite.config.js` 的 `workspaceApi`：`GET /api/ws`、`PUT /api/outline`、`PUT /api/layout`、`POST /api/asset`、`GET /api/file`；工作区 `?ws=` > `SYN_WS` > `.synapsis/config.json`。
- **界面接入** —— `shell.jsx`：启动加载、停手 0.7s 自动保存（大纲有错不存）、状态栏显示；`?demo` = 样例 + localStorage（测试专用）。
- **导入空间图** —— `core/tools/import_spacegraph.js`：一次性，留作来源记录。

## `>v<🤖LLM接口`

小标题：

- **CLI** —— `node core/cli.js` 无参数看用法。LLM 先 `overview`（省 token）→ `get <id>` / `export <id>` → 改结构用 `apply` → `check`。
- **init** —— 双击 `Synapsis_init.vbs` 弹出系统选文件夹窗口（`init_picker.ps1`：IFileOpenDialog + FOS_PICKFOLDERS，资源管理器同款；.NET Framework 的 FolderBrowserDialog 是老式树形窗口所以不用；记住上次选的**上一级**目录在 `.synapsis/last_init_dir.txt`），或把文件夹拖到它上面，或 `cli.js init <目录>`。ps1 必须带 BOM（PS 5.1），读 node 输出前设 `[Console]::OutputEncoding = UTF8`；`SYN_QUIET=1` 不弹结果框（测试用），结果写 `.synapsis/last_init.log`。给项目挂上 Synapsis（重跑安全：已有文件不动，只刷新生成的启动器）：`__synapsis/` + `_synapsis.md`、`.synapsis/`（自带 `*` gitignore，不碰项目原有 .gitignore）、`Synapsis.vbs`（VBScript 的 Escape 给 %uXXXX 浏览器不认 → 手写 UTF-8 编码，已与 encodeURIComponent 对过）。

## `>v<🖥️桌面`

小标题：

- **托盘主进程** —— `electron/main.mjs`：Electron = Node + Chromium（Obsidian 同款），所以托盘不需要 Python。主进程 `chdir(app/)` 后直接 `createServer` 起 vite（端口被占 = 复用已有服务）；`SYN_DESKTOP=1` 关掉心跳自动退出（否则会把整个程序关了）。单实例锁：再次启动把 `--ws` 交给已开的实例。关窗口不退出，托盘「退出」才退。托盘图标代码画的 PNG（不依赖图片文件）。
- **启动台** —— `launcher.html`：最近打开（`.synapsis/recent.json`）+「打开文件夹…」（Electron 原生对话框，默认停在上次项目的上一级）；没挂上 Synapsis 的文件夹先问要不要初始化（调 `core/cli.js` 的 `init`）。preload 只暴露 recent / pickOpen / open / forget / info。⚠️IPC 返回值要能结构化克隆，别把 BrowserWindow 传回页面。
- **项目启动器** —— 模板 `Synapsis.vbs`：装了 Electron 就用桌面程序 `--ws <本目录>` 打开，否则退回 dev 服务 + 浏览器。
- **安装** —— `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；npm 11 下 postinstall 可能没下二进制 → 手动 `node node_modules/electron/install.js`。
- **自检** —— `test/desktop.test.js`：`SYN_TEST_HIDDEN` 窗口不显示、跳过确认框；`SYN_RECENT` 把最近列表指到临时文件。外部服务在跑 / 不在跑两条路径都过过。

## `>v<🧭导航`

小标题：

- **视图记忆** —— `viewports[scope]` 存平移+缩放，localStorage 持久化；画布组件按 scope 重挂载时读回（RF `defaultViewport`）。没有记录才 fitView。
- **历史** —— `go()` 统一入口压栈；Alt+← / Alt+→ 后退前进，Alt+↑ 上一层（并选中刚才所在的节点）。
- **快捷键** —— 捕获阶段监听 window，焦点在大纲/输入框里时不触发；Enter 同级、Tab 子级、空格展开要 `stopPropagation`。

## `>v<🎨画布`

小标题：

- **ReactFlow** —— 本地 nodes 状态 + 外部数据变时重建；⚠️重建要保留旧对象的 `measured`，否则节点被隐藏到重新测量完。
- **右键菜单** —— `panels.jsx` 的 `ContextMenu`：节点（属性/改名/状态/新建子级·同级/展开/钻进/删除）、空白处（新建/全部展开/上一层）。删除 = `withoutNode` 改大纲 → 工作区里文件移进 `_过期的/`；有子孙时先确认。快捷键 Del / F2 / I。
- **属性面板** —— `PropsPanel`：状态、frontmatter 属性、入/出边（**分组显示经由子节点的对外连接**，子树内部的边不算）、正文（工作区模式可改，失焦 `PATCH /api/node` 写回 = Synapsis 唯一写正文的地方，因为是用户亲手改的）。
- **贴图** —— 选中节点时 Ctrl+V 图片 → dataURL 存 localStorage（原型；正式版存 `__synapsis/` 文件）。**没自动化测。**

## `>v<🚀启停`

小标题：

- **心跳** —— 页面每 20s `GET /__alive`；服务见过 ping 后 3 分钟无人 ping 就 `process.exit`。3 分钟是因为后台标签页定时器被节流到约 1 次/分钟。`SYN_IDLE_MS` 可调短做测试。
- **启动 / 停止** —— `Synapsis_start.vbs` 无窗口 `npm run dev` 再开浏览器（已在跑时第二个实例因端口占用失败，无害）；`Synapsis_stop.bat` 按端口 5410 杀进程。

## `>v<✅自检`

小标题：

- **核心** —— `npm test`（app/），纯 Node，18 项；`node core/test/workspace.test.js`，临时目录 19 项。
- **界面** —— `npm run test:ui`（需先起 dev），playwright-core + 本机 Edge 无头：样例模式 29 项（含原地展开、空格、双击子项、新建后改名）+ 工作区模式 17 项（含右键改状态/属性改正文/删除进 _过期的/Del 键/文件页预览）（临时目录，不碰真文件）。`test/shot.mjs` 给真实工作区截图。
- **graph check** —— `checkWorkspace`：悬空边、叶子没 status、code 指向不存在的文件、done 却没 code（提示）。

## `>v<🏗️构建引导`

小标题：

- **生成骨架** —— `bootstrap.js <目录> [--name] [--desc] [--dry]`：模板占位 `{{NAME}} {{DESC}} {{DATE}} {{GUIDE}}`，已有文件跳过，无 git 则 init。规矩本体 `bootstrap/_ProjectBootstrap.md`，全局 skill `project-bootstrap` 指向它。
