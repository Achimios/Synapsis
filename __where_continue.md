# 从哪继续（一屏；旧的在 `_过期的/__where_continue*.md`）

**2026-10-08 夜** —— 在本目录开的新对话（不再是 SimuWeb 里）。两个会话分工：一个 Opus 聊认知 / 信息论 / 工程方法，一个 Sonnet 实现；共用 `_Blackboard.md`。
- 🌅 **下次从这里开**（👤 2026-10-08 夜）：地基打完，**从 Life Games 研究图里的「从一个游戏NPC开始」起，用实际小案例一步步按需求长功能**；别再预先铺大功能（罗马不是一天建成的）。FK 读回 L2 已做但默认静默、界面 ⚠ 不做；删除的临时去处是 `__synapsis/.junk/`（关窗口送回收站，见 `_TODO.md`「删除的临时去处」）；手动验的还没做：Electron 关窗口 / 托盘退出真触发清空、右键菜单观感、DSH 的 lite 预设实际省了多少 token
- 📌 **2026-10-09 做的：钉子（原名钩子）第 1、2 步都做完了**。代码 `core/pins.js`（纯函数，含 `locateLine`）+ `core/workspace.js`（`loadPins` / `savePins` / `migratePinsFile` / `findFilesByName`，存 `.synapsis/pins.json`，兼容读旧 `hooks.json`）+ `app/src/pindock.jsx`（浮窗，反引号 / 顶栏 📌 开关）+ `panels.jsx`（`RawText` 一行一个 span、选中文字右键菜单）+ `shell.jsx`（`editPins` 进撤销栈 `op: 'pins'`、`pinSelection` / `jumpPin`）。第 1 步 = 节点钉子；第 2 步 = 正文框 / 原文页 / 文件预览里选中文字右键 → 钉到…，存 文件 + 行号 + 整行，双击高亮那一行，文件改过能找回（详见 `_TODO.md`「导航」）。**全部未提交**（一大批：钉子两步、文档补全、`__synapsis` 图补全、UI 测试改动）。
  - 自检：core 各项全过（pins 70）；界面和桌面自检的数字见 `_开发进度.md` 顶上
  - `useBoxGeometry`（`app/src/ai.jsx`）改成窗口缩小时整个框拉回屏幕，AI 框和钉子窗口共用，顺手修了一个 bug（改大小监听之前写进 AI 框的键）
  - **没做**（别误以为有）：在卡片渲染出来的正文里选文字钉；组的图视图；自动跳转轨迹；完整稳定 id；Caps 呼出（Caps Lock 是切换键，用反引号）
  - ⚠️ 含反斜杠的代码只用 Edit / Write 改：这次又在 shell 里的 Python 写 JS，换行转义被吃成真换行，白修了一轮（用户级 CLAUDE.md 写着）
  - 临时文件：`app/test/_ui_tmp.test.js` 是跑回归用的副本，**不需要，可删**（若还在）
- 🌙 **2026-10-10 深夜（睡前交接，最新）**：大纲（拖动只调次序、多选、锁、1/2/3 列、⛓ 分组、⇅ 让 AI 排序、Ctrl+H 替换）、单手快捷键（WASD 等）、引入 / 传送门卡片 `ref:` / UI 框 `ui:`、饱和度档、空白处右栏看当前节点、Enter 不再新建（只 Shift+Enter 新建同级）、右键节点只留「新建子节点」、对展开的子节点列表右键 = 子节点自己的菜单、内置 AI 新建带正文 / 子树 / 读文件 / 翻手册 —— 细节见 `_开发进度.md`。
  - 已提交到 `ae0a8d7`（ui 475 / 核心全过）；**之后还有一批没提交**：右键菜单精简、子节点右键、饱和度自动色可调 + 右栏饱和度行、`_开发进度.md` / `_TODO.md` / 这份、`__synapsis` 自己的 vault 补写。只重跑了相关 UI 块，**睡前没做全量**，明早先跑一遍。
  - **接下来**（`_TODO.md`「2026-10-10 晚 路线」）：（③ AI 配置页按用途细分模型：已做）UI 框的 ▸ / ⊞ 已做（只认自己的状态，不跟「预览展开」）；在线 AI 的上下文加了传送门障碍物 / 正文开头 / 项目大纲；词表颜色后可跟 /50 饱和度（已支持，补了说明），「同组全一个颜色分不开」还在等 👤 定（最内层命中优先？）；命令行导出 UI 布局；本地 8B 版同样的新建升级；手册检索加 Qwen 嵌入；👤 在慢慢试大纲手感。
  - 👤 说明天可能直接在 Synapsis 自己的 vault（`__synapsis/`）里指挥我更新 Synapsis：vault 里已按「界面 / 核心 / AI 辅助…」补了今天的节点和状态，用 `node core/cli.js overview --ws .` 看。
