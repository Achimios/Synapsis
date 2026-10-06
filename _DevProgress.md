# 开发进度

## 2026-10-07
- ✅ 项目骨架：AGENTS/CLAUDE、_Design（哲学 + v1 规格）、_TODO、_LEARNINGS、_DevIndex、-给人类的解释
- ✅ 画布对比原型 spikes/：React Flow 与 tldraw 5 共用外壳与核心
  - 【实测】`npm test` 17/17；`npm run test:ui` 28/28（两画布各 14：钻进、聚合边、选中入蓝出橙/淡化、拖动持久化、画布连线→大纲、Enter 新节点、LLM 导出、无页面报错）
  - 【未验】贴图（Ctrl+V）没有自动化测；手感只能用户亲手试
  - 【实测】tldraw 在 localhost 免 key 可跑，但右下角有「Get a license for production」水印；许可条款本身未读
- ⏳ 等用户试两个画布 → 选库 → 写 core/（一节点一 .md 的读写）+ server + CLI
