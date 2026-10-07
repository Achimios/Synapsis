# core/ —— 数据核心（纯 Node，无依赖）

- `outline.js`：大纲 ⇄ 图、范围投影、自动布局、LLM 导出（浏览器也 import 它）
- `workspace.js`：`__synapsis/` 文件夹 ⇄ 图（文件夹 = 层级；保留正文/属性/边标签；删除进 `_过期的/`）
- `cli.js`：给 LLM 和人用的命令行（overview / outline / export / get / check / apply / init）
- `templates/Synapsis.vbs`：`init` 生成的项目启动器（纯 ASCII）
- `tools/import_spacegraph.js`：一次性导入记录（空间图.html → 研究工作区）

规矩：
- 一切改动先过 `node core/test/workspace.test.js` 和 `node app/test/outline.test.js`；⭐往返逐字相等是这里的「必须相等的量」
- 不删用户写的东西：节点消失 → 文件移进 `_过期的/`；正文 Synapsis 永远不改
- 含反斜杠的代码别用 Git Bash heredoc 写（见 `../_LEARNINGS.md` #9–#11）
