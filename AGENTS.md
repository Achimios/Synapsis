# Synapsis —— 根 Agent

> 短。详细的去 `_Design/`、`_LEARNINGS.md`。每个有需要的子目录有自己的 `AGENTS.md` + `CLAUDE.md`(@AGENTS.md)。

## 是什么
给人类自己**思考草稿**用的结构图工具：一个被规划项目内部的「脑区 → 区块内部 → 神经元」。
草稿可导出结构化文本 + CLI，让 LLM 读图、按图施工。哲学见 `_Design/Philosophy.md`。

⭐**核心不是代码水平，是对人类思维路径的理解和交互设计。** 需求来源 = 用户的摩擦日志，不是功能清单。

## 命名约定
- `_` 前缀 = LLM 读；`-` 前缀 = 人类读；进代码的文件名一律英文
- 弃用文件 → 就近的 `_过期的/`（分布式，不集中）；未来要做 → `_TODO.md`
- 被规划项目里：`__synapsis/` = 图数据（进 git）；`.synapsis/` = 本机状态（gitignore）

## 目录
| 路径 | 内容 |
|---|---|
| `_Design/` | 哲学、规格、决定（长文） |
| `__synapsis/` | Synapsis 规划它自己（自测） |
| `core/` | ⭐数据核心：工作区读写、大纲、CLI（`node core/cli.js` 看用法） |
| `bootstrap/` | ⭐**项目构建引导**：用户所有新项目的规矩 + 骨架模板 + 生成脚本（全局 skill `project-bootstrap` 指向这里） |
| `app/` | 界面：React Flow（已定，见 `_Design/Decision_Canvas.md`）+ 外壳 + dev 服务里的工作区 API |
| `Synapsis.vbs` / `Synapsis_stop.bat` / `Synapsis_init.bat` | 打开 Synapsis 自己的工作区 / 停服务 / **把项目文件夹拖上去 = 挂上 Synapsis** |

## 规矩
- 能在 Node 里跑的逻辑（解析、投影、check、导出）放纯函数，用 Node 自检，别靠浏览器验证
- 报告里分开写「实测」和「推测」，没验到的写出来
- 回复与文档用中文
