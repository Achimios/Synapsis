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
- 根节点写 `.`（Git Bash 会把单独的 `/` 改写成 Git 安装目录）。名字里有 `/` 的节点，id 照写 `/`，也接受文件名里的全角 `／`。
- **先看 `__synapsis/_Blackboard.md`**：这是这个项目里人和各个 AI 讨论设计的地方（见 §6）。

## 3. 规矩（重要）
1. **正文是人写的思考。** 不要改写或删掉人写的段落。要补充就在正文末尾追加一节 `## AI 记录（YYYY-MM-DD）`。`body` 命令会整段替换正文，用之前先 `get` 读出原文，保留原文再追加。
2. **做完一块就回写状态**：`status <id> done|partial`；有对应代码就 `set <id> code=相对路径#符号`；最后跑 `check`（文件或 `#符号` 不存在都会报错，草稿不会悄悄变成谎言）。
   - ⚠️`code:` 的路径**相对 `--ws` 目录**（就是放 `__synapsis/` 的那一层），不是 git 仓库根。代码在上一层就写 `../tac.js#think`。
   - 📎 `file: 相对项目根的路径`：这个节点只是引用一个 `__synapsis` 外的项目文件（笔记 / json 等；界面里右键空白 →「引入…」建的）。要看内容就按路径自己去读，别改写路径；文件被移走时 `check` 会提示（warn）。这种节点不带 status，不算进度。
   - ↗ `ref: <另一个节点的 id>`：传送门卡片，只是在这一页放个指向别处节点的入口（界面：右键空白 →「引入…」→ 选节点；双击跳过去）；名字 `↗ 目标名`，不带 status；目标改名 / 搬家时 ref 会自动跟；目标删了 check 报 warn。**不是复制**，别当成有内容的节点。
   - ▭ `ui: true` + `w` / `h`：UI 框（界面草稿用）。在所在页里是个有宽高的线框，**里面（钻进去）是正常画布，位置用里面那一页自己的坐标**；里面可以放 UI 框，也可以放普通节点写文字说明。要读布局：`_layout.json` 里是各节点左上角坐标（`x` 向右、`y` 向下），UI 框的四个角 = 左上 (x,y)，右下 (x+w, y+h)；界面里右键 UI 框 →「复制 UI 布局」能得到整理好的文字（每一级 UI 框带四个角 + 宽高，普通节点带名字和正文）。UI 框不带 status。
   - 🎬 **时间轴页**（剪辑用）：页面节点写 `timeline: true`（可选 `beats: 感官.json` 拍点源、`fps: 24`），它的子节点写 `t0` / `t1`（**成片时间**，秒，3 位小数；也认 `分:秒`）+ 可选 `track`（0 = 主轨）就是轴上的一段；没写的不上轴。视频片段写 `src`（剪辑表语法，如 `样片:粒子海/20_….mp4@1.2`、`原片@0:52.5`），可选 `speed`；没 src 就用第一张图当静帧。**剪辑以这些节点为准**，读用 `timeline <页id> --json`（别自己解析 md）。同一素材用两次 = 放两张传送门卡（`ref:`），各写各的 t0 / t1，别复制节点。截帧的时间码是素材时间（写 `src_t`），别和 t0 / t1 混。轴上的条不带 status；`check` 只警告 t0 ≥ t1、只写了一个、同轨重叠。**段落** = 子节点本身也是时间轴页：它的时间由里面各段自动算（最早 t0 ~ 最晚 t1），**别给段落写 t0 / t1**（写了不算，check 会提示）；导出里段落带 `"group": true`，要镜头就 `timeline <段落id>`。镜头和画布上的参考 / 描述节点用普通连线（镜头 → 参考 = 这段用了这个参考）。
   - 分组不用标状态：`overview` 按子节点汇总（全 ✅ 才 ✅）。
   - 不做了就 `status <id> dropped`（❌ 弃用，别删）：不算完成度，`check` 跳过它和它的子孙。
3. **一次写很多节点用 `batch`**（一个 JSON 文件，一个进程跑完），别每个节点 spawn 好几次。`add` 撞名会报错；脚本可能重跑就加 `--if-missing`（batch 里是 `{"ifMissing":true}`）。
4. **小结构改动可以直接做**（加子节点、连线、改错字）。**大改**（删分组、改名一片、重新分层）先问人。
   - **图里写的是意图，代码是实现。做不到节点里写的意图时，把差距报告给人，别回头改意图节点去迁就实现。** 想改意图，是人的决定（可以提议，但要说清「这是在改意图」）。
