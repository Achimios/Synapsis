// >v<🤖AI指令-配图-👤 2026-10-16「用 Grok 生成图片美化 Synapsis，额度花不完」：动作 image（人确认后才生成，花钱），图存进那张卡的 _pics_ 文件夹。
//   接口按 docs.x.ai（2026-10-16 读过）：POST {xai}/images/generations {model, prompt, n, aspect_ratio, response_format: 'b64_json'} → data[0].b64_json
import { ONLINE, onlineKey, aiLog } from './ai.js';

export const IMAGE_MODEL = 'grok-imagine-image-2.0';
export const ASPECTS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '21:9'];

// base64 头几个字节认格式（接口不一定给 mime）
const mimeOf = b64 => b64.startsWith('/9j') ? 'image/jpeg' : b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';

export async function genImage(cfg, { prompt, aspect = 'auto', quality = null, resolution = null, model: want = null }, { fetchFn = fetch } = {}) { // 没指定 = AI 设置里的默认（cfg.imageQuality / imageRes），再没有 = 最便宜：low、1k
  quality = quality || cfg.imageQuality || 'low'; resolution = resolution || cfg.imageRes || '1k';
  const key = onlineKey(cfg, 'xai');
  if (!key) throw new Error('没有 Grok（xAI）的 key：⋯ → 🤖 AI 设置「在线」页填');
  const model = want || cfg.imageModel || IMAGE_MODEL, t0 = Date.now();
  const body = { model, prompt: String(prompt).slice(0, 2000), n: 1, response_format: 'b64_json', ...(ASPECTS.includes(aspect) && aspect !== 'auto' ? { aspect_ratio: aspect } : {}), ...(resolution === '2k' ? { resolution: '2k' } : {}), ...(model === 'grok-imagine-image-2.0' ? { quality: quality === 'medium' ? 'medium' : 'low' } : {}) }; // quality 只有 2.0 认
  let err = null, b64 = '';
  try {
    const r = await fetchFn((process.env.SYNAPSIS_ONLINE_URL || ONLINE.xai.url) + '/images/generations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`xai 图片 ${r.status}：${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    b64 = j.data?.[0]?.b64_json || '';
    if (!b64) throw new Error('接口没回图片（被内容审核拦了？）');
  } catch (e) { err = e; }
  aiLog(cfg, { kind: 'AI 配图', model: 'xai:' + model, ms: Date.now() - t0, messages: [{ role: 'user', content: body.prompt + `（${[body.aspect_ratio, body.quality, body.resolution].filter(Boolean).join('，') || '默认'}）` }], raw: b64 ? `[图片 ${Math.round(b64.length * 0.75 / 1024)} KB]` : '', error: err?.message });
  if (err) throw err;
  return 'data:' + mimeOf(b64) + ';base64,' + b64;
}
