// >v<✅自检-钉子-临时翻阅组（core/pins.js）：纯函数操作、存取、节点改名 / 搬家后钉子跟着走（含撤销方向）
// node core/test/pins.test.js
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyPins, cleanPins, lineAt, makeLinePin, locateLine, addLines, updateItem, addGroup, removeGroup, renameGroup, setCurrent, toggleCollapsed, addNodes, removeItem, toggleItem, clearGroup, remapNodes } from '../pins.js';
import { saveOutline, loadPins, savePins, loadWorkspace, setNodeBody } from '../workspace.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('✗', m)); };

// ── 纯函数操作 ──
let d = emptyPins();
ok(d.groups.length === 0 && d.current === null, '空：没有组、没有当前组');
let r = addGroup(d); d = r.doc;
ok(d.groups.length === 1 && d.groups[0].name === '组 1' && d.current === r.id, '新组：默认叫「组 1」，成为当前组');
const g1 = r.id;
r = addGroup(d); d = r.doc;
ok(d.groups[1].name === '组 2' && d.current === r.id, '第二个组叫「组 2」并成为当前');
const g2 = r.id;
ok(addGroup(d, '读代码').doc.groups[2].name === '读代码', '可以起名');

let a = addNodes(d, g1, [{ node: '甲', label: '甲' }, { node: '乙/丙', label: '丙' }]);
d = a.doc;
ok(a.added === 2 && d.groups[0].items.length === 2 && d.current === g1, '钉两个节点进组 1，组 1 成为当前组');
ok(d.groups[0].items.every(i => i.kind === 'node' && i.checked === false && i.id), '条目：kind=node，☐ 默认没勾，有 id');
a = addNodes(d, g1, [{ node: '甲', label: '甲' }, { node: '丁', label: '丁' }]);
ok(a.added === 1 && a.doc.groups[0].items.map(i => i.node).join() === '甲,乙/丙,丁', '同一节点在同一组里只放一份，其余照放');
ok(addNodes(d, g2, [{ node: '甲', label: '甲' }]).doc.groups[1].items.length === 1, '不同组可以各放一份');
ok(addNodes(d, 'nope', [{ node: '甲' }]).added === 0, '组不存在 → 不加');
ok(addNodes(d, g1, [{ node: '乙/丙' }]).doc.current === g1, '重复钉也让这组成为当前（人刚点过它）');

d = a.doc;
const it = d.groups[0].items[0];
ok(toggleItem(d, g1, it.id).groups[0].items[0].checked === true, '☐ 勾上');
ok(toggleItem(toggleItem(d, g1, it.id), g1, it.id).groups[0].items[0].checked === false, '再点 = 取消');
ok(removeItem(d, g1, it.id).groups[0].items.length === 2, '删一个钉子');
const cleared = clearGroup(d, g1);
ok(cleared.groups.length === 2 && cleared.groups[0].items.length === 0, '清空：钉子没了，组还在（不自动消失）');
ok(renameGroup(d, g1, '  翻 NPC 笔记 ').groups[0].name === '翻 NPC 笔记', '改名（去首尾空格）');
ok(renameGroup(d, g1, '   ').groups[0].name === '组 1', '改成空名 = 不改');
ok(toggleCollapsed(d, g1).groups[0].collapsed === true, '折叠');
ok(setCurrent(d, g2).current === g2 && setCurrent(d, 'nope').current === d.current, '设当前组（不存在的忽略）');
const rm = removeGroup(d, g1);
ok(rm.groups.length === 1 && rm.current === g2, '删当前组 → 当前挪到剩下的第一组');
ok(removeGroup(removeGroup(d, g1), g2).current === null, '删光 → 没有当前组');
ok(d.groups[0].items.length === 3 && d.groups[0].items[0].checked === false && d.groups.length === 2, '操作不改旧 doc（纯函数）：上面删 / 勾 / 清空 / 删组之后，旧的还是 3 个钉子、没勾、2 个组');

