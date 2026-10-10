// 传送门卡片（ref: 指向别处的节点）：addRefNode / migrateRefs / check。node core/test/refnode.test.js
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, loadWorkspace, workspaceOutline, checkWorkspace, addRefNode } from '../workspace.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const root = mkdtempSync(join(tmpdir(), 'syn-ref-'));
saveOutline(root, '设计\n  战斗\n  移动\n页面');

const r = addRefNode(root, '页面', '设计/战斗');
ok(r.id === '页面/↗ 战斗', '名字 = ↗ 目标名，建在指定页面下 ' + r.id);
let ws = loadWorkspace(root);
const n = ws.graph.nodes.get(r.id);
ok(n && n.meta.ref === '设计/战斗', 'frontmatter 带 ref: 目标 id ' + JSON.stringify(n?.meta));
ok(!n.status, '不带 status（不混进进度统计）');
ok(!checkWorkspace(ws).some(i => i.where === r.id), 'check：有效的 ref 没问题（也不报「没有 status」） ' + JSON.stringify(checkWorkspace(ws).filter(i => i.where === r.id)));

// 指向的本身是传送门卡片 → 直接指它的目标
const r2 = addRefNode(root, '设计', r.id);
ok(loadWorkspace(root).graph.nodes.get(r2.id).meta.ref === '设计/战斗', '指向传送门卡片 → 改指它的目标，不绕两层');
// 同一个目标可以放多张（同页重名自动区分）
const r3 = addRefNode(root, '页面', '设计/战斗');
ok(r3.id !== r.id, '同页再放一张 → 名字区分 ' + r3.id);

// 目标改名：ref 跟着走
saveOutline(root, workspaceOutline(loadWorkspace(root)).replace('  战斗', '  打架'));
ws = loadWorkspace(root);
ok(ws.graph.nodes.has('设计/打架'), '目标改名了');
ok(ws.graph.nodes.get(r.id).meta.ref === '设计/打架', '改名后 ref 跟着改 ' + ws.graph.nodes.get(r.id).meta.ref);
ok(ws.graph.nodes.get(r2.id).meta.ref === '设计/打架' && ws.graph.nodes.get(r3.id).meta.ref === '设计/打架', '几张卡的 ref 都跟着改');
// 目标搬家（跨父，剪切粘贴）：ref 跟着走
const root2 = mkdtempSync(join(tmpdir(), 'syn-ref2-'));
saveOutline(root2, '甲\n  乙\n丙');
const q = addRefNode(root2, '丙', '甲/乙'), qn = q.id.split('/').pop();
saveOutline(root2, '甲\n丙\n  ' + qn + '\n  乙');
ws = loadWorkspace(root2);
ok(ws.graph.nodes.has('丙/乙') && ws.graph.nodes.get('丙/' + qn).meta.ref === '丙/乙', '目标搬到别处 → ref 跟着改 ' + ws.graph.nodes.get('丙/' + qn)?.meta.ref);
// 目标删了：卡片留着，check 报 warn
saveOutline(root2, '丙\n  ' + qn);
ws = loadWorkspace(root2);
const bad = checkWorkspace(ws).filter(i => /ref 指向不存在/.test(i.msg));
ok(bad.length === 1 && bad[0].level === 'warn', '目标不在了 → check 报 ref 指向不存在（warn） ' + JSON.stringify(bad));
rmSync(root2, { recursive: true, force: true });
// 不存在的目标 / 父节点
let threw = false; try { addRefNode(root, '', '没有这个'); } catch { threw = true; } ok(threw, '目标不存在 → 报错');
threw = false; try { addRefNode(root, '不存在的页', '页面'); } catch { threw = true; } ok(threw, '父节点不存在 → 报错');
rmSync(root, { recursive: true, force: true });
console.log(`refnode: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
