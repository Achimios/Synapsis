---
status: done
order: 9
code: core/lmstudio.js#lmsServerStart
---

2026-10-11：模型在 LM Studio 里加载了，但本机 HTTP 服务（:1234）没开 → Synapsis 报 ECONNREFUSED。

- AI 设置里「重新加载」先 `lms server start`，加载带 `--ttl 3600`（闲 1 小时卸载，👤 要打游戏）
- 第一次状态检查连不上 :1234 时自动开一次服务（开服务不加载模型、不占显存）
- ⚠ LM Studio 自动 JIT 加载用它自己的默认上下文（8192），要永久 16k 得在 LM Studio 的 My Models → ⚙ 改
