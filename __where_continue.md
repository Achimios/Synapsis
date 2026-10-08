# 从哪继续（一屏；旧的在 `_过期的/__where_continue*.md`）

**2026-10-08 夜** —— 在本目录开的新对话（不再是 SimuWeb 里）。两个会话分工：一个 Opus 聊认知 / 信息论 / 工程方法，一个 Sonnet 实现；共用 `_Blackboard.md`。
- 🌅 **下次从这里开**（👤 2026-10-08 夜）：地基打完，**从 Life Games 研究图里的「从一个游戏NPC开始」起，用实际小案例一步步按需求长功能**；别再预先铺大功能（罗马不是一天建成的）。FK 读回 L2 已做但默认静默、界面 ⚠ 不做；删除的临时去处是 `__synapsis/.junk/`（关窗口送回收站，见 `_TODO.md`「删除的临时去处」）；手动验的还没做：Electron 关窗口 / 托盘退出真触发清空、右键菜单观感、DSH 的 lite 预设实际省了多少 token
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
