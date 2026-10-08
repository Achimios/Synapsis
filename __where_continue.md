# 从哪继续（一屏；旧的在 `_过期的/__where_continue*.md`）

**2026-10-08（白天到晚上）** —— 都提交了、全绿（core 各项 + memory 12 + UI 268 + desktop 13）。最新提交见 `git log`。
⚠️ 这一整天是在 **SimuWeb 目录开的对话**里做的（SimuWeb 的 CLAUDE.md / 记忆一直混在上下文里）。👤 决定以后 **在本目录开新对话** —— 本仓库的 AGENTS.md / `_开发索引.md` / `_TODO.md` / `_LEARNINGS.md` 才是 Synapsis 的规矩。
- 👉 **开工先看**：`_TODO.md`「2026-10-08 晚 AI 这一批」+ 本仓库 `_Blackboard.md` + `Life Games/研究/__synapsis/_Blackboard.md`（**不改它的名字**）
- 这一天做完：
  - **启动器 / 图标**：图标在 `_图标/`（丢 png 进去会自动转 ico）；项目里 init 生成快捷方式「在Synapsis打开本项目」，vbs 藏进 `.synapsis/`（`core/launcher.js`）
  - **左栏搜索**：文本页查找（焦点留在查找框、高亮画在文字后面，Enter 不会改字 —— 曾误删 Life Games 一个词，已恢复）、文件页按名字过滤 / 勾「内容」搜正文
  - **历史栏**（Shift+Tab，大纲右边）：每一步一句人话，点哪行回到哪步（`core/history.js`）
  - **AI 指令框 Shift+F**：
    - 本地 8B 用严格版提示词（问答 / 做事分流）；**在线 DeepSeek 用宽松版**（能聊、接人设、自己推理，整份软件知识进系统提示词吃缓存）—— 👤「主观能动性…扁平化指挥」
    - 动作白名单 = 安全底线，不是教它怎么想（👤「不能完全依靠 skill，不然 LLM 的意义是啥」）；原语 `place`（挪一张卡）、`tighten`（方位不变收紧）、`move` 改名「移进」（= 改父节点）
    - **长期记忆**（`core/memory.js`，只给在线）：项目级 `__synapsis/_AI记忆/`、用户级 `<Synapsis>/.synapsis/记忆/`；只强制附索引（新对话 / 清空 / 8 轮没附过），全文 AI 自己 `read`；`remember` 确认才写
    - 框可拖动 / 改大小；关框关窗不丢（没发的话、待确认的执行…，`/ui/stash` 服务进程内存，托盘重启才清）；「🎨 配色词表」页
    - 🧠 上下文用量；软件知识只读一份：`core/keymap.js` + `__AI接入手册.md`（`core/knowledge.js`）
  - **AI 设置**（⋯ → 🤖 AI）：通用（指令框 / 高频各选本地或在线，高频默认本地）+ 本地页（上下文长度：lms 估显存再重新加载）+ 在线页（DeepSeek key 存 `.synapsis/keys.json` 不进 git；flash / pro；思考强度默认不思考）
- 等 👤：矩阵 / 向量类型节点；第 10 条 角色 × 归属；E2 / E3；ASTRA 在 `_设计/ASTRA的思考/` 写的探索（👤 说待会儿读，建议子代理先出目录 + 一句话）
- ⚠️ **含 `\` 的代码只用 Edit / Write 工具改**，别走 shell heredoc / python 字符串（这一天又踩了 6 次：断言挡住或换行被吃）
- ⚠️ 自检：假 LM Studio 用工作区 `.synapsis/ai.json`（`offline: true` = 不联网、全走本地）；假在线服务用环境变量 `SYNAPSIS_ONLINE_URL`
- 现状一览 `_开发进度.md`，细则 `_工程规矩.md`
