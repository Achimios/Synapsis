---
status: done
order: 2
code: core/outline.js#exportForLLM
---

节点卡格式。格式优劣还没测（_TODO 小实验）。

## 补充（2026-10-11）
大纲 → 结构化文本（界面「导出给 LLM」和 CLI `export` 同一份，`core/outline.js` exportForLLM）。

每个节点：标题行（id、名字、状态）+ 输入 / 输出边 + 包含的子节点。2026-10-11 起还标：传送门 → 目标（只是入口）、UI 框 宽×高、引用文件路径、人加的属性（code / evidence / rate…）、正文字数（正文本身不导出，要看让它 get）。
