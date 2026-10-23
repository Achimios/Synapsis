// >v<✅自检-规模-核心计时：node core/tools/scale_bench.mjs <scale_gen 造的工作区>（会改那个工作区里的一个节点，只给临时目录用）
import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url';
const R = new URL('../', import.meta.url).href;
const W = await import(R + 'workspace.js'), O = await import(R + 'outline.js'), Ag = await import(R + 'agent.js');
const root = process.argv[2];
const t = (name, f, n = 3) => { let best = Infinity, out; for (let i = 0; i < n; i++) { const t0 = performance.now(); out = f(); best = Math.min(best, performance.now() - t0); } console.log(name.padEnd(34), Math.round(best) + ' ms'); return out; };
const ws = t('loadWorkspace', () => W.loadWorkspace(root));
const ol = t('workspaceOutline', () => W.workspaceOutline(ws));
console.log('  大纲', ol.split('\n').length, '行', ol.length, '字');
t('parseOutline', () => O.parseOutline(ol));
t('checkWorkspace', () => W.checkWorkspace(ws));
t('findNodes 「代价」', () => W.findNodes(ws, '代价'));
t('findNodes 「失误可以恢复」(正文)', () => W.findNodes(ws, '失误可以恢复'));
t('projectView 根', () => O.projectView(ws.graph, O.ROOT));
t('projectView 一个三级组', () => O.projectView(ws.graph, '战斗/战斗节奏/战斗节奏·代价'));
const ex = t('exportForLLM 全部', () => O.exportForLLM(ws.graph, O.ROOT), 1);
console.log('  导出', ex.length, '字');
const pc = t('pageContext 根', () => Ag.pageContext(ws, O.ROOT, [], {}), 1);
console.log('  根页上下文', pc.text.length, '字');
const pc2 = t('pageContext 二级组', () => Ag.pageContext(ws, '战斗/战斗节奏', [], {}), 1);
console.log('  二级组上下文', pc2.text.length, '字');
t('saveOutline 原样写回(自动保存最坏)', () => W.saveOutline(root, ol), 1);
t('saveOutline 改一个名字', () => W.saveOutline(root, ol.replace('战斗节奏·代价·例1\n', '战斗节奏·代价·例1改\n')), 1);
t('saveOutline 改回来', () => W.saveOutline(root, ol), 1);
t('setNodeBody 一个', () => W.setNodeBody(root, '战斗/战斗节奏/战斗节奏·代价/战斗节奏·代价·例2', '新正文 ' + Date.now()), 1);
t('setNodeMeta 一个', () => W.setNodeMeta(root, '战斗/战斗节奏/战斗节奏·代价/战斗节奏·代价·例2', { color: '红' }), 1);
const cli = (...a) => execFileSync(process.execPath, [fileURLToPath(new URL('cli.js', R)), ...a, '--ws', root], { encoding: 'utf8', maxBuffer: 1e8 });
for (const c of [['overview'], ['check'], ['export'], ['find', '代价'], ['outline']]) { const o = t('CLI ' + c.join(' '), () => cli(...c), 1); console.log('  输出', o.length, '字'); }
