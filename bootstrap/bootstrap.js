#!/usr/bin/env node
// >v<🏗️构建引导-生成骨架-按用户规矩给新项目铺文档骨架，已有文件一律跳过
// 用法：node bootstrap.js <项目目录> [--name 名字] [--desc "一句话"] [--dry]
// 规矩本体：同目录 _ProjectBootstrap.md；模板：template/
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'template');
const GUIDE = join(HERE, '_ProjectBootstrap.md');

export function plan(target, { name, desc, date }) {
  const vars = { NAME: name, DESC: desc, DATE: date, GUIDE: GUIDE.replace(/\\/g, '/') };
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir)) {
      const src = join(dir, e);
      if (statSync(src).isDirectory()) { walk(src); continue; }
      const rel = relative(TEMPLATE, src);
      const dst = join(target, rel);
      const body = readFileSync(src, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
      out.push({ rel: rel.replace(/\\/g, '/'), dst, body, exists: existsSync(dst) });
    }
  };
  walk(TEMPLATE);
  return out;
}

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else args._.push(argv[i]);
  }
  if (!args._[0]) { console.log('用法：node bootstrap.js <项目目录> [--name 名字] [--desc "一句话"] [--dry]'); process.exit(1); }
  const target = resolve(args._[0]);
  const name = args.name || basename(target).replace(/^\d+_/, '');
  const date = new Date().toISOString().slice(0, 10);
  const items = plan(target, { name, desc: args.desc || '待定（一句话：这是什么、给谁用）', date });
  let made = 0;
  for (const it of items) {
    if (it.exists) { console.log('  跳过（已存在）', it.rel); continue; }
    console.log((args.dry ? '  将创建 ' : '  创建 ') + it.rel);
    if (!args.dry) { mkdirSync(dirname(it.dst), { recursive: true }); writeFileSync(it.dst, it.body); made++; }
  }
  if (!args.dry && !existsSync(join(target, '.git'))) {
    try { execFileSync('git', ['init', '-q'], { cwd: target }); console.log('  git init'); }
    catch (e) { console.log('  ⚠️ git init 失败：', e.message); }
  }
  console.log(`${args.dry ? '预演' : '完成'}：${name} @ ${target}，新建 ${args.dry ? items.filter(i => !i.exists).length : made} 个，跳过 ${items.filter(i => i.exists).length} 个`);
  console.log('下一步：按 _ProjectBootstrap.md §6，用一两句话跟用户确认「是什么 / 精度定位 / 当前专注」写进 AGENTS.md');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