// ── 清洗：手改坏了不崩 ──
ok(cleanPins(null).groups.length === 0 && cleanPins('x').current === null, '清洗：乱七八糟的输入 → 空');
const dirty = cleanPins({ current: 'zzz', groups: [{ id: 'a', name: 'A', items: [{ id: '1', kind: 'node', node: 'n' }, { id: '2', kind: 'line' }, null, { kind: 'node' }] }, { name: '没 id' }] });
ok(dirty.groups.length === 1 && dirty.groups[0].items.length === 1 && dirty.current === 'a', '清洗：没 id 的组丢掉、未知 kind 的条目丢掉、当前组指向不存在 → 第一组');

// ── 行钉子：lineAt / makeLinePin / addLines / 清洗 / 跟着改名 ──
const T = 'ab\ncd\r\nefg\n\nlast';
ok(lineAt(T, 0).line === 1 && lineAt(T, 0).text === 'ab', 'lineAt：第 1 行');
ok(lineAt(T, 3).line === 2 && lineAt(T, 3).text === 'cd' && lineAt(T, 3).start === 3, 'lineAt：第 2 行，去掉行尾 \\r，start = 这一行起点');
ok(lineAt(T, 2).line === 1, 'lineAt：落在换行符本身 = 还算这一行');
ok(lineAt(T, 11).line === 4 && lineAt(T, 11).text === '', 'lineAt：空行（第 4 行从偏移 11 开始）');
ok(lineAt(T, 999).line === 5 && lineAt(T, 999).text === 'last', 'lineAt：超出 = 最后一行');
const long = '0123456789'.repeat(10); // 100 字
const lp = makeLinePin({ file: 'a/b.md', line: 7, lineText: long, selStart: 45, selEnd: 75 });
ok(lp.kind === 'line' && lp.file === 'a/b.md' && lp.line === 7 && lp.text === long && lp.seg === 3 && lp.node === null, 'makeLinePin：选中 45~75，中间 60 → 第 3 段（0 起）' + lp.seg);
ok(lp.label === long.slice(45, 75), 'makeLinePin：label = 选中那段');
ok(makeLinePin({ file: 'f', line: 1, lineText: 'x'.repeat(5000) }).text.length === 2000, 'makeLinePin：整行最多存 2000 字');
ok(makeLinePin({ file: 'f', line: 1, lineText: '', }).label === '（空行）', 'makeLinePin：空行有名字');
ok(makeLinePin({ file: 'f', line: 1, lineText: '没选中文字' }).label === '没选中文字' && makeLinePin({ file: 'f', line: 1, lineText: '没选中文字' }).seg === 0, 'makeLinePin：没选中 = 钉整行，label 用行开头');
let lg = addGroup(emptyPins()); const lgid = lg.id; lg = lg.doc;
let la = addLines(lg, lgid, [lp, makeLinePin({ file: 'a/b.md', line: 9, lineText: '另一行' })]);
ok(la.added === 2 && la.doc.groups[0].items.every(i => i.kind === 'line' && i.id && i.checked === false), 'addLines：两行进组，有 id');
ok(addLines(la.doc, lgid, [lp]).added === 0, 'addLines：同文件同一行不重复');
ok(addLines(la.doc, lgid, [{ ...lp, file: 'other.md' }]).added === 1, 'addLines：不同文件同行号可以');
const cl = cleanPins(la.doc);
ok(cl.groups[0].items.length === 2 && cl.groups[0].items[0].text === long && cl.groups[0].items[0].seg === 3, '清洗：行钉子保留 file / text / seg');
ok(cleanPins({ groups: [{ id: 'g', name: 'g', items: [{ id: '1', kind: 'line', file: 'x', line: 'abc' }, { id: '2', kind: 'line', line: 3 }] }] }).groups[0].items.length === 0, '清洗：行号不是数字 / 没 file 的行钉子丢掉');
const upd = updateItem(la.doc, lgid, la.doc.groups[0].items[0].id, { line: 12, text: '改了' });
ok(upd.groups[0].items[0].line === 12 && upd.groups[0].items[0].text === '改了' && la.doc.groups[0].items[0].line === 7, 'updateItem：改行号和文字，旧 doc 不变');
const lnode = { ...la.doc, groups: [{ ...la.doc.groups[0], items: [{ ...la.doc.groups[0].items[0], node: '甲' }, la.doc.groups[0].items[1]] }] };
const rn = remapNodes(lnode, { 甲: '甲改' });
ok(rn.groups[0].items[0].node === '甲改' && rn.groups[0].items[1].node === null && rn !== lnode, 'remapNodes：行钉子带 node 的跟着改，没有 node 的不管');

