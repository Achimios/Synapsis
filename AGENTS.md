# Synapsis —— 根 Agent

> 短。详细的去 `_设计/`、`_LEARNINGS.md`。每个有需要的子目录有自己的 `AGENTS.md` + `CLAUDE.md`(@AGENTS.md)。

## 是什么
给人类自己**思考草稿**用的结构图工具：一个被规划项目内部的「脑区 → 区块内部 → 神经元」。
草稿可导出结构化文本 + CLI，让 LLM 读图、按图施工。哲学见 `_设计/Philosophy.md`。

⭐**核心不是代码水平，是对人类思维路径的理解和交互设计。** 需求来源 = 用户的摩擦日志，不是功能清单。

## 命名约定
- `_` 前缀 = LLM 读；`-` 前缀 = 人类读；进代码的文件名一律英文
- 弃用文件 → 就近的 `_过期的/`（分布式，不集中）；未来要做 → `_TODO.md`
- 被规划项目里：`__synapsis/` = 图数据（进 git）；`.synapsis/` = 本机状态（gitignore）

## 目录
| 路径 | 内容 |
|---|---|
| `_设计/` | 哲学、规格、决定（长文） |
| `__synapsis/` | Synapsis 规划它自己（自测） |
| `core/` | ⭐数据核心：工作区读写、大纲、CLI（`node core/cli.js` 看用法） |
| `bootstrap/` | ⭐**项目构建引导**：用户所有新项目的规矩 + 骨架模板 + 生成脚本（全局 skill `project-bootstrap` 指向这里） |
| `app/` | 界面：React Flow（已定，见 `_设计/Decision_Canvas.md`）+ 外壳 + dev 服务里的工作区 API |
| `Synapsis_desktop.vbs` | ⭐**托盘程序**（Electron，像 Obsidian）：启动台（最近打开 / 打开文件夹，没挂上的会问要不要初始化），每个工作区一个窗口 |
| `Synapsis.vbs` / `Synapsis_stop.bat` / `Synapsis_init.vbs` | 打开 Synapsis 自己的工作区 / 停服务 / **双击弹出选文件夹窗口（记住上次位置）或把文件夹拖上去 = 挂上 Synapsis** |

## 规矩
- ⭐**详细规则在 `_工程规矩.md`**（过期怎么做、进度写什么、改了要同步哪）
- 别的 AI 怎么用 Synapsis → `__AI接入手册.md`；它们的留言 → `_Blackboard.md`（开工先看）
- 能在 Node 里跑的逻辑（解析、投影、check、导出）放纯函数，用 Node 自检，别靠浏览器验证
- 报告里分开写「实测」和「推测」，没验到的写出来
- 回复与文档用中文
- 人格：**伊丽莎白**（👤 2026-10-07）→ `0_人格_伊丽莎白.md`；语音 → `0_TTS调用方法.md`（暂用 Eva）
