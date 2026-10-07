// >v<🧪嵌入实验-语义近邻-用本地嵌入模型（LM Studio）看：向量是否反映图结构、能否提示漏掉的连线
// node core/tools/embed_probe.js [--model <id>] [--text label|full] [--ws <工作区>]
// 判据（可检验）：有连线的节点对，平均余弦相似度应明显高于没连线的；差值 / 标准差 = 效应量。
import { loadWorkspace } from '../workspace.js';
import { workspaceRoot } from '../cli.js';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const MODEL = opt('model') || 'text-embedding-nomic-embed-text-v1.5';
const MODE = opt('text') || 'full';
const URL = 'http://localhost:1234/v1/embeddings';

const ws = loadWorkspace(workspaceRoot(argv));
const leaves = [...ws.graph.nodes.values()].filter(n => n.id && !n.children.length);
const textOf = n => MODE === 'label' ? n.label
  : [n.label, n.meta.math, n.body.replace(/^#+.*$/gm, '').trim().slice(0, 300)].filter(Boolean).join('。');
const prefix = MODEL.includes('nomic') ? 'clustering: ' : ''; // nomic 要任务前缀

const t0 = Date.now();
const res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, input: leaves.map(n => prefix + textOf(n)) }), signal: AbortSignal.timeout(180000) });
if (!res.ok) { console.log('嵌入接口出错', res.status, await res.text()); process.exit(1); }
const vecs = (await res.json()).data.map(d => d.embedding);
const cos = (a, b) => { let s = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return s / Math.sqrt(x * y); };

const linked = new Set(ws.graph.edges.flatMap(e => [e.from + '|' + e.to, e.to + '|' + e.from]));
const pairs = [];
for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
  const a = leaves[i], b = leaves[j];
  pairs.push({ a: a.label, b: b.label, s: cos(vecs[i], vecs[j]), linked: linked.has(a.id + '|' + b.id), sameGroup: a.parent === b.parent });
}
const stat = xs => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); return { m, sd, n: xs.length }; };
const L = stat(pairs.filter(p => p.linked).map(p => p.s)), U = stat(pairs.filter(p => !p.linked).map(p => p.s));
const G = stat(pairs.filter(p => p.sameGroup).map(p => p.s)), O = stat(pairs.filter(p => !p.sameGroup).map(p => p.s));
const pooled = Math.sqrt((L.sd ** 2 + U.sd ** 2) / 2);
const f = x => x.toFixed(3);
console.log(`模型 ${MODEL}｜文本 ${MODE}｜${leaves.length} 个叶子节点、${pairs.length} 对、维数 ${vecs[0].length}｜耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`有连线  ${f(L.m)} ± ${f(L.sd)}（${L.n} 对）`);
console.log(`没连线  ${f(U.m)} ± ${f(U.sd)}（${U.n} 对）  → 差 ${f(L.m - U.m)}，效应量 ${f((L.m - U.m) / pooled)}`);
console.log(`同分组  ${f(G.m)}   跨分组 ${f(O.m)}`);
console.log('\n最像但没连线的 8 对（候选「漏掉的关系」，要人判断）：');
for (const p of pairs.filter(p => !p.linked).sort((x, y) => y.s - x.s).slice(0, 8)) console.log(`  ${f(p.s)}  ${p.a}  ↔  ${p.b}${p.sameGroup ? '（同组）' : ''}`);
console.log('\n有连线里最不像的 4 对（向量看不出来的关系）：');
for (const p of pairs.filter(p => p.linked).sort((x, y) => x.s - y.s).slice(0, 4)) console.log(`  ${f(p.s)}  ${p.a}  ↔  ${p.b}`);
