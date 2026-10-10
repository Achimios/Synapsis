// >v<✅自检-界面-并行版（👤 2026-10-10「自检太慢，不适合高频交互」）：把 ui.test.js 按块拆开，开几个进程同时跑（每个块自己建临时工作区，互不相干）。
//   用法（先起测试服务：SYN_DESKTOP=1 npx vite --port 5477 --strictPort）：
//     node test/ui_par.mjs                    全部块，4 个进程并行（全量约 3~4 分钟，原来 10 分钟以上）
//     node test/ui_par.mjs UI 钉子            只跑名字里含「UI」或「钉子」的块（改哪块跑哪块，十几秒）
//     node test/ui_par.mjs -j 6 -p 5410       6 个进程、端口 5410
//     node test/ui_par.mjs --list             只列出所有块的名字
//   块 = ui.test.js 里顶格的 `{ … }`（和最前面那个 for 大块）；用到剪贴板的块放同一个进程串行（系统剪贴板只有一个）。
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let jobs = 4, port = 5477, list = false; const want = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-j') jobs = +args[++i] || 4; else if (args[i] === '-p') port = +args[++i] || 5477; else if (args[i] === '--list') list = true; else want.push(args[i]);
}
const lines = readFileSync(join(dir, 'ui.test.js'), 'utf8').split(/\r?\n/);
const starts = lines.map((l, i) => /^(\{|for \(const kind of .*\{)$/.test(l) ? i : -1).filter(i => i >= 0);
const blocks = starts.map(s => {
  let e = s + 1; while (e < lines.length && lines[e] !== '}') e++;
  const text = lines.slice(s, e + 1).join('\n');
  const name = (text.match(/console\.log\('==\s*([^']*)'/) || text.match(/console\.log\('==',/) && ['', 'reactflow'] || [, '块@' + (s + 1)])[1].trim();
  return { name: name || '画布主体', text, size: e - s, clip: /clipboard/.test(text) };
});
const head = lines.slice(0, starts[0]).join('\n').replace(/localhost:5410/, 'localhost:' + port);
const foot = lines.slice(lines.findIndex((l, i) => i > starts.at(-1) && l.startsWith('await browser.close()'))).join('\n');
if (list) { blocks.forEach(b => console.log(String(b.size).padStart(4), b.clip ? '📋' : '  ', b.name)); process.exit(0); }
const picked = want.length ? blocks.filter(b => want.some(w => b.name.includes(w))) : blocks;
if (!picked.length) { console.log('没有匹配的块。--list 看名字'); process.exit(1); }
// 贪心分配：大的先分，每次给当前最轻的进程；用剪贴板的都进 0 号
const n = Math.min(jobs, picked.length), bins = Array.from({ length: n }, () => ({ size: 0, blocks: [] }));
for (const b of [...picked].sort((a, c) => (c.clip - a.clip) || c.size - a.size)) { const bin = b.clip ? bins[0] : bins.reduce((m, x) => x.size < m.size ? x : m); bin.blocks.push(b); bin.size += b.size; }
const t0 = Date.now(); let pass = 0, fail = 0;
const run = (bin, k) => new Promise(res => {
  const file = join(dir, `_par_${k}.test.js`);
  writeFileSync(file, [head, ...bin.blocks.map(b => b.text), foot].join('\n'));
  let out = '';
  const p = spawn(process.execPath, [file], { cwd: dirname(dir) });
  const timer = setTimeout(() => { out += '\n  ✗ 超时 8 分钟，进程被杀\n'; p.kill(); }, 8 * 60 * 1000);
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', () => { clearTimeout(timer); rmSync(file, { force: true }); res(out); });
});
const outs = await Promise.all(bins.map(run));
for (const out of outs) {
  const m = out.match(/ui:(\d+) 过 \/ (\d+) 挂/);
  if (m) { pass += +m[1]; fail += +m[2]; } else { fail++; console.log('  ✗ 进程没跑完（没有汇总行）：\n' + out.split('\n').slice(-12).join('\n')); }
  for (const l of out.split('\n')) if (/✗|Error|Timeout/.test(l) && !/^ui:/.test(l)) console.log(l);
}
console.log(`ui(并行 ${n} 进程，${picked.length}/${blocks.length} 块，${Math.round((Date.now() - t0) / 1000)} 秒): ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