- 🧩 **2026-10-10 做的（已提交，见 git log）**：看清连线（Q，竖栏 🔍线）；展开竖栏（画布左侧：子图 / 子级 / 属性 / 正文 = 本页临时「看」三态，不改节点不挪位置；⋯ 和空白右键「展开本页 ▸」= 真改进 Ctrl+Z；右键卡片「展开 ▸」悬停二级，做不了的灰着）；📌钉 / 🔍线 搬进竖栏；外部文件节点（右键空白「引入外部文件」/ 连线到… 的「项目文件」页签 / Ctrl+F 的「项目文件」页签；节点带 `file:`，不改边格式）；⚙ 设置（左上角，`settings.yaml` 进 git，目前只有 init 生成哪些）；快捷键页双搜索（左按键右文字）；跨项目复制（Ctrl+C 带来源路径，另一个项目 Ctrl+V）。
  - **没做**：快捷键自定义（先把按键处理改成「动作名 → 键」）；跨项目复制的快照；引入外部文件后撤销再重做会丢 `file:`；文件移走后按名找回 / `?`。待办都在 `_TODO.md`。
  - ⚠️ 跑 UI 自检时**别同时改 `app/src` / `core/*.js`**（vite 热更新会刷新页面打断测试）；测试服务用 `SYN_DESKTOP=1 npx vite --port 5477 --strictPort`（不然 3 分钟没网页会自己退出）。含 `
` 的代码只用 Edit / Write 改（这次又在 shell 的 Python 里把 `
` 写成了真换行，已修）。
- 👉 **开工先看**：`_TODO.md` 最上面「内置 AI 升级」+ `_Blackboard.md` + `Life Games/研究/__synapsis/_Blackboard.md`（**不改它的名字**）
- 🆕 **这一晚做的**（全绿：core 各项 + `loop.test.js` 21 + `memory.test.js` 17 + app 29；`vite build` 编过）：
  - 调研报告 `_设计/-Agent架构调研_2026-10-08.md`（§7 = 官方一手资料，§8 = 对照内置 AI 的差距；§1–6 是 3～4 月的二手分析，冲突以 §7 为准）
  - 内置 AI（`core/agent.js`）：历史里分清「提议 / 执行」（`ai_chat.json` 的 `executed` / `warnings`，下一轮前加【上一轮结果】）；执行后重叠检查；在线版只读 `look`（node / page / search，最多 3 跳）；记忆 `type` + 索引 60 条上限
