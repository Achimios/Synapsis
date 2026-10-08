// >v<🤖AI指令-软件知识-内置 LLM 回答「怎么用 / 快捷键」：只读两份唯一的源，不另写一份
//   1) core/keymap.js（界面「⌨ 快捷键」页同一份）  2) <Synapsis>/__AI接入手册.md（给外部 AI 的那份，没生成就读模板）
//   8B 的上下文小 → 不整份塞，按问题挑最相关的几段（字二元组 + IDF），预算内拼起来
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYMAP } from './keymap.js';

const HOME = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 700; // 一段最多多少字

function manualText(home) {
  for (const f of [join(home, '__AI接入手册.md'), join(home, 'core', 'templates', 'AI_Manual.md')]) {
    try { return readFileSync(f, 'utf8'); } catch { /* 下一个 */ }
  }
  return '';
}

// 手册按 ## 分节，节内按空行切成不超过 MAX 字的段；每段带上节名
function splitManual(md) {
  const out = [];
  for (const sec of md.split(/\n(?=## )/)) {
    const title = (sec.match(/^##\s+(.+)/) || [, '手册'])[1].trim();
    let cur = '';
    for (const para of sec.replace(/^##.*\n/, '').split(/\n\s*\n/)) {
      if (cur && cur.length + para.length > MAX) { out.push({ src: '手册·' + title, text: cur.trim() }); cur = ''; }
      cur += para + '\n\n';
    }
    if (cur.trim()) out.push({ src: '手册·' + title, text: cur.trim() });
  }
  return out;
}

export function knowledgeChunks(home = HOME) {
  const keys = KEYMAP.map(([g, rows]) => ({ src: '快捷键·' + g, text: rows.map(([k, v]) => `${k}：${v}`).join('\n') }));
  return [...keys, ...splitManual(manualText(home))];
}

// 字二元组（中文）+ 英文单词，小写
function grams(s) {
  const t = String(s).toLowerCase(), g = new Map(), add = w => g.set(w, (g.get(w) || 0) + 1);
  for (const w of t.match(/[a-z0-9_+.-]{2,}/g) || []) add(w);
  const han = t.replace(/[^一-鿿]+/g, ' ');
  for (const run of han.split(' ')) for (let i = 0; i + 1 < run.length; i++) add(run.slice(i, i + 2));
  return g;
}

// 问句里的虚词不算（「怎么」「什么」到处都有，会把不相干的段顶上来）
const STOP = new Set(['怎么', '么连', '么切', '么放', '么用', '什么', '是什', '如何', '哪里', '在哪', '可以', '能不', '不能', '一下', '这个', '那个', '这几', '几个', '我想', '想要', '要怎', '快捷', '捷键', '有哪', '哪些', '是否', '怎样']);

// 挑和问题最相关的段：Σ idf(问题里出现在该段的词)，按段长温和归一（BM25 式）；没有命中 → 空
//   「快捷 / 捷键」只当一个加分：问快捷键时快捷键表的段排前面
export function pickKnowledge(question, { home = HOME, budget = 2400, chunks = knowledgeChunks(home) } = {}) {
  const all = grams(question), q = [...all.keys()].filter(w => !STOP.has(w));
  const askKeys = all.has('快捷') || all.has('捷键') || /shortcut|按键|热键/i.test(question);
  if (!q.length && !askKeys) return [];
  const cg = chunks.map(c => grams(c.src + ' ' + c.text)), avg = cg.reduce((s, g) => s + g.size, 0) / cg.length;
  const idf = w => Math.log(1 + chunks.length / (1 + cg.filter(g => g.has(w)).length));
  const scored = chunks.map((c, i) => {
    let s = 0; for (const w of q) if (cg[i].has(w)) s += idf(w) * Math.sqrt(Math.min(3, cg[i].get(w))); // 出现多次的更相关，封顶
    s /= 0.5 + 0.5 * cg[i].size / avg;
    if (askKeys && c.src.startsWith('快捷键')) s += 0.5;
    return { ...c, score: s };
  }).filter(c => c.score > 0.8).sort((a, b) => b.score - a.score);
  if (askKeys && !scored.some(c => c.score > 1.5)) { // 泛泛地问「有哪些快捷键」→ 快捷键表按顺序给，放不下的只给标题
    const keys = chunks.filter(c => c.src.startsWith('快捷键')); let used = 0;
    return keys.map(c => ({ ...c, score: 0, ...((used += c.text.length) > budget && { text: '（太长略去，问具体的再查）' }) }));
  }
  const out = []; let used = 0;
  for (const c of scored) { if (used + c.text.length > budget) continue; out.push(c); used += c.text.length; if (out.length >= 5) break; }
  return out;
}

export const knowledgeText = picks => picks.map(c => `【${c.src}】\n${c.text}`).join('\n\n');
