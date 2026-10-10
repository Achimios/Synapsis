// UI 节点：addUiNode + 布局导出 uiLayoutText。node core/test/uilayout.test.js
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveOutline, loadWorkspace, saveLayout, checkWorkspace, addUiNode, setNodeBody, workspaceOutline } from '../workspace.js';
import { uiLayoutText, isUi, uiSize } from '../uilayout.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  ✗', m)); };
const root = mkdtempSync(join(tmpdir(), 'syn-ui-'));
saveOutline(root, '普通');
const a = addUiNode(root, '', { label: '主界面', w: 1000, h: 600 });
const b = addUiNode(root, '', { label: '侧栏', w: 200, h: 300 });
let ws = loadWorkspace(root);
ok(isUi(ws.graph.nodes.get(a.id).meta) && uiSize(ws.graph.nodes.get(a.id).meta).w === 1000, 'addUiNode：ui: / w / h 写进 frontmatter');
ok(!ws.graph.nodes.get(a.id).status, '不带 status');
ok(!checkWorkspace(ws).some(i => i.where === a.id && /没有 status/.test(i.msg)), 'check 不报「没有 status」');
ok(uiSize({}).w === 220 && uiSize({}).h === 140, '没写宽高 → 默认 220×140');

// 主界面（UI）里面：按钮、标题（UI）、说明（普通）；标题里面再有个图标（UI）
const btn = addUiNode(root, a.id, { label: '按钮', w: 100, h: 40 });
const title = addUiNode(root, a.id, { label: '标题', w: 300, h: 50 });
const icon = addUiNode(root, title.id, { label: '图标', w: 32, h: 32 });
saveOutline(root, workspaceOutline(loadWorkspace(root)).replace('  标题', '  说明\n  标题'));
setNodeBody(root, a.id + '/说明', '这里放玩家头像\n和名字');
ws = loadWorkspace(root);
const meta = Object.fromEntries([...ws.graph.nodes].map(([id, n]) => [id, n.meta || {}]));
const body = Object.fromEntries([...ws.graph.nodes].map(([id, n]) => [id, n.body || '']));
const layout = { [a.id]: { x: 100, y: 50 }, [b.id]: { x: 1200, y: 50 }, [btn.id]: { x: 20, y: 500 }, [title.id]: { x: 20, y: 20 }, [icon.id]: { x: 5, y: 5 }, [a.id + '/说明']: { x: 400, y: 100 } };

let t = uiLayoutText(ws.graph, meta, body, layout, [a.id]);
ok(/\[UI\] 主界面  左上\(100,50\) 右上\(1100,50\) 右下\(1100,650\) 左下\(100,650\)  宽1000 高600/.test(t), '父 UI 节点：四个角 + 宽高 ' + t.split('\n')[1]);
ok(t.includes('- [UI] 标题  左上(20,20)') && t.includes('- [UI] 图标  左上(5,5) 右上(37,5) 右下(37,37) 左下(5,37)  宽32 高32'), '里面每一级 UI 节点都带四角（图标在标题里面）');
ok(t.includes('- 说明：这里放玩家头像 和名字'), '普通节点只带名字和正文');
ok(!t.includes('侧栏'), '没选中的 UI 节点不输出');
const lines = t.split('\n');
ok(lines.findIndex(l => l.includes('标题')) < lines.findIndex(l => l.includes('说明')) && lines.findIndex(l => l.includes('说明')) < lines.findIndex(l => l.includes('按钮')), '里面按位置从上到下排：标题(y20) → 说明(y100) → 按钮(y500)');
ok(/^ {2}- \[UI\] 标题/m.test(t) && /^ {4}- \[UI\] 图标/m.test(t), '缩进 = 在上一级里面');

// 选中几个：每个都输出；选中的父子都在 → 只算最外层（子的由递归带出）
t = uiLayoutText(ws.graph, meta, body, layout, [b.id, a.id]);
ok(t.indexOf('主界面') < t.indexOf('侧栏'), '同页的多个按位置排：主界面(y50,x100) 先于 侧栏(y50,x1200)');
t = uiLayoutText(ws.graph, meta, body, layout, [a.id, title.id]);
ok((t.match(/\[UI\] 标题/g) || []).length === 1, '父子都选中 → 子不重复输出');
t = uiLayoutText(ws.graph, meta, body, layout, [title.id]);
ok(t.includes('[UI] 标题') && t.includes('[UI] 图标') && !t.includes('主界面'), '只选子 UI 节点 → 只输出它和它里面的');
ok(uiLayoutText(ws.graph, meta, body, layout, ['普通']) === '', '选的不是 UI 节点 → 空');
rmSync(root, { recursive: true, force: true });
console.log(`uilayout: ${pass} 过 / ${fail} 挂`); process.exit(fail ? 1 : 0);
