// >v<🤖AI指令-配图-👤 2026-10-16「用 Grok 生成图片美化 Synapsis，额度花不完」：动作 image（人确认后才生成，花钱），图存进那张卡的 _pics_ 文件夹。
//   接口按 docs.x.ai（2026-10-16 读过）：POST {xai}/images/generations {model, prompt, n, aspect_ratio, response_format: 'b64_json'} → data[0].b64_json
//   👤 2026-10-20 加豆包 Seedream（火山方舟，ark key）：模型名 doubao-seedream-* 就走方舟。接口按 4_Eidolon/_设计/接口_生成.md（Eidolon 10-20 实测过 flash）：
//     POST {ark}/images/generations {model, prompt, size: '1.5K' | '2K' | '宽x高', watermark: false}；宽x高 总像素 [921600, 4624220]；返回的 url 24 小时失效 → 当场取回
//     ⚠ pro / flash 别传 sequential_image_generation / stream（只有 lite 认，会 400）。参考图 / 图层拆分还没接
//     Eidolon 10-20 实测：flash 认 response_format=b64_json，data[0] 只有 b64_json / output_format / size（不带 url）；1K 档按 prompt 自定比例（出过 1424x800）
import { ONLINE, onlineKey, aiLog, isArkImage } from './ai.js';

export const IMAGE_MODEL = 'grok-imagine-image-2.0';
export const ASPECTS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '21:9'];

// base64 头几个字节认格式（接口不一定给 mime）
const mimeOf = b64 => b64.startsWith('/9j') ? 'image/jpeg' : b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';

// 方舟的 size：自动比例 = 档位（1k → 1.5K：文档说和 1K 同价、效果更好）；指定比例 = 宽x高，边长取 16 的倍数，总像素夹在接口允许的范围里
export function arkSize(aspect, resolution) {
  const base = resolution === '2k' ? 2048 : 1536;
  const m = /^(\d+):(\d+)$/.exec(aspect || '');
  if (!m) return resolution === '2k' ? '2K' : '1.5K';
  const r = +m[1] / +m[2], at = s => [Math.round(Math.sqrt(s * r) / 16) * 16, Math.round(Math.sqrt(s / r) / 16) * 16];
  let s = base * base, [w, h] = at(s);
  while (w * h < 921600) [w, h] = at(s *= 1.02);
  while (w * h > 4624220) [w, h] = at(s *= 0.98);
  return w + 'x' + h;
}

export async function genImage(cfg, { prompt, aspect = 'auto', quality = null, resolution = null, model: want = null }, { fetchFn = fetch } = {}) { // 没指定 = AI 设置里的默认（cfg.imageQuality / imageRes），再没有 = 最便宜：low、1k
  quality = quality || cfg.imageQuality || 'low'; resolution = resolution || cfg.imageRes || '1k';
  const model = want || cfg.imageModel || IMAGE_MODEL, t0 = Date.now(), ark = isArkImage(model);
  const prov = ark ? 'ark' : 'xai', key = onlineKey(cfg, prov);
  if (!key) throw new Error(ark ? '没有豆包（火山方舟）的 key：⋯ → 🤖 AI 设置「在线」页填' : '没有 Grok（xAI）的 key：⋯ → 🤖 AI 设置「在线」页填');
  const body = ark
    ? { model, prompt: String(prompt).slice(0, 2000), size: arkSize(aspect, resolution), response_format: 'b64_json', watermark: false }
    : { model, prompt: String(prompt).slice(0, 2000), n: 1, response_format: 'b64_json', ...(ASPECTS.includes(aspect) && aspect !== 'auto' ? { aspect_ratio: aspect } : {}), ...(resolution === '2k' ? { resolution: '2k' } : {}), ...(model === 'grok-imagine-image-2.0' ? { quality: quality === 'medium' ? 'medium' : 'low' } : {}) }; // quality 只有 grok 2.0 认
  let err = null, b64 = '', mime = null;
  try {
    const r = await fetchFn((process.env.SYNAPSIS_ONLINE_URL || ONLINE[prov].url) + '/images/generations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(ark ? 300000 : 120000) });
    if (!r.ok) throw new Error(`${prov} 图片 ${r.status}：${(await r.text()).slice(0, 200)}`);
    const j = await r.json(), d = j.data?.[0] || {};
    b64 = d.b64_json || '';
    if (!b64 && d.url) { // 只给了链接（24 小时失效）→ 当场取回
      const g = await fetchFn(d.url, { signal: AbortSignal.timeout(60000) });
      if (!g.ok) throw new Error(`取图片 ${g.status}`);
      b64 = Buffer.from(await g.arrayBuffer()).toString('base64'); mime = /^image\//.test(g.headers.get('content-type') || '') ? g.headers.get('content-type').split(';')[0] : null;
    }
    if (!b64) throw new Error('接口没回图片（被内容审核拦了？）' + (j.error?.message ? '：' + j.error.message : ''));
  } catch (e) { err = e; }
  aiLog(cfg, { kind: 'AI 配图', model: prov + ':' + model, ms: Date.now() - t0, messages: [{ role: 'user', content: body.prompt + `（${[body.aspect_ratio, body.size, body.quality, body.resolution].filter(Boolean).join('，') || '默认'}）` }], raw: b64 ? `[图片 ${Math.round(b64.length * 0.75 / 1024)} KB]` : '', error: err?.message });
  if (err) throw err;
  return 'data:' + (mime || mimeOf(b64)) + ';base64,' + b64;
}
