# 开发索引表

代码里用 `>v<` 开头的注释做标记，方便直接 grep/glob 定位到具体功能，不用翻文件结构。

**格式**：`>v<[emoji]大标题-小标题-一句话注释`
例：`>v<🔭视图投影-范围投影-只显示当前范围的子节点，子孙边提升聚合，范围外端点变 portal`

**怎么用**：想改哪块功能，先在本表找到大标题，再全局搜那个大标题字符串，所有相关位置一次列全。

```bash
grep -rn ">v<🧭导航" spikes/src spikes/test bootstrap --include=*.js --include=*.jsx
```

> ⚠️ 在本文件里写标记一律包反引号：行首的 `>` 会被 Markdown 当成引用块。
> 文档（`_Design/` 等）不进本表，见 `AGENTS.md` 的目录表。
> `.vbs` / `.bat` 必须纯 ASCII，不能写 emoji 标记 → 在这里登记文件名代替。

---

## 大标题一览

| 标记 | 涉及范围 | 说明 |
|---|---|---|
| `>v<🌳大纲模型` | `spikes/src/outline.js` | 大纲文本 ⇄ 图；画布编辑（加边/加节点）后回写大纲 |
| `>v<🔭视图投影` | `spikes/src/outline.js` | 范围投影（跨层边聚合、portal）、自动布局 |
| `>v<📤LLM导出` | `spikes/src/outline.js` | 节点卡格式的结构化文本 |
| `>v<🧭导航` | `spikes/src/shell.jsx` | 钻进/退出、后退前进、视图记忆、快捷键 |
| `>v<🎨画布` | `spikes/src/rf.jsx` `spikes/src/td.jsx` `spikes/src/shell.jsx` | 两个画布实现、贴图 |
| `>v<🚀启停` | `spikes/vite.config.js` `spikes/src/shell.jsx` + `Synapsis_start.vbs` `Synapsis_stop.bat` | 无窗口启动、按端口停止、心跳自动退出 |
| `>v<✅自检` | `spikes/test/` | 纯 Node 核心自检 + 无头 Edge 界面自检 |
| `>v<🏗️构建引导` | `bootstrap/bootstrap.js` `bootstrap/template/` | 给新项目铺骨架，已有文件跳过 |

---

## `>v<🌳大纲模型`

小标题：

- **解析** —— `parseOutline`：缩进 = 子级，`-> 名称` = 连线，行首 ✅◐○ = 状态。连线目标按名称**就近**解析（从自己的父开始逐级向上找子树里同名的），所以跨分组写名字就行；同名冲突时写完整路径。
- **序列化** —— `toOutline`：能用名称唯一解析回去就写名称，否则写完整路径。⭐「parse(toOutline(g)) == g」是免费的必须相等量，自检里有。
- **画布编辑** —— `withEdge` / `withNode`：画布上的操作不直接改画布，而是改图 → 生成新大纲 → 重新解析。大纲是唯一真源。
- ⚠️ id = 名称路径（原型简化），**改名会丢坐标**；正式版 core/ 要换稳定 id。

## `>v<🔭视图投影`

小标题：

- **范围投影** —— `projectView`：只显示当前范围的直接子节点；子孙之间的边提升到可见祖先上并聚合（`count`，画成 ×N）；端点在范围外 → `@portal:<id>` 节点，双击跳过去。
- **自动布局** —— `autoLayout`：最长路径分层（左→右），先 DFS 找回边并忽略（否则反馈环会让层数爆掉，2026-10-07 自检抓到）；奇数层下错 70px，免得反馈边穿过同一行的节点。已有坐标不动。

## `>v<📤LLM导出`

小标题：

- **节点卡** —— `exportForLLM`：每个节点一节，带 `[id]`、状态、入边、出边、包含。完整规范见 `Life Games/研究/有向图软件_需求与方案.md` §0.6；格式优劣**还没测**（`_TODO.md` 里的小实验）。

## `>v<🧭导航`

小标题：

- **视图记忆** —— `viewports[scope]` 存平移+缩放，localStorage 持久化；画布组件按 scope 重挂载时读回（RF `defaultViewport`，tldraw `setCamera`）。没有记录才 fitView。
- **历史** —— `go()` 统一入口压栈；Alt+← / Alt+→ 后退前进，Alt+↑ 上一层（并选中刚才所在的节点）。
- **快捷键** —— 捕获阶段监听 window，焦点在大纲/输入框里时不触发；Enter 同级、Tab 子级要 `stopPropagation`，否则 tldraw 也会响应。

## `>v<🎨画布`

小标题：

- **ReactFlow** —— 本地 nodes 状态 + 外部数据变时重建；⚠️重建要保留旧对象的 `measured`，否则节点被隐藏到重新测量完。
- **tldraw节点形状** —— 自定义 `snode`：⚠️必须 `getIndicatorPath`（tldraw 5）、`getGeometry` 要 `isFilled: true`（否则只有边框可点）。
- **tldraw** —— 边 = 受管箭头（锁定、带 `meta.managed`）；用户画的箭头在 pointer_up 时翻译成连线再删掉；⚠️双击自己按坐标找（tldraw 的 `onDoubleClick` 在已选中时不触发）。
- **贴图** —— 选中节点时 Ctrl+V 图片 → dataURL 存 localStorage（原型；正式版存 `__synapsis/` 文件）。**没自动化测。**

## `>v<🚀启停`

小标题：

- **心跳** —— 页面每 20s `GET /__alive`；服务见过 ping 后 3 分钟无人 ping 就 `process.exit`。3 分钟是因为后台标签页定时器被节流到约 1 次/分钟。`SYN_IDLE_MS` 可调短做测试。
- **启动 / 停止** —— `Synapsis_start.vbs` 无窗口 `npm run dev` 再开浏览器（已在跑时第二个实例因端口占用失败，无害）；`Synapsis_stop.bat` 按端口 5410 杀进程。

## `>v<✅自检`

小标题：

- **核心** —— `npm test`，纯 Node，17 项。
- **界面** —— `npm run test:ui`（需先起 dev），playwright-core + 本机 Edge 无头，两个画布同一套交互各 19 项；可传截图目录。

## `>v<🏗️构建引导`

小标题：

- **生成骨架** —— `bootstrap.js <目录> [--name] [--desc] [--dry]`：模板占位 `{{NAME}} {{DESC}} {{DATE}} {{GUIDE}}`，已有文件跳过，无 git 则 init。规矩本体 `bootstrap/_ProjectBootstrap.md`，全局 skill `project-bootstrap` 指向它。
