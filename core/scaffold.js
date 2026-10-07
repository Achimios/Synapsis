// >v<🏗️构建引导-界面里的项目骨架-Synapsis 打开的项目里按需补 _开发进度.md 那套文档（init 不带它们：👤 2026-10-08「研究里似乎不需要」）
// 先检测：同名已存在 → 跳过；有「同类」的旧名文件（_DevProgress.md 等）→ 默认不勾；只写勾上的、不存在的
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { plan } from '../bootstrap/bootstrap.js';

// 模板文件名 → 用户别的项目里可能已经在用的同类文件（有了就别再铺一份）；英文名是 2026-10-08 改中文之前的旧名
const ALIASES = {
  '_开发进度.md': ['_DevProgress.md', '_研究进度.md', '_进度.md'],
  '_TODO.md': ['_待办.md', 'TODO.md'],
  '__where_continue.md': ['_从哪继续.md', '_where_continue.md', '_接手.md'],
  '_LEARNINGS.md': ['_经验教训.md', 'LEARNINGS.md', '_坑.md'],
  '_工程规矩.md': ['_ProjectRules.md', '_项目规则.md'],
  '_开发索引.md': ['_DevIndex.md', '_开发索引表.md'],
  'AGENTS.md': ['CLAUDE.md'],
  '_PLAN.md': ['_计划.md', '_Plan.md'],
};

export function scaffoldPlan(root) {
  const name = basename(root).replace(/^\d+_/, '');
  return plan(root, { name, desc: '待定（一句话：这是什么、给谁用）', date: new Date().toISOString().slice(0, 10) }).map(it => {
    const alike = (ALIASES[it.rel] || []).filter(a => existsSync(join(root, a)));
    return { rel: it.rel, exists: it.exists, alike, body: it.body, dst: it.dst };
  });
}

export function scaffoldWrite(root, rels) {
  const want = new Set(rels || []);
  const made = [];
  for (const it of scaffoldPlan(root)) {
    if (!want.has(it.rel) || it.exists) continue;
    mkdirSync(dirname(it.dst), { recursive: true });
    writeFileSync(it.dst, it.body);
    made.push(it.rel);
  }
  return made;
}
