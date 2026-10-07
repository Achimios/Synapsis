<!-- synapsis:generated —— 这份由 Synapsis 生成，会被刷新；想自己改就删掉这一行 -->
# Synapsis · AI 接入手册

> 给接手**被 Synapsis 规划的项目**的 AI（Claude / Codex / 别的 LLM）。读完这一页就能读图、按图干活、把进度写回图里。
> 这份是生成物，源头在 `C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/templates/AI_Manual.md`；改手册改那份，然后跑 `node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" manual --write`。

## 1. 这是什么
- 项目根目录的 `__synapsis/` 是**这个项目的结构图**：人（Leo）在这里想清楚「要造什么、各块怎么连、造到哪了」。
- 它是**设计草稿**，不是代码，也不是规格书：节点可以很粗糙，边多半是设计估计。别把它当成已经验证过的事实。
- 你的角色：**照着图理解意图 → 写代码 → 把状态写回图**（节点变 ✅◐○、挂上 `code:`）。人画意图，AI 施工，图显示进度。

## 2. 开工前三步
```bash
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" overview --ws "<被规划项目根目录>"     # 分组树 + 状态统计（先看这个，省 token）
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" find <关键词> --ws "<被规划项目根目录>" # 找到和你任务相关的节点
node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" get "<节点id>" --ws "<被规划项目根目录>" # 读节点：属性 + 入边/出边 + 正文
```
- 节点 id = 名称路径，比如 `游戏NPC状态空间组/决策/决策空间（战术目标）`。
- 中文参数在 Windows 上走 **Bash**；PowerShell 5.1 会把中文变成 `??`。

## 3. 规矩（重要）
1. **正文是人写的思考。** 不要改写或删掉人写的段落。要补充就在正文末尾追加一节 `## AI 记录（YYYY-MM-DD）`。`body` 命令会整段替换正文，用之前先 `get` 读出原文，保留原文再追加。
2. **做完一块就回写状态**：`status <id> done|partial`；有对应代码就 `set <id> code=相对路径#符号`；最后跑 `check`（code 路径不存在会报错，草稿不会悄悄变成谎言）。
3. **小结构改动可以直接做**（加子节点、连线、改错字）。**大改**（删分组、改名一片、重新分层）先问人。
4. **删除不真删**：`rm` 把文件移进 `__synapsis/_过期的/`。手动删文件也照此办理。
5. **别碰**：`_layout.json`（人摆的位置）、`.synapsis/`（本机视图状态）。
6. 说法要分清证据：结论是测出来的就写【实测】，是推的就写【估计】或【未验】。可以记成属性：`set <id> evidence=实测`。
7. 优先用 CLI。直接改 md 文件也行，但要按 §5 的格式写，改完跑 `check`。

## 4. CLI
`node "C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/core/cli.js" <命令> … --ws "<被规划项目根目录>"`

```
用法：node core/cli.js <命令> [参数] [--ws <被规划项目根目录>]
读：
  overview                     分组树 + 状态统计（先看这个，省 token）
  outline                      完整大纲（可编辑后用 apply 整体写回）
  export [节点id]              节点卡（给 LLM 的结构化文本），默认全部
  get <节点id>                 单个节点：属性 + 入边/出边 + 正文
  find <关键词>                在名字 / 属性 / 正文里找
  check                        悬空边、无状态、code 指向不存在的文件
写（每条都是原子的一小步；删除一律进 _过期的/，不真删）：
  add <父id|/> <名字> [--after <兄弟id>]   新建节点，打印新 id
  rename <id> <新名字>
  status <id> <done|partial|todo|none>
  link <从id> <到id> [--label 标签] [--kind 类型]   连线（已有则只改标签）
  unlink <从id> <到id>
  body <id> <文件|->           用文件（- = 标准输入）替换正文
  set <id> 键=值 [键=值…]      改属性（值留空 = 删掉这个键）
  rm <id>                      删除节点和子孙
  apply <大纲文件>             用大纲文本整体写回（大改结构时用）
其它：
  manual                       打印 AI 接入手册
  init <项目目录>              给项目挂上 Synapsis
```

## 5. 文件格式（文件夹 = 层级）
- 叶子节点 `名字.md`；有子节点的 `名字/_node.md`。
- 以 `_` 或 `.` 开头的都不是节点：`_layout.json`（坐标）、`_过期的/`（删掉的）、`_pics_名字/`（这个节点的图片）、`_pics/`（这一页的散图）、`_synapsis.md`（本手册）。
- 名字里有 `/` 等非法字符时，文件名用全角，原名写在 frontmatter 的 `label:` 里。
```
---
status: done | partial | todo
order: 0                # 兄弟间顺序
rate: 0.5–5 Hz          # 其余属性随便加，Synapsis 原样保留
code: src/ai/think.js#decide
to:
  - 目标名字 | 边标签 | 类型
---
正文：人写的，Synapsis 不改。
```
- 连线目标按名字**就近**解析：先找兄弟，再往上层找。同名冲突时写完整 id。

## 6. 和人、和 Synapsis 本身打交道
- 人是 Leo：游戏开发者 / motion designer。回复用中文。他累的时候别让他做琐碎决定，有惯例就按惯例办。
- 你在用 Synapsis 时觉得别扭，或者缺了什么功能：**追加一条到 `C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/_Blackboard.md`**，写日期、你在干什么、卡在哪。维护 Synapsis 的那个 Claude 会看，看完处理掉。别直接改 Synapsis 的代码。
- 打开图形界面：双击项目根目录的 `Synapsis.vbs`。改动会和 CLI 的写入同步，两边写的都是同一批 md 文件。
