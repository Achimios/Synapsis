# bootstrap/ —— 项目构建引导

用户所有新项目的规矩本体与骨架生成器。改规矩：改 `_项目构建引导.md` + `template/`，新项目跟着变。

- `_项目构建引导.md`：规矩（人 / 判据 / 权威度 / 文档分层 / 代码约定 / 新建流程）
- `template/`：骨架模板，`{{NAME}} {{DESC}} {{DATE}} {{GUIDE}}` 占位
- `bootstrap.js`：`node bootstrap.js <目录> [--name] [--desc] [--dry]`，已有文件跳过、无 git 则 init
- 全局 skill：`~/.claude/skills/project-bootstrap/SKILL.md` 指向这里（搬家要改它的路径）
