# 现有工具调研：可借鉴的经验 + Synapsis 真正独特的地方

> 2026-10-07 夜，👤 睡前布置：「去网上搜搜现有的思维导图类工具，研究可参考经验和我们的独特之处」。
> 👤 自己认为最独特的三点：**① 对自身大脑的探索 ② 基变换 ③ Synapsis 本身就是多层感知机**（它诞生于做游戏 NPC MLP），而不只是文本和草图工具。
> ⚠️ 诚实边界：这是约 20 次搜索的扫描，不是穷举。「没找到别人做」≠「没人做」。也别把 Claude 同意用户当成交叉验证（基石：两个 AI 说同样的话很可能同源）。

---

## 1. 地形图：八类工具，各自回答什么问题

| 类 | 代表 | 回答的问题 | 和 Synapsis 的关系 |
|---|---|---|---|
| 思维导图 | XMind | 「这个主题下有什么」（只能是树） | Synapsis 的大纲就是树，但边可以跨树 → 已超出 |
| **概念图** | Novak / CmapTools | 「A **怎样**关联 B」：边上必须写连接词（命题：细胞—含有→细胞器） | ⭐**Synapsis 其实属于这类**：边有标签、有类型、有方向 |
| 空间超文本 / 白板 | VIKI、Scapple、Kinopio、Obsidian Canvas | 「先摆出来，结构慢慢浮现」 | 和我们的「形式化逐节点」同一个哲学 |
| 嵌套缩放 | Muse、Heptabase（白板套白板）、TheBrain | 「大局和细节怎么同时在手里」 | = 我们的钻进 / 原地展开 |
| 结构化数据库 | Tana（supertag）、Notion | 「这东西是什么类型、有哪些字段」 | = 形式化阶梯的高级端 |
| 参考板 | **PureRef** | 「让参考一直在眼前，不打断手上的活」 | 👤 的习惯来源 → 刚改的主题 |
| 节点计算 | tldraw computer、ComfyUI、Houdini、TouchDesigner、TF Playground | 「数据流过这张图会变成什么」 | ⭐**MLP 方向的近亲** |
| 认知科学 | 扩散激活（Collins & Loftus 1975）、概念空间（Gärdenfors 2000） | 「脑子里的概念是怎么组织、怎么被想起来的」 | ⭐**基变换和「探索自己大脑」的理论地基** |

另有一个很近的研究原型：Ink & Switch 的 **Ambsheets**：一个格子同时装多个值（`{500, 1200}`），这些值照常流过公式，结果是所有可能世界的组合。它其实就是「平行世界」电子表格。

---

## 2. 可以直接借的（按投入产出排）

**小、马上能做**
1. **JSON Canvas 导出 / 导入**（Obsidian 的开放格式 `.canvas`：nodes + edges，带 fromSide/toSide）→ 一个纯函数，换来 Obsidian 里也能看图。一节点一 md 的路线不变，`.canvas` 只是一个视图。
2. **概念图的连接词**：「给连线加标签，逼你说清是什么关系，而不只是承认有关系」（Novak）。→ check 里加一条 info：节点升到「有 spec」这一级后，没标签的出边提示一下。别强制（Shipman：过早要求结构，人会停止思考）。
3. **PureRef 的「一直在眼前」**：窗口置顶 + 半透明的迷你模式（只显示当前页），开着 UE / 戈多时也能看着图。Electron `setAlwaysOnTop` 加 `setOpacity`，代码量很小。
4. **Muse 的教训**：「页」模型比无限乱缩放更不容易迷路。→ 我们的「范围 = 页」是对的；**别做全局无限缩放**，语义缩放也要落在页上。

**中等**
5. **VIKI 的空间解析器**：从摆放里识别隐含结构（排成一列、叠成一摞、挨在一起），然后**提议**把它变成显式的分组 / 边。这正好对上「结构慢慢长出来」：人先随手摆，Synapsis 看出模式后问一句「要不要合成一组？」。
6. **Kinopio 的反面提醒**：作者认为亲手摆放和连线才会形成空间记忆，所以 Kinopio 故意不加 AI。→ 我们的 LLM 提议必须是**虚影**，人接受了才算数；自动布局只给从没摆过的节点用（现在就是这样，保持）。
7. **Tana 2026-01 推出了 MCP 服务器**，Claude Code 可以直接连。→ 「LLM 是一等读者」已经是行业趋势，**不再是护城河**。CLI 包成 MCP 从「更远」提到「下一步」，它是基本配置。

---

## 3. 独特之处（逐条对照现有工具，诚实评估）

### ① 对自身大脑的探索
- **别人**：几乎都在管「关于世界的知识」（Heptabase、Tana）或「项目」（Notion）。Kinopio 和 Muse 的气质最接近（「为思考设计」），但它们只是**容器**，不观察你怎么想。
- **Synapsis 可以多做的**：工具本身记录**思维路径**（摩擦日志、哪些节点反复改名、哪里卡住、你以为的核心 vs 连线显示的核心）。
- **评估**：方向独特，但现在还只有「摩擦日志」这一条落地。要变成真东西，需要一个能量化的输出，比如「你的中心度 vs 你的注意力」对照（PageRank vs 编辑次数 / 停留时间）。

### ② 基变换
- **最接近的**：
  - TheBrain：点一个想法就把它挪到中心。这只是换**原点**，不是换**基**。
  - TensorFlow Embedding Projector：PCA / t-SNE 之间切换，但不能编辑。
  - Ambsheets：多个世界叠在一起，但它是表格，不是图。
