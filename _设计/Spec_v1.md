# Synapsis · v1 规格（先简单）

> 2026-10-07。未来的东西进 `_待办.md`，不进这里。原始需求文档（AI 行为图视角，更细）：`Life Games/研究/有向图软件_需求与方案.md`。

## 0. 测试工作区（👤）
`C:\Users\Administrator\Desktop\Life Games\研究`（空间图.html 等就是被规划的内容）。core 写好前不往那里写 `__synapsis/`。

## 1. 工作空间布局（被规划的项目）
```
<项目根>/
  __synapsis/        图数据：节点 .md（一节点一文件）、图片、layout（坐标单独存，免得拖动污染语义 diff）—— 进 git
  .synapsis/         本机状态（窗口、缓存）—— gitignore
  Synapsis.vbs       启动器：`node core/cli.js init <项目>` 生成；起全局服务（没在跑才起）并打开本目录（纯 ASCII，中文路径手动 UTF-8 编码）
```
- **服务全局只有一个**（像 Obsidian：软件全局、工作区本地），多工作区；避免每个项目各起一个撞端口、两份代码版本。
- `__synapsis/` 而不是 `.synapsis/`：ripgrep 与 Obsidian 都默认跳过点目录。
- 在被规划项目的 CLAUDE.md 里加一句「设计图见 `synapsis overview`」。

## 2. 可视空间
- **内部区** = `__synapsis/` 的草稿节点
- **外部区** = 项目本身：v1 只读文件树 + 解析 `_开发索引.md` / `_开发索引表.md` 里的 `>v<` 行（递归扫描，每张表挂在所在目录节点上；钻进目录即看到，不需要切换工作区）
- 忽略：`.git` `node_modules` `_过期的` `__pycache__`

## 3. v1 交互
- 大纲式打字建节点（回车同级、Tab 子级），`-> 目标` 连线；画布同步出现，之后可拖
- 钻进节点（子图）+ 面包屑；子孙间的边在上层**聚合**显示
- 粘贴图片进节点
- 选中：入边蓝 / 出边橙，其余淡化
- 状态 ✅◐○
- 导出结构化文本给 LLM（节点卡格式，见需求文档 §0.6）

## 4. LLM 的 CLI
`synapsis overview | get <id> | neighbors <id> | search <q> | check | export [--scope id] | patch <file>`
与服务共用 `core/`。

## 5. 画布库
React Flow（MIT）vs tldraw（自有许可，待核实）—— 同一需求各做一版原型，用户亲手试后定。见 `app/`。
