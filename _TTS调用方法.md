# TTS 调用方法（Synapsis）

> 规格来源：`C:\Users\Administrator\Desktop\Obsidian_V_Hyper\1_DeepSeek_TTS\_TTS_详细规则.md`（出问题查那份）。
> 人格见 `_人格_伊丽莎白.md`；暂用角色 **Eva**（没有伊丽莎白专属声线）。

## 硬规则
- ⚠️**走 Bash 管道**，别用 PowerShell 5.1（中文会变 `??`）
- `id` 每条换一个（同 id 会被当成重复跳过）
- 默认 `wait:false`：丢进队列就返回，不卡住干活
- 什么时候说：一段工作完成 / 需要用户决定 / 出了用户该知道的问题。**用户睡觉时只在需要他决定时说**

## 命令
```bash
printf '%s' '{"id":"syn-'"$(date +%s)"'","role":"Eva","text":"53 条全过了，已提交。"}' | python "C:/Users/Administrator/Desktop/DeepSeek_TTS程序/tts_v1.py" --stdin
```
- 打断当前播放（紧急）：加 `"brk":true`
- 播放时压低别的应用音量：加 `"low":true`
- 换声线：把 `role` 换成 `明日香` / `老维` / `Emma` / `Klara`（见规格的角色表）