- **理论地基**：Gärdenfors 的「质量维度」（颜色 = 色相 × 饱和度 × 亮度）。一组基 = **选哪几个质量维度当坐标轴**。Synapsis 的节点本来就有维度：层级、流向（拓扑序）、状态、频率（rate）、证据等级、时间、嵌入的主成分……
- **可做的最小版本**：给 x、y 各选一个维度（比如「流向 × 状态」「层级 × 频率」「嵌入 PC1 × PC2」），节点**动画过渡**到新位置，人摆的布局永远是「设计基」，可以一键回去。中键拖动 = 在两组基之间连续插值（这就是 `Navigation.md` 里的设想，现在有了具体做法）。
- **评估**：⭐**没找到有人在可编辑的思维图上做「多组基之间连续插值」**。这是三条里最容易做出明显差异的一条，第一版只要几天。

### ③ Synapsis 本身就是多层感知机
- **最接近的**：
  - tldraw computer、ComfyUI：节点会**算**（LLM 或数据处理），数据沿边流。但它们是程序，不是思考草稿。
  - TF Playground：能看到每个单元学到了什么。但网络是固定的玩具，不是你自己的图。
  - 扩散激活：激活一个概念会沿着关联扩散到相关概念。这是认知科学对「想起」的经典模型；Xerox PARC 2000 年有过可视化专利，学术工具也很少（SpreadPy 2025）。
- **Synapsis 独有的组合**：
  1. **同一张图从草稿一路长成网络**：便签 → 有类型 → 有 spec → 有 code → **有实测激活**。形式化阶梯的最后一级就是「这个节点是一个真神经元，数值从游戏里读回来」（FK）。NPC 的 AI 空间图本来就是网络拓扑（观测 → 记忆 / 个性 / 情绪 → 决策 → 行为），画图就是在设计网络。
  2. **在自己的思维图上跑扩散激活**：点一个节点，激活沿边按权重衰减扩散，亮度 = 激活值。可以拿它问「我想到 X 时会连带想起什么」「哪些节点永远不亮（孤岛）」。这同时服务 ① 和 ③。
- **评估**：⭐**组合是独特的**（草稿 ⇄ 可运行网络是同一份数据）。风险是变成「什么都想做的工具」，所以只在七丘（NPC 状态空间组）这一个案例上推进，先让它的边带权重、能扩散，再谈接游戏实时数据。

### 一句话
> **别人画的是知识，Synapsis 画的是一个会动的脑子：可以换基去看（②），可以通电看它怎么亮（③），还会记下你自己是怎么想的（①）。**

---

## 4. 建议的三个小实验（都能在 `?demo` 里先跑，不碰真工作区）
1. **E1 换基**：工具栏选「x 轴维度 / y 轴维度」，节点动画过渡；按一个键回到设计布局。判据：在七丘上换到「流向 × 频率」时，能不能一眼看出某个结论（比如高频节点全挤在观测端）。
2. **E2 扩散激活**：选中节点按 `A`，激活沿出边扩散 3 跳，每跳衰减，卡片亮度 = 激活。判据：👤 看完会不会说「哦，原来这个也连着」。
3. **E3 JSON Canvas 导出**：`cli.js export --canvas` 生成 Obsidian 能打开的 `.canvas` 文件。判据：Obsidian 里打开不报错，布局和 Synapsis 一致。

## 来源
- 概念图：[Novak & Cañas, Theory of concept maps](https://cmap.ihmc.us/docs/theory-of-concept-maps.php)
- 空间超文本：[VIKI (Shipman & Marshall)](https://people.engr.tamu.edu/shipman/abstracts/echt94-abstract.html)、[Spatial Hypertext](https://people.engr.tamu.edu/shipman/spatialhypertext.html)
- Kinopio：[Designing for thinking](https://pketh.org/designing-for-thinking.html)、[About](https://about.kinopio.club/about)
- Muse：[Ink & Switch Muse](https://www.inkandswitch.com/muse/)、[Infinite canvas memo](https://museapp.com/memos/2020-12-infinite-canvas)
- Heptabase：[Organize knowledge](https://wiki.heptabase.com/organize-knowledge-and-projects)
- Tana：[Tana review 2026（MCP 2026-01-30）](https://tooliverse.ai/tools/tana)
- tldraw computer：[the-decoder](https://the-decoder.com/tldraw-unveils-experimental-natural-language-computer-powered-by-gemini-2-0/)、[tldraw AI docs](https://tldraw.dev/docs/ai)
- JSON Canvas：[spec](https://docsearch.algolia.com/mcp/docs/repo/obsidianmd/jsoncanvas)
- PureRef：[Creative Bloq](https://www.creativebloq.com/how-to/pureref)
- TF Playground：[Direct-Manipulation Visualization of Deep Networks](https://arxiv.org/pdf/1708.03788)
- 扩散激活：[SpreadPy (2025)](https://arxiv.org/html/2507.09628v1)、[Xerox 专利 US6151595](https://patents.google.com/patent/US6151595)
- 概念空间：[Gärdenfors, Conceptual Spaces](https://cse.hkust.edu.hk/pg/seminars/F08/gardenfors.html)
- 平行世界表格：[Ambsheets notebook](https://inkandswitch.com/ambsheets/notebook/01)、[Simon Willison 介绍](https://simonwillison.net/2025/Feb/5/ambsheets/)
- 阶梯：[Bret Victor, Up and Down the Ladder of Abstraction（worrydream.com）](https://waxy.org/2011/10/bret_victors_up/)
- TheBrain 对比：[outlinersoftware 讨论](https://www.outlinersoftware.com/topics/viewt/9411)