5. **删除不真删**：`rm` 把文件移进 `__synapsis/.junk/`（临时的：Synapsis 窗口关掉时整个送系统回收站，不进 git）。要长期留着的旧东西，自己放 `__synapsis/_过期的/`。手动删文件也照此办理。
6. **别手改**：`_layout.json`（人摆的位置，应用也在写它，同时改会互相覆盖；**读可以**，UI 草稿的方位就在里面）、`.synapsis/`（本机视图状态）。
7. 说法要分清证据：`set <id> evidence=实测|设计|估计|未验`（界面卡片上会显示成标签）。
   - 标 `evidence=实测` 时，如果节点有 `code:`，会顺手记下那个文件的内容快照（`evidence_hash`，机器记的，别手改）。之后文件变了，`check` 给一条 info「实测之后 … 改过，结论可能要重验」——**只提示，不作废**。你重新验过，就再 `set <id> evidence=实测` 刷新快照。先写 `code=`、后标 `实测`，或者同一条 `set` 里一起写，都行。
   - 「设计」说的是应该怎样，「实测 / 估计 / 未验」说的是观察到怎样、有多可信；两个维度，别指望一个字段说清。
   - 连线的 `--kind 离散`（或 事件）在界面上画成虚线，其余实线。
   - `--kind 调节`：A **调节** B（A 是 B 的参数 / 修改器，决定 B 怎么工作，不是流进 B 的数据；比如「观察属性」调节「观察空间」）。界面上从 A 底下连到 B 顶上、点线 + ◆，自动布局不把它当上下游。
   - **颜色 / 底纹靠「分层词表」，别手写 `color:` / `pattern:`**（只有人在界面上改了才会有）。
     - 词表 = `_词表.md`，一份里两节：`## 颜色`（`- 红: 词, 词`）和 `## 图案`（`- 网格: 词, 词`；图案 = 节点的「性质」：网格 几何空间 / 点阵 读数数据 / 斜纹 结构流程 / 横纹 文档规则 / 波纹 情绪信号）。
     - **分层**：`__synapsis/_词表.md` 是项目那份；**每个分组的文件夹里也可以有自己的 `_词表.md`，只管这个分组里面**。
     - 一个节点的颜色 / 底纹**只看它自己的名字**（不继承父级）：从它的父级开始往上，哪一层的词表先命中它的名字就用哪一层；某一层没写颜色（或图案）就接着往上找；都没命中 = 灰 / 无底纹。
     - 人说「这个组里 X 用红」→ 写进那个分组自己的 `_词表.md`；说「全项目 X 用红」→ 写进项目那份。
     - `sat: 25|50|75` 是人手动标的深浅，叠在自动色上，别动。
8. 优先用 CLI。直接改 md 文件也行，但要按 §5 的格式写，改完跑 `check`。

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
  check                        悬空边、无状态、code 指向不存在的文件 / 符号、时间轴 t0/t1 不对或同轨重叠
  timeline [页id] [--json]     时间轴页（timeline: true）上的条：t0 / t1（成片时间，秒）/ track / 图 / 正文，按 t0 排；
                               不带页id = 列出所有时间轴页。--json 给程序读（Eidolon edl.py 用这个）
写（每条都是原子的一小步；删除一律进 .junk/（关窗口时才清，期间能撤销），不真删）：
  add <父id|.> <名字> [--after <兄弟id>] [--if-missing]
                               新建节点，打印新 id；同级已有同名 → 报错（--if-missing 则直接返回已有 id）
                               根用 . （Git Bash 会把单独的 / 改写成 Git 安装目录）
  rename <id> <新名字>
  move <id> <新父id|.>          挪到别的父节点下（正文 / 属性 / 图片 / 连线跟着走，打印新 id）；目标里重名 → 报错
  status <id> <done|partial|todo|dropped|none>   dropped = 弃用 ❌（不算完成度，check 跳过）
  link <从id> <到id> [--label 标签] [--kind 类型]   连线（已有则只改标签）
  unlink <从id> <到id>
  body <id> <文件|->           用文件（- = 标准输入）替换正文
  set <id> 键=值 [键=值…]      改属性（值留空 = 删掉这个键）
  rm <id>                      删除节点和子孙
  frame <id> <视频> <时间>      从视频截一帧当这个节点的图（视频相对项目根或绝对路径；时间 = 秒或 分:秒，是素材时间）；
                               旁边同名 .md 记来源和 src_t。ffmpeg：SYN_FFMPEG > PATH > Eidolon 虚拟环境里那个
  batch <JSON文件|->           一次跑一批写命令（一个进程，不用每条 spawn）：
                               [["add",".","感知"],["set","感知","code=../a.js#see"],["body","感知","正文文本"]]
                               body 在 batch 里第三项直接是正文；末尾可带选项对象
                               {"label":…,"kind":…,"after":…,"ifMissing":true}；遇错停下，报告第几条
  apply <大纲文件>             用大纲文本整体写回（大改结构时用）
其它：
  launcher [目录]              重建项目根的快捷方式（换了 _图标/ 里的图标后用）
  manual                       打印 AI 接入手册
  init <项目目录>              给项目挂上 Synapsis
```

## 5. 文件格式（文件夹 = 层级）
- 叶子节点 `名字.md`；有子节点的 `名字/_node.md`。
- 以 `_` 或 `.` 开头的都不是节点：`_Blackboard.md`（讨论区）、`_词表.md`（分层词表：颜色 + 图案，项目根和各分组文件夹里都可以有，见 §3）、`_layout.json`（坐标）、`_过期的/`（人手放的旧东西）、`.junk/`（程序删掉的，临时）、`_pics_名字/`（这个节点的图片）、`_pics/`（这一页的散图）、`_synapsis.md`（本手册）。
- 名字里有 `/` 等非法字符时，文件名用全角，原名写在 frontmatter 的 `label:` 里。
```
---
status: done | partial | todo | dropped
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
- **讨论这个项目本身**（设计想法、分歧、要人拍板的事）：追加到本项目的 `<被规划项目根目录>/__synapsis/_Blackboard.md`，格式 `## YYYY-MM-DD · 谁 · 话题`。人和其他 AI 都在这里回。定下来的结论搬进对应节点的正文 / 属性，讨论条目剪进 `__synapsis/_过期的/_Blackboard.md`。
- **Synapsis 这个工具本身**的问题：你在用 Synapsis 时觉得别扭，或者缺了什么功能：**追加一条到 `C:/Users/Administrator/Desktop/Obsidian_V_Synapsis/_Blackboard.md`**，写日期、你在干什么、卡在哪。维护 Synapsis 的那个 Claude 会看，看完处理掉。别直接改 Synapsis 的代码。
- 打开图形界面：双击项目根目录的「在Synapsis打开本项目」快捷方式（兜底脚本在 `.synapsis/Synapsis.vbs`）。改动会和 CLI 的写入同步，两边写的都是同一批 md 文件。
