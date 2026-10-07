# 项目详细规则（约定 + 指引）

> `AGENTS.md` 只放基石，要短；**怎么做**的细则都写在这里。改了规矩就改这份，不要散落在对话里。
> 通用部分和所有新项目共用，源头是 `bootstrap/template/_ProjectRules.md`（改通用规矩改那份，再同步过来）；本项目特有的写在最后一节。

## 1. `_过期的/`：过期内容移走，不删
- **就近放**：每个目录需要时自己建一个 `_过期的/`，不要集中到根目录。
- **两种过期方式**
  1. **整个文件过期** → 把文件移进同级的 `_过期的/`。
  2. **文件里的一段过期** → 把那段**剪切**出来，追加到同级 `_过期的/<原文件名>`（同名文件，没有就新建），段前加标题 `## YYYY-MM-DD · 从 <原文件> 剪出`。原文件只留结论，或者一行指针。
- **什么时候**：每一轮工作收尾时顺手做（和更新 `_where_continue.md` 同一时间），别攒着。
- **不删**：👤 的规矩。`_过期的/` 里的东西 AI 不再读，人想翻旧账时去翻。

## 2. 进度文件写什么、不写什么
- `_DevProgress.md` **只留现在有用的**：各模块当前状态（一行）、功能级里程碑、👤 决定、⚠️ 还没验到的。
- **修好的小 bug、技术过程（怎么查出来的、试过什么）** → 修完那一轮就剪到 `_过期的/_DevProgress.md`。
  - 其中**机理值得记住的**（下次还会踩），提炼成一条写进 `_LEARNINGS.md`（坑 + 为什么 + 怎么避），过程本身仍然过期。
- `_where_continue.md` 一屏：只写「现在在做什么 / 下一步 / 等用户决定什么」，旧的剪去过期。
- 判断标准：**下一个接手的 AI 读了这行，会不会做出不同的事？** 不会，就该过期。

## 3. 改了东西要同步的清单
| 改了什么 | 同步哪里 |
|---|---|
| 加了 / 改了功能 | 代码里的 `>v<` 锚点 + `_DevIndex.md` + `_DevProgress.md` 一行 |
| 来自 👤 的抱怨 / 卡点 | `-给人类的解释/-摩擦日志.md`（原话 + 怎么处理的） |
| 踩了值得记的坑 | `_LEARNINGS.md`；很常见的提到 `AGENTS.md` 常见坑 |
| 做完了待办 | `_TODO.md` 打勾（或剪去过期） |
| 定了一个设计决定 | `_Design/` 对应文件，标 👤 / 日期 |
| 一轮收尾 | `_where_continue.md`、过期清理、git 提交 |

## 4. 本项目（Synapsis）特有的约定
- **被规划项目里的三样东西**：`__synapsis/` = 图数据（进 git）；`.synapsis/` = 本机状态（view.json 视图、window.json 窗口，自带 `*` gitignore）；根目录 `Synapsis.vbs` = 启动器。
- **节点文件**：叶子 `名字.md`，分组 `名字/_node.md`；图片 `_pics_名字/` 紧挨节点 md；`_` 或 `.` 开头的都不是节点。Synapsis 只在用户亲手改正文时写正文。
- **颜色**全在 `app/src/shell.css` 的 `:root` 变量里，组件里不写死颜色；键位只在 `app/src/panels.jsx` 的 `KEYMAP` 表里写一次。
- **AI 接入手册只改模板** `core/templates/AI_Manual.md`，然后 `node core/cli.js manual --write`（cli 自检会核对根目录那份和模板一致）；工作区里的 `_synapsis.md` 打开工作区时自动刷新。
- **别的 AI 的留言**在 `_Blackboard.md`（Synapsis 工具本身的问题）：每轮开工先看一眼，处理完剪进 `_过期的/`。被规划项目自己的讨论在它的 `__synapsis/_Blackboard.md`。
- **自检**：`node core/test/workspace.test.js`、`node core/test/cli.test.js`、`node core/test/space.test.js`、`node core/test/arrange.test.js`、`node core/test/colors.test.js`、`npm test`、`npm run test:ui`（要先有 :5410 服务）、`npm run test:desktop`。⚠️测试只用 `?demo` 或临时目录，**绝不碰真工作区**；桌面测试实例不抢单实例锁（用户可能正开着 Synapsis）。
- **探测接口别带假路径**：`?ws=` 写错会在磁盘上建目录（2026-10-07 建出过 `C:\nonexist`；现在 view 接口已拦，其它写接口仍要小心）。
- 人格：伊丽莎白（`_人格_伊丽莎白.md`）；语音见 `_TTS调用方法.md`。
