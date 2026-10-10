// >v<🤖AI辅助-上下文长度-在 Synapsis 里改本地模型的上下文长度（👤 2026-10-08「context 长度能直接在 syna 里配置吗」）。
//   LM Studio 的 HTTP 接口改不了已加载模型的上下文，只能「卸载 → 按新长度重新加载」，走它自带的命令行 lms：
//     lms ps --json                         → 已加载的实例（modelKey / identifier / contextLength）
//     lms load <key> -c N --estimate-only   → 先估显存（不加载）
//     lms unload <identifier>; lms load <key> -c N --identifier <key> -y
//   lms 在 ~/.lmstudio/bin/lms(.exe)，环境变量 LMS_BIN 可以改。显存：RTX 5070 12GB 上 qwen3-8b Q4 在 32k ≈ 7.9 GiB（实测估算）
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const lmsBin = () => process.env.LMS_BIN || join(homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const run = (args, ms = 180000) => new Promise((res, rej) => {
  const bin = lmsBin();
  if (!existsSync(bin)) return rej(new Error('找不到 LM Studio 的命令行 lms：' + bin));
  execFile(bin, args, { timeout: ms, windowsHide: true, maxBuffer: 1 << 22 }, (e, out, err) => {
    const text = String(out || '').replace(/\x1b\[[0-9;]*m/g, '') + String(err || '').replace(/\x1b\[[0-9;]*m/g, '');
    e ? rej(new Error(text.trim().slice(-300) || e.message)) : res(text);
  });
});

// 已加载的实例
export async function lmsLoaded() {
  const out = await run(['ps', '--json'], 20000);
  return JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)).map(m => ({ key: m.modelKey, id: m.identifier, type: m.type, ctx: m.contextLength, maxCtx: m.maxContextLength }));
}
// 对话模型的 id（可能是实例 id「qwen3-8b:2」）→ 模型 key
export const modelKeyOf = (id, loaded = []) => loaded.find(m => m.id === id)?.key || String(id).replace(/:\d+$/, '');

// 先估：这个长度要多少显存（不加载）
export async function lmsEstimate(id, ctx) {
  const key = modelKeyOf(id, await lmsLoaded().catch(() => []));
  const out = await run(['load', key, '-c', String(ctx), '--estimate-only', '-y'], 60000);
  const gib = re => { const m = re.exec(out); return m ? Number(m[1]) : null; };
  return { key, ctx, gpu: gib(/GPU Memory:\s*([\d.]+)\s*GiB/i), total: gib(/Total Memory:\s*([\d.]+)\s*GiB/i), ok: !/not be loaded|exceed|insufficient/i.test(out), text: out.trim() };
}

// 👤 2026-10-11 模型加载了但 HTTP 服务没开（lms server status = not running）→ Synapsis 连不上（ECONNREFUSED）。没开就开（已开着 = 什么都不做）
export async function lmsServerStart() {
  const st = await run(['server', 'status'], 20000).catch(e => e.message);
  if (/not running/i.test(st)) await run(['server', 'start'], 60000);
}

// 卸掉这个模型的所有实例，按新长度重新加载（identifier = 模型 key，之后按 key 调用就是它）
export async function lmsReload(id, ctx) {
  const n = Number(ctx);
  if (!(n >= 2048 && n <= 1048576)) throw new Error('上下文长度要在 2048 ~ 1048576 之间');
  await lmsServerStart();
  const loaded = await lmsLoaded(), key = modelKeyOf(id, loaded);
  for (const m of loaded.filter(m => m.key === key)) await run(['unload', m.id], 60000);
  await run(['load', key, '-c', String(n), '--identifier', key, '--ttl', '3600', '-y']); // 闲 1 小时自动卸载（同 LM Studio 自动加载的默认）：👤 要打游戏，别一直占显存
  const now = (await lmsLoaded()).find(m => m.id === key);
  return { key, ctx: now?.ctx ?? n, maxCtx: now?.maxCtx ?? null };
}