- 🆕 黑板里 Opus 派的两条做完了（实测快照 + AI 底线），回复在 `_Blackboard.md` 那条下面；第 3 条（没 status 的叶子 warn）按它说的先不动
- ⚠️ **只在假服务上测过**。真模型手测 look / 【上一轮结果】还没做（用临时目录，别在 Life Games 上试）
- 等 👤：C③「整理记忆」要不要做（用户点了才跑）；矩阵 / 向量类型节点；第 10 条 角色 × 归属；E2 / E3；ASTRA 在 `_设计/ASTRA的思考/` 写的探索（建议子代理先出目录 + 一句话）
- 范围（👤 2026-10-08）：**Synapsis 不拿来训练游戏 NPC**，那是 Life Games 的事；调研报告 §6 的 NPC 内容只是学习思路笔记，别往 Synapsis 待办里加
- ⚠️ **含 `\` 的代码只用 Edit / Write 工具改**，别走 shell heredoc / python 字符串
- ⚠️ 自检：假 LM Studio 用工作区 `.synapsis/ai.json`（`offline: true` = 不联网、全走本地）；假在线服务用环境变量 `SYNAPSIS_ONLINE_URL` + `DEEPSEEK_API_KEY=sk-fake`（照 `core/test/loop.test.js`）
- 临时交接用完就丢 `_过期的/`（👤 2026-10-08 的规矩，`_工程规矩.md` §1）
- 现状一览 `_开发进度.md`，细则 `_工程规矩.md`

## 2026-10-11 交接（Sonnet → Opus，用户要压缩后让 Opus 接，**debug 请细心**）
- 最新提交：`92c4b65`（大纲 ↑∞/↑1/↓、多列大纲整棵子树不拆列、预览展开两态 + 顶部提示条）、`6f2031e`（UI 节点也吃预览展开、`tempDeep`、真展开本页排除 UI 框内节点）、本次 keymap 补 Shift+1~4。**全部只做了编译检查，没跑自检**（用户要求不跑全量；他自己手测）。
- ✅ **已修 1（Opus）**：Shift+1 时 UI 框里的子图又被裁。原因有两个：① `tempDeep` 要求 `!framed[id]`，一级子节点自己真展开过子图就不算，于是被裁；② 裁剪在 `build()` 时按当时的 measured 算并存进节点 style，子图被递进撑大后裁剪还停在旧尺寸。改法：裁剪挪到 `main.jsx` 的 `clipUi`，每次渲染按当前坐标和 measured 现算、不存进 nodes（`shown = clipUi(sizeFrames(nodes))`）；view 节点改带 `seeDeep`（本页开着 Shift+1），有子图的那层不裁。playwright 复现过、修后验过（开 = 不裁，关 = 按新尺寸裁回）。
- ✅ **已修 2（Opus）**：真的展开本页改用 `underUi(id)`，沿 graph 父级一路往上查到本页为止，任一祖先是 UI 框就不动。验过：UI 框里三层真展开状态在展开 / 收起本页时都不变。
- ✅ **贴图进撤销（Opus）**：`{op:'pics'}`，贴进节点 / 散图，撤销 = 挪进 .junk/（`/pic-remove`，`core/workspace.js removePic`），重做 = `/restore` 搬回并写回坐标；删散图也能撤销。改了 `vite.config.js` 和 core → **托盘要重启**才生效。
- ✅ **AI 指令框：压缩记忆 + 发图（Opus）**：短记忆 = 摘要 + 摘要之后的原文（`core/agent.js` `memoryOf / compactChat / needCompact`，摘要存 `.synapsis/ai_chat_summary.json`）；在线 / 本地各一套（`memCfg`）：在线默认 64000 token / 留 4 轮，本地 3000 / 2（键名带 Local），回答后后台自动压，AI 设置「通用」两行可调；关了自动压缩 = 超上限从最老的丢。🗜 手动压。图：Ctrl+V / 拖进框 → 缩略图（单击放大、✕），`chat()` 发成 文字 + image_url，本地也照发（用户有能看图的 Qwen）；短记忆只记张数，日志写「[图片 N 张]」。用户实测 DeepSeek flash 看图成功。
- ⚠ 修了 `saveAiConfig`：以前存任何 AI 设置都把整份默认值写进 ai.json，默认值改了不生效（memLimit 被冻在 8000）；现在只写改过的键，并从用户的 ai.json 删掉了被冻住的三行。
- 待决：框内缩放 / 平移要不要存盘（用户问「存盘会有冲突？」：我的回答是不会，只是几个数；会和外部 CLI/AI 改布局放在同一文件里。倾向存到 `view.json` 而不是 `_layout.json`，就不会冲突）。
- 用户要求：快捷键页（`core/keymap.js`）已补；`_开发进度.md` / vault 节点还没更新到最近几批（框内画布、⛶、compact、大纲三态、托盘重启、中键平移、图案词表、预览展开两态）。
- 托盘需重启一次：新菜单项「重启 Synapsis」和 `/ai/words` 路由才生效。
