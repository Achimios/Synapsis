# __synapsis/ —— 这个项目的结构图（Synapsis 工作区）

> 给人和 LLM 读的说明。图是**设计草稿**，不是代码；边多为设计估计（看 `source:`）。

## 怎么读（LLM 优先用 CLI，省 token）
```bash
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" overview --ws "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis"     # 分组树 + 状态统计（先看这个）
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" get "<节点id>" --ws "..."   # 单个节点：属性 + 入边/出边 + 正文
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" export ["<节点id>"] --ws "..." # 节点卡
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" check --ws "..."            # 悬空边、无状态、code 指向不存在的文件
```
节点 id = 名称路径（`游戏NPC状态空间组/决策/决策空间（战术目标）`）。

## 文件格式（文件夹 = 层级）
- 叶子节点 `名字.md`；有子节点的 `名字/_node.md`
- 以 `_` 或 `.` 开头的不是节点：`_layout.json`（坐标）、`_assets/`（图片）、`_过期的/`（删除的节点，不真删）
- 名字里有 `/` 等非法字符 → 文件名用全角，原名在 frontmatter `label:`
```
---
status: done | partial | todo
order: 0
rate: 0.5–5 Hz          # 其余属性随便加，Synapsis 原样保留
to:
  - 目标名字 | 边标签 | 类型（离散 / LLM）
---
正文：人写的，Synapsis 不改。
```
- 连线目标按名字**就近**解析（先兄弟、再往上层找）；同名冲突时写完整 id。
- 改结构（增删改名、移动、连线）优先在 Synapsis 界面或 `apply` 里做；直接改文件也行，改完跑 `check`。