// ── locateLine：行变了怎么找回来 ──
const DOC = ['# 标题', '', '第一段：这是一段比较长的话，用来测试按二十个字一段做探针的搜索方法，看看改动之后还能不能找回来。', '- 要点一', '- 要点二', '', '结尾。'];
const P = { kind: 'line', file: 'x.md', line: 3, text: DOC[2], seg: 2 };
let loc = locateLine(DOC, P);
ok(loc.line === 3 && loc.how === 'exact', '原行号上就是 → exact');
loc = locateLine(['新加的一行', '又一行', ...DOC], P);
ok(loc.line === 5 && loc.how === 'moved', '上面插了两行 → moved，找到第 5 行 ' + JSON.stringify(loc));
loc = locateLine(['# 标题', '', DOC[2].slice(0, 30) + '【改了一段】' + DOC[2].slice(36), '- 要点一'], P);
ok(loc.line === 3 && loc.how === 'fuzzy', '行中间被改了几个字 → fuzzy，认得出 ' + JSON.stringify(loc));
loc = locateLine(['# 标题', '', '前面插了一句。' + DOC[2], '- 要点一'], P);
ok(loc.line === 3 && loc.how === 'fuzzy', '行开头插了字（各段边界全错位）→ 照样找到，因为探针是子串搜索不要求对齐 ' + JSON.stringify(loc));
loc = locateLine(['# 标题', '', DOC[2] + '后面又加了很多很多字。', '- 要点一'], P);
ok(loc.line === 3, '行尾追加 → 找到');
loc = locateLine(['完全不相干的内容', '另一些东西', '- 要点一'], P);
ok(loc.line === null && loc.how === 'lost', '整行没了 → lost');
loc = locateLine(['...' + DOC[2].slice(0, 20) + '...', '无关', DOC[2].slice(0, 20) + '，后面全改了成别的话'], P);
ok(loc.line === null && loc.candidates.length >= 1 && loc.candidates.length <= 3, '只剩 1 段还对得上、且不是选中的那一段 → 不敢认，lost，列候选让人选 ' + JSON.stringify(loc));
loc = locateLine([DOC[2], '无关', DOC[2], '无关', DOC[2]], { ...P, line: 4 });
ok(loc.line === 3 || loc.line === 5, '同一行出现多次 → 取离原行号近的 ' + loc.line);
loc = locateLine(['x', 'y', 'z', 'z', 'z', 'z', 'z'], { kind: 'line', file: 'f', line: 6, text: 'z', seg: 0 });
ok(loc.line === 6 && loc.how === 'exact', '短行：原行号对得上 → exact');
loc = locateLine(['z', 'a', 'z', 'z'], { kind: 'line', file: 'f', line: 2, text: 'z', seg: 0 });
ok(loc.how === 'moved' && (loc.line === 1 || loc.line === 3), '短行：整行相等的取离原行号近的 ' + loc.line);
ok(locateLine(['a', ''], { kind: 'line', file: 'f', line: 2, text: '', seg: 0 }).how === 'exact', '空行钉子：原行号还是空行 → exact');
ok(locateLine(['a', 'b'], { kind: 'line', file: 'f', line: 1, text: '   ', seg: 0 }).how === 'lost', '空行钉子：原位置不是空行 → 不乱认');
ok(locateLine(DOC.map(l => l + '\r'), P).how === 'exact', '文件是 CRLF（每行带 \\r）也认');
const manyLines = Array.from({ length: 3000 }, (_, i) => '这是第 ' + i + ' 行，随便写一点内容占位置，凑够二十个字。');
const t0 = Date.now(); locateLine(manyLines, { kind: 'line', file: 'f', line: 5, text: '根本不存在的一行文字，只是想看看搜索 3000 行要多久。', seg: 0 });
ok(Date.now() - t0 < 300, '搜 3000 行没找到也很快：' + (Date.now() - t0) + 'ms');

