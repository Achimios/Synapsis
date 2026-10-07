// >v<✅自检-空间-纯函数（解析、投影、拖动反解、不正交度）+ 临时工作区里用 CLI 写一个情绪空间，check / get 认得
// node core/test/space.test.js
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAxes, parseVec, parseMatrix, mapsOf, spaceInfo, direction, angleDeg, closestPairs, moveInPlane, dot, cosine } from '../space.js';
import { loadWorkspace } from '../workspace.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

ok(parseAxes('愉悦, 唤醒，支配').join() === '愉悦,唤醒,支配', 'axes 中英文逗号');
ok(parseVec('0.4, 0.9 -0.3').join() === '0.4,0.9,-0.3', 'vec 逗号或空格');
ok(parseVec('a, 1').some(Number.isNaN), 'vec 非数 → NaN（给 check 报）');
const W = parseMatrix('1 0 0; 0 1 0.5');
ok(W.length === 2 && W[1].join() === '0,1,0.5', '矩阵 ; 分行');
ok(mapsOf({ 'axes': 'x', '映射→行为空间': '1 0', '映射 -> 别的': '0 1' }).map(m => m.ref).join() === '行为空间,别的', '映射→ 和 映射 -> 都认');

// 一个手搭的图：情绪空间 3 轴，4 个成员（兴奋和激动几乎同向）
const nodes = new Map([['', { children: ['情绪'], parent: null, label: '根' }], ['情绪', { children: ['情绪/兴奋', '情绪/激动', '情绪/谨慎', '情绪/备注'], parent: '', label: '情绪' }]]);
const meta = { '情绪': { axes: '愉悦, 唤醒, 支配' }, '情绪/兴奋': { vec: '0.6, 0.9, 0.4' }, '情绪/激动': { vec: '0.5, 0.95, 0.35' }, '情绪/谨慎': { vec: '-0.2, 0.1, -0.5' }, '情绪/备注': {} };
for (const id of ['情绪/兴奋', '情绪/激动', '情绪/谨慎', '情绪/备注']) nodes.set(id, { children: [], parent: '情绪', label: id.split('/')[1] });
const g = { nodes };
const s = spaceInfo(g, '情绪', id => meta[id]);
ok(s && s.axes.length === 3 && s.members.length === 3 && s.loose.join() === '情绪/备注', 'spaceInfo：有 vec 的是成员，没有的是旁注');
ok(closestPairs(s, 1)[0].a + closestPairs(s, 1)[0].b === '兴奋激动' && closestPairs(s, 1)[0].cos > 0.99, '最相近的一对 = 兴奋·激动');
const ex = direction(s, '#0'), ey = direction(s, '#1');
ok(near(angleDeg(ex, ey), 90), '两根轴夹角 90°');
const dx = direction(s, '情绪/兴奋'), dy = direction(s, '情绪/激动');
ok(angleDeg(dx, dy) < 10, '拿两个情绪词当基：夹角很小（基不正交）' + angleDeg(dx, dy));
// 拖动反解：轴平面上只改那两维
let v = moveInPlane([0.6, 0.9, 0.4], ex, ey, 0.1, -0.2);
ok(near(v[0], 0.1) && near(v[1], -0.2) && near(v[2], 0.4), '轴平面拖动：只改 x、y 两维，第三维不动');
// 斜的方向：拖完以后两个投影正好落在鼠标位置
const u = direction(s, '情绪/兴奋'), w = direction(s, '情绪/谨慎');
v = moveInPlane([0.6, 0.9, 0.4], u, w, 0.3, 0.7);
ok(near(dot(v, u), 0.3) && near(dot(v, w), 0.7), '斜基拖动：投影落在拖到的位置（解 2×2）');
ok(near(cosine([1, 0], [0, 2]), 0) && near(cosine([1, 1], [2, 2]), 1), 'cosine');

// —— 端到端：CLI 写一个情绪空间 → 行为空间 ——
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
const root = mkdtempSync(join(tmpdir(), 'syn-space-'));
const run = (...a) => { const r = spawnSync(process.execPath, [CLI, ...a, '--ws', root], { encoding: 'utf8' }); return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status }; };
try {
  spawnSync(process.execPath, [CLI, 'init', root], { encoding: 'utf8' });
  const ops = join(root, 'ops.json');
  writeFileSync(ops, JSON.stringify([
    ['add', '.', '情绪空间'], ['set', '情绪空间', 'axes=愉悦, 唤醒, 支配'],
    ['add', '情绪空间', '兴奋'], ['set', '情绪空间/兴奋', 'vec=0.6, 0.9, 0.4'],
    ['add', '情绪空间', '激动'], ['set', '情绪空间/激动', 'vec=0.5, 0.95, 0.35'],
    ['add', '情绪空间', '恐惧'], ['set', '情绪空间/恐惧', 'vec=-0.7, 0.9'],
    ['add', '.', '行为空间'], ['set', '行为空间', 'axes=攻击性, 移动速度'],
    ['set', '情绪空间', '映射→行为空间=0.2 0.5 0.8; 0 1'],
    ['link', '情绪空间', '行为空间'],
  ]));
  const r = run('batch', ops);
  ok(r.code === 0, 'batch 写情绪空间 ' + r.err);
  const c = run('check').out;
  ok(c.includes('vec 有 2 维') && c.includes('恐惧'), 'check：维数对不上 → 警告 ' + c);
  ok(c.includes('矩阵应是 2 行') , 'check：矩阵形状不对 → 报错');
  run('set', '情绪空间/恐惧', 'vec=-0.7, 0.9, -0.6');
  run('set', '情绪空间', '映射→行为空间=0.2 0.5 0.8; 0 1 -0.3');
  const c2 = run('check').out;
  ok(!c2.includes('vec 有') && !c2.includes('矩阵应是'), '改对之后 check 不再报 ' + c2);
  const gt = run('get', '情绪空间').out;
  ok(gt.includes('3 轴') && gt.includes('兴奋·激动') && gt.includes('→行为空间（2×3）'), 'get 打印空间摘要 ' + gt);
  const m = loadWorkspace(root).graph.nodes.get('情绪空间').meta;
  ok(m['映射→行为空间'] === '0.2 0.5 0.8; 0 1 -0.3', '映射存在 frontmatter 里，键名带中文和箭头能往返');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`space: ${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
