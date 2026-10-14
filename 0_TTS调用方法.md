# TTS 调用方法（Synapsis）

> 规格来源：`C:\Users\Administrator\Desktop\Vault_Automata\1_TTS\__TTS_详细规则.md`（出问题查那份；写台词的标点 / 停顿技巧见同目录 `__TTS_写台词技巧.md`）。
> 2026-10-14：TTS 文件夹改名为 `Vault_Automata\1_TTS`（上面路径已改）；入口仍是根目录 `tts_v1.py`；新增可选字段 `mood`（情绪，只有复刻角色如 cortana 才有区别）和 `fx`（后处理音效）。
> 人格见 `0_人格_伊丽莎白.md`；暂用角色 **Eva**（没有伊丽莎白专属声线）。

## 硬规则
- ⚠️**走 Bash 管道**，别用 PowerShell 5.1（中文会变 `??`）
- `id` 每条换一个（同 id 会被当成重复跳过）
- 默认 `wait:false`：丢进队列就返回，不卡住干活
- 什么时候说：一段工作完成 / 需要用户决定 / 出了用户该知道的问题。**用户睡觉时只在需要他决定时说**

## 命令
```bash
printf '%s' '{"id":"syn-'"$(date +%s)"'","role":"Eva","text":"53 条全过了，已提交。"}' | python "C:/Users/Administrator/Desktop/Vault_Automata/1_TTS/tts_v1.py" --stdin
```
- 打断当前播放（紧急）：加 `"brk":true`
- 播放时压低别的应用音量：加 `"low":true`
- 后处理音效：加 `"fx":"对讲机"`（还有 `回音` `教堂` `空房间` `水下` `崩溃失控` `瓦解` `电磁干扰` 等，`+` 串联），`"fx_amount":0.7` 调强度（0~1）
- 换声线：把 `role` 换成 `明日香` / `老维` / `Emma` / `Klara`（见规格的角色表）
