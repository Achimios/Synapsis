# 从哪继续（一屏；旧的在 `_过期的/__where_continue*.md`）

**2026-10-08（第二夜，👤 睡了让我「哐哐继续干」）** —— 都提交了、全绿（core 各项 + UI 228）。
- 👉 **开工先看**：本仓库 `_Blackboard.md`（工具问题）+ `Life Games/研究/__synapsis/_Blackboard.md`（研究讨论，**不改它的名字**）
- 这一夜做完：
  - **LM Studio 接入**（`core/ai.js`，顶栏 🤖 AI）：选模型（本机 `.synapsis/ai.json`，工作区可覆盖）、语义配色 / 语义图案（8B 归类，缓存）、生成词表（草稿 → 点了才写）、**潜在关联**小窗（嵌入粗排 + 8B 精排带理由）、调用日志 `.synapsis/ai_log.jsonl`
  - **AI 指令框 Ctrl+J**（`core/agent.js` + `core/plan.js` + `core/skills/*.md`）：11 个技能（含 move），8B 只给动作草案 → 校验 → 预览 → Enter 执行（进撤销）；短记忆 `.synapsis/ai_chat.json`；说了做了却没给动作 → 明说
  - **底纹图案**（`core/patterns.js`，`_图案.md`）：颜色 = 主题，图案 = 性质
  - **移动节点**：拖到卡片上 = 放进去、框里拖出 = 拿出来、Ctrl+X/V、CLI `move`；`moveNodes` 把新旧 id 对应交给 `saveOutline`（撤销 / 重做也带）
  - 框选挤压（逐张推进）、Shift 锁轴、📄 卡片里展开正文（极简 md）、卡片显示属性、属性表可改名、传送门三档、白色主题、快捷键页美化、桌面版 Ctrl+=、搜索改 Ctrl+F、文档改名（`_TODO` `_PLAN` `_Blackboard` `_LEARNINGS` `__AI接入手册` `__where_continue`，人格 / TTS `0_`）
- 👉 **下一步**：图片灯箱 / 散图归给节点 → 撤销覆盖属性编辑
- 等 👤：**矩阵 / 向量类型节点**怎么做（👤 想取代「设为空间」；情绪→行为插值去问 Life Games 的 Sonnet）；第 10 条 角色 × 归属；E2 / E3
- ⚠️ 改 `vite.config.js` 要**一次写完**；JSX 属性里别用 `//`；**含 `\` 的代码别走 shell heredoc / python 字符串**（这一夜又踩了 3 次，换行被吃 → 用 Edit 工具）
- ⚠️ 自检里的假 LM Studio：工作区级 `.synapsis/ai.json` 把临时工作区指到假服务；读「最后一条」消息（前面可能是短记忆）
- 现状一览 `_开发进度.md`，细则 `_工程规矩.md`