// ── 叶子变成分组（甲.md → 甲/_node.md）：节点 id 不变，行钉子按节点取到新路径，那一行还在 ──
{
  const rl = mkdtempSync(join(tmpdir(), 'syn-pins-leaf-'));
  try {
    saveOutline(rl, '甲\n乙');
    setNodeBody(rl, '甲', '第一行\n要钉的这一行内容稍微长一点点，用来测试叶子变分组之后还能找到。\n第三行');
    const n0 = loadWorkspace(rl).graph.nodes.get('甲'), lines0 = readFileSync(n0.file, 'utf8').split('\n');
    const ln0 = lines0.findIndex(l => l.startsWith('要钉的这一行')) + 1;
    const pin = makeLinePin({ file: relative(rl, n0.file).split(sep).join('/'), node: '甲', line: ln0, lineText: lines0[ln0 - 1], selStart: 0, selEnd: 6 });
    ok(pin.file === '__synapsis/甲.md', '变身之前：钉的是 甲.md ' + pin.file);
    saveOutline(rl, '甲\n  子\n乙'); // 甲 有了子节点 → 变成分组
    const n1 = loadWorkspace(rl).graph.nodes.get('甲');
    ok(relative(rl, n1.file).split(sep).join('/') === '__synapsis/甲/_node.md', '变身之后：节点 甲 的文件是 甲/_node.md ' + n1.file);
    const lines1 = readFileSync(n1.file, 'utf8').split('\n'), loc = locateLine(lines1, pin);
    ok(loc.line && lines1[loc.line - 1].startsWith('要钉的这一行'), '按节点取新路径 → 在新文件里找得到那一行 ' + JSON.stringify(loc));
    saveOutline(rl, '甲\n乙'); // 子节点没了 → 变回叶子（子 的文件进 .junk）
    const n2 = loadWorkspace(rl).graph.nodes.get('甲');
    ok(relative(rl, n2.file).split(sep).join('/') === '__synapsis/甲.md' && locateLine(readFileSync(n2.file, 'utf8').split('\n'), pin).line, '变回叶子：文件回到 甲.md，那一行还找得到');
  } finally { rmSync(rl, { recursive: true, force: true }); }
}

// ── remapNodes：同时换 ──
const sw = remapNodes({ ...emptyPins(), groups: [{ id: 'g', name: 'g', collapsed: false, items: [{ id: '1', kind: 'node', node: 'a', label: 'a', checked: false }, { id: '2', kind: 'node', node: 'b', label: 'b', checked: false }] }] }, { a: 'b', b: 'a' });
ok(sw.groups[0].items.map(i => i.node).join() === 'b,a', 'a↔b 互换不会换两遍');
const same = emptyPins();
ok(remapNodes(same, { a: 'b' }) === same, '没有可换的 → 原样返回（不写盘）');

