---
status: done
order: 23
code: app/src/main.jsx#applyHold
---

👤 2026-10-12：打字时双手不离键盘。

- 方向键挪选中的卡（多选一起），Shift = × fast
- Ctrl+方向键 = UI 框右边 / 下边往箭头方向走；Ctrl+Alt = 左边 / 上边（箭头 = 边移动的方向；大部分时候只要右 / 下）
- 按下走一步 → 停 delay → 每 interval 一步（自己计时，不用系统按键重复）；全松开才存 = 一步 Ctrl+Z
- 步长 / 倍数 / 两个停顿在 ⚙ 设置（settings.yaml `nudge`）