// ── 存取 ──
const root = mkdtempSync(join(tmpdir(), 'syn-pins-'));
try {
  ok(loadPins(root).groups.length === 0, '没有文件 → 空');
  ok(!existsSync(join(root, '.synapsis', 'pins.json')), '读不会建文件');
  savePins(root, d);
  ok(existsSync(join(root, '.synapsis', 'pins.json')), '存在 .synapsis/pins.json（本机，.synapsis 自带 gitignore 的地方）');
  ok(JSON.stringify(loadPins(root)) === JSON.stringify(cleanPins(d)), '存了再读 = 原样');
  writeFileSync(join(root, '.synapsis', 'pins.json'), '{坏了');
  ok(loadPins(root).groups.length === 0, '文件坏了 → 空，不崩');

  // ── 节点改名 / 搬家，钉子跟着走（走真的 saveOutline） ──
  saveOutline(root, '甲\n  子\n乙\n丙');
  let h = addGroup(emptyPins()).doc;
  h = addNodes(h, h.current, [{ node: '甲', label: '甲' }, { node: '甲/子', label: '子' }, { node: '乙', label: '乙' }]).doc;
  savePins(root, h);
  saveOutline(root, '甲改\n  子\n乙\n丙');
  let ids = loadPins(root).groups[0].items.map(i => i.node).join();
  ok(ids === '甲改,甲改/子,乙', '改名 甲→甲改：钉子跟着走，连子孙也跟（' + ids + '）');
  ok(loadPins(root).groups[0].items[0].label === '甲改', '名字缓存也更新');
  // 撤销改名 = 反方向再存一次（界面会带 hint：要写成的 id ← 现在的 id）
  saveOutline(root, '甲\n  子\n乙\n丙', new Map([['甲', '甲改'], ['甲/子', '甲改/子']]));
  ids = loadPins(root).groups[0].items.map(i => i.node).join();
  ok(ids === '甲,甲/子,乙', '撤销改名：钉子跟回来（' + ids + '）');
  // 搬家：乙 挪进 丙 下面
  saveOutline(root, '甲\n  子\n丙\n  乙', new Map([['丙/乙', '乙']]));
  ids = loadPins(root).groups[0].items.map(i => i.node).join();
  ok(ids === '甲,甲/子,丙/乙', '乙 搬进 丙 → 钉子跟着（' + ids + '）');
  // 删除：节点没了，钉子还在（界面显示找不到；撤销删除后又对上了）
  saveOutline(root, '甲\n  子\n丙');
  ok(loadPins(root).groups[0].items.some(i => i.node === '丙/乙'), '节点删了，钉子留着（不替人删）');
  // 没有钉子文件时，保存不应该凭空建一个
  const root2 = mkdtempSync(join(tmpdir(), 'syn-pins-'));
  try { saveOutline(root2, 'x\ny'); saveOutline(root2, 'x2\ny'); ok(!existsSync(join(root2, '.synapsis', 'pins.json')), '没钉子时保存 / 改名不会建 pins.json'); }
  finally { rmSync(root2, { recursive: true, force: true }); }
  // 钉子文件坏了不拦保存
  writeFileSync(join(root, '.synapsis', 'pins.json'), '{坏了');
  ok(saveOutline(root, '甲\n  子\n丁').ok === true, '钉子文件坏了：保存照常成功');
  // 改名前叫 hooks.json：读得到旧的就接着用，保存时换成 pins.json 并删掉旧的
  const root3 = mkdtempSync(join(tmpdir(), 'syn-pins-'));
  try {
    mkdirSync(join(root3, '.synapsis'), { recursive: true });
    const g0 = addGroup(emptyPins()); const doc0 = addNodes(g0.doc, g0.id, [{ node: '甲', label: '甲' }]).doc;
    writeFileSync(join(root3, '.synapsis', 'hooks.json'), JSON.stringify(doc0));
    ok(loadPins(root3).groups[0]?.items[0]?.node === '甲', '旧的 hooks.json 还读得到');
    savePins(root3, doc0);
    ok(existsSync(join(root3, '.synapsis', 'pins.json')) && !existsSync(join(root3, '.synapsis', 'hooks.json')), '保存 → 换成 pins.json，旧的删掉');
  } finally { rmSync(root3, { recursive: true, force: true }); }
} finally { rmSync(root, { recursive: true, force: true }); }

console.log(`pins: ${pass} 过 / ${fail} 挂`);
process.exitCode = fail ? 1 : 0;
