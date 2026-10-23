// 外壳：左大纲（真源）、面包屑、导出、快捷键、贴图、工作区读写。
// 画布组件（main.jsx，React Flow）只负责「显示 view + 回报用户操作」。
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { describeChange } from './history.js';
import './zones.js'; // Ctrl+Tab 换 WASD 的生效区（左栏 / 画布 / 右栏）：一加载就装键盘监听，要比下面这些都早
import { uiLayoutText, isUi, uiSize } from '../../core/uilayout.js';
import { parseOutline, projectView, breadcrumb, exportForLLM, withEdge, withNode, withoutNode, withStatus, withLabel, withReordered, replaceLabels, autoLayout, lineOf, resolveLabel, isDropped, withCopies, withoutEdge, ROOT } from './outline.js';
import { colorMap, wordTables, hierHit, upperTable, baseColor, satOf } from './colors.js';
import { patternMap, patternTables, PATTERNS } from './patterns.js';
import { spaceInfo, isSpace, parseAxes, parseVec, mapsOf, direction, directionLabel, dot, angleDeg, moveInPlane, fmtVec, closestPairs } from './space.js';
import { timelineInfo, isTimeline, parseTime, spanOf, round3, tlCardEdges } from './timeline.js';
import { TimelineView } from './timeline.jsx';
import { FrameGrab } from './framegrab.jsx';
import { KeyCombo, ContextMenu, PropsPanel, FileTree, FilePanel, TextFind, HistoryPanel, OutlineTree, HelpModal, SettingsModal, ReplaceBar, ScaffoldModal, SearchModal, DRAG_NODE, OverflowBar } from './panels.jsx';
const DRAG_PIC = 'application/x-synapsis-pic';
import { initStash, useStash, putStash } from './stash.js';
import { AiPanel, RelatedDock, AgentBox } from './ai.jsx';
import { PinDock } from './pindock.jsx';
import { emptyPins, addGroup, addNodes, addLines, updateItem, lineAt, makeLinePin, locateLine } from './pins.js';
import { MdLite } from './mdlite.jsx';
import { MdEditor } from './mdedit.jsx';
import { SAMPLE } from './sample.js';
import './shell.css';

const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额满/隐私模式：不持久化 */ } };

// >v<🚀启停-心跳-页面每 20s ping，全关后服务自动退出
// 心跳：告诉服务「还有网页开着」（全关后服务自动退出，见 vite.config.js）
const ping = () => fetch('/__alive').catch(() => {});
ping(); setInterval(ping, 20000);

// >v<💾工作区-界面接入-默认读写被规划项目的 __synapsis/；?demo = 样例数据 + localStorage（自动化测试用，不碰真文件）；?ws=<目录> 指定工作区
const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo');
const WSQ = Q.get('ws') ? 'ws=' + encodeURIComponent(Q.get('ws')) : '';
const HIST_KEY = 'syn.hist.' + (WSQ || 'default'); // 撤销记录：sessionStorage（刷新不丢）+ 服务进程内存暂存（关 vault 再打开也在，退出托盘才清）
const withWs = path => '/api' + path + (WSQ ? (path.includes('?') ? '&' : '?') + WSQ : '');
const api = (path, opts) => fetch(withWs(path), opts && { ...opts, headers: { 'content-type': 'application/json' } })
  .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || (j.report && j.report.errors && JSON.stringify(j.report.errors)) || r.status); return j; });
initStash(api); // 界面暂存（关窗口不丢，托盘重启才清）：先去服务端取回来

// >v<🎨画布-卡片属性-人加的属性显示在卡片上（👤 2026-10-08：加了属性画布上看不到）；结构 / 显示用的字段不算，最多 4 条
const SYS_META = new Set(['to', 'label', 'status', 'order', 'color', 'pattern', 'sat', 'tint', 'vec', 'axes', 'evidence', 'evidence_hash', 'rate', 'picw', 'img', 'kind']); // 👤 2026-10-12 有专门按钮的（颜色 / 图案 / 饱和 / 框内）不当标签列在卡片上
const CARD_HIDE = new Set(['file', 'ref', 'ui', 'w', 'h']); // 这些有专门的样子（📎 / ↗ / UI 框），不再当普通属性列在卡片上
const cardProps = meta => Object.entries(meta || {}).filter(([k, v]) => !SYS_META.has(k) && !CARD_HIDE.has(k) && !k.startsWith('_') && !k.startsWith('W_') && !k.startsWith('映射') && typeof v !== 'object' && String(v).trim() !== '');
export function Shell({ name, Canvas }) {
  const [mode, setMode] = useState(DEMO ? 'demo' : 'loading'); // demo | loading | ws | offline
  const [wsData, setWsData] = useState(null);
  // >v<📌钉子-接入-临时翻阅组：服务端 .synapsis/pins.json 是真源（/ws 和每次保存的返回里都带 pins，节点改名时服务端已迁移）；界面每次操作整份 PUT /pins
  //   edit = 进操作历史（撤销 / 重做）；view = 只是折叠 / 设当前组，不进历史。PUT 还在路上时不采纳服务端回来的旧值
  const [pins, setPins] = useState(emptyPins), [pinsOpen, setPinsOpen] = useStash('pins.open', false);
  const pinsRef = useRef(pins), pinsInflight = useRef(0);
  const [rawHl, setRawHl] = useState(null), [fileHl, setFileHl] = useState(null), [pinAsk, setPinAsk] = useState(null); // 行钉子跳转后高亮的那一行（右栏原文 / 文件预览）、找不到时让人选的候选
  const setPinsDoc = doc => {
    pinsRef.current = doc; setPins(doc); pinsInflight.current++;
    api('/pins', { method: 'PUT', body: JSON.stringify(doc) }).catch(e => setSaveState('❌ 钉子没存上：' + e.message)).finally(() => { pinsInflight.current--; });
  };
  useEffect(() => {
    const h = wsData?.pins;
    if (!h || pinsInflight.current || JSON.stringify(h) === JSON.stringify(pinsRef.current)) return;
    pinsRef.current = h; setPins(h);
  }, [wsData]);
  const [saveState, setSaveState] = useState('');
  const lastSaved = useRef(null);
  const local = mode === 'demo' || mode === 'offline';
  const [text, setText] = useState(() => DEMO ? load('syn.text', SAMPLE) : '');
  const [scope, setScope] = useState(ROOT);
  const [selected, setSelected] = useState(null);
  const [positions, setPositions] = useState(() => DEMO ? load('syn.pos.' + name, {}) : {});
  const [localImages, setImages] = useState(() => load('syn.img2', {})); // id -> [dataURL]
  const [exportText, setExportText] = useState(null);
  // >v<🧭导航-视图记忆-每个范围各存平移+缩放；工作区模式存 <项目>/.synapsis/view.json（下次启动还原：各页视图、上次所在页、展开、左栏）
  // 每个范围各记一份视图（平移+缩放），返回上一级/再钻进来时还原
  const [viewports, setViewports] = useState(() => DEMO ? load('syn.vp.' + name, {}) : {});
  const [outlineGroup, setOutlineGroup] = useState(false); // 大纲分组视图（按连线分组，组内按流向排）
  const [agentPreset, setAgentPreset] = useState(null);
  const imgAt = useRef(null); // 空白处右键「AI 配图」点的位置（画布坐标）：生成的散图落这里
  // 👤 2026-10-20 配图在后台生成（服务端 runImgJobs）：轮询 /ai/images，做完一张就重读工作区（图出现在卡上），状态栏报剩几张。AI 框不用等，能接着聊、能关
  const imgWatch = useRef(null);
  const watchImages = seq0 => {
    if (imgWatch.current) return; let seq = seq0;
    const tick = () => api('/ai/images').then(async j => {
      if (j.seq !== seq) { seq = j.seq; setWsData(await api('/ws')); setPositions(p => ({ ...p, ...Object.fromEntries(Object.entries(j.layout || {}).filter(([k]) => k.startsWith('@pic:'))) })); }
      if (j.pending > 0) { setSaveState(`🎨 配图后台生成中：还剩 ${j.pending} 张（可以接着聊、关掉对话框）`); imgWatch.current = setTimeout(tick, 1500); }
      else { imgWatch.current = null; setSaveState(`🎨 配图好了：${j.made.length} 张` + (j.failed.length ? ' ⚠ ' + j.failed.join('；') + '（AI 下一轮会知道）' : '')); }
    }).catch(() => { imgWatch.current = setTimeout(tick, 3000); });
    imgWatch.current = setTimeout(tick, 1000);
  };
  useEffect(() => { if (mode === 'ws') api('/ai/images').then(j => j.pending > 0 && watchImages(j.seq - 1)).catch(() => {}); }, [mode]); // 窗口刷新 / 重开时还在生成 → 接着看
  const [outlineHere, setOutlineHere] = useState(0); // 大纲范围三态：0 完整 / 1 本节点和它上一层 / 2 只本节点里面（旧版存的 true = 2）
  const [multiIds, setMultiIds] = useState([]); // 多选（画布和大纲共用一组；≥2 个才算）
  const [outlineLock, setOutlineLock] = useState(null); // 🔒 大纲锁：{root, scope, selected}，锁住时列表不跟着导航换页 / 展开 / 滚动
  const [leftCols, setLeftCols] = useState(1); // 左栏内容（大纲树 / 文件树）排成 1 / 2 / 3 列；宽度自己拖
  const [leftHidden, setLeftHidden] = useState(() => DEMO ? load('syn.lh', false) : false);
  const [propsOpen, setPropsOpen] = useState(() => DEMO ? load('syn.po', true) : true);
  // >v<🧭导航-历史-Alt+A/D 后退前进，Alt+W 上一层
  // 导航历史：像浏览器一样 Alt+← / Alt+→
  const hist = useRef({ back: [], fwd: [] });
  const rmb = useRef({ down: false, used: false }); // 右键按着没（右键 + 侧键 组合）
  const taRef = useRef(null), findRef = useRef(null);
  // >v<🔭视图投影-原地展开-不钻进去也能看子级：卡片里列出子节点（▸N 点一下 / 2），双击子项跳进去并选中
  const [expanded, setExpanded] = useState(() => DEMO ? load('syn.exp', {}) : {});
  // >v<🎨画布-分组展开成框-分组变半透明底框，子节点画在框里、线直连（👤 2026-10-08「这个好！值得做！」）；框里的坐标 = 钻进分组那一页的坐标
  const [framed, setFramed] = useState(() => DEMO ? load('syn.frm', {}) : {});
  const toggleFrame = id => setFramed(x => ({ ...x, [id]: !x[id] }));
  const [panelW, setPanelW] = useState(() => DEMO ? load('syn.pw', { left: 280, right: 300 }) : { left: 280, right: 300 });
  // >v<🖼️图片-折叠与大小-每个节点的图可单独收起（视图状态，进 view.json）；宽度 picw 是设计数据，进节点 frontmatter
  const [picFold, setPicFold] = useState(() => DEMO ? load('syn.pf', {}) : {});
  const [textOpen, setTextOpen] = useState({}); // 卡片里展开正文的节点（记进 view.json）
  // >v<🖼️图片-灯箱-双击卡片里的图 / 散图 = 放大看；← → 切换，Esc / 点背景关
  const [lightbox, setLightbox] = useState(null); // {urls, i}
  cardActions.lightbox = (urls, i) => setLightbox({ urls, i });
  useEffect(() => {
    if (!lightbox) return;
    const k = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLightbox(null); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setLightbox(l => ({ ...l, i: (l.i + (e.key === 'ArrowRight' ? 1 : -1) + l.urls.length) % l.urls.length })); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [!!lightbox]);
  const [portalModes, setPortalModes] = useState({}); // 每页的传送门：show | fade | hide（记进 view.json）
  const [histOpen, setHistOpen] = useState(false), [histBusy, setHistBusy] = useState(false); // 操作历史栏（Shift+`；记进 view.json）
  const [seeLines, setSeeLines] = useState(false); // 看清连线：卡片变淡变小、连线更粗更亮（记进 view.json）
  // >v<🎨画布-展开竖栏-四种展开（子级 / 属性 / 正文 / 成框）各有「改」和「看」（👤 2026-10-10）：
  //   改 = 真改每个节点自己的展开状态（expanded / propsShut / textOpen / framed，进 Ctrl+Z）；
  //   看 = 本页临时盖一层：不接管 → 展开 → 收起 三态轮换，节点自己的状态不动，按页记（seeModes[页]），切页不继承
  const [propsShut, setPropsShut] = useState({}); // 卡片上人加的属性默认显示；收起的节点记在这（以前是全局开关 cardProps）
  const [seeModes, setSeeModes] = useState({}); // { 页: { kids|props|text|frame: 'on' | 'off' } }
  const [theme, setTheme] = useState(() => load('syn.theme', 'dark')); // 本机偏好，不跟项目走
  useEffect(() => { document.documentElement.dataset.theme = theme; save('syn.theme', theme); }, [theme]);
  const [localPicw, setLocalPicw] = useState(() => load('syn.pw', {}));
  const [renaming, setRenaming] = useState(null); // 大纲树里正在改名的节点
  const [bodyEdit, setBodyEdit] = useState(null); // 画布卡片里正在改正文的节点（👤 2026-10-16 右键「编辑正文」）
  const [canvasRename, setCanvasRename] = useState(null); // 画布卡片上正在改名的节点（👤 2026-10-08：跳到左栏改「太视觉跳跃」）
  const [localLoose, setLocalLoose] = useState(() => load('syn.loose', {})); // 样例模式的散图：scope -> [{id, url}]

  const graph = useMemo(() => parseOutline(text), [text]);
  const realScope = graph.nodes.has(scope) ? scope : ROOT;
  const hereMode = outlineHere === true ? 2 : +outlineHere || 0; // 大纲范围：0 完整 / 1 上一层 + 本节点 / 2 本节点
  const hereRoot = sc => hereMode === 2 ? sc : hereMode === 1 ? (graph.nodes.get(sc)?.parent ?? '') : '';
  useEffect(() => setMultiIds(m => { const k = m.filter(id => !id.startsWith('@')); return k.length === m.length ? m : k.length > 1 ? k : []; }), [realScope]); // 换页：传送门 / 散图的选择不跟过去（真节点的可以，大纲锁着时要从别的页拖过来）
  // >v<📐空间-界面-当前页是空间节点（有 axes:）→ 成员按 vec 投影到两根方向上（轴或成员方向 = 换基），拖动 = 改坐标
  const [spaceAxes, setSpaceAxes] = useState({}); // scope -> [x方向, y方向]（'#0' = 第 0 根轴，或成员 id）
  const getMeta = useCallback(id => wsData?.nodes[id]?.meta, [wsData]);
  const space = useMemo(() => graph.nodes.has(realScope) ? spaceInfo(graph, realScope, getMeta) : null, [graph, realScope, getMeta]);
  const plane = useMemo(() => {
    if (!space) return null;
    const keys = (spaceAxes[realScope] || ['#0', '#1']).map(k => k.startsWith('#') || space.members.some(m => m.id === k) ? k : '#0');
    const u = direction(space, keys[0]), v = direction(space, keys[1] ?? '#1');
    const pts = space.members.map(m => ({ id: m.id, x: dot(m.vec, u), y: dot(m.vec, v) }));
    const S = 260 / Math.max(1, ...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))); // 1 个单位多少像素：坐标都在 ±1 内就固定 260
    return { keys, u, v, S, pts, angle: angleDeg(u, v), labels: keys.map(k => directionLabel(space, k)) };
  }, [space, spaceAxes, realScope]);
  // >v<🎬时间轴-界面-当前页 timeline: true → 默认显示时间轴视图（V 切回画布，记在 view.json 的 tlOff）；拍点源只拿精简后的（服务端挑 beats / downbeats / phrases）
  const tl = useMemo(() => graph.nodes.has(realScope) ? timelineInfo(graph, realScope, getMeta) : null, [graph, realScope, getMeta]);
  const [tlOff, setTlOff] = useState({}); // scope -> true = 这一页看画布
  const [tlOpen, setTlOpen] = useState({}); // 时间轴页 / 时间轴卡 id -> [展开的段落 id…]（记 view.json）
  const tlToggle = (cid, gid) => setTlOpen(m => { const s = new Set(m[cid] || []); s.has(gid) ? s.delete(gid) : s.add(gid); return { ...m, [cid]: [...s] }; });
  const showTl = !!tl && !tlOff[realScope];
  const [beatsAt, setBeatsAt] = useState({}); // 拍点源路径 -> 精简后的拍点（null = 读不到）；时间轴页和画布上的时间轴卡共用
  const needBeats = src => { if (!src || mode !== 'ws' || src in beatsAt) return; setBeatsAt(m => ({ ...m, [src]: null }));
    api('/timeline/beats?p=' + encodeURIComponent(src)).then(d => setBeatsAt(m => ({ ...m, [src]: d }))).catch(e => setSaveState('⚠ 拍点读不到：' + e.message)); };
  useEffect(() => { needBeats(tl?.beats); }, [tl?.beats, mode]);
  const beats = tl?.beats ? { src: tl.beats, data: beatsAt[tl.beats] || null } : null;
  const tlFps = tl ? tl.fps ?? beats?.data?.fps ?? null : null;
  const tlInfoOf = useCallback(id => graph.nodes.has(id) ? timelineInfo(graph, id, getMeta) : null, [graph, getMeta]);
  const tlLead = tl && tlFps ? (parseTime(tl.lead) || 0) / tlFps : 0; // 页面 lead: N = 吸附时提前 N 帧（段落页跟上级）
  // 段落（👤 2026-10-24 定 A：时间由里面的镜头算）：拖段落 = 里面所有镜头一起挪 dt 秒（一步撤销）；上下拖 = 改段落自己的 track
  const tlShift = (gid, dt, track) => {
    const s = spanOf(graph, gid, getMeta), old = getMeta(gid) || {}, list = [];
    if (s && dt) for (const id of s.leaves) { const m = getMeta(id); list.push([id, { t0: String(round3(parseTime(m.t0) + dt)), t1: String(round3(parseTime(m.t1) + dt)) }]); }
    if (track !== undefined && String(track) !== String(old.track ?? 0)) list.push([gid, { track: track ? String(track) : null }]);
    saveMetas(list, { desc: `挪段落「${graph.nodes.get(gid)?.label}」` + (dt ? `${dt > 0 ? '+' : ''}${dt.toFixed(3)} 秒（${s.leaves.length} 段一起）` : '换轨') });
  };
  // 时间轴改 t0 / t1 / track：先改本地（不闪回），再走 saveMeta（进撤销栈）
  const tlCommit = (id, p) => {
    const old = getMeta(id) || {};
    const patch = { t0: String(p.t0), t1: String(p.t1), track: p.track ? String(p.track) : old.track != null ? '0' : null };
    if (patch.track === null) delete patch.track;
    setWsData(d => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id], meta: { ...d.nodes[id].meta, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) } } } }));
    saveMeta(id, patch);
  };
  // >v<🤖AI辅助-接入-LM Studio 状态 / 语义配色（core/ai.js）：连不上就当没有，什么都不挡
  const [aiStatus, setAiStatus] = useState(null), [aiOpen, setAiOpen] = useState(false), [semCols, setSemCols] = useState(null), [agentOpen, setAgentOpen] = useStash('agent.open', false); // AI 框开着关窗口，回来还开着
  const aiCheck = () => mode === 'ws' && api('/ai/status').then(setAiStatus).catch(() => setAiStatus({ ok: false, error: 'Synapsis 服务没回应' }));
  useEffect(() => { aiCheck(); }, [mode]);
  useEffect(() => {
    if (mode !== 'ws' || !aiStatus?.ok || !aiStatus.cfg?.semColors) { setSemCols(null); return; }
    const t = setTimeout(() => api('/ai/colors').then(d => setSemCols(d.colors)).catch(() => {}), 1200); // 改大纲时别每个字都问
    return () => clearTimeout(t);
  }, [mode, aiStatus, wsData?.outline, wsData?.colorWords]);
  const cWords = useMemo(() => ({ '': wsData?.colorWords ?? null, ...(wsData?.colorWordsAt || {}) }), [wsData?.colorWords, wsData?.colorWordsAt]), pWords = useMemo(() => ({ '': wsData?.patternWords ?? null, ...(wsData?.patternWordsAt || {}) }), [wsData?.patternWords, wsData?.patternWordsAt]); // 层级词表（👤 2026-10-11）：根 + 各分组自己的
  const cTables = useMemo(() => wordTables(cWords), [cWords]), pTables = useMemo(() => patternTables(pWords), [pWords]);
  const colors = useMemo(() => colorMap(graph, getMeta, cWords, semCols), [graph, getMeta, cWords, semCols]); // 👤 2026-10-12 颜色只看节点自己（不继承父级、不轮色，没命中 = 灰）；sat: 单独叠
  const [semPats, setSemPats] = useState(null);
  useEffect(() => {
    if (mode !== 'ws' || !aiStatus?.ok || !aiStatus.cfg?.semColors) { setSemPats(null); return; }
    const t = setTimeout(() => api('/ai/patterns').then(d => setSemPats(d.patterns)).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [mode, aiStatus, wsData?.outline, wsData?.patternWords]);
  const patterns = useMemo(() => patternMap(graph, getMeta, pWords, semPats), [graph, getMeta, pWords, semPats]);
  // 属性栏「词表」一行 + 「为什么是这个色 / 底纹」：上级 = 父级往上第一个有表的；本层 = 这个分组自己的（只有分组才有）
  const wordsInfo = id => {
    if (id == null || !graph.nodes.has(id) || id === ROOT) return null;
    const lab = sc => sc === ROOT ? '项目' : graph.nodes.get(sc)?.label || sc;
    const why = (tables, key, pick) => { const h = hierHit(graph, id, tables, pick); return h && !getMeta(id)?.[key] ? { word: h.word, from: h.from, fromLabel: lab(h.from) } : null; }; // 手动写了 color: / pattern: 就不显示「词：」
    // 👤 2026-10-12 颜色 + 图案合成一份 _词表.md：上级 = 父级往上第一个有 _词表.md 的层（项目那份总算有），本层 = 这个分组自己有没有
    const files = new Set(wsData?.wordsFiles || []); let up = ROOT;
    for (let a = graph.nodes.get(id)?.parent; a != null && a !== ROOT; a = graph.nodes.get(a)?.parent) if (files.has(a)) { up = a; break; }
    return { group: graph.nodes.get(id).children.length > 0, upper: { scope: up, label: lab(up) }, own: files.has(id), color: { why: why(cTables, 'color', r => r.color) }, pattern: { why: why(pTables, 'pattern', r => r.pattern) } };
  };
  // 边标签 / 节点副标题来自工作区文件（大纲里没有）
  const sm = seeModes[realScope] || {};
  const pre = (m, id) => m === 'deep' || (m === 'on' && (graph.nodes.get(id)?.parent ?? ROOT) === realScope); // 本页「看」盖一层：on = 只展开本页直接的节点；deep = 子孙也一起（Shift+数字）
  const eff = (m, own, id) => pre(m, id) ? true : own; // 没开 = 用节点自己的
  const uiId = id => isUi(wsData?.nodes[id]?.meta); // 👤 2026-10-10 UI 框不跟「预览展开」的全局三态，只认自己的 ▸ / ⊞
  // 👤 2026-10-11 预览「子级」临时盖过节点自己真展开的子图（不然真成框的节点在预览里看不到子级列表）；预览「子图」同时开着时子图优先；UI 框一样（👤：要联动，UI 框也得能看子级）
  const expE = id => eff(sm.kids, !!expanded[id], id), frmE = id => pre(sm.frame, id) || (!!framed[id] && !pre(sm.kids, id)), txtE = id => eff(sm.text, !!textOpen[id], id), prpE = id => eff(sm.props, !propsShut[id], id), picE = id => eff(sm.pics, !picFold[id], id); // 👤 2026-10-17 图片 = 第 5 种展开（5 / Shift+5）
  // 普通卡的手动大小（_layout.json 的 w / h）：只在大小变了时才让 view 重算（拖动坐标不触发）
  const sizeKey = useMemo(() => JSON.stringify(Object.entries(positions).filter(([k, v]) => !k.startsWith('@') && v?.w && v?.h).map(([k, v]) => [k, v.w, v.h])), [positions]);
  const sizes = useMemo(() => new Map(JSON.parse(sizeKey).map(([k, w, h]) => [k, { w, h }])), [sizeKey]);
  const view = useMemo(() => {
    // 🎬 时间轴卡：展开的 timeline 节点不摆子节点，整张卡就是一条时间轴（子节点画在卡里）
    const isCard = k => !space && frmE(k) && isTimeline(getMeta(k)) && graph.nodes.get(k)?.children.length > 0;
    const v0 = projectView(graph, realScope, space ? null : new Set([...graph.nodes.keys()].filter(k => graph.nodes.get(k)?.children.length && frmE(k) && !isCard(k))));
    const v = tlCardEdges(graph, v0, v0.nodes.filter(n => isCard(n.id)).map(n => n.id), id => timelineInfo(graph, id, getMeta), tlOpen);
    const lab = new Map((wsData?.edges || []).map(e => [e.from + '->' + e.to, e.label]));
    // >v<🔭视图投影-传送门三档-每页：显示 / 淡化 / 隐藏（👤 2026-10-08 待办第 5 条）；隐藏时和选中节点相连的传送门照样显示
    const pm = portalModes[realScope] || 'show';
    const keepPortal = new Set(v.portals.filter(p => p.id === selected || v.edges.some(e => (e.from === p.id && e.to === selected) || (e.to === p.id && e.from === selected))).map(p => p.id));
    const kind = new Map((wsData?.edges || []).map(e => [e.from + '->' + e.to, e.kind || '']));
    const colOf = id => colors.get(id.startsWith('@portal:') ? id.slice(8) : id) || PALETTE_IDLE;
    // 子级列表一行一个；Shift+2（kids = deep）= 全递进：子孙按层缩进一路列下去（👤 2026-10-11「递进就是全递进」，同 Shift+1）
    const kidRows = (ids, d) => ids.flatMap(c => { const k = graph.nodes.get(c), deep = sm.kids === 'deep' && k.children.length > 0; return [{ id: c, label: k.label, status: k.status, n: deep ? 0 : k.children.length, d, renaming: canvasRename === c }, ...(deep ? kidRows(k.children, d + 1) : [])]; });
    const pAxes = space ? space.axes : null; // 在空间页里，成员卡片的小横条用这一页的轴名
    // 空间 → 空间的边：源空间写了 映射→目标 就带上矩阵（画成热力图）
    const matOf = e => {
      if (e.count > 1) return null;
      const [from, to] = e.raw[0].split('->');
      const fm = getMeta(from), tm = getMeta(to);
      if (!isSpace(fm) || !isSpace(tm)) return null;
      const mp = mapsOf(fm).find(m => (resolveLabel(graph.nodes, from, m.ref) || m.ref) === to);
      return mp ? { W: mp.W, rows: parseAxes(tm.axes), cols: parseAxes(fm.axes) } : null;
    };
    return {
      ...v,
      nodes: v.nodes.map(n => ({
        ...n, color: colOf(n.id), pattern: PATTERNS[patterns.get(n.id)] || '', dropped: isDropped(graph, n.id), sub: wsData?.nodes[n.id]?.meta?.rate || '',
        evidence: wsData?.nodes[n.id]?.meta?.evidence || '',
        props: prpE(n.id) ? cardProps(wsData?.nodes[n.id]?.meta) : [], propN: cardProps(wsData?.nodes[n.id]?.meta).length,
        vec: getMeta(n.id)?.vec ? parseVec(getMeta(n.id).vec) : null, vecAxes: pAxes,
        spaceAxes: isSpace(getMeta(n.id)) ? parseAxes(getMeta(n.id).axes) : null,
        picw: +(wsData?.nodes[n.id]?.meta?.picw) || localPicw[n.id] || 0, foldPics: !picE(n.id), body: wsData?.nodes[n.id]?.body || '', file: wsData?.nodes[n.id]?.meta?.file || null, sw: sizes.get(n.id)?.w || 0, sh: sizes.get(n.id)?.h || 0, ui: isUi(wsData?.nodes[n.id]?.meta), tint: +(wsData?.nodes[n.id]?.meta?.tint) || 0, uiW: uiSize(wsData?.nodes[n.id]?.meta).w, uiH: uiSize(wsData?.nodes[n.id]?.meta).h, ref: wsData?.nodes[n.id]?.meta?.ref || null, refMissing: !!wsData?.nodes[n.id]?.meta?.ref && !graph.nodes.has(String(wsData.nodes[n.id].meta.ref)), textOpen: txtE(n.id),
        open: expE(n.id) && n.children.length > 0 && !v.parentOf.has(n.id) && !(frmE(n.id) && !space), renaming: canvasRename === n.id, editing: bodyEdit === n.id,
        tlCard: isCard(n.id), tlOpen: tlOpen[n.id] || null, tlRev: isCard(n.id) ? Object.values(beatsAt).filter(Boolean).length + '/' + selected : null, // 拍点到了 / 选中变了 → 卡重画
        framed: !space && frmE(n.id) && n.children.length > 0 && !isCard(n.id), seeDeep: sm.frame === 'deep', // 本页开着 Shift+1 递进预览（画布据此让 UI 框里的子图超出、不裁）
        tempFrame: !space && frmE(n.id) && !framed[n.id] && n.children.length > 0, realFramed: !!framed[n.id] && n.children.length > 0, // realFramed：节点自己真展开了（预览暂时盖掉时也是真） // 只是「看」临时展开的子图：不挪别的卡，也不存坐标
        frame: v.parentOf.get(n.id) ?? null,
        kids: kidRows(n.children, 0),
      })),
      portals: v.portals.filter(p => pm !== 'hide' || keepPortal.has(p.id)).map(p => ({ ...p, label: '↗ ' + (graph.nodes.get(p.target)?.label || p.target), color: colOf(p.id), dropped: isDropped(graph, p.target), faded: pm === 'fade' && !keepPortal.has(p.id) })), // 淡化时，和选中节点相连的也不淡（同隐藏）
      // 线 = 出发节点的颜色；kind 是「离散」→ 虚线（聚合的边要每条都离散才虚）
      edges: v.edges.filter(e => pm !== 'hide' || [e.from, e.to].every(x => !x.startsWith('@portal:') || keepPortal.has(x))).map(e => ({ ...e, fadedPortal: pm === 'fade' && [e.from, e.to].some(x => x.startsWith('@portal:') && !keepPortal.has(x)), text: e.count > 1 ? '×' + e.count : lab.get(e.raw[0]) || '', mat: matOf(e), color: colOf(e.from), dropped: [e.from, e.to].some(x => isDropped(graph, x.startsWith('@portal:') ? x.slice(8) : x)), dashed: e.raw.every(r => DISCRETE.test(kind.get(r) || '')), mod: e.raw.every(r => MOD.test(kind.get(r) || '')) })),
    };
  }, [graph, realScope, wsData, expanded, picFold, textOpen, localPicw, space, getMeta, colors, patterns, canvasRename, bodyEdit, framed, portalModes, selected, propsShut, seeModes, sizes, tlOpen, beatsAt]);
  // >v<🖼️图片-卡片显示-节点的 _pics_名字/ 里所有图（旧版 frontmatter img: 也认）
  const images = useMemo(() => {
    if (local) return localImages;
    const m = {}, url = p => withWs('/file?p=' + encodeURIComponent(p));
    for (const [id, n] of Object.entries(wsData?.nodes || {})) {
      const l = [...(n.meta.img ? [n.meta.img] : []), ...(n.pics || [])].map(url);
      if (l.length) m[id] = l;
    }
    return m;
  }, [local, localImages, wsData]);
  // >v<🖼️图片-散图显示-当前页 _pics/ 里不属于任何节点的图，画布上是独立的图块（id = @pic:路径）
  const loosePics = useMemo(() => {
    if (local) return localLoose[realScope] || [];
    return (wsData?.loose?.[realScope] || []).map(p => ({ id: '@pic:' + p, url: withWs('/file?p=' + encodeURIComponent(p)), path: p }));
  }, [local, localLoose, wsData, realScope]);

  // 启动：从工作区加载（含上次的视图）；失败 → 离线（localStorage）
  useEffect(() => {
    if (DEMO) return;
    Promise.all([api('/ws'), api('/ui/stash').catch(() => ({}))]).then(([d, stash]) => {
      const v = d.view || {};
      lastSaved.current = d.outline; setText(d.outline); setPositions(d.layout || {}); setWsData(d);
      hist2.current.committed = { text: d.outline, positions: d.layout || {} };
      // 页面刷新（开发服务重启、Ctrl+R）后接上撤销记录：只在文件和上次记下的一致时接（外面改过就不接，免得撤销盖掉别人的改动）
      // 撤销记录优先从服务进程的暂存取（关 vault 再从托盘打开也还在，退出托盘才没）；取不到再用 sessionStorage（刷新页面）
      const sv = stash?.[HIST_KEY] || (() => { try { return JSON.parse(sessionStorage.getItem(HIST_KEY)); } catch { return null; } })();
      if (sv?.committed?.text === d.outline) { hist2.current.undo = sv.undo || []; hist2.current.redo = sv.redo || []; }
      setViewports(v.viewports || {}); setExpanded(v.expanded || {}); setFramed(v.framed || {}); if (v.panelW) setPanelW(v.panelW); setPicFold(v.picFold || {}); setTextOpen(v.textOpen || {}); setPortalModes(v.portalModes || {}); setPropsShut(v.propsShut || {}); setLeftCols(+v.leftCols || 1); setOutlineHere(v.outlineHere === true ? 2 : +v.outlineHere || 0); setOutlineGroup(!!v.outlineGroup); setSeeModes(v.seeModes || {}); setSeeLines(!!v.seeLines); if (v.histOpen) setHistOpen(true); setLeftHidden(!!v.leftHidden); setPropsOpen(v.propsOpen ?? true); setSpaceAxes(v.spaceAxes || {}); setTlOff(v.tlOff || {}); setTlOpen(v.tlOpen || {}); if (v.scope) setScope(v.scope);
      api('/scaffold').then(s => { if (!s.mounted) setScaffold(s); }).catch(() => {}); // 👤 2026-10-12 没挂过 Synapsis 的文件夹：先问要建哪些
      setMode('ws'); setSaveState(d.errors.length ? '⚠️ 文件里有 ' + d.errors.length + ' 处解析错误（跑 check）' : '已加载');
      // .junk/ = 删除的临时去处，正常关窗口会清空；还有东西 = 上次没正常关闭（或 CLI / AI 删过东西）→ 问要不要清
      if (d.graveyard) setTimeout(() => {
        const mb = (d.graveyard.size / 1048576).toFixed(1);
        if (confirm(`__synapsis/.junk/ 里还有 ${d.graveyard.count} 项（${mb} MB）：可能上次托盘没正常退出，或者 CLI / AI 删过东西。撤销栈已经丢了，这些没法再 Ctrl+Z，只能手动去 .junk/ 里翻。

送进系统回收站清空吗？（取消 = 先留着，下次打开再问；以后在回收站里也找得到）`))
          api('/graveyard/clear', { method: 'POST' }).then(r => setSaveState(`已把 ${r.count} 项（${(r.size / 1048576).toFixed(1)} MB）送进系统回收站` + (r.left ? `，还剩 ${r.left} 项没成功` : ''))).catch(e => setSaveState('❌ ' + e.message));
      }, 400);
    }).catch(e => { setMode('offline'); setText(load('syn.text', SAMPLE)); setPositions(load('syn.pos.' + name, {})); setSaveState('⚠️ 没连上工作区（' + e.message + '），本地离线模式'); });
  }, []);
  // 自动保存：大纲停手 0.7s 且无错误 → 写回文件
  useEffect(() => {
    if (mode !== 'ws' || text === lastSaved.current) return;
    if (graph.errors.length) { setSaveState('大纲有错，暂不保存'); return; }
    const t = setTimeout(() => {
      setSaveState('保存中…');
      const hint = saveHint.current; saveHint.current = null;
      api('/outline', { method: 'PUT', body: JSON.stringify({ outline: text, ...(hint ? { hint } : {}) }) })
        .then(d => { lastSaved.current = text; setWsData(d); recordSave(text, d.report); setPositions(p => ({ ...p, ...Object.fromEntries(Object.entries(d.layout || {}).filter(([k]) => k.startsWith('@pic:') || !p[k])) })); /* 改名 / 搬家后坐标键会变：服务端迁好的新键补进来（已有的不覆盖）——不补的话刚改名的节点在这边没坐标，下一个新节点会叠到同一个空位（2026-10-10 UI 框里连建三个全在 (0,0)） */ const r = d.report; setSaveState('已保存 ' + new Date().toLocaleTimeString() + (r.removed.length ? '（' + r.removed.length + ' 项移进 .junk/）' : '')); })
        .catch(e => setSaveState('❌ 保存失败：' + e.message));
    }, 700);
    return () => clearTimeout(t);
  }, [text, mode]);
  const layout = useMemo(() => {
    // 顶层按当前页排；框里的子节点按「钻进那个分组」那一页排（坐标相对框，和钻进去看到的一样）
    const top = view.nodes.filter(n => !n.frame);
    const l = autoLayout({ ...view, nodes: top }, positions);
    for (const f of view.nodes.filter(n => n.framed)) {
      const kids = f.children;
      Object.assign(l, Object.fromEntries(Object.entries(autoLayout({ nodes: kids.map(id => ({ id })), edges: view.edges, portals: [] }, positions)).filter(([id]) => kids.includes(id))));
    }
    // 散图没坐标时排在节点右边一列
    const maxX = Math.max(0, ...Object.values(l).map(p => p.x));
    loosePics.forEach((p, i) => { l[p.id] = positions[p.id] || { x: maxX + 320, y: i * 240 }; });
    // 空间页：成员的位置 = 坐标投影（卡片中心对准那个点），不用存的坐标；没坐标的旁注排在左边
    if (plane) {
      for (const p of plane.pts) l[p.id] = { x: p.x * plane.S, y: -p.y * plane.S };
      space.loose.forEach((id, i) => { l[id] = positions[id] || { x: -plane.S - 420, y: -plane.S + i * 110 }; });
    }
    return l;
  }, [view, positions, loosePics, plane, space]);
  const inPlane = id => !!plane && plane.pts.some(p => p.id === id);
  // 自动排出来的位置立刻固定（存起来），之后加节点别的节点不会跟着跳（空间成员的位置由坐标决定，不存）
  useEffect(() => {
    const tmpFrames = new Set(view.nodes.filter(n => n.tempFrame).map(n => n.id)); // 「看」临时展开的子图里的节点：自动排的位置不存盘（看完就恢复原样，一个文件都不动）
    const missing = Object.fromEntries(Object.entries(layout).filter(([id]) => !positions[id] && !inPlane(id) && !tmpFrames.has(graph.nodes.get(id)?.parent)));
    if (Object.keys(missing).length) move(missing, { silent: true });
  }, [layout]);
  const sel = selected && (view.nodes.some(n => n.id === selected) || view.portals.some(p => p.id === selected) || loosePics.some(p => p.id === selected)) ? selected : null;
  const wordsScope = sel && !sel.startsWith('@') && graph.nodes.get(sel)?.children.length ? sel : realScope; // AI 起草词表给哪一层（选中分组 = 它，否则当前画布）
  // 👤 2026-10-10 属性栏：选中了看它；空白处（没选中）看当前进入的节点（根没有属性，不管）
  const propId = sel ? (!sel.startsWith('@') && graph.nodes.has(sel) ? sel : null) : (realScope !== ROOT ? realScope : null);

  useEffect(() => { if (local) save('syn.text', text); }, [text, local]);
  useEffect(() => { if (local) save('syn.pos.' + name, positions); }, [positions, name, local]);
  useEffect(() => save('syn.img2', localImages), [localImages]);
  useEffect(() => { if (local) save('syn.frm', framed); }, [framed, local]);
  useEffect(() => { if (local) save('syn.pw', panelW); }, [panelW, local]);
  useEffect(() => { if (local) { save('syn.vp.' + name, viewports); save('syn.exp', expanded); save('syn.lh', leftHidden); save('syn.pf', picFold); save('syn.po', propsOpen); } }, [viewports, expanded, leftHidden, picFold, propsOpen, name, local]);
  useEffect(() => save('syn.pw', localPicw), [localPicw]);
  useEffect(() => save('syn.loose', localLoose), [localLoose]);
  // 工作区：视图状态停手 0.6s 写进 .synapsis/view.json
  useEffect(() => {
    if (mode !== 'ws') return;
    const t = setTimeout(() => api('/view', { method: 'PUT', body: JSON.stringify({ viewports, expanded, framed, panelW, leftHidden, leftCols, outlineHere, outlineGroup, picFold, textOpen, portalModes, propsShut, seeModes, seeLines, histOpen, propsOpen, spaceAxes, tlOff, tlOpen, scope: realScope }) }).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [viewports, expanded, framed, panelW, leftHidden, leftCols, outlineHere, outlineGroup, picFold, textOpen, portalModes, propsShut, seeModes, seeLines, histOpen, propsOpen, spaceAxes, tlOff, tlOpen, realScope, mode]);
  const onViewport = useCallback((sc, vp) => setViewports(v => ({ ...v, [sc]: vp })), []);
  // 导航历史每一条 = { scope, sel }：后退 / 前进恢复离开那一页时选中的（👤 2026-10-12，像浏览器恢复滚动位置；离开时没选 = 不选）
  const go = useCallback(next => {
    if (next === realScope) return;
    hist.current.back.push({ scope: realScope, sel: selected }); hist.current.fwd = [];
    setScope(next);
  }, [realScope, selected]);
  const stepHist = (from, to) => { if (!from.length) return; to.push({ scope: realScope, sel: selected }); const e = from.pop(); setSelected(e.sel ?? null); setScope(e.scope); };
  const back = () => stepHist(hist.current.back, hist.current.fwd);
  const fwd = () => stepHist(hist.current.fwd, hist.current.back);

  const drill = useCallback(id => {
    if (id.startsWith('@portal:')) {
      const target = id.slice(8);
      go(graph.nodes.get(target).parent);
      setSelected(target);
    } else if (wsData?.nodes[id]?.meta?.ref && graph.nodes.has(String(wsData.nodes[id].meta.ref)) && !graph.nodes.get(id)?.children.length) { // ↗ 传送门卡片：双击 = 跳到它指的节点（去它那一页并选中）
      const target = String(wsData.nodes[id].meta.ref); go(graph.nodes.get(target).parent); setSelected(target);
    } else if (wsData?.nodes[id]?.meta?.file && !graph.nodes.get(id)?.children.length) { setSelected(id); openFile(wsData.nodes[id].meta.file); } // 引用外部文件的叶子：双击 = 打开那个文件（钻进去没东西可看）
    else { go(id); setSelected(null); }
  }, [graph, go, wsData]);
  // 上一层：快捷键（Alt+W / 右键 + 侧键后）回去后选中刚才那个节点（👤 2026-10-12：接着 Alt+S 就能钻回去）；菜单里点的不选
  const up = (pick = true) => { const p = graph.nodes.get(realScope).parent; if (p !== null) { setSelected(pick ? realScope : null); go(p); } };
  const connect = useCallback((from, to, mod) => {
    const resolve = id => id.startsWith('@portal:') ? id.slice(8) : id;
    if (mod && mode === 'ws') { // 拖的是调节口：连线 + 写 kind 调节（一个请求做完）
      api('/link', { method: 'POST', body: JSON.stringify({ from: resolve(from), to: resolve(to), kind: '调节' }) })
        .then(d => { lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report); setSaveState('已连调节线：' + graph.nodes.get(resolve(from))?.label + ' ◆→ ' + graph.nodes.get(resolve(to))?.label); })
        .catch(e => setSaveState('❌ ' + e.message));
      return;
    }
    const t = withEdge(graph, resolve(from), resolve(to));
    if (t) setText(t);
  }, [graph, mode]);
  // 属性面板里点边的类型：普通 → 调节 → 离散 → 普通
  const cycleKind = (from, to, label, kind) => {
    const next = MOD.test(kind) ? '离散' : DISCRETE.test(kind) ? '' : '调节';
    api('/edge', { method: 'PATCH', body: JSON.stringify({ from, to, label, kind: next }) }).then(d => { setWsData(d); setSaveState('边的类型：' + (next || '普通')); }).catch(e => setSaveState('❌ ' + e.message));
  };
  const move = useCallback((changes, opt = {}) => {
    // 空间页里拖成员 = 改它的 vec（只改投影的那两个方向上的分量），乐观更新后写回 frontmatter
    if (plane) {
      const vecs = {};
      for (const [id, pos] of Object.entries(changes)) {
        const m = space.members.find(x => x.id === id);
        if (m && pos.x !== undefined) vecs[id] = fmtVec(moveInPlane(m.vec, plane.u, plane.v, pos.x / plane.S, -pos.y / plane.S));
      }
      if (Object.keys(vecs).length) {
        setWsData(d => ({ ...d, nodes: { ...d.nodes, ...Object.fromEntries(Object.entries(vecs).map(([id, vec]) => [id, { ...d.nodes[id], meta: { ...d.nodes[id].meta, vec } }])) } }));
        Promise.all(Object.entries(vecs).map(([id, vec]) => api('/node', { method: 'PATCH', body: JSON.stringify({ id, meta: { vec } }) })))
          .then(r => { setWsData(r[r.length - 1]); setSaveState('坐标已改 ' + Object.entries(vecs).map(([id, v]) => graph.nodes.get(id)?.label + ' = (' + v + ')').join('；')); })
          .catch(e => setSaveState('❌ 坐标保存失败：' + e.message));
        changes = Object.fromEntries(Object.entries(changes).filter(([id]) => !vecs[id]));
        if (!Object.keys(changes).length) return;
      }
    }
    if (!opt.silent) recordMove(changes);
    setPositions(p => { const q = { ...p }; for (const [k, v] of Object.entries(changes)) q[k] = { ...p[k], ...v }; return q; }); // 按键合并：散图的 w 和 x/y 分开更新
    if (mode === 'ws') api('/layout', { method: 'PUT', body: JSON.stringify({ positions: changes }) }).catch(e => setSaveState('❌ 坐标保存失败：' + e.message));
  }, [mode, plane, space, graph]);

  // >v<🧭导航-撤销重做-Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y）：一步 = 一次大纲保存（增删改名、状态、连线）或一次拖动 / 框选缩放。
  // 撤销删除 = 先把 .junk/ 里的文件搬回原处，再写回删除前的大纲（正文、属性、图片都在）。
  // 属性 / 正文编辑（含颜色、图案）也在撤销栈里（op 条目，见 saveMeta / saveBody）；不在撤销范围：空间页拖动改 vec。只在工作区模式。
  const hist2 = useRef({ undo: [], redo: [], committed: null, applying: false });
  const [histTick, setHistTick] = useState(0); // 历史栏跟着刷新
  const histT = useRef(null);
  const persistHist = () => {
    setHistTick(x => x + 1); const h = hist2.current;
    const snap = { undo: h.undo.slice(-50), redo: h.redo.slice(-50), committed: h.committed };
    try { sessionStorage.setItem(HIST_KEY, JSON.stringify(snap)); } catch { /* 配额满：只是刷新后接不上 */ }
    clearTimeout(histT.current); histT.current = setTimeout(() => putStash({ [HIST_KEY]: snap }), 300); // 同时存服务进程内存：关 vault 窗口再打开还能撤销
  };
  const recordSave = (t, report) => {
    const h = hist2.current, c = h.committed;
    if (!c) return;
    if (h.applying) { h.applying = false; if (report.restore?.length && h.undo.length) h.undo.at(-1).restore = report.restore; } // 重做了一次删除：撤销它要搬回的是这次的文件
    else if (c.text !== t) { h.undo.push({ text: c.text, positions: c.positions, restore: report.restore?.length ? report.restore : null, hint: report.moveMap?.length ? report.moveMap : null, desc: describeChange(c.text, t, report).desc, t: Date.now() }); h.redo = []; }
    h.committed = { text: t, positions: c.positions };
    persistHist();
  };
  const recordMove = changes => {
    const h = hist2.current, c = h.committed;
    if (!c || h.applying) return;
    const n = Object.keys(changes).length;
    h.undo.push({ text: c.text, positions: c.positions, restore: null, desc: n === 1 ? '拖动 ' + (graph.nodes.get(Object.keys(changes)[0])?.label || '图片') : `拖动 / 排列 ${n} 张卡`, t: Date.now() }); h.redo = [];
    const p = { ...c.positions };
    for (const [k, v] of Object.entries(changes)) p[k] = { ...p[k], ...v };
    h.committed = { text: c.text, positions: p };
    persistHist();
  };
  // 撤销 / 重做「移动节点」：把新旧 id 的对应带给服务端（hint = [要写成的 id, 现在的 id]…），不靠名字猜
  const saveHint = useRef(null);
  const flip = hint => hint ? hint.map(([a, b]) => [b, a]) : null;
  const applyHist = async e => {
    const h = hist2.current, c = h.committed;
    saveHint.current = e.hint || null;
    h.lost = 0;
    if (e.restore?.length) await api('/restore', { method: 'POST', body: JSON.stringify({ pairs: e.restore }) }).then(r => { h.lost = e.restore.length - (r.restored?.length || 0); }).catch(err => setSaveState('❌ 撤销删除失败：' + err.message));
    h.applying = e.text !== lastSaved.current;
    setText(e.text);
    const diff = Object.fromEntries(Object.entries(e.positions).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(c.positions[k])).map(([k, v]) => [k, { w: null, h: null, ...v }])); // 没有 w / h = 回到自动：服务端按键合并，要明说 null
    if (Object.keys(diff).length) {
      setPositions(p => ({ ...p, ...diff }));
      api('/layout', { method: 'PUT', body: JSON.stringify({ positions: diff }) }).catch(() => {});
    }
    h.committed = { text: e.text, positions: e.positions };
    persistHist();
  };
  const undo = () => {
    const h = hist2.current;
    if (mode !== 'ws' || !h.committed) return setSaveState('撤销只在工作区模式');
    const e = h.undo.pop(); if (!e) return setSaveState('没有可撤销的');
    if (e.op) { h.redo.push(e); persistHist(); return applyOp(e, 'undo').then(() => setSaveState('已撤销' + ({ meta: '属性修改', pins: '钉子操作', vs: '展开状态', pics: e.desc }[e.op] || '正文修改') + ' · 还能撤 ' + h.undo.length + ' 步')); }
    h.redo.push({ text: h.committed.text, positions: h.committed.positions, hint: flip(e.hint), desc: e.desc, t: e.t });
    return applyHist(e).then(() => setSaveState(h.lost > 0 ? `⚠ 已撤销，但有 ${h.lost} 项没能从 .junk/ 搬回来（已被清理，或原位置有同名文件）：那部分的正文 / 图片找不回，去系统回收站看看 · 还能撤 ${h.undo.length} 步` : '已撤销' + (e.restore ? '（删掉的节点从 .junk/ 搬回来了）' : '') + ' · 还能撤 ' + h.undo.length + ' 步'));
  };
  const redo = () => {
    const h = hist2.current;
    if (mode !== 'ws' || !h.committed) return;
    const e = h.redo.pop(); if (!e) return setSaveState('没有可重做的');
    if (e.op) { h.undo.push(e); persistHist(); return applyOp(e, 'redo').then(() => setSaveState('已重做')); }
    h.undo.push({ text: h.committed.text, positions: h.committed.positions, restore: null, hint: flip(e.hint), desc: e.desc, t: e.t });
    return applyHist(e).then(() => setSaveState('已重做'));
  };
  // 历史栏点一行：连续撤销（steps < 0）/ 重做（steps > 0）到那一步；一步一步等上一步落地
  const jumpHist = async steps => {
    setHistBusy(true);
    try { for (let i = 0; i < Math.abs(steps); i++) await (steps < 0 ? undo() : redo()); }
    finally { setHistBusy(false); }
    setSaveState(steps < 0 ? `已撤销 ${-steps} 步（历史栏）` : `已重做 ${steps} 步（历史栏）`);
  };
  // >v<🌳大纲模型-新建节点-Enter 同级 / Tab 子级（父节点原地展开）/ 工具栏＋；建完光标跳到大纲那一行、名字选中，直接打字改名
  const pendingRename = useRef(null);
  const addNode = asChild => {
    const s = sel && !sel.startsWith('@') ? sel : null;
    const parent = s && asChild ? s : s ? graph.nodes.get(s).parent : realScope;
    const r = withNode(graph, parent, asChild ? null : s);
    pendingRename.current = r.id;
    setText(r.text);
    if (asChild) { if (uiId(s)) setFramed(x => ({ ...x, [s]: true })); else setExpanded(x => ({ ...x, [s]: true })); } else setSelected(r.id);
  };
  useEffect(() => {
    const id = pendingRename.current;
    if (!id || !graph.nodes.has(id)) return;
    pendingRename.current = null;
    focusLabel(id);
  }, [graph]);
  // 大纲里选中某节点的名字（改名 = 直接打字）
  const focusLabel = (id, again) => {
    // 改名：卡片在画布上（或在展开的子级列表里）→ 就地输入；否则在大纲树里原地出输入框；「文本」页里则选中那一行的名字
    const p = graph.nodes.get(id)?.parent;
    if (view.nodes.some(n => n.id === id) || (p != null && expE(p) && view.nodes.some(n => n.id === p))) { setCanvasRename(id); return; }
    if (leftHidden) setLeftHidden(false);
    if (leftTab !== 'text') { if (leftTab === 'files') setLeftTab('outline'); setRenaming(id); return; }
    if (leftHidden && !again) { requestAnimationFrame(() => focusLabel(id, true)); return; }
    const ta = taRef.current, line = lineOf(graph, id);
    if (!ta || line < 0) return;
    const lines = text.split('\n');
    const start = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
    const lab = graph.nodes.get(id).label, at = lines[line].indexOf(lab);
    ta.focus();
    ta.setSelectionRange(start + at, start + at + lab.length);
    // 让选中的那行滚到可见处
    ta.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(ta).lineHeight) - ta.clientHeight / 2);
  };

  // >v<🎨画布-右键菜单-动作：删除（工作区里 = 移进 .junk/）、改状态、改名、属性
  const [menu, setMenu] = useState(null);       // {x, y, id|null}
  // >v<🎨画布-属性面板-默认开着（👤：点了节点总要看概览）；「概览 / 原文」两页，看原文不再顶掉属性
  const [bodyMode, setBodyMode] = useStash('body.mode', 'live'); // 右栏正文：live 实时预览 | src 全部源码（Ctrl+E；👤 2026-10-17 顶替「原文」页签；旧的 prev 当 live）
  const [rawText, setRawText] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // >v<🔎搜索-接入-Ctrl+F 跳过去（换页 + 选中 + 居中）；L / 右键「连线到…」= 选目标连线（可以连到别的页，那头会变成传送门）
  const [finder, setFinder] = useState(null); // {mode: 'go' | 'link', from?}
  const searchItems = useMemo(() => [...graph.nodes.values()].filter(n => n.id !== ROOT).map(n => ({ id: n.id, label: n.label, path: n.id, here: n.parent === realScope, meta: wsData?.nodes[n.id]?.meta, body: wsData?.nodes[n.id]?.body })), [graph, wsData, realScope]);
  const jumpTo = id => {
    const p = graph.nodes.get(id)?.parent;
    if (p == null) return;
    if (p !== realScope && !(frmE(p) && view.nodes.some(n => n.id === id))) go(p);
    setSelected(id); setPropsOpen(true);
    // 等画布把这张卡画出来再居中（以前固定等 400ms + 300ms 动画，跳转显得拖）：同一页立刻就成，换页一般 1~2 帧
    const center = (n = 0) => { if (n > 30 || cardActions.centerOn?.(id, n >= 15)) return; setTimeout(() => center(n + 1), 30); };
    center();
  };
  // >v<🎨画布-改接连线-Alt 拖连线一端：放到别的节点 = 改接（标签 / 类型跟过去），放到空白 = 删除，拖的时候右键 / Esc = 取消（👤 2026-10-08）
  const rewire = (from, to, nf, nt) => {
    const resolve = id => id.startsWith('@portal:') ? id.slice(8) : id;
    nf = resolve(nf); nt = resolve(nt);
    if (nf === from && nt === to) return;
    if (mode === 'ws') {
      api('/rewire', { method: 'POST', body: JSON.stringify({ from, to, nf, nt }) })
        .then(d => { lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report); setSaveState('已改接：' + graph.nodes.get(nf)?.label + ' → ' + graph.nodes.get(nt)?.label + '（Ctrl+Z 撤销）'); })
        .catch(e => setSaveState('❌ ' + e.message));
      return;
    }
    const t1 = withoutEdge(graph, from, to), t2 = t1 && withEdge(parseOutline(t1), nf, nt);
    if (t2) setText(t2);
  };
  // >v<🎨画布-删连线-右键连线 / 属性面板 ✕（👤 2026-10-08「没法取消连线」）；聚合的线 = 删掉里面每一条
  const removeEdges = pairs => {
    let g = graph, t = null;
    for (const [from, to] of pairs) { const x = withoutEdge(g, from, to); if (x) { t = x; g = parseOutline(x); } }
    if (t) { setText(t); setSaveState('已删除连线' + (pairs.length > 1 ? ' ' + pairs.length + ' 条' : '') + '（Ctrl+Z 撤销）'); }
  };
  const [scaffold, setScaffold] = useState(null); // 「📄 项目文件…」对话框：检测结果（没挂过的文件夹打开时自动弹）
  const [leftTab, setLeftTab] = useState('outline'); // outline（树，导航用）| text（原始大纲文本）| files
  // >v<🌳大纲模型-大纲树-点一下 = 画布跳到那一页并选中、右侧显示内容；双击 / Enter = 改名；钻进用 ▸
  const pick = id => {
    const n = graph.nodes.get(id); if (!n) return;
    setMultiIds([]);
    if (n.parent !== realScope) go(n.parent);
    setSelected(id); setPropsOpen(true);
  };
  const commitRename = (id, label) => {
    setRenaming(null); setCanvasRename(null);
    const t = withLabel(graph, id, label);
    if (!t) return;
    setText(t);
    const p = graph.nodes.get(id).parent, nid = p === ROOT ? label.trim() : p + '/' + label.trim();
    setSelected(nid);
    // 还没存盘就改名的新节点：坐标是按临时 id 记的，带到新 id 上（否则落回自动布局的空槽）
    if (positions[id] && !positions[nid]) move({ [nid]: { x: positions[id].x, y: positions[id].y } }, { silent: true });
  };
  const [tree, setTree] = useState(null);
  const [fileView, setFileView] = useState(null); // {path, text|null, note, error}
  const remove = id => {
    if (id?.startsWith('@pic:')) { // 散图：进 .junk/
      if (local) setLocalLoose(m => ({ ...m, [realScope]: (m[realScope] || []).filter(p => p.id !== id) }));
      else { const at = positions[id]; api('/loose-remove', { method: 'POST', body: JSON.stringify({ path: id.slice(5) }) }).then(r => { pushOp({ op: 'pics', del: true, paths: [id.slice(5)], pairs: [r.pair], layout: r.pair[2] ? { [id]: r.pair[2] } : at ? { [id]: at } : null, desc: '删除散图' }); return api('/ws'); }).then(setWsData).catch(e => setSaveState('❌ ' + e.message)); }
      setSelected(null); setSaveState('已删除散图' + (local ? '' : '（移进 .junk/，Ctrl+Z 撤销）'));
      return;
    }
    const n = graph.nodes.get(id);
    if (!n || id.startsWith('@portal:')) return;
    let k = 0; const cnt = x => { for (const c of graph.nodes.get(x).children) { k++; cnt(c); } }; cnt(id);
    if (k && !confirm(`删除「${n.label}」和它下面 ${k} 个子孙？${mode === 'ws' ? '\n（文件先移进 __synapsis/.junk/（关窗口才清），期间 Ctrl+Z 能撤）' : ''}`)) return;
    setText(withoutNode(graph, id));
    if (sel === id) setSelected(null);
    setSaveState(`已删除「${n.label}」` + (mode === 'ws' ? '（移进 .junk/）' : ''));
  };
  const setStatus = (id, s) => setText(withStatus(graph, id, s));
  const menuActions = {
    props: id => { setSelected(id); setPropsOpen(true); },
    rename: id => focusLabel(id),
    ...(mode === 'ws' ? { editBody: id => cardActions.editBody(id) } : {}),
    status: setStatus,
    addChild: id => { setSelected(id); const r = withNode(graph, id, null); pendingRename.current = r.id; setText(r.text); if (uiId(id)) setFramed(x => ({ ...x, [id]: true })); else setExpanded(x => ({ ...x, [id]: true })); }, // UI 框加子节点 → 展开成子图（不是子列表）
    addSibling: id => { const r = withNode(graph, graph.nodes.get(id).parent, id); pendingRename.current = r.id; setText(r.text); setSelected(r.id); },
    addUiHere: async () => { // 空白处右键 → 新建 UI 框：放在右键点的位置
      try {
        const d = await api('/addui', { method: 'POST', body: JSON.stringify({ parent: realScope }) });
        pendingRename.current = d.id; lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
        const p = menu && cardActions.toFlow ? cardActions.toFlow({ x: menu.x, y: menu.y }) : null;
        if (p) move({ [d.id]: { x: Math.round(p.x), y: Math.round(p.y) } }, { silent: true });
        setFramed(f => ({ ...f, [d.id]: true })); // 新建的 UI 框默认展开子图（里面还没东西，所以先不大）
        setSelected(d.id); setSaveState('已新建 UI 框（拖右下角调大小；双击标题钻进去里面摆小框；Ctrl+Z 撤销）');
        setTimeout(() => { const el = document.querySelector('.react-flow__node[data-id="' + CSS.escape(d.id) + '"] .uibox'), r = el?.getBoundingClientRect(); if (r && (r.right > innerWidth - 20 || r.bottom > innerHeight - 20)) cardActions.centerOn?.(d.id, true); }, 400); // 框比较大，落在屏幕边上看不全 → 移到视野里
      } catch (e) { setSaveState('❌ 新建 UI 框失败：' + e.message); }
    },
    // 👤 2026-10-17 右键「AI 配图…」：打开 AI 框写好半句话，人补上画什么再 Enter（生成花钱，确认后才调）。空白处 = 散图落在右键点的位置；卡片上 = 图进那张卡
    ...(mode === 'ws' ? {
      aiImageHere: () => {
        imgAt.current = menu && cardActions.toFlow ? cardActions.toFlow({ x: menu.x, y: menu.y }) : null;
        setAgentPreset({ text: '在这里画一张（散图，不归给卡片）：', n: Date.now() }); setAgentOpen(true);
      },
      aiImage: id => {
        imgAt.current = null; setSelected(id);
        setAgentPreset({ text: '给「' + (graph.nodes.get(id)?.label || id) + '」配一张图：', n: Date.now() }); setAgentOpen(true);
      },
      // 🎞 从视频截帧（👤 2026-10-24）：选一个本机视频 → 弹窗里停在想要的时刻截一帧
      frameHere: () => pickVideo(null, menu && cardActions.toFlow ? cardActions.toFlow({ x: menu.x, y: menu.y }) : null),
      frameFor: id => pickVideo(id, null),
    } : {}),
    copyUiLayout: id => { // 右键 UI 框 → 复制 UI 布局：选中了好几个就一起；每个 UI 节点带四角位置，普通节点带名字和正文
      const ids = cardActions.multi?.length && cardActions.multi.includes(id) ? cardActions.multi : [id];
      const nodes = wsData?.nodes || {}, meta = Object.fromEntries(Object.entries(nodes).map(([k, n]) => [k, n.meta || {}])), body = Object.fromEntries(Object.entries(nodes).map(([k, n]) => [k, n.body || '']));
      const t = uiLayoutText(graph, meta, body, { ...positions, ...layout }, ids);
      if (!t) return setSaveState('选中的里面没有 UI 框');
      navigator.clipboard?.writeText(t).then(() => setSaveState('已复制 UI 布局（' + t.split('\n').length + ' 行）：贴给 LLM 就行'), () => setSaveState('❌ 复制失败：浏览器没给剪贴板权限'));
    },
    addHere: () => {
      const r = withNode(graph, realScope, null); pendingRename.current = r.id; setText(r.text); setSelected(r.id);
      // 放在右键点的位置（👤 2026-10-08：以前落到自动布局的空槽里）
      const p = menu && cardActions.toFlow ? cardActions.toFlow({ x: menu.x, y: menu.y }) : null;
      if (p) move({ [r.id]: { x: Math.round(p.x), y: Math.round(p.y) } }, { silent: true });
    },
    toggle: id => toggle(id), drill: id => drill(id), remove, frame: id => toggleFrame(id), isFramed: id => !!framed[id],
    // 右键「展开 ▸」二级菜单：这个节点能展开的几种，及各自现在是展开还是收起（点一下 = 翻转它自己的状态，和 2 / 点卡片 ▸N 一样不进历史）
    openProjectFile: p => openFile(p), pickFile: () => setFinder({ mode: 'import' }), gotoRef: id => { const t = String(wsData?.nodes[id]?.meta?.ref || ''); if (graph.nodes.has(t)) { go(graph.nodes.get(t).parent); setSelected(t); } },
    expAll: () => Object.entries(EXP).map(([k, E]) => ({ k, name: E.name, any: expAnyOpen(k), none: !expIds(k).length })),
    expChange: k => expChange(k),
    expToggle: (id, k) => { const flip = x => { const y = { ...x }; if (y[id]) delete y[id]; else y[id] = true; return y; }; ({ kids: setExpanded, props: setPropsShut, text: setTextOpen, frame: setFramed, pics: setPicFold })[k](flip); },
    hasFile: id => !!nodeFile(id),
    openMd: id => { setSelected(id); setPropsOpen(true); setBodyMode('src'); },
    reveal: id => reveal(nodeFile(id), 'select'),
    linkTo: id => setFinder({ mode: 'link', from: id }),
    linkFrom: id => setFinder({ mode: 'linkfrom', to: id }), // 从另一个节点连到这个：和「连线到…」同一个弹窗，反过来连
    // 📌 右键 → 钉到…：右键的节点在多选里就一起钉；当前组（高亮）排第一，最好点到
    pinsSelMenu: mode === 'ws' ? sel => { const d = pinsRef.current, cur = d.groups.find(g => g.id === d.current) || null; return { cur, others: d.groups.filter(g => g !== cur), pin: gid => pinSelection(sel, gid) }; } : null,
    pinsMenu: mode === 'ws' ? id => {
      const d = pinsRef.current, cur = d.groups.find(g => g.id === d.current) || null, m = cardActions.multi;
      const ids = (m?.length > 1 && m.includes(id) ? m : [id]).filter(x => !x.startsWith('@'));
      return { cur, others: d.groups.filter(g => g !== cur), n: ids.length, pin: gid => pinNodes(ids, gid) };
    } : null,
    removeEdges: ids => removeEdges(ids),
    edgeKind: (from, to) => { const e = (wsData?.edges || []).find(x => x.from === from && x.to === to); if (e) cycleKind(from, to, e.label || '', e.kind || ''); },
    canEdgeKind: mode === 'ws',
    pasteHint: id => { setSelected(id); setSaveState('选中了「' + graph.nodes.get(id).label + '」：现在 Ctrl+V 贴图'); },
    // 👤 2026-10-17 右键「贴图」= 弹文件选择框（卡片上 = 图进这张卡；空白处 = 散图落在右键点的位置）；卡片上还能替换 / 删掉已有的图
    pickImages: id => { setSelected(id); pickFiles(srcs => addImages(id, srcs)); },
    pickImagesHere: () => { const at = menu && cardActions.toFlow ? cardActions.toFlow({ x: menu.x, y: menu.y }) : null; pickFiles(srcs => addImages(null, srcs, at)); },
    ...(mode === 'ws' ? {
      removePic: (id, url) => removeCardPics(id, [url]),
      replacePic: (id, url) => pickFiles(async srcs => { await addImages(id, srcs.slice(0, 1)); await removeCardPics(id, [url], '替换'); }),
    } : {}),
    up: () => up(false), canUp: realScope !== ROOT,
    // 只有 👤 在这里点了才写 color:；「自动」= 删掉 color:，回到按分组 / 关键词自动配色
    color: mode === 'ws' ? (id, c) => saveMeta(id, { color: c }) : null,
    // 饱和度：单独的 sat:（👤 2026-10-12 不把自动色变手动）；旧的「色/50」写法顺手拆回底色
    tint: mode === 'ws' ? (id, t) => saveMeta(id, { tint: t ? String(t) : null }) : null, // 框内浓度：0 = 跟随 ⚙ 外观
    sat: mode === 'ws' ? (id, p) => { const c = getMeta(id)?.color, patch = { sat: p === 100 ? null : String(p) }; if (c && String(c).includes('/')) patch.color = String(c).split('/')[0]; saveMeta(id, patch); } : null,
    pattern: mode === 'ws' ? (id, p) => saveMeta(id, { pattern: p }) : null,
    // 右键「转为 ▸」：普通节点 ⇄ UI 框（👤 2026-10-11 常建错）。只动 ui / w / h（进 Ctrl+Z）；转成 UI 框且有子级 → 展开成子图（UI 框默认那样）
    convert: mode === 'ws' ? (id, to) => { const m = wsData?.nodes[id]?.meta || {}; if (to === 'ui') { saveMeta(id, { ui: 'true', w: m.w || '220', h: m.h || '140' }); if (graph.nodes.get(id)?.children.length) setFramed(x => ({ ...x, [id]: true })); } else saveMeta(id, { ui: null, w: null, h: null }); } : null,
    // 打开某一层的 _词表.md（scope = 分组 id，'' = 项目那份；没有就建）
    words: mode === 'ws' ? (scope = '') => api('/words', { method: 'POST', body: JSON.stringify({ scope }) }).then(d => { reveal(d.file, 'open'); api('/ws').then(setWsData).catch(() => {}); setSaveState('词表：' + d.file + '（改完保存，Synapsis 会自动刷新）'); }).catch(e => setSaveState('❌ ' + e.message)) : null,
    toggleAll: () => setExpanded(x => { const y = { ...x }; for (const n of view.nodes) if (n.children.length) y[n.id] = !allOpen; return y; }),
  };
  const onEdgeMenu = useCallback((edgeId, x, y) => { const e = view.edges.find(q => q.id === edgeId); if (e) setMenu({ edge: e, x, y }); }, [view]);
  const onContextMenu = useCallback((id, x, y) => { if (id && !id.startsWith('@')) setSelected(id); setMenu({ id: id && !id.startsWith('@') ? id : null, x, y }); }, []);
  // 文件页：切过去时取文件树；点文件 → 右侧预览
  useEffect(() => { if (leftTab === 'files' && mode === 'ws' && !tree) api('/tree').then(setTree).catch(e => setTree({ tree: [], error: e.message })); }, [leftTab, mode]);
  const openFile = p => { setFileView({ path: p }); api('/raw?p=' + encodeURIComponent(p)).then(setFileView).catch(e => setFileView({ path: p, error: e.message })); };
  // >v<🗂️外部区-节点md-节点 ⇄ 文件：右键/属性面板「看 md 原文」「在资源管理器显示」「默认程序打开」；文件树点节点 md → 画布跳过去选中
  const nodeFile = id => wsData?.nodes[id]?.file;
  const reveal = (p, how) => api('/reveal', { method: 'POST', body: JSON.stringify({ p, how }) }).catch(e => setSaveState('❌ ' + e.message));
  const fileToNode = useMemo(() => new Map(Object.entries(wsData?.nodes || {}).map(([id, n]) => [n.file, id])), [wsData]);
  // 文件树：节点 md → 画布跳过去 + 属性面板「原文」页；其它文件 → 旁边开预览（属性面板不动）
  const onTreeOpen = p => {
    const id = fileToNode.get(p);
    if (id && graph.nodes.has(id)) { pick(id); setPropsOpen(true); setBodyMode('src'); } else openFile(p);
  };
  // 右栏正文用的 md 原文（源码模式显示 frontmatter、算正文从第几行起；文件变了跟着刷新）
  useEffect(() => {
    if (!propsOpen || !propId || !nodeFile(propId)) { setRawText(null); return; }
    const p = nodeFile(propId);
    api('/raw?p=' + encodeURIComponent(p)).then(r => setRawText({ p, text: r.text ?? '' })).catch(() => setRawText(null)); // 记着是哪个文件的：切了节点、新的还没回来时不拿旧的 frontmatter 顶着
  }, [propsOpen, propId, wsData]);
  // >v<🧭导航-撤销重做-属性 / 正文编辑也进撤销栈（👤 待办）：记 {op, id, undo: 改之前, redo: 改之后}，撤销 = 把旧值写回
  const pushOp = e => { const h = hist2.current; if (!h.committed) return; const lb = graph.nodes.get(e.id)?.label || e.id; h.undo.push({ ...e, desc: e.desc || (e.op === 'meta' ? `改属性 ${lb}：${Object.keys(e.redo).join('、')}` : `改正文 ${lb}`), t: Date.now() }); h.redo = []; persistHist(); };
  // 📌 钉子的每一步：旧 doc / 新 doc 整份存进撤销栈（很小）。撤销 / 重做时折叠、当前组用现在的（那只是看法，不是内容）
  const editPins = (next, desc) => { const prev = pinsRef.current; if (next === prev) return; pushOp({ op: 'pins', undo: prev, redo: next, desc }); setPinsDoc(next); };
  const viewPins = next => { if (next !== pinsRef.current) setPinsDoc(next); };
  const restorePins = snap => {
    const live = pinsRef.current;
    setPinsDoc({ ...snap, current: snap.groups.some(g => g.id === live.current) ? live.current : snap.current,
      groups: snap.groups.map(g => { const l = live.groups.find(x => x.id === g.id); return l ? { ...g, collapsed: l.collapsed } : g; }) });
  };
  // 钉进某一组（'new' = 新组）：apply(doc, gid) → { doc, added }；labs = 给人看的名字
  const pinInto = (gid, apply, labs) => {
    let doc = pinsRef.current, made = false;
    if (gid === 'new' || !doc.groups.some(x => x.id === gid)) { const r = addGroup(doc); doc = r.doc; gid = r.id; made = true; }
    const r = apply(doc, gid);
    const name = r.doc.groups.find(x => x.id === gid).name;
    if (!r.added && !made) { viewPins(r.doc); setSaveState(`📌 「${name}」里已经有了：${labs}`); return; }
    editPins(r.doc, `钉到「${name}」：${labs}`);
    setSaveState(`📌 已钉到「${name}」：${labs}（Ctrl+Z 撤销；反引号 \` 或顶栏 📌 看钉子）`);
  };
  const pinNodes = (ids, gid) => {
    ids = ids.filter(id => graph.nodes.has(id) && id !== ROOT);
    if (!ids.length) return;
    setPinsOpen(true); // 👤 2026-10-11 钉完自动弹出钉子窗口，看得到钉进去了
    const labs = ids.length > 2 ? `${graph.nodes.get(ids[0]).label} 等 ${ids.length} 个` : ids.map(id => graph.nodes.get(id).label).join('、');
    pinInto(gid, (doc, g) => addNodes(doc, g, ids.map(id => ({ node: id, label: graph.nodes.get(id).label }))), labs);
  };
  // >v<📌钉子-行钉子-在正文 / 原文 / 文件预览里选中一段文字，右键 → 钉到…：存「文件 + 行号 + 整行文字」（👤 2026-10-09 第 2 步）。
  //   正文框里的文字没有 frontmatter，行号要到真文件里对一下；选中跨了几行就只钉第一行
  const nodeOfFile = file => Object.keys(wsData?.nodes || {}).find(id => wsData.nodes[id].file === file) || null;
  const pinSelection = async (sel, gid) => {
    setPinsOpen(true);
    const { line, start, text: lineText } = lineAt(sel.text, sel.start);
    let ln = line;
    if (sel.from === 'body') {
      try {
        const r = await api('/raw?p=' + encodeURIComponent(sel.file));
        if (r.text) { const rl = r.text.split('\n'), guess = line + Math.max(0, rl.length - sel.text.split('\n').length), loc = locateLine(rl, { line: guess, text: lineText, seg: 0 }); if (loc.line) ln = loc.line; }
      } catch { /* 取不到就用正文里的行号 */ }
    }
    const it = makeLinePin({ file: sel.file, node: nodeOfFile(sel.file), line: ln, lineText, selStart: sel.start - start, selEnd: Math.min(sel.end - start, lineText.length) });
    pinInto(gid, (doc, g) => addLines(doc, g, [it]), `${sel.file.split('/').pop()} 第 ${ln} 行「${it.label.slice(0, 16)}」`);
  };
  // 双击钉子：节点 = 跳过去；行 = 打开那个文件、找回那一行、高亮（行号 / 文字变了顺手更新；找不到就让人在最像的几行里选）
  const showFile = (file, line, nid) => {
    const hl = line ? { file, line, n: Date.now() } : null;
    if (nid && graph.nodes.has(nid)) { jumpTo(nid); setPropsOpen(true); setBodyMode('src'); setRawHl(hl); if (mode === 'ws') api('/ws').then(setWsData).catch(() => {}); } // 节点的 md → 右栏正文的源码模式（文件可能在外面改过：重读，正文和行号才对得上）
    else { setFileHl(hl); openFile(file); } // 别的文件 → 文件预览
  };
  // 钉的是节点 md 里的一行：画布跳到那个节点，卡片里把正文展开，并滚到那一行（找渲染出来的文字，不靠行号；只是展开卡片，不挪别的节点）
  const peekCardBody = (nid, item) => {
    if (!nid || !wsData?.nodes?.[nid]?.body?.trim()) return;
    setTextOpen(x => x[nid] ? x : { ...x, [nid]: true });
    const clean = t => String(t || '').replace(/^[\s>#*+\-|]+(\d+[.)]\s*)?/, '').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim();
    const seg = clean(String(item.text || '').slice((item.seg || 0) * 20, (item.seg || 0) * 20 + 20)), whole = clean(item.text);
    const probes = [seg.length >= 4 ? seg : whole, whole.slice(0, 12), whole.slice(0, 6)].filter(p => p.length >= 3);
    const tryScroll = n => {
      const box = document.querySelector('.react-flow__node[data-id="' + CSS.escape(nid) + '"] .cardtext');
      if (!box) { if (n < 40) setTimeout(() => tryScroll(n + 1), 50); return; }
      let hit = null;
      for (const p of probes) {
        for (const el of box.querySelectorAll('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, div, span')) {
          if (!(el.textContent || '').replace(/\s+/g, ' ').includes(p)) continue;
          if ([...el.children].some(c => (c.textContent || '').replace(/\s+/g, ' ').includes(p))) continue; // 取最里面那层
          hit = el; break;
        }
        if (hit) break;
      }
      if (!hit) return;
      const zoom = box.offsetHeight ? box.getBoundingClientRect().height / box.offsetHeight : 1;
      box.scrollTop += (hit.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight * zoom / 2) / zoom;
      hit.classList.add('pinflash'); setTimeout(() => hit.classList.remove('pinflash'), 2200);
    };
    setTimeout(() => cardActions.centerOn?.(nid, true), 160); // 正文展开后卡片变高了，再居中一次
    setTimeout(() => tryScroll(0), 260);
  };
  const jumpPin = async (gid, item) => {
    if (item.kind === 'node') return jumpTo(item.node);
    const nid = (item.node && wsData?.nodes?.[item.node] ? item.node : null) || nodeOfFile(item.file); // 节点 md 跟着改过名 → 按节点取现在的路径
    let file = nid ? wsData.nodes[nid].file : item.file;
    const get = f => api('/raw?p=' + encodeURIComponent(f)).catch(() => null);
    let r = await get(file);
    if (!r) { // 文件不在原路径：按文件名在项目里找，只有一个就用它
      const f = await api('/findfile?p=' + encodeURIComponent(item.file)).catch(() => ({ matches: [] }));
      if (f.matches.length !== 1) { setSaveState(f.matches.length ? `❌ 「${item.file}」不在原处，项目里有 ${f.matches.length} 个同名文件，没法自动选` : `❌ 找不到文件「${item.file}」（被删了或搬出项目）`); return; }
      file = f.matches[0]; r = await get(file);
      if (!r) { setSaveState(`❌ 读不了「${file}」`); return; }
    }
    if (r.text == null) { setSaveState('❌ ' + (r.note || '这个文件不能预览')); return; }
    const lines = r.text.split('\n'), loc = locateLine(lines, item);
    if (loc.line == null) {
      setPinAsk({ gid, iid: item.id, file, nid, cands: loc.candidates.map(c => ({ line: c.line, text: lines[c.line - 1].replace(/\r$/, '') })) });
      showFile(file, null, nid);
      setSaveState(`❓ 找不到「${item.label}」原来的那一行（文件改过了）：在钉子窗口里选一行，或点「都不是」`);
      return;
    }
    setPinAsk(null);
    if (loc.how !== 'exact' || file !== item.file) viewPins(updateItem(pinsRef.current, gid, item.id, { line: loc.line, text: lines[loc.line - 1].replace(/\r$/, '').slice(0, 2000), file }));
    showFile(file, loc.line, nid);
    if (nid && file === wsData.nodes[nid]?.file) peekCardBody(nid, { ...item, text: lines[loc.line - 1] });
  };
  const choosePinLine = c => {
    const a = pinAsk; if (!a) return;
    viewPins(updateItem(pinsRef.current, a.gid, a.iid, { line: c.line, text: c.text.slice(0, 2000), file: a.file }));
    setPinAsk(null); showFile(a.file, c.line, a.nid);
    if (a.nid && a.file === wsData.nodes[a.nid]?.file) peekCardBody(a.nid, { text: c.text, seg: 0 });
  };
  const saveMeta = (id, patch, opt = {}) => {
    const old = wsData?.nodes[id]?.meta || {};
    if (!opt.silent) pushOp({ op: 'meta', id, undo: Object.fromEntries(Object.keys(patch).map(k => [k, k in old ? old[k] : null])), redo: patch });
    return api('/node', { method: 'PATCH', body: JSON.stringify({ id, meta: patch }) }).then(d => { setWsData(d); setSaveState('属性已保存：' + Object.keys(patch).join('、') + '（Ctrl+Z 撤销）'); }).catch(e => setSaveState('❌ 属性保存失败：' + e.message));
  };
  // 一次改好几个节点的属性（一步撤销）：list = [[id, patch]…]
  const saveMetas = (list, opt = {}) => {
    if (!list.length) return Promise.resolve();
    if (!opt.silent) pushOp({ op: 'metas', id: list[0][0], desc: opt.desc, undo: list.map(([id, p]) => { const old = getMeta(id) || {}; return [id, Object.fromEntries(Object.keys(p).map(k => [k, k in old ? old[k] : null]))]; }), redo: list });
    setWsData(d => ({ ...d, nodes: { ...d.nodes, ...Object.fromEntries(list.filter(([id]) => d.nodes[id]).map(([id, p]) => { const m = { ...d.nodes[id].meta }; for (const [k, v] of Object.entries(p)) if (v == null) delete m[k]; else m[k] = v; return [id, { ...d.nodes[id], meta: m }]; })) } })); // 先改本地，不闪回
    return api('/nodes', { method: 'PATCH', body: JSON.stringify({ items: list.map(([id, meta]) => ({ id, meta })) }) }).then(d => { setWsData(d); setSaveState((opt.desc || '属性已保存') + '（Ctrl+Z 撤销）'); }).catch(e => setSaveState('❌ 属性保存失败：' + e.message));
  };
  // 属性面板的快捷按钮：把空白模板填进「＋ 属性」那一行，改完回车
  const metaHints = id => {
    const m = getMeta(id) || {}, out = [], par = graph.nodes.get(id)?.parent, pm = par != null ? getMeta(par) : null;
    if (graph.nodes.get(id)?.children.length && !isTimeline(m)) out.push({ label: '设为时间轴', key: 'timeline', value: 'true', title: '这一页变成时间轴（V 切回画布）：子节点写 t0 / t1（成片时间，秒）就排成条。还可以写 beats: 感官.json（拍点网格）、fps、lead（吸附提前几帧）' });
    if (isTimeline(pm) && m.t0 == null) out.push({ label: '上轴', key: 't0', value: '0', title: '在「' + graph.nodes.get(par).label + '」的时间轴上的入点（秒）；再加 t1 = 出点。也可以在时间轴视图里把它从「没上轴」拖上去' });
    if (!isSpace(m)) out.push({ label: '设为空间', key: 'axes', value: '轴1, 轴2, 轴3', title: '这个节点变成「空间」：axes = 轴名，逗号分隔。子节点写 vec 就成了它的成员' });
    if (isSpace(pm) && !m.vec) out.push({ label: '加坐标', key: 'vec', value: parseAxes(pm.axes).map(() => '0').join(', '), title: '在「' + graph.nodes.get(par).label + '」里的坐标：' + parseAxes(pm.axes).join('、') });
    if (isSpace(m)) for (const e of graph.edges.filter(x => x.from === id)) {
      const tm = getMeta(e.to), lab = graph.nodes.get(e.to).label;
      if (isSpace(tm) && !mapsOf(m).some(x => (resolveLabel(graph.nodes, id, x.ref) || x.ref) === e.to))
        out.push({ label: '映射→' + lab, key: '映射→' + lab, value: parseAxes(tm.axes).map(() => parseAxes(m.axes).map(() => '0').join(' ')).join('; '), title: `矩阵 ${parseAxes(tm.axes).length} 行（${parseAxes(tm.axes).join('、')}）× ${parseAxes(m.axes).length} 列（${parseAxes(m.axes).join('、')}），; 分行` });
    }
    return out;
  };
  const saveBody = (id, body, opt = {}) => {
    const old = wsData?.nodes[id]?.body || '';
    if (old === body) return Promise.resolve();
    if (!opt.silent) pushOp({ op: 'body', id, undo: old, redo: body });
    return api('/node', { method: 'PATCH', body: JSON.stringify({ id, body }) }).then(d => { setWsData(d); setSaveState('正文已保存 ' + new Date().toLocaleTimeString() + '（Ctrl+Z 撤销）'); }).catch(e => setSaveState('❌ 正文保存失败：' + e.message));
  };
  // 展开竖栏「改」：四份展开状态整份存进撤销栈（几十个 true，很小）；撤销 / 重做 = 整份写回
  const vsRef = useRef({}); vsRef.current = { expanded, framed, textOpen, propsShut, picFold };
  const restoreVS = s => { setExpanded(s.expanded || {}); setFramed(s.framed || {}); setTextOpen(s.textOpen || {}); setPropsShut(s.propsShut || {}); if (s.picFold) setPicFold(s.picFold); };
  // 图片进撤销：{op:'pics', paths, pairs, layout, del}。贴进来的（del 假）撤销 = 挪进 .junk/、重做 = 搬回；删掉的（del 真）反过来
  const applyPics = async (e, which) => {
    if ((which === 'undo') !== !!e.del) { // pairs 第三项 = 删之前的坐标（散图被自动摆过、拖过都以这时的为准）
      e.pairs = (await api('/pic-remove', { method: 'POST', body: JSON.stringify({ paths: e.paths }) })).pairs;
      const lay = Object.fromEntries(e.pairs.filter(p => p[2]).map(p => ['@pic:' + p[1], p[2]])); e.layout = Object.keys(lay).length ? lay : null;
      persistHist();
    }
    else {
      await api('/restore', { method: 'POST', body: JSON.stringify({ pairs: e.pairs || [] }) });
      if (e.layout) { setPositions(p => ({ ...p, ...e.layout })); await api('/layout', { method: 'PUT', body: JSON.stringify({ positions: e.layout }) }); }
    }
    setWsData(await api('/ws'));
  };
  const applyOp = (e, which) => e.op === 'metas' ? saveMetas(e[which], { silent: true }) : e.op === 'vs' ? Promise.resolve(restoreVS(e[which])) : e.op === 'pins' || e.op === 'hooks' ? Promise.resolve(restorePins(e[which])) : e.op === 'pics' ? applyPics(e, which) : e.op === 'meta' ? saveMeta(e.id, e[which], { silent: true }) : saveBody(e.id, e[which], { silent: true });

  const toggle = id => setExpanded(x => ({ ...x, [id]: !x[id] }));
  cardActions.toggle = toggle;
  cardActions.toggleFrame = toggleFrame;
  cardActions.drill = id => drill(id);
  cardActions.commitRename = commitRename;
  cardActions.cancelRename = () => setCanvasRename(null);
  cardActions.openChild = child => { const p = graph.nodes.get(child)?.parent; if (p == null) return; go(p); setSelected(child); };
  const allOpen = view.nodes.filter(n => n.children.length).every(n => expanded[n.id]);
  // >v<🎨画布-展开竖栏-四种展开 × 改 / 看（👤 2026-10-10）。适用的节点：子级 / 成框 = 有子节点；正文 = 有正文；属性 = 卡片上有属性可显示
  const EXP = {
    frame: { name: '子图', field: 'framed', ok: n => n.children.length > 0, own: id => !!framed[id], tip: '子节点画在框里、线直连（内部画布）' },
    kids: { name: '子级', field: 'expanded', ok: n => n.children.length > 0, own: id => !!expanded[id], tip: '卡片里列出子节点' },
    props: { name: '属性', field: 'propsShut', inv: true, ok: n => cardProps(wsData?.nodes[n.id]?.meta).length > 0, own: id => !propsShut[id], tip: '卡片上人加的属性' },
    text: { name: '正文', field: 'textOpen', ok: n => !!wsData?.nodes[n.id]?.body?.trim(), own: id => !!textOpen[id], tip: '卡片里渲染 md 正文' },
    pics: { name: '图片', field: 'picFold', inv: true, ok: n => (images[n.id]?.length || 0) > 0, own: id => !picFold[id], tip: '卡片上的图片（🖼 单张收起 / 显示）' },
  };
  const [settingsOpen, setSettingsOpen] = useState(false); // 左上角 ⚙
  // 👤 2026-10-16 左栏 / 右栏各自 Ctrl+滚轮缩放（鼠标在栏里任何地方，含空白处、正文框上；不按 Ctrl 照常滚）。只缩放标题栏以下，记在本机
  const [paneZoom, setPaneZoom] = useState(() => { try { return { left: 1, right: 1, ...JSON.parse(localStorage.getItem('syn.paneZoom') || '{}') }; } catch { return { left: 1, right: 1 }; } });
  useEffect(() => {
    const w = e => { if (!e.ctrlKey) return; const p = e.target.closest?.('aside.outline') ? 'left' : e.target.closest?.('aside.side') ? 'right' : null; if (!p) return;
      e.preventDefault(); e.stopPropagation();
      setPaneZoom(z => { const n = { ...z, [p]: Math.round(Math.min(1.6, Math.max(0.6, z[p] + (e.deltaY < 0 ? 0.05 : -0.05))) * 100) / 100 }; try { localStorage.setItem('syn.paneZoom', JSON.stringify(n)); } catch { /* */ } return n; }); };
    window.addEventListener('wheel', w, { capture: true, passive: false }); return () => window.removeEventListener('wheel', w, { capture: true });
  }, []);
  // 👤 2026-10-12 H = 键位提示开关：按钮旁边显示组合键小字（data-keyx）+ 画布右下角导航 / 选择速查；单键的（data-key：1 2 3 4 Q ` ?）一直显示。
  //   默认开（给新手），记在本机。原则：快捷键提示放在用到它的界面旁边，快捷键页不暴露全部
  const [keyHints, setKeyHints] = useState(() => load('syn.keyhints', true));
  useEffect(() => { try { localStorage.setItem('syn.keyhints', JSON.stringify(keyHints)); } catch { /* 无痕模式 */ } }, [keyHints]);
  // 方向键微调（nudge）和框底色（look）的参数（settings.yaml；样例模式 / 读不到 = 默认）。画布那边读 cardActions.nudge
  useEffect(() => {
    const put = s => {
      if (s?.nudge) cardActions.nudge = { ...NUDGE, ...s.nudge };
      const L = s?.look || {}, st = document.documentElement.style; // 框底色浓度 → CSS 变量（shell.css 的 --box-tint）
      if (+L.boxDark >= 0) st.setProperty('--box-tint-dark', +L.boxDark + '%');
      if (+L.boxLight >= 0) st.setProperty('--box-tint-light', +L.boxLight + '%');
    };
    if (mode === 'ws') api('/settings').then(d => put(d.settings)).catch(() => {});
    const on = e => put(e.detail); window.addEventListener('syn-settings', on);
    return () => window.removeEventListener('syn-settings', on);
  }, [mode]);
  // Ctrl+H 替换节点名：范围 = 选中的几张（ids）或整页（null）；匹配的卡依次选中并移到视野里
  const [repl, setRepl] = useState(null); // {find, to, ids, idx, note}
  const replIds = repl ? (repl.ids || graph.nodes.get(realScope)?.children || []).filter(id => graph.nodes.has(id)) : [];
  const replHits = repl?.find ? replIds.filter(id => graph.nodes.get(id).label.toLowerCase().includes(repl.find.toLowerCase())) : [];
  const replCur = replHits.length ? ((repl.idx % replHits.length) + replHits.length) % replHits.length : 0;
  const replSkip = repl?.find ? replaceLabels(graph, replIds, repl.find, repl.to).skipped.length : 0;
  const replFocus = replHits[replCur];
  useEffect(() => { if (repl && replFocus) { setSelected(replFocus); setTimeout(() => cardActions.centerOn?.(replFocus, true), 0); } }, [replFocus, repl?.find]);
  const replRun = only => {
    const r = replaceLabels(graph, replIds, repl.find, repl.to, { only });
    if (!r.text) { setRepl(x => ({ ...x, note: r.skipped.length ? `没改：${r.skipped[0].why}` : '' })); return; }
    setText(r.text);
    const map = Object.fromEntries(r.changed.map(c => [c.id, c.to]));
    const again = repl.to.toLowerCase().includes(repl.find.toLowerCase()); // 替换后还含查找词：别原地打转
    setRepl(x => ({ ...x, ids: x.ids ? x.ids.map(id => map[id] ?? id) : null, idx: only && again ? x.idx + 1 : x.idx, note: `已改 ${r.changed.length} 个` + (r.skipped.length ? `，${r.skipped.length} 个因${r.skipped[0].why}跳过` : '') }));
  };
  const addRefNodeFrom = async target => { // 右键空白 → 引入… → 选了一个节点：这一页放一张传送门卡片（指向它，不用连线；不是复制）
    try {
      const d = await api('/addref', { method: 'POST', body: JSON.stringify({ parent: realScope, target }) });
      lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
      setSelected(d.id); setSaveState('已放一张传送门卡片「' + (graph.nodes.get(target)?.label || target) + '」（Ctrl+Z 撤销；双击卡片跳过去）');
      requestAnimationFrame(() => cardActions.centerOn?.(d.id));
    } catch (e) { setSaveState('❌ 引入失败：' + e.message); }
  };
  const addFileNodeFrom = async rel => {
    try {
      const d = await api('/addfile', { method: 'POST', body: JSON.stringify({ parent: realScope, rel }) });
      lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
      setSelected(d.id); setSaveState('已引入文件「' + rel + '」为节点（Ctrl+Z 撤销；原文件不动）');
      requestAnimationFrame(() => cardActions.centerOn?.(d.id));
    } catch (e) { setSaveState('❌ 引入失败：' + e.message); }
  };
  // 「连线到…」也能选项目里的外部文件：选了就先把它引成节点（已有节点引用过的不重复列），再连线
  useEffect(() => { if (finder && mode === 'ws' && !tree) api('/tree').then(setTree).catch(e => setTree({ tree: [], error: e.message })); }, [finder]);
  const fileItems = useMemo(() => {
    if (!finder || finder.mode === 'linkfrom' || !tree?.tree) return []; // 「从…连过来」只选节点（文件节点要先引入）
    const used = finder.mode !== 'go' ? new Set(Object.values(wsData?.nodes || {}).map(n => n.meta?.file).filter(Boolean)) : new Set(); // 连线时已有节点引用过的文件不重复列；Ctrl+F 跳转时全列
    const out = [], walk = items => { for (const it of items || []) { if (it.dir) walk(it.children); else if (!(it.path === '__synapsis' || it.path.startsWith('__synapsis/')) && !used.has(it.path)) out.push({ id: '@file:' + it.path, label: '📎 ' + it.name, path: it.path, meta: {}, body: '' }); } };
    walk(tree.tree); return out;
  }, [finder, tree, wsData]);
  const linkToFile = async (from, rel) => {
    try {
      const d = await api('/addfile', { method: 'POST', body: JSON.stringify({ parent: realScope, rel }) });
      lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
      const d2 = await api('/link', { method: 'POST', body: JSON.stringify({ from, to: d.id }) });
      lastSaved.current = d2.report.outline; setText(d2.report.outline); setWsData(d2); recordSave(d2.report.outline, d2.report);
      setSelected(from); setSaveState('已把文件「' + rel + '」引成节点并连线（Ctrl+Z 撤销，两步）');
    } catch (e) { setSaveState('❌ 连到文件失败：' + e.message); }
  };
  const EXP_KEY = { frame: '1', kids: '2', props: '3', text: '4', pics: '5' };
  const [expMore, setExpMore] = useState(false); // 竖栏最上面的 ⋯ 菜单（「改」放这里，用得少）
  useEffect(() => { if (!expMore) return; const c = e => { if (!e.target.closest?.('.expmore, .expmenu')) setExpMore(false); }; window.addEventListener('pointerdown', c, true); return () => window.removeEventListener('pointerdown', c, true); }, [expMore]);
  // 真的展开本页：UI 框自己和它里面所有层的子孙都不动（UI 框自己单独展开）。沿父级往上查到本页为止，钻进 UI 框那页时里面的照常
  const underUi = id => { for (let p = id; p != null && p !== realScope; p = graph.nodes.get(p)?.parent ?? null) if (uiId(p)) return true; return false; };
  const expIds = k => view.nodes.filter(n => !underUi(n.id) && EXP[k].ok(n)).map(n => n.id);
  const expAnyOpen = k => expIds(k).some(EXP[k].own);
  // 改：有没折叠的 → 先全部折叠；已经全折叠了 → 全部展开（本页的节点；没东西可展开的不算）。进 Ctrl+Z；节点之间的位置照原有的展开逻辑，不额外挪
  const expChange = k => {
    const ids = expIds(k); if (!ids.length) return;
    const open = !expAnyOpen(k), E = EXP[k], prev = vsRef.current, cur = { ...prev[E.field] };
    for (const id of ids) { if (open !== !!E.inv) cur[id] = true; else delete cur[id]; }
    const next = { ...prev, [E.field]: cur };
    pushOp({ op: 'vs', undo: prev, redo: next, desc: `${open ? '展开' : '收起'}本页 ${ids.length} 个节点的${E.name}` });
    restoreVS(next);
  };
  // 看：不接管 → 展开 → 收起 → 不接管。只改本页的临时覆盖，不进历史
  const expSee = (k, deep) => setSeeModes(m => { const cur = m[realScope] || {}, want = deep ? 'deep' : 'on', nx = cur[k] === want ? undefined : want; const o = { ...cur }; if (nx) o[k] = nx; else delete o[k]; const r = { ...m }; if (Object.keys(o).length) r[realScope] = o; else delete r[realScope]; return r; });

  // >v<🧭导航-快捷键-Enter 改名 / Tab 左栏开关 / Esc / Alt+W/A/D / 鼠标侧键 上一层后退前进
  // 画布快捷键（焦点在输入框里时不触发）
  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyH' && mode === 'ws') { e.preventDefault(); e.stopPropagation(); if (repl) setRepl(null); else { const m = cardActions.getMulti?.() || []; setRepl({ find: '', to: '', ids: m.length > 1 ? m : null, idx: 0, note: '' }); } return; } // 👤 2026-10-10 Ctrl+H = 替换节点名
      if (e.ctrlKey && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.stopPropagation(); if (e.target === taRef.current || e.target === findRef.current) { findRef.current?.focus(); findRef.current?.select(); return; } setFinder({ mode: 'go' }); return; } // 在输入框里也能用；在「文本」页 = 文本查找
      const inText = e.target.closest && e.target.closest('textarea, input, [contenteditable="true"]');
      // 👤 2026-10-17 Ctrl+E = 右栏正文 实时预览 ⇄ 全部源码（在正文里也能用；别的输入框里不管）；右栏关着 = 先打开
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyE' && (!inText || e.target.closest('.mdbody'))) {
        e.preventDefault(); e.stopPropagation();
        if (!propsOpen) setPropsOpen(true); else setBodyMode(m => m === 'src' ? 'live' : 'src');
        return;
      }
      if (inText) return;
      if (menu) return; // 右键菜单开着：WASD / E / Esc 归菜单（panels.jsx menuNav）
      if (finder && e.key === 'Tab') return; // 连线 / 搜索弹窗开着：Tab 归弹窗（切页签），别当成开关左栏
      if (helpOpen && e.key === 'Escape') { setHelpOpen(false); return; }
      if (e.key === '`' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (mode === 'ws') setPinsOpen(o => !o); return; } // 👤 2026-10-09 反引号 = 钉子窗口开关
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing && !e.repeat) { e.preventDefault(); e.stopPropagation(); setSeeLines(o => !o); return; } // 👤 2026-10-10 Q = 看清连线开关
      if (e.code === 'KeyV' && tl && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing && !e.repeat) { e.preventDefault(); e.stopPropagation(); setTlOff(m => ({ ...m, [realScope]: !m[realScope] })); return; } // 🎬 V = 时间轴页：时间轴 ⇄ 画布
      if (e.shiftKey && !e.ctrlKey && !e.altKey && e.code === 'KeyF') { e.preventDefault(); e.stopPropagation(); if (mode === 'ws') setAgentOpen(o => !o); return; } // 👤 2026-10-08 Shift+F = AI 指令框（单手）
      if (e.ctrlKey && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) { e.preventDefault(); e.stopPropagation(); (e.key.toLowerCase() === 'y' || e.shiftKey ? redo : undo)(); return; }
      if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); setPropsOpen(o => !o); } // 👤 2026-10-10 Shift+Tab = 右栏（属性）开关
      else if (e.code === 'Backquote' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); setHistOpen(o => !o); } // 👤 Shift+` = 操作历史栏（和 ` 钉子窗口统一）
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); setLeftHidden(h => !h); } // 👤 Tab = 侧栏开关
      else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (sel && !sel.startsWith('@')) focusLabel(sel); }
      else if (e.code === 'KeyR' && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (sel && !sel.startsWith('@')) focusLabel(sel); } // 👤 2026-10-12 R = 改名（左手，同 Enter）；Alt+R = 改完
      else if (e.code === 'KeyF' && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat && !e.isComposing) { e.preventDefault(); e.stopPropagation(); const n = sel && !sel.startsWith('@') && graph.nodes.get(sel); if (n?.children.length && frmE(sel)) cardActions.fitFrame?.(sel); else cardActions.overview?.(); } // 👤 2026-10-12 F = 看全局 / 再按回原来的视野；选中的节点展开了子图 = 只管它里面（同框里的 ⛶）
      else if (e.code === 'KeyE' && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat && !e.isComposing) { // 👤 2026-10-12 E = 弹右键菜单（选中的卡旁边；没选中 = 画布中间的空白菜单），WASD 在菜单里走，E 确定
        e.preventDefault(); e.stopPropagation();
        const el = sel && document.querySelector(`.react-flow__node[data-id="${CSS.escape(sel)}"]`), cv = document.querySelector('.canvas')?.getBoundingClientRect();
        if (el) { const r = el.getBoundingClientRect(); onContextMenu(sel, Math.min(r.right + 4, innerWidth - 230), Math.max(r.top, 40)); }
        else if (cv && !sel) onContextMenu(null, cv.left + cv.width / 2, cv.top + cv.height / 2);
      }
      else if (e.code === 'KeyH' && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat && !e.isComposing) { e.preventDefault(); e.stopPropagation(); setKeyHints(o => !o); }
      else if (e.code === 'KeyT' && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (sel && !sel.startsWith('@') && graph.nodes.has(sel)) menuActions.addChild(sel); } // 👤 2026-10-12 T = 给选中的建子节点，直接进改名（同右键 ＋ 新建子节点） // 👤 2026-10-10 选中了 Enter = 重命名；没选中什么都不做（常误触）。👤 2026-10-11 键盘新建（Shift+Enter / Insert / Ctrl+Enter）和 F2 都去掉：新建走鼠标（右键），改名只留 Enter
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyS') { e.preventDefault(); e.stopPropagation(); if (sel && !sel.startsWith('@')) drill(sel); } // Alt+S = 钻进去（没选中不管）
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyW') { e.preventDefault(); e.stopPropagation(); up(); } // 👤 2026-10-10 Alt+W/A/D = 上一层 / 后退 / 前进（单手）
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyA') { e.preventDefault(); e.stopPropagation(); back(); }
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyD') { e.preventDefault(); e.stopPropagation(); fwd(); }
      else if (/^Digit[1-5]$/.test(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) { // 样例模式也能用（空格 / F 去掉后靠它）。👤 2026-10-10 1 2 3 4 = 子图 / 子级 / 属性 / 正文：选中了就切这张卡自己的，没选中 = 本页预览展开（只本页）；Shift+数字 = 预览展开并递进到子孙
        e.preventDefault(); e.stopPropagation();
        const k = ['frame', 'kids', 'props', 'text', 'pics'][+e.code.slice(5) - 1];
        if (e.shiftKey) expSee(k, true);
        else if (sel && !sel.startsWith('@')) { const n = graph.nodes.get(sel); if (n && EXP[k].ok({ id: sel, children: n.children })) menuActions.expToggle(sel, k); }
        else expSee(k);
      }
      else if (e.key === 'Escape') setSelected(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); e.stopPropagation(); remove(sel); } // 👤 2026-10-11 空格 / F 和 2 / 1 重复，去掉
      else if (e.key === '?' || e.key === 'F1') { e.preventDefault(); setHelpOpen(h => !h); }
    };
    // 鼠标侧键：3 = 后退，4 = 前进（拦掉浏览器自己的历史跳转）
    // 👤 2026-10-12 单右手：按住右键 + 侧键后 = 上一层（同 Alt+W，回去后选中刚才那个节点）；按住右键 + 侧键前 = 钻进选中的（同 Alt+S）。
    //   用过组合键，松开右键时那次右键菜单不弹
    const onMouse = e => {
      if (e.button === 2) { if (e.type === 'mousedown') { rmb.current.down = true; rmb.current.used = false; } else rmb.current.down = false; return; }
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type !== 'mouseup') return;
      if (rmb.current.down || e.buttons & 2) { rmb.current.used = true; if (e.button === 3) up(); else if (sel && !sel.startsWith('@')) drill(sel); return; }
      (e.button === 3 ? back : fwd)();
    };
    const onCtx = e => { if (rmb.current.used) { rmb.current.used = false; e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('mouseup', onMouse, true);
    window.addEventListener('contextmenu', onCtx, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onMouse, true); window.removeEventListener('mouseup', onMouse, true); window.removeEventListener('contextmenu', onCtx, true); };
  });

  // >v<🖼️图片-进图-粘贴 / 拖文件 / 从浏览器拖网页图：落在卡片上 = 进那个节点；落在空白处或没选中 = 在当前页新建一个节点装它（PureRef 习惯）
  const readFile = f => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
  // 弹系统的文件选择框选图（可多选）→ cb([{dataUrl}])
  const pickFiles = cb => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.style.display = 'none';
    inp.onchange = () => { const fs = [...(inp.files || [])]; inp.remove(); if (fs.length) Promise.all(fs.map(readFile)).then(us => cb(us.map(dataUrl => ({ dataUrl })))); };
    inp.oncancel = () => inp.remove();
    document.body.appendChild(inp); inp.click();
  };
  // 删卡片上的图（进 .junk/，Ctrl+Z 能撤）
  const removeCardPics = async (id, urls, why = '删') => {
    const paths = urls.map(u => new URL(u, location.href).searchParams.get('p')).filter(Boolean); if (!paths.length) return;
    try {
      const r = await api('/pic-remove', { method: 'POST', body: JSON.stringify({ paths }) });
      pushOp({ op: 'pics', del: true, paths, pairs: r.pairs, desc: `${why}了「${graph.nodes.get(id)?.label || id}」的 ${paths.length} 张图` });
      setWsData(await api('/ws')); setSaveState(`已${why}「${graph.nodes.get(id)?.label || id}」的图（Ctrl+Z 撤销）`);
    } catch (e) { setSaveState('❌ 删图失败：' + e.message); }
  };
  // 🎞 截帧弹窗：target = 节点 id（null = 散图，落在 at）；连截几张时散图错开一点
  const [frameDlg, setFrameDlg] = useState(null);
  const openFrameGrab = (file, target, at) => setFrameDlg({ file, target, at, n: 0 });
  const pickVideo = (target, at) => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*,.mp4,.m4v,.mov,.webm,.mkv'; inp.onchange = () => { const f = inp.files?.[0]; if (f) openFrameGrab(f, target, at); }; inp.click(); };
  const addImages = async (target, srcs, at, baseName) => {
    if (!srcs.length) return;
    try {
      const id = target;
      if (!id) { // 落在空白处 / 没选中时粘贴 → 散图，放进当前页的 _pics/（👤：不必变成节点）
        if (mode !== 'ws') {
          const urls = srcs.filter(s => s.dataUrl).map((s, i) => ({ id: '@pic:local' + Date.now() + '_' + i, url: s.dataUrl }));
          if (urls.length < srcs.length) setSaveState('样例模式拿不到网页图片，拖本地文件或粘贴试试');
          setLocalLoose(m => ({ ...m, [realScope]: [...(m[realScope] || []), ...urls] }));
          if (at) move(Object.fromEntries(urls.map((u, i) => [u.id, { x: at.x + i * 30, y: at.y + i * 30 }])));
          return;
        }
        let last = null; const paths = [], lay = {};
        for (const [i, s] of srcs.entries()) {
          const p = at && { x: at.x + i * 30, y: at.y + i * 30 };
          last = await api('/loose', { method: 'POST', body: JSON.stringify({ scope: realScope, ...s, at: p }) });
          paths.push(last.path); if (p && !last.node) lay['@pic:' + last.path] = p;
        }
        pushOp({ op: 'pics', paths, layout: Object.keys(lay).length ? lay : null, desc: `贴进 ${paths.length} 张散图` });
        const d = await api('/ws');
        setWsData(d); setPositions(p => ({ ...p, ...Object.fromEntries(Object.entries(d.layout || {}).filter(([k]) => k.startsWith('@pic:'))) }));
        setSaveState(last.node ? '这一页是叶子，没有自己的文件夹 → 图归给它：' + last.path : '散图已存 ' + last.path);
        return;
      }
      setSelected(id);
      if (mode !== 'ws') {
        const urls = srcs.filter(s => s.dataUrl).map(s => s.dataUrl);
        if (urls.length < srcs.length) setSaveState('样例模式拿不到网页图片，拖本地文件或粘贴试试');
        return setImages(m => ({ ...m, [id]: [...(m[id] || []), ...urls] }));
      }
      let last = ''; const paths = [];
      for (const s of srcs) paths.push(last = (await api('/asset', { method: 'POST', body: JSON.stringify({ id, ...s }) })).path);
      pushOp({ op: 'pics', id, paths, desc: `给「${graph.nodes.get(id)?.label || id}」贴了 ${paths.length} 张图` });
      setSaveState('图片已存 ' + last + (srcs.length > 1 ? ` 等 ${srcs.length} 张` : ''));
      setWsData(await api('/ws'));
    } catch (e) { setSaveState('❌ 贴图失败：' + e.message); }
  };
  // >v<🌳大纲模型-复制粘贴节点-Ctrl+C 复制选中的卡（含框选 / Ctrl 多选）连同子孙、属性、正文、图片、它们之间的边；
  // Ctrl+V 粘到当前页、落在鼠标处，同名加「 2」，能撤销（👤 2026-10-08）。剪贴板里写一行带标记的文本；不是节点才当图片贴
  const CLIP = 'synapsis-nodes:', CUT = 'synapsis-cut:';
  // >v<🌳大纲模型-移动节点-拖进节点 / Ctrl+X 剪切 → 到目标页 Ctrl+V（👤 2026-10-08）：core/workspace.js moveNodes，正文 / 属性 / 图片 / 连线 / 坐标跟着走
  const moveInto = async (ids, parent, at = null) => {
    ids = ids.filter(id => !id.startsWith('@') && graph.nodes.has(id));
    if (!ids.length || mode !== 'ws') return false;
    if (parent == null) parent = realScope;
    try {
      const d = await api('/move', { method: 'POST', body: JSON.stringify({ ids, parent }) });
      lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
      if (at) move(Object.fromEntries(d.report.roots.map((id, i) => [id, { x: Math.round(at.x), y: Math.round(at.y + i * 50) }])), { silent: true });
      setSaveState('已移到「' + (parent === ROOT ? '根' : graph.nodes.get(parent)?.label) + '」：' + ids.map(id => graph.nodes.get(id)?.label).join('、') + '（Ctrl+Z 撤销）');
      return true;
    } catch (e) { setSaveState('❌ 移动失败：' + e.message); return false; }
  };
  cardActions.moveInto = moveInto;
  // >v<🖼️图片-归属-散图拖到卡片上 = 归给它；卡片里的图拖到空白 = 变散图（落在鼠标处）、拖到别的卡 = 换主人（core movePic）
  const movePics = async (paths, to, at = null) => {
    if (mode !== 'ws' || !paths.length) return;
    try {
      let d = null; const out = [];
      for (const p of paths) { d = await api('/move-pic', { method: 'POST', body: JSON.stringify({ path: p, to, scope: realScope }) }); out.push(d.pic.path); }
      setWsData(d);
      if (!to && at) move(Object.fromEntries(out.map((p, i) => ['@pic:' + p, { x: Math.round(at.x + i * 30), y: Math.round(at.y + i * 30) }])), { silent: true });
      setSaveState(to ? `图片归给「${graph.nodes.get(to)?.label}」` : '图片变成这一页的散图');
    } catch (e) { setSaveState('❌ 图片移动失败：' + e.message); }
  };
  cardActions.movePics = movePics;
  const mouse = useRef(null);
  useEffect(() => { const m = e => { mouse.current = { x: e.clientX, y: e.clientY }; }; window.addEventListener('pointermove', m); return () => window.removeEventListener('pointermove', m); }, []);
  const pasteNodes = async (ids, src, parent = realScope, dropAt = null) => {
    const cross = !!src && !!wsData?.root && src !== wsData.root; // 从另一个项目复制来的（托盘里开着多个项目）：服务端按来源路径去读
    const r = cross ? { roots: [] } : withCopies(graph, ids, parent);
    if (!r) return setSaveState('剪贴板里的节点不在这个工作区');
    let roots = r.roots;
    if (mode === 'ws') {
      try {
        const d = await api('/paste', { method: 'POST', body: JSON.stringify({ ids, parent, ...(cross ? { src } : {}) }) });
        roots = d.report.roots;
        lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
      } catch (e) { return setSaveState('❌ 粘贴失败：' + e.message); }
    } else setText(r.text);
    const at = dropAt || mouse.current, p = parent === realScope && at && cardActions.toFlow ? cardActions.toFlow(at) : null;
    if (p) move(Object.fromEntries(roots.map((id, i) => [id, { x: Math.round(p.x), y: Math.round(p.y + i * 50) }])), { silent: true });
    setSelected(roots[0]);
    setSaveState((cross ? '已从另一个项目粘贴 ' : '已粘贴 ') + roots.map(id => graph.nodes.get(id)?.label || id.split('/').pop()).join('、') + '（Ctrl+Z 撤销）');
  };
  useEffect(() => {
    const onCopy = e => {
      if (e.target.closest?.('textarea, input, [contenteditable="true"]') || window.getSelection()?.toString()) return; // 在输入框里 / 选了文字 = 正常复制文字
      const ids = (cardActions.multi?.length ? cardActions.multi : sel ? [sel] : []).filter(id => !id.startsWith('@'));
      if (!ids.length) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', CLIP + JSON.stringify({ ids, src: wsData?.root || null }));
      setSaveState('已复制 ' + ids.length + ' 个节点（连同子孙）· 到目标页 Ctrl+V');
    };
    const onCut = e => {
      if (e.target.closest?.('textarea, input, [contenteditable="true"]') || window.getSelection()?.toString()) return;
      const ids = (cardActions.multi?.length ? cardActions.multi : sel ? [sel] : []).filter(id => !id.startsWith('@'));
      if (!ids.length || mode !== 'ws') return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', CUT + JSON.stringify({ ids }));
      setSaveState('已剪切 ' + ids.length + ' 个节点 · 到目标页（或钻进目标节点）Ctrl+V = 移过去（原位置不留）');
    };
    window.addEventListener('copy', onCopy); window.addEventListener('cut', onCut);
    return () => { window.removeEventListener('copy', onCopy); window.removeEventListener('cut', onCut); };
  });
  useEffect(() => {
    const onPaste = e => {
      if (e.target.closest?.('.agentbox')) return; // AI 指令框里贴图 = 附给 AI（框自己处理），不是贴进卡片
      const txt = e.clipboardData?.getData('text/plain') || '';
      if (txt.startsWith(CUT) && !e.target.closest?.('textarea, input, [contenteditable="true"]')) {
        e.preventDefault(); e.stopPropagation();
        let ids = []; try { ids = JSON.parse(txt.slice(CUT.length)).ids; } catch { return setSaveState('❌ 剪贴板内容坏了'); }
        const at = mouse.current && cardActions.toFlow ? cardActions.toFlow(mouse.current) : null;
        moveInto(ids, realScope, at).then(okd => { if (okd) navigator.clipboard?.writeText('').catch(() => {}); }); // 剪切只能粘一次
        return;
      }
      if (txt.startsWith(CLIP) && !e.target.closest?.('textarea, input, [contenteditable="true"]')) {
        e.preventDefault(); e.stopPropagation();
        try { const c = JSON.parse(txt.slice(CLIP.length)); pasteNodes(c.ids, c.src); } catch { setSaveState('❌ 剪贴板内容坏了'); }
        return;
      }
      const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      const target = sel && !sel.startsWith('@') ? sel : null;
      const at = !target && mouse.current && cardActions.toFlow ? cardActions.toFlow(mouse.current) : null; // 散图落在鼠标处（👤 2026-10-17）
      Promise.all(files.map(readFile)).then(us => addImages(target, us.map(dataUrl => ({ dataUrl })), at));
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  });
  const onDrop = e => {
    // dataTransfer 只在事件同步阶段可读 → 先全部取出来
    const dt = e.dataTransfer;
    const picDrag = dt?.getData(DRAG_PIC);
    if (picDrag) { // 卡片里的图拖出来
      e.preventDefault();
      let info = null; try { info = JSON.parse(picDrag); } catch { return; }
      const card = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest?.('.react-flow__node')).find(n => n && !n.dataset.id.startsWith('@'));
      const t = card?.dataset.id;
      if (t === info.from) return; // 放回自己身上 = 不动
      movePics([info.path], t || null, t ? null : cardActions.toFlow ? cardActions.toFlow({ x: e.clientX, y: e.clientY }) : null);
      return;
    }
    const treeNode = dt?.getData(DRAG_NODE);
    if (treeNode) { // 从大纲树拖来的（可以是选中的好几个）：落在卡片上 = 放进它；落在空白 = 放到当前页、落在鼠标处；默认移动，松开左键前按住 Ctrl = 复制
      e.preventDefault();
      let tids = [treeNode]; try { const j = JSON.parse(treeNode); if (Array.isArray(j)) tids = j; } catch {}
      const card = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest?.('.react-flow__node')).find(n => n && !tids.includes(n.dataset.id) && !n.dataset.id.startsWith('@pic:'));
      const t = card?.dataset.id, parent = t ? (t.startsWith('@portal:') ? t.slice(8) : t) : realScope, at = t ? null : { x: e.clientX, y: e.clientY };
      if (e.ctrlKey) pasteNodes(tids, undefined, parent, at);
      else moveInto(tids, parent, at && cardActions.toFlow ? cardActions.toFlow(at) : null);
      return;
    }
    // 🎞 拖进视频 → 截帧弹窗（落在卡片上 = 截的图进那张卡；空白处 = 散图落在这里）
    const vid = [...(dt?.files || [])].find(f => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name));
    if (vid && mode === 'ws') {
      e.preventDefault();
      const c = e.target.closest?.('.react-flow__node')?.dataset.id, tgt = c && !c.startsWith('@') ? c : null;
      openFrameGrab(vid, tgt, tgt ? null : cardActions.toFlow ? cardActions.toFlow({ x: e.clientX, y: e.clientY }) : null);
      return;
    }
    const files = [...(dt?.files || [])].filter(f => f.type.startsWith('image/'));
    const html = dt?.getData('text/html') || '';
    const url = (dt?.getData('text/uri-list') || '').split('\n')[0].trim() || (html.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
    if (!files.length && !/^(https?:|data:image)/.test(url)) return;
    e.preventDefault();
    const card = e.target.closest?.('.react-flow__node')?.dataset.id;
    const target = card && !card.startsWith('@') ? card : null;
    // 落点 → 画布坐标（直接读 React Flow 的变换矩阵，不依赖视图记忆有没有存过）
    let at = null;
    const vpEl = e.currentTarget.querySelector('.react-flow__viewport');
    if (vpEl && !target) {
      const m = new DOMMatrix(getComputedStyle(vpEl).transform), r = e.currentTarget.getBoundingClientRect();
      at = { x: (e.clientX - r.left - m.e) / m.a, y: (e.clientY - r.top - m.f) / m.a };
    }
    const base = files[0] ? files[0].name.replace(/\.[^.]+$/, '').replace(/->|[,，]/g, ' ').trim().slice(0, 40) : '';
    if (files.length) Promise.all(files.map(readFile)).then(us => addImages(target, us.map(dataUrl => ({ dataUrl })), at, base));
    else addImages(target, [url.startsWith('data:') ? { dataUrl: url } : { url }], at);
  };
  // 图片掉在画布外（左栏、工具栏）也别让 Electron / 浏览器把窗口导航到那张图
  useEffect(() => {
    const no = e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', no); window.addEventListener('drop', no);
    return () => { window.removeEventListener('dragover', no); window.removeEventListener('drop', no); };
  }, []);
  cardActions.resizeLoose = (id, w) => move({ [id]: { w: Math.round(Math.max(60, Math.min(2400, w))) } });
  // 👤 2026-10-12 普通节点手动大小：存 _layout.json（和坐标一样是「摆放」，不是设计数据）；w = null → 回到自动
  cardActions.resizeCard = (id, w, h) => move({ [id]: w ? { w: Math.round(Math.max(60, w)), h: Math.round(Math.max(28, h)) } : { w: null, h: null } });
  cardActions.resizeUi = (id, w, h) => { w = Math.round(Math.max(40, Math.min(4000, w))); h = Math.round(Math.max(30, Math.min(4000, h))); if (mode === 'ws') saveMeta(id, { w: String(w), h: String(h) }); };
  cardActions.foldPics = id => setPicFold(f => ({ ...f, [id]: !f[id] }));
  cardActions.toggleProps = id => menuActions.expToggle(id, 'props');
  // 👤 2026-10-16 画布里改正文：自动展开正文（手动调过的大小不动），光标进去；Esc / 点别处 = 存好收起编辑（正文照样展开着）
  cardActions.editBody = id => { setTextOpen(f => f[id] ? f : { ...f, [id]: true }); setBodyEdit(id); };
  cardActions.endBody = (id, body) => { setBodyEdit(b => b === id ? null : b); saveBody(id, body); };
  cardActions.toggleText = id => setTextOpen(f => { const g = { ...f }; if (g[id]) delete g[id]; else g[id] = true; return g; });
  cardActions.resizePics = (id, w) => {
    if (w != null) w = Math.round(Math.max(80, Math.min(1600, w)));
    // 👤 2026-10-17 改图片宽度也进 Ctrl+Z（走 saveMeta）；w = null = 回到默认宽度（删掉 picw）
    if (mode === 'ws') saveMeta(id, { picw: w == null ? null : String(w) });
    else setLocalPicw(m => { const g = { ...m }; if (w == null) delete g[id]; else g[id] = w; return g; });
  };
  const withPics = [...view.nodes.filter(n => images[n.id]?.length), ...loosePics];
  const allPicsFolded = withPics.length > 0 && withPics.every(n => picFold[n.id]);

  // 大纲里：Tab 缩进、Shift+Tab 反缩进、回车保持缩进
  const onTaKey = e => {
    const ta = e.target, { selectionStart: s, selectionEnd: en, value: v } = ta;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    // Ctrl+Z / Ctrl+Y 交给应用的撤销栈（文本框自带的撤销被 React 的 setText 打断，按了没反应 —— 👤 2026-10-08 文本查找误改时撤不回来）
    //   还没存盘的打字 → 先退回上次存盘的文本；已经存了 → 和画布上一样一步步撤
    if (e.ctrlKey && !e.altKey && /^[zZyY]$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const isRedo = e.key.toLowerCase() === 'y' || e.shiftKey;
      if (!isRedo && mode === 'ws' && v !== lastSaved.current) { setText(lastSaved.current); setSaveState('已撤销还没保存的打字'); }
      else (isRedo ? redo : undo)();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (v.startsWith('  ', lineStart)) { setText(v.slice(0, lineStart) + v.slice(lineStart + 2)); requestAnimationFrame(() => ta.setSelectionRange(s - 2, en - 2)); }
      } else { setText(v.slice(0, lineStart) + '  ' + v.slice(lineStart)); requestAnimationFrame(() => ta.setSelectionRange(s + 2, en + 2)); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const ind = v.slice(lineStart).match(/^ */)[0];
      setText(v.slice(0, s) + '\n' + ind + v.slice(en));
      requestAnimationFrame(() => ta.setSelectionRange(s + 1 + ind.length, s + 1 + ind.length));
    }
  };

  const crumbs = breadcrumb(graph, realScope);
  // >v<🧭导航-上级导航-选中了节点时，面包屑后面接上「选中节点的路径」（👤 2026-10-08）：平时选中的是本页的子节点 = 只多一段（选中的那个）；
  //   选中的在别的页（搜索 / 大纲跳来的）= 把它的上级链也列出来，点上级 = 选中那个上级节点。↑ = 上一级（有选中 → 选中父节点；没选 → 回到上一层页面并选中刚离开的节点）
  const selNode = selected && graph.nodes.get(selected);
  const selTail = selNode && selected !== ROOT ? breadcrumb(graph, selected).filter(c => !crumbs.some(x => x.id === c.id)) : [];
  const goUp = () => {
    if (selNode) { if (selNode.parent === ROOT || selNode.parent == null) setSelected(null); else pick(selNode.parent); return; }
    if (realScope === ROOT) return;
    const from = realScope; go(graph.nodes.get(from).parent); setSelected(from);
  };
  // >v<🎨画布-左右栏宽度-拖栏边调宽（👤 2026-10-08），记进 view.json（样例模式 localStorage）
  const dragPanel = (e, side) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = side === 'left' ? panelW.left : panelW.right;
    const mv = ev => { const w = Math.max(180, Math.min(side === 'left' ? 1800 : 760, w0 + (side === 'left' ? 1 : -1) * (ev.clientX - x0))); setPanelW(p => ({ ...p, [side]: Math.round(w) })); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  // >v<🎬时间轴-时间轴卡-画布上的时间轴卡（main.jsx TNode）要用的数据和回调：每次渲染刷新
  cardActions.tl = {
    infoOf: tlInfoOf, labelOf: id => graph.nodes.get(id)?.label ?? id, colorOf: id => colors.get(id),
    imgOf: id => images[id]?.[0] || (getMeta(id)?.ref && images[getMeta(id).ref]?.[0]) || null,
    beatsOf: inf => { if (inf?.beats && !(inf.beats in beatsAt)) setTimeout(() => needBeats(inf.beats)); return inf?.beats ? beatsAt[inf.beats] || null : null; },
    fpsOf: inf => inf?.fps ?? (inf?.beats && beatsAt[inf.beats]?.fps) ?? null,
    leadOf: inf => { const f = inf?.fps ?? (inf?.beats && beatsAt[inf.beats]?.fps); return f ? (parseTime(inf.lead) || 0) / f : 0; },
    commit: tlCommit, shift: tlShift, toggle: tlToggle, selected, select: id => setSelected(id), open: id => { setSelected(id); setPropsOpen(true); },
    resize: (id, w) => move({ [id]: { ...(positions[id] || {}), w: Math.round(w) } }),
  };
  return (
    <div className={'shell' + (keyHints ? ' showkeys' : '')} style={{ '--zl': paneZoom.left, '--zr': paneZoom.right, '--leftw': panelW.left + 'px', '--rightw': panelW.right + 'px' }}>
      {!leftHidden && <div className="resizer left" title="拖动调宽度" onPointerDown={e => dragPanel(e, 'left')} />}
      <aside className={'outline' + (leftCols > 1 ? ' cols cols' + leftCols : '')} style={leftHidden ? { display: 'none' } : undefined}>
        <div className="bar tabs">
          {mode === 'ws' && <a className="gear" title="设置（init 生成哪些、以后的快捷键自定义…）" onClick={() => setSettingsOpen(true)}>⚙</a>}
          <a className={leftTab === 'outline' ? 'on' : ''} onClick={() => setLeftTab('outline')} title="点一下 = 画布跳过去并显示内容；双击 / Enter = 改名">大纲</a>
          <a className={leftTab === 'text' ? 'on' : ''} onClick={() => setLeftTab('text')} title="原始大纲文本：成片打字、批量改结构">文本</a>
          <a className={leftTab === 'files' ? 'on' : ''} onClick={() => setLeftTab('files')} title="项目根目录的文件（只读预览；点 __synapsis 里的节点 md → 画布跳过去）">文件</a>
          <span className="hint" title={leftTab === 'text' ? '缩进 = 子级\n-> 名称 = 连线\n✅ ◐ ○ = 状态，❌ = 弃用' : ''}>{leftTab === 'text' ? '?' : leftTab === 'files' && mode !== 'ws' ? '样例模式没有项目文件' : ''}</span>
          {leftTab === 'outline' && <a className={'groupbtn' + (outlineGroup ? ' on' : '')} onClick={() => setOutlineGroup(v => !v)} title={outlineGroup ? '分组视图：按连线连在一起的分组，组内按流向排（上游在前）。点一下回到正常次序' : '按连线分组：连在一起的一组，组内按流向排，没有连线的放最后一组'}>⛓</a>}
          {leftTab === 'outline' && mode === 'ws' && <a className="sortbtn" onClick={() => { setAgentPreset({ text: '把「' + (realScope === ROOT ? '根' : graph.nodes.get(realScope)?.label) + '」这一层的节点在大纲里按合理的先后顺序排好（只调次序，不改层级、不改连线）', n: Date.now() }); setAgentOpen(true); }} title="让 AI 把这一层按合理的先后排序：打开 AI 指令框并写好一句话，你改改再 Enter；执行后 Ctrl+Z 能撤">⇅</a>}
          {leftTab === 'outline' && <a className={'lockbtn' + (outlineLock ? ' on' : '')} onClick={() => setOutlineLock(l => l ? null : { root: realScope, scope: realScope, selected })} title={outlineLock ? '大纲已锁住：导航到别的页，列表不动，可以拖里面的节点过来。点一下解锁' : '锁住大纲：之后导航到别的页，列表还停在这里，可以拖里面的节点到别的页'}>{outlineLock ? '🔒' : '🔓'}</a>}
          {leftTab === 'outline' && <a className={'herebtn' + (hereMode ? ' on' : '')} onClick={() => setOutlineHere((hereMode + 1) % 3)} title={['↑∞ 现在显示完整大纲；点一下 → ↑1 只显示本层和上一层', '↑1 现在显示本层和上一层（同级的也在）；点一下 → ↓ 只显示本层里面', '↓ 现在只显示当前进入的节点里的子节点；点一下 → ↑∞ 回到完整大纲'][hereMode]}>{['↑∞', '↑1', '↓'][hereMode]}</a>}
          {leftTab !== 'text' && <a className={'colsbtn' + (leftCols > 1 ? ' on' : '')} onClick={() => setLeftCols(v => v % 3 + 1)} title={`内容排成 ${leftCols} 列（点一下切到 ${leftCols % 3 + 1} 列；宽度自己拖）`}>▥{leftCols > 1 ? leftCols : ''}</a>}
        </div>
        <TextFind active={leftTab === 'text'} taRef={taRef} text={text} inputRef={findRef}>
          <textarea ref={taRef} value={text} spellCheck={false} onChange={e => setText(e.target.value)} onKeyDown={onTaKey} />
        </TextFind>
        {leftTab === 'outline' && <OutlineTree graph={graph} grouped={outlineGroup} rootId={hereRoot(outlineLock ? outlineLock.root : realScope)} frozen={outlineLock} multiIds={multiIds} onSelectSet={(ids, focus) => { const u = [...new Set(ids)].sort(); setMultiIds(u.length > 1 ? u : []); setSelected(focus ?? u.at(-1) ?? null); }} selected={selected} scope={realScope} renaming={renaming} status={STATUS_ICON} colors={colors} onMove={mode === 'ws' ? () => {} : null} onReorder={(ids, target, where) => { const r = withReordered(graph, ids, target, where); if (r.error) setSaveState('⚠ ' + r.error); else setText(r.text); }}
          onPick={pick} onDrill={id => { go(id); setSelected(null); }} onRename={id => setRenaming(id)} onCommit={commitRename} onCancel={() => setRenaming(null)} />}
        {leftTab === 'files' && mode === 'ws' && <FileTree tree={tree} onOpen={onTreeOpen} current={fileView?.path} api={api} />}
        {leftTab !== 'files' && graph.errors.length > 0 && <div className="errs">{graph.errors.map((er, i) => <div key={i}>第 {er.line} 行：{er.msg}</div>)}</div>}
      </aside>
      {histOpen && mode === 'ws' && <HistoryPanel hist={hist2.current} tick={histTick} busy={histBusy} onClose={() => setHistOpen(false)} onJump={jumpHist} />}
      <main>
        <div className="bar top">
          {leftHidden && mode === 'ws' && <button className="ghost" title="设置" onClick={() => setSettingsOpen(true)}>⚙</button>}
          <button className="ghost" onClick={() => setLeftHidden(h => !h)} title="显示/隐藏左栏（大纲、文件）">{leftHidden ? '▸' : '◂'}</button>
          <button className="ghost" disabled={!selected && realScope === ROOT} onClick={goUp} title={selected ? '上一级：选中它的父节点（顶层节点 = 取消选中）' : '上一级：回到上一层页面，并选中刚离开的那个节点'}>↑</button>
          <span className="crumbs">{crumbs.map((c, i) => <span key={c.id}>{i > 0 && ' › '}<a onClick={() => { go(c.id); setSelected(null); }}>{c.label}</a></span>)}
            {selTail.map((c, i) => <span key={c.id}>{' › '}{i === selTail.length - 1 ? <a className="cur" title="当前选中的节点">{c.label}</a> : <a title="选中这个上级节点" onClick={() => pick(c.id)}>{c.label}</a>}</span>)}</span>
          <span className="grow" />
          <span className="save-wrap"><span className={'save' + (saveState.startsWith('❌') || saveState.startsWith('⚠') ? ' bad' : '')} title={wsData?.root || ''}>{mode === 'ws' ? (wsData?.root || '').split(/[\\/]/).slice(-1)[0] + ' · ' : mode === 'demo' ? '样例 · ' : ''}{saveState}</span></span>
          <button className="ghost sidetoggle" data-keyx="Shift+Tab" onClick={() => setPropsOpen(o => !o)} title="显示 / 隐藏右栏（属性）  Shift+Tab">{propsOpen ? '▸' : '◂'}</button>
        </div>
        <OverflowBar>
          <button onClick={() => addNode(false)} title="在当前层新建（选中节点时建在它后面）；建完直接打字改名">＋ 节点</button>
          {mode === 'ws' && <button className={histOpen ? '' : 'off'} data-keyx="Shift+`" title="操作历史：每一步改了什么，点一行回到那一步（Shift+`）" onClick={() => setHistOpen(o => !o)}>🕘 历史</button>}
          {withPics.length > 0 && <button onClick={() => setPicFold(f => { const g = { ...f }; for (const n of withPics) g[n.id] = !allPicsFolded; return g; })} title="当前页所有卡片的图片一起收起 / 显示">{allPicsFolded ? '显示图片' : '收起图片'}</button>}
          <button onClick={() => setExportText(exportForLLM(graph, realScope, id => wsData?.nodes[id]))}>导出给 LLM</button>
          {mode === 'ws' && <button data-keyx="Shift+F" title="AI 指令框（Shift+F）：用一句话让本地模型在当前页对齐 / 排列 / 连线 / 改状态…，先预览再执行" onClick={() => setAgentOpen(o => !o)}>💬 指令</button>}
          {mode === 'ws' && <button className={'aibtn ' + (aiStatus?.ok ? 'on' : 'off')} title={aiStatus?.ok ? 'LM Studio 已连上：语义配色 / 潜在关联 / 生成词表' : 'AI 辅助（LM Studio）：' + (aiStatus?.error || '检查中')} onClick={() => { setAiOpen(true); aiCheck(); }}>🤖 AI</button>}
          {mode === 'ws' && <button title="给这个项目补 Synapsis 的几样（手册 / 黑板 / 词表 / 快捷方式）和开发进度 / 待办 / 规矩那套文档（先检测，已有的不覆盖）" onClick={() => api('/scaffold').then(setScaffold).catch(e => setSaveState('❌ ' + e.message))}>📄 项目文件…</button>}
          {local && <button onClick={() => { if (confirm('重置大纲为样例、清空坐标与图片？')) { setText(SAMPLE); setPositions({}); setImages({}); } }}>重置</button>}
          <button className="themebtn" title={theme === 'light' ? '换深色主题' : '换白色主题'} onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '🌙' : '☀'}</button>
          <button className="keysbtn" data-key="?" title="快捷键一览（? 或 F1）" onClick={() => setHelpOpen(true)}>⌨ 快捷键</button>
        </OverflowBar>
        <div className="cwrap">
        {mode !== 'loading' && <div className="expbar">
          <button className="expmore" title="真的展开：真改本页每个节点自己的状态（进 Ctrl+Z）；下面四个是「预览展开」，只是临时看一眼" onClick={() => setExpMore(o => !o)}>⋯</button>
          {expMore && <div className="ctx expmenu">
            <div className="mh">真的展开本页（Ctrl+Z 能撤销）</div>
            {Object.entries(EXP).map(([k, E]) => { const none = !expIds(k).length, any = expAnyOpen(k); return <div key={k} className={'mi' + (none ? ' quiet' : '')} onClick={() => { if (none) return; setExpMore(false); expChange(k); }} title={none ? `本页没有可展开的${E.name}` : '有没折叠的先全部收起；已经全收起了就全部展开'}><span>{any ? '收起' : '展开'}本页{E.name}</span></div>; })}
          </div>}
          <div className="exphead" title="预览展开：只在本页临时盖一层，节点自己的状态不动、不进历史、切页不继承。要真的展开，点上面的 ⋯">预览展开</div>
          {Object.entries(EXP).map(([k, E]) => {
            const m = sm[k], none = !expIds(k).length;
            return <button key={k} data-key={EXP_KEY[k]} className={'exprow see' + (m === 'on' ? ' on' : m === 'deep' ? ' on deep' : '') + (none ? ' none' : '')}
              title={`${E.name}（${E.tip}）\n预览展开：只在本页临时盖一层，节点自己的状态不动，切页不继承\n点一下 = 只展开本页的节点（快捷键 ${EXP_KEY[k]}）；Shift+点 = 连子孙一起（Shift+${EXP_KEY[k]}）\n现在：${m === 'on' ? '预览展开中' : m === 'deep' ? '预览展开中（含子孙）' : '没开'}`} onClick={e => expSee(k, e.shiftKey)}>{E.name}{m === 'deep' ? '∞' : ''}</button>;
          })}
          <div className="expsep" />
          {mode === 'ws' && <button className={'tool pinbtn' + (pinsOpen ? ' on' : '')} data-key="`" title={'钉子：临时翻阅用的书签组（右键卡片 → 📌 钉到…；反引号 ` 开关）' + (pins.groups.some(g => g.items.length) ? '\n现有 ' + pins.groups.reduce((s, g) => s + g.items.length, 0) + ' 个钉子' : '')} onClick={() => setPinsOpen(o => !o)}>📌钉</button>}
          <button className={'tool linebtn' + (seeLines ? ' on' : '')} data-key="Q" title="看清连线（Q）：卡片缩小变淡（选中节点和它相连的不变），连线变粗变亮。再点一下恢复" onClick={() => setSeeLines(o => !o)}>🔍线</button>
          {view.portals.length + (portalModes[realScope] === 'hide' ? 1 : 0) > 0 && (() => { const pm = portalModes[realScope] || 'show'; // 👤 2026-10-11 传送门三档是「改观察」，从顶栏挪到钉 / 线旁边
            return <button className={'tool portalbtn' + (pm !== 'show' ? ' on' : '')} title={'这一页的传送门（别的层的节点）：显示 → 淡化 → 隐藏（隐藏时和选中节点相连的仍显示）\n现在：' + { show: '显示', fade: '淡化', hide: '隐藏' }[pm]} onClick={() => setPortalModes(m => ({ ...m, [realScope]: { show: 'fade', fade: 'hide', hide: 'show' }[m[realScope] || 'show'] }))}>↗{{ show: '门', fade: '淡化', hide: '隐藏' }[pm]}</button>; })()}
        </div>}
        {mode === 'loading' ? <div className="canvas"><div className="hint" style={{ padding: 20 }}>加载工作区…</div></div> : <div className={'canvas' + (seeLines ? ' seelines' : '') + (sel ? ' hassel' : '')} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
          {showTl ? null : keyHints ? <div className="keyhud" title="键位提示（H 关掉）">{KEY_HUD.map(([k, v]) => <div key={k}><KeyCombo text={k} /><span>{v}</span></div>)}<div className="hk">H 关掉 · ? 全部</div></div>
            : <div className="keychip" title="打开按键提示（H）" onClick={() => setKeyHints(true)}><KeyCombo text="H" /> 按键提示</div>} {/* 👤 2026-10-12 右下角始终有个入口 */}
          {plane && <div className="planebar" title="投影方向可以是轴，也可以是某个成员的方向（= 换一组基看同一批点）。拖动卡片 = 改它在这两个方向上的坐标">
            <b>空间</b>
            {['X', 'Y'].map((a, i) => <label key={a}>{a}<select value={plane.keys[i]} onChange={e => setSpaceAxes(m => { const k = [...plane.keys]; k[i] = e.target.value; return { ...m, [realScope]: k }; })}>
              <optgroup label="轴">{space.axes.map((x, j) => <option key={j} value={'#' + j}>{x}</option>)}</optgroup>
              {space.members.length > 0 && <optgroup label="成员方向（换基）">{space.members.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>}
            </select></label>)}
            <span className={Math.abs(plane.angle - 90) > 1 ? 'warn' : 'hint'} title="两根投影方向的夹角；不是 90° = 这组基不正交，图上的距离被拉歪了">夹角 {plane.angle.toFixed(0)}°</span>
            {space.members.length < 2 ? <span className="hint">子节点写 vec: 才会出现在这里</span> :
              <span className="hint" title="成员两两余弦，|cos| 最大的一对：这两个其实差不多是一回事">最像：{(p => `${p.a}·${p.b} ${p.cos.toFixed(2)}`)(closestPairs(space, 1)[0])}</span>}
          </div>}
          {Object.keys(sm).length > 0 && <div className="seebanner" title="点一下关掉本页所有预览展开" onClick={() => setSeeModes(m => { const r = { ...m }; delete r[realScope]; return r; })}>
            预览展开中：{Object.entries(sm).map(([k, v]) => EXP[k]?.name + (v === 'deep' ? '（含子孙）' : '')).filter(Boolean).join(' · ')}<span>节点自己没变 · 点这里关闭</span>
          </div>}
          {showTl ? <TimelineView key={realScope} info={tl} labelOf={id => graph.nodes.get(id)?.label ?? id} colorOf={id => colors.get(id)}
            imgOf={id => images[id]?.[0] || (getMeta(id)?.ref && images[getMeta(id).ref]?.[0]) || null}
            beats={beats?.src === tl.beats ? beats.data : null} fps={tlFps} lead={tlLead} selected={sel} onSelect={id => setSelected(id)}
            infoOf={tlInfoOf} onShift={tlShift} open={new Set(tlOpen[realScope] || [])} onToggle={gid => tlToggle(realScope, gid)}
            onCommit={tlCommit} onPlace={tlCommit} onOpen={id => { setSelected(id); setPropsOpen(true); }} />
          : <Canvas key={realScope} theme={theme} view={view} layout={layout} selected={sel} images={images} seeLines={seeLines} multiSel={multiIds} onMultiSel={setMultiIds}
            plane={plane && { S: plane.S, labels: plane.labels, ids: plane.pts.map(p => p.id) }}
            pics={loosePics.map(p => ({ ...p, w: positions[p.id]?.w || 0, folded: !!picFold[p.id] }))}
            onSelect={setSelected} onDrill={drill} onConnect={connect} onMove={move} onContextMenu={onContextMenu} onEdgeMenu={onEdgeMenu} onRewire={rewire} onRemoveEdges={removeEdges}
            viewport={viewports[realScope]} onViewport={vp => onViewport(realScope, vp)} />}
          {mode === 'ws' && aiStatus?.ok && sel && !sel.startsWith('@') && graph.nodes.has(sel) &&
            <RelatedDock api={api} id={sel} label={graph.nodes.get(sel).label} onJump={jumpTo} onOpenFile={openFile} onLink={to => connect(sel, to)} />}
        </div>}
        </div>
      </main>
      {propsOpen && <div className="resizer right" title="拖动调宽度" onPointerDown={e => dragPanel(e, 'right')} />}
      {propsOpen && propId && (
        <PropsPanel id={propId} graph={graph} wsNode={wsData?.nodes[propId]} edges={mode === 'ws' ? (wsData?.edges || []) : graph.edges}
          editable={mode === 'ws'} onStatus={setStatus} onBody={saveBody} onMeta={saveMeta} metaHints={mode === 'ws' ? metaHints(propId) : []} file={nodeFile(propId)} bodyMode={bodyMode} onBodyMode={setBodyMode} raw={rawText && rawText.p === nodeFile(propId) ? rawText.text : null} onReveal={reveal} onSelect={id => { const p = graph.nodes.get(id)?.parent; if (p != null && p !== realScope) go(p); setSelected(id); }} onClose={() => setPropsOpen(false)}
          onRename={commitRename} onEdgeKind={mode === 'ws' ? cycleKind : null} onEdgeRemove={(from, to) => removeEdges([[from, to]])} color={colors.get(propId)} onColor={mode === 'ws' ? (id, c) => saveMeta(id, { color: c }) : null} baseColor={propId != null && graph.nodes.has(propId) ? baseColor(graph, propId, getMeta(propId), cTables, semCols) : null} satNow={satOf(getMeta(propId))} onSat={menuActions.sat} pattern={patterns.get(propId)} onPattern={menuActions.pattern} words={wordsInfo(propId)} onWords={menuActions.words}
          hl={rawHl && rawHl.file === nodeFile(propId) ? rawHl : null} onSelMenu={mode === 'ws' ? (e, s) => setMenu({ x: e.clientX, y: e.clientY, sel: s }) : null} />
      )}
      {propsOpen && !propId && !sel && <aside className="side"><div className="bar"><b>属性</b><button onClick={() => setPropsOpen(false)}>✕</button></div><div className="sidebody hint">选中一个节点看它的属性（Shift+Tab 开关）</div></aside>}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {frameDlg && <FrameGrab file={frameDlg.file} targetLabel={frameDlg.target ? '「' + (graph.nodes.get(frameDlg.target)?.label || frameDlg.target) + '」的图' : '这一页的散图'} onClose={() => setFrameDlg(null)}
        onShot={s => { const k = frameDlg.n++; addImages(frameDlg.target, [s], frameDlg.at && { x: frameDlg.at.x + k * 30, y: frameDlg.at.y + k * 30 }); }} />}
      {settingsOpen && mode === 'ws' && <SettingsModal api={api} onClose={() => setSettingsOpen(false)} onHelp={() => setHelpOpen(true)} />}
      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}>
        <img src={lightbox.urls[lightbox.i]} onClick={e => e.stopPropagation()} />
        {lightbox.urls.length > 1 && <div className="lbcount">{lightbox.i + 1} / {lightbox.urls.length}（← →）</div>}
      </div>}
      {pinsOpen && mode === 'ws' && <PinDock doc={pins} graph={graph} edit={editPins} view={viewPins} jump={jumpPin} ask={pinAsk} onChoose={choosePinLine} onIgnore={() => setPinAsk(null)} onClose={() => setPinsOpen(false)} />}
      {agentOpen && mode === 'ws' && <AgentBox preset={agentPreset} api={api} scope={realScope} wordsScope={wordsScope} wordsLabel={wordsScope === ROOT ? '项目' : graph.nodes.get(wordsScope)?.label} boxes={() => cardActions.boxes?.() || {}} selected={cardActions.multi?.length ? cardActions.multi : sel ? [sel] : []}
        onPreview={ids => ids.length && cardActions.select?.(ids)} onClose={() => setAgentOpen(false)} onZoom={(urls, i) => setLightbox({ urls, i })}
        onWordsApplied={d => { setWsData(d); setSaveState('配色词表已更新：' + d.file); }}
        onApplied={async good => {
          const d = await api('/ai/apply', { method: 'POST', body: JSON.stringify({ actions: good, boxes: cardActions.boxes?.() || {}, at: imgAt.current }) });
          if (good.some(a => a.do === 'image' && !a.id)) { imgAt.current = null; setPositions(p => ({ ...p, ...Object.fromEntries(Object.entries(d.layout || {}).filter(([k]) => k.startsWith('@pic:'))) })); }
          lastSaved.current = d.report.outline; setText(d.report.outline); setWsData(d); recordSave(d.report.outline, d.report);
          if (Object.keys(d.moves).length) move(d.moves);
          if (d.select.length) cardActions.select?.(d.select);
          setSaveState('AI 指令已执行 ' + good.length + ' 步（Ctrl+Z 撤销）' + (d.warnings?.length ? ' ⚠ ' + d.warnings.join('；') + '（AI 下一轮会知道）' : '') + (d.imaging ? ` · 🎨 配图后台生成中（${d.imaging} 张，可以接着聊、关掉对话框）` : ''));
          if (d.imaging) watchImages(d.imgSeq);
        }} />}
      {aiOpen && <AiPanel api={api} status={aiStatus} onStatus={setAiStatus} onClose={() => setAiOpen(false)} />}
      {repl && <ReplaceBar r={repl} setR={setRepl} total={replHits.length} cur={replCur} skip={replSkip} scopeText={repl.ids ? `只在选中的 ${repl.ids.length} 张里` : '本页节点名'}
        onStep={d => setRepl(x => ({ ...x, idx: replCur + d, note: '' }))} onOne={() => replHits.length && replRun(replHits[replCur])} onAll={() => replHits.length && replRun(null)} onClose={() => setRepl(null)} />}
      {finder && <SearchModal title={finder.mode === 'link' ? '连线：「' + graph.nodes.get(finder.from)?.label + '」→ 哪个节点？' : finder.mode === 'linkfrom' ? '连线：哪个节点 → 「' + graph.nodes.get(finder.to)?.label + '」？' : finder.mode === 'import' ? '引入到这里：节点 → 传送门卡片，项目文件 → 文件节点' : '跳到节点（Ctrl+F）'} items={[...(finder.mode === 'import' ? searchItems.filter(x => !x.here && !wsData?.nodes[x.id]?.meta?.ref) : searchItems), ...fileItems]} exclude={finder.from || finder.to}
        onClose={() => setFinder(null)} onPick={id => id.startsWith('@file:') ? (finder.mode === 'link' ? linkToFile(finder.from, id.slice(6)) : finder.mode === 'import' ? addFileNodeFrom(id.slice(6)) : openFile(id.slice(6))) : finder.mode === 'link' ? connect(finder.from, id) : finder.mode === 'linkfrom' ? connect(id, finder.to) : finder.mode === 'import' ? addRefNodeFrom(id) : jumpTo(id)} />}
      {scaffold && <ScaffoldModal data={scaffold} onClose={() => setScaffold(null)}
        onCreate={(syn, files, mount) => api('/scaffold', { method: 'POST', body: JSON.stringify({ syn, files, mount }) }).then(async d => { setScaffold(null); setTree(null); setWsData(await api('/ws')); setSaveState(d.made.length ? '已创建 ' + d.made.join('、') : '没有新建（都已存在）'); }).catch(e => setSaveState('❌ ' + e.message))} />}
      {fileView && <FilePanel file={fileView.text !== undefined || fileView.error || fileView.note ? fileView : null} onClose={() => setFileView(null)} hl={fileHl && fileHl.file === fileView.path ? fileHl : null} onSelMenu={mode === 'ws' ? (e, s) => setMenu({ x: e.clientX, y: e.clientY, sel: s }) : null} />}
      {menu && <ContextMenu menu={menu} node={menu.id ? { ...graph.nodes.get(menu.id), pics: images[menu.id] || [], color: colors.get(menu.id), baseColor: graph.nodes.has(menu.id) ? baseColor(graph, menu.id, getMeta(menu.id), cTables, semCols) : null, satNow: satOf(getMeta(menu.id)), tintNow: +getMeta(menu.id)?.tint || 0, colorSet: getMeta(menu.id)?.color || null, patternSet: getMeta(menu.id)?.pattern || null, pattern: patterns.get(menu.id) || null, open: !!expanded[menu.id], file: wsData?.nodes[menu.id]?.meta?.file || null, ref: wsData?.nodes[menu.id]?.meta?.ref || null, ui: isUi(wsData?.nodes[menu.id]?.meta), descendants: (() => { let k = 0; const c = x => { for (const y of graph.nodes.get(x).children) { k++; c(y); } }; c(menu.id); return k; })() } : null}
        actions={{ ...menuActions, allOpen }} onClose={() => setMenu(null)} />}
      {exportText !== null && (
        <div className="modal" onClick={() => setExportText(null)}>
          <div onClick={e => e.stopPropagation()}>
            <div className="bar"><b>给 LLM 的结构化文本（当前范围）</b>
              <button onClick={() => navigator.clipboard.writeText(exportText)}>复制</button>
              <button onClick={() => setExportText(null)}>关闭</button></div>
            <pre>{exportText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}


// 两个画布共用的节点外观
export const STATUS_ICON = { done: '✅', partial: '◐', todo: '○', dropped: '❌' };
const PALETTE_IDLE = '#8a8a8a';
export const DISCRETE = /离散|discrete|事件|event/i; // 边的 kind 是这些 → 虚线
export const MOD = /调节|修改器|modifier|modulat/i; // 调节边：从下往上连到顶上的调节口，点线 + ◆（👤 2026-10-08 观察属性不是流进观察空间的数据）
// >v<🎨画布-边的颜色-线 = 出发节点的颜色（core/colors.js），离散 = 虚线，箭头标方向（👤 2026-10-08 去掉进出渐变）；
// 选中节点时颜色不变：相连的线变实变粗，其余变淡；没选中时越长越淡、越灰（有下限）—— 临时拖远的节点（待办）连线自然退到背景里
// near = 算作「选中」的一组 id（选中一个框时 = 框 + 框里的节点）；不给就只看 selected
// boost = 「看清连线」模式：线更粗更亮、不按长度变淡（卡片那边变淡变小，见 shell.css .seelines）
export function edgeLook(e, selected, near = null, boost = false) {
  const on = near ? near.has(e.to) || near.has(e.from) : e.to === selected || e.from === selected;
  const w = (e.mod ? 1 : 1.5) + Math.log2(e.count) * 1.5 + (boost ? 1 : 0), color = e.dropped ? PALETTE_IDLE : e.color || PALETTE_IDLE, dash = e.mod ? '2 4' : e.dashed ? '6 4' : undefined;
  const mod = !!e.mod;
  if (e.dropped && !(selected && on)) return { hl: false, color, dash, mod, opacity: selected ? 0.08 : 0.2, width: w }; // 连着弃用节点的线：灰、更淡
  if (!selected) return { hl: false, boost, color, dash, mod, opacity: e.fadedPortal ? 0.2 : boost ? 0.95 : 0.6, width: w };
  if (on) return { hl: true, boost, color, dash, mod, opacity: 1, width: w + 1.5 };
  return { hl: false, boost, color, dash, mod, opacity: e.fadedPortal ? 0.06 : boost ? 0.3 : 0.14, width: w };
}
export const FADE = { near: 350, far: 1600, minOpacity: 0.3, minSat: 0.15 }; // 画布坐标长度；短于 near 不衰减，长于 far 到下限
export function lengthFade(len) {
  const t = Math.max(0, Math.min(1, (len - FADE.near) / (FADE.far - FADE.near)));
  return { opacity: 1 - t * (1 - FADE.minOpacity), sat: 1 - t * (1 - FADE.minSat) };
}
// 把颜色往同亮度的灰拉：s = 1 原色，s = 0 全灰
export function desat(hex, s) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const g = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  return 'rgb(' + c.map(x => Math.round(g + (x - g) * s)).join(', ') + ')';
}
export function nodeDim(id, view, selected) {
  if (!selected || id === selected) return false;
  // 框和它里面的节点：选中框 → 里面的不变暗；选中框里的节点 → 外面那层框不变暗
  const inFrame = (x, f) => { for (let p = view.parentOf?.get(x); p != null; p = view.parentOf.get(p)) if (p === f) return true; return false; };
  if (inFrame(id, selected) || inFrame(selected, id)) return false;
  return !view.edges.some(e => (e.from === selected && e.to === id) || (e.to === selected && e.from === id));
}
// 卡片上的交互回调（外壳每次渲染时填好；画布组件不用逐层传）
// 画布右下角的导航 / 选择速查（H 开关）。只放画布上随时要用、按钮上看不到的
const KEY_HUD = [['F', '看全局 / 回去'], ['W A S D', '选卡'], ['Shift+W A S D', '只本层'], ['Alt+W / S', '上一层 / 进去'], ['Alt+A / D', '后退 / 前进'], ['Alt(Shift)+← →', '扩选'], ['(Shift) ← → ↑ ↓', '挪卡'], ['Ctrl(Alt)+← → ↑ ↓', '卡片大小'], ['R / T', '改名 / 建子节点'], ['E', '右键菜单']];
const NUDGE = { step: 8, fast: 4, delay: 200, interval: 100 }; // 和 core/settings.js 的 nudge 默认值一致
export const cardActions = { toggle: () => {}, openChild: () => {}, foldPics: () => {}, resizePics: () => {}, nudge: { ...NUDGE } };
// pointerdown 也要拦住，否则 React Flow 会把它当成选中或拖动的开始
const stop = e => e.stopPropagation();
// 卡片上就地改名：Enter / 失焦 = 确定，Esc = 取消；键盘和鼠标事件都不往画布冒（否则 Delete / 拖动会作用到卡片）
function RenameInput({ id, label }) {
  const done = useRef(false), el = useRef(null);
  // 新卡片要等 React Flow 量完尺寸才可见，autoFocus 会落空 → 挂上后多试几帧
  useEffect(() => {
    let n = 0, t;
    const go = () => { const i = el.current; if (!i) return; i.focus(); if (document.activeElement === i) i.select(); else if (n++ < 20) t = setTimeout(go, 25); };
    go();
    return () => clearTimeout(t);
  }, []);
  return <input ref={el} className="rename nodrag nopan" defaultValue={label} size={Math.max(4, label.length + 2)}
    onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || (e.altKey && e.code === 'KeyR')) { e.preventDefault(); done.current = true; cardActions.commitRename(id, e.target.value); } else if (e.key === 'Escape') { done.current = true; cardActions.cancelRename(); } }}
    onBlur={e => { if (!done.current) cardActions.commitRename(id, e.target.value); }} />;
}
// 卡片里改正文：高度跟着字长（手动大小的卡就在卡里滚）；Esc / 失焦 = 存
function BodyEdit({ id, body }) { // 👤 2026-10-17 和右栏正文同一个编辑器（实时预览：光标进到哪段才露出符号，真粗体、标题稍大），框跟着内容长高
  const ref = useRef(null), done = useRef(false);
  const end = () => { if (done.current) return; done.current = true; cardActions.endBody(id, ref.current ? ref.current.state.doc.toString() : body); };
  return <div className="cardedit nodrag nowheel" onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); end(); } }}>
    <MdEditor viewRef={ref} value={body || ''} autoFocus placeholder="正文（md）…  Esc 存好退出" onBlur={end} />
  </div>;
}
export function NodeCard({ node, img, dim, isSel }) {
  const pics = img?.length > 0, showPics = pics && !node.foldPics;
  // 拖图片右下角调宽度：屏幕位移 ÷ 当前缩放（从卡片实际尺寸反推，不依赖 React Flow 的 store）
  const startResize = e => {
    e.stopPropagation(); e.preventDefault();
    const card = e.currentTarget.closest('.card');
    const w0 = card.offsetWidth, z = card.getBoundingClientRect().width / w0 || 1, x0 = e.clientX;
    let w = w0;
    const mv = ev => { w = Math.max(80, w0 + (ev.clientX - x0) / z); card.style.width = w + 'px'; card.style.maxWidth = 'none'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); cardActions.resizePics(node.id, w); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  // 拖右下角改卡片大小（👤 2026-10-12）：改过就固定，内容超出 = 裁掉，选中后滚轮滚卡片里面；双击右下角 = 回到自动
  const startCardResize = e => {
    e.stopPropagation(); e.preventDefault();
    const card = e.currentTarget.closest('.card');
    const w0 = card.offsetWidth, h0 = card.offsetHeight, z = card.getBoundingClientRect().width / w0 || 1, x0 = e.clientX, y0 = e.clientY;
    let w = w0, h = h0, moved = false;
    const mv = ev => { moved = true; w = Math.max(60, w0 + (ev.clientX - x0) / z); h = Math.max(28, h0 + (ev.clientY - y0) / z); Object.assign(card.style, { width: w + 'px', height: h + 'px', maxWidth: 'none' }); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) cardActions.resizeCard(node.id, w, h); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const sized = node.sw > 0;
  return (
    <div className={'card' + (sized ? ' sized' + (isSel ? ' nowheel' : '') : '') + (node.ref ? ' refcard' : '') + (node.pattern ? ' pat-' + node.pattern : '') + (dim ? ' dim' : '') + (isSel ? ' sel' : '') + (showPics ? ' hasimg' : '') + (node.status ? ' s-' + node.status : '') + (node.dropped ? ' dropped' : '')}
      style={{ ...(node.color ? { '--c': node.color } : {}), ...(node.tint ? { '--card-tint': node.tint + '%' } : {}), ...(sized ? { width: node.sw, height: node.sh, maxWidth: 'none' } : showPics && node.picw ? { width: node.picw, maxWidth: 'none' } : node.editing ? { width: 340, maxWidth: 'none' } : node.textOpen && node.body?.trim() ? { width: 'max-content', maxWidth: 420 } : {}) }}>
      <div className="title">{node.status && <span className="st">{STATUS_ICON[node.status]}</span>}{node.renaming ? <RenameInput id={node.id} label={node.label} /> : <span className="lab">{node.label}</span>}
        {pics && <span className="picbadge" title={node.foldPics ? '显示图片' : '收起图片'} onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.foldPics(node.id); }}>🖼{img.length > 1 ? img.length : ''}</span>}
        {node.body?.trim() && <span className={'textbadge' + (node.textOpen ? ' on' : '')} title={node.textOpen ? '收起正文' : '在卡片里展开正文（md）'} onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.toggleText(node.id); }}>📄</span>}
        {!sized && showPics && node.picw > 0 && <span className="sizebadge" title={'图片宽度 ' + Math.round(node.picw) + '：点一下回到默认宽度（Ctrl+Z 能撤）'} onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.resizePics(node.id, null); }}>⇲</span>}
        {sized && <span className="sizebadge" title={'手动大小 ' + Math.round(node.sw) + '×' + Math.round(node.sh) + '：点一下回到自动（跟着内容变）'} onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.resizeCard(node.id, null); }}>⇲</span>}
        {node.propN > 0 && <span className={'propbadge' + (node.props?.length ? ' on' : '')} title={node.props?.length ? '收起卡片上的属性' : '展开属性（' + node.propN + ' 条）'} onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.toggleProps(node.id); }}>☰</span>}
        {node.children.length > 0 && <span className="kids" title="展开/收起子级（2）；双击卡片钻进" onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.toggle(node.id); }}>{node.open ? '▾' : '▸'} {node.children.length}</span>}
        {node.children.length > 0 && <span className="kids fr" title="展开子图（F）：子节点画在框里，线直连" onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.toggleFrame(node.id); }}>⊞</span>}</div>
      {(node.sub || node.evidence) && <div className="sub">{node.evidence && <span className={'ev ev-' + (EVIDENCE[node.evidence] || 'x')} title="证据等级（evidence:）">{node.evidence}</span>}{node.sub}</div>}
      {node.props?.length > 0 && <div className="props">{node.props.slice(0, 4).map(([k, v]) => <div key={k} title={k + ': ' + v}><span className="pk">{k}</span>{String(v)}</div>)}
        {node.props.length > 4 && <div className="hint">… 还有 {node.props.length - 4} 条（Shift+Tab 看全部）</div>}</div>}
      {node.ref && <div className={'sub filesub refsub' + (node.refMissing ? ' miss' : '')} title={node.refMissing ? '指向的节点不见了：' + node.ref : '传送门：指向「' + node.ref + '」（双击跳过去）'}>↗ {node.ref}{node.refMissing ? '（没找到）' : ''}</div>}
      {node.file && <div className="sub filesub" title={'引用项目里的文件：' + node.file + '（双击打开）'}>📎 {node.file}</div>}
      {node.editing ? <BodyEdit id={node.id} body={node.body} />
        : node.textOpen && node.body?.trim() && <div className="cardtext nodrag nowheel" onDoubleClick={e => e.stopPropagation()}><MdLite text={node.body} /></div>}
      {node.spaceAxes && <div className="axchips" title="空间节点：双击进去看成员的坐标投影">⊹ {node.spaceAxes.join(' · ')}</div>}
      {node.vec && <VecBars vec={node.vec} axes={node.vecAxes} />}
      {node.open && node.kids && <ul className="kidlist">{node.kids.map(k => (
        <li key={k.id} data-nid={k.id} style={k.d ? { paddingLeft: 2 + k.d * 12 } : undefined} title="双击跳进去（右键 = 这个子节点的菜单）" onPointerDown={stop} onMouseDown={stop} onDoubleClick={e => { e.stopPropagation(); cardActions.openChild(k.id); }}>
          <span className="st">{k.status ? STATUS_ICON[k.status] : '·'}</span>{k.renaming ? <RenameInput id={k.id} label={k.label} /> : <span className={k.status === 'dropped' ? 'strike' : ''}>{k.label}</span>}{k.n > 0 && <span className="kn">▸{k.n}</span>}
        </li>))}</ul>}
      {showPics && <div className={'pics n' + Math.min(img.length, 3)}>{img.map((u, i) => <img key={u} src={u} className="nodrag" draggable title="双击放大；拖到空白 = 变散图，拖到别的卡 = 换给它" onDragStart={e => { const p = new URL(u, location.href).searchParams.get('p'); e.dataTransfer.setData(DRAG_PIC, JSON.stringify({ path: p, from: node.id })); e.dataTransfer.effectAllowed = 'move'; }} onDoubleClick={e => { e.stopPropagation(); cardActions.lightbox?.(img, i); }} />)}
        <span className="picgrip nodrag" title="拖动调整大小" onPointerDown={startResize} onMouseDown={stop} onClick={stop} /></div>}
      {!showPics && <span className="cardgrip nodrag" title={sized ? '拖动改大小；双击 = 回到自动大小' : '拖动改大小（改过就固定，不再跟内容走）'} onPointerDown={startCardResize} onMouseDown={stop} onClick={stop}
        onDoubleClick={e => { e.stopPropagation(); if (sized) cardActions.resizeCard(node.id, null); }} />}
    </div>
  );
}
// >v<📐空间-卡片小横条-vec 每一维一条，0 在中间（负值往左）；超过 8 维只给维数
const EVIDENCE = { 实测: 'ok', 设计: 'design', 估计: 'guess', 未验: 'none' };
function VecBars({ vec, axes }) {
  if (vec.length > 8) return <div className="vecbars hint">{vec.length} 维向量</div>;
  const m = Math.max(1, ...vec.map(x => Math.abs(x) || 0));
  return (
    <div className="vecbars">{vec.map((x, i) => (
      <div key={i} className="vb" title={(axes?.[i] ?? '#' + i) + ' = ' + x}>
        <span className="vl">{axes?.[i] ?? i}</span>
        <span className="vt"><span className={'vf' + (x < 0 ? ' neg' : '')} style={{ width: (Math.abs(x) / m * 50 || 0) + '%', [x < 0 ? 'right' : 'left']: '50%' }} /></span>
      </div>))}</div>
  );
}
// >v<📐空间-映射热力图-边上画矩阵 W（行 = 目标轴，列 = 源轴），蓝正红负
export function MatrixChip({ mat }) {
  const m = Math.max(1e-9, ...mat.W.flat().map(x => Math.abs(x) || 0));
  return (
    <table className="matchip" title={'y = W·x\n行 = ' + mat.rows.join('、') + '\n列 = ' + mat.cols.join('、')}><tbody>
      <tr><td />{mat.cols.map((c, j) => <th key={j}>{c.slice(0, 2)}</th>)}</tr>
      {mat.W.map((r, i) => <tr key={i}><th>{(mat.rows[i] || '?').slice(0, 3)}</th>{r.map((x, j) => (
        <td key={j} title={`${mat.rows[i]} ← ${mat.cols[j]}：${x}`} style={{ background: `color-mix(in srgb, ${x < 0 ? 'var(--neg)' : 'var(--pos)'} ${Math.round(Math.abs(x) / m * 100) || 0}%, transparent)` }}>{Number.isNaN(x) ? '?' : ''}</td>))}</tr>)}
    </tbody></table>
  );
}
// 空间页的坐标轴（画在节点层最底下，不挡点击）
export function AxesCard({ S, labels }) {
  const R = S * 1.25;
  return (
    <svg className="axes" width={2 * R} height={2 * R} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
      <circle r={S} className="unit" />
      <line x1={-R} y1={0} x2={R} y2={0} /><line x1={0} y1={R} x2={0} y2={-R} />
      {[-1, 1].map(t => <g key={t}><text x={t * S} y={14} textAnchor="middle">{t}</text><text x={6} y={-t * S + 4}>{t}</text></g>)}
      <text className="al" x={R - 4} y={-8} textAnchor="end">{labels[0]} →</text>
      <text className="al" x={8} y={-R + 14}>↑ {labels[1]}</text>
    </svg>
  );
}
// 散图：没有卡片框，图就是本体（PureRef 式）；收起时是一个小签
export function PicCard({ pic, isSel }) {
  const startResize = e => {
    e.stopPropagation(); e.preventDefault();
    const el = e.currentTarget.closest('.loosepic');
    const w0 = el.offsetWidth, z = el.getBoundingClientRect().width / w0 || 1, x0 = e.clientX;
    let w = w0;
    const mv = ev => { w = Math.max(60, w0 + (ev.clientX - x0) / z); el.style.width = w + 'px'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); cardActions.resizeLoose(pic.id, w); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  if (pic.folded) return <div className={'loosepic folded' + (isSel ? ' sel' : '')} title={pic.path || ''}>🖼</div>;
  return (
    <div className={'loosepic' + (isSel ? ' sel' : '')} style={{ width: pic.w || 240 }} title={pic.path || ''}>
      <img src={pic.url} draggable={false} title="双击放大" onDoubleClick={e => { e.stopPropagation(); cardActions.lightbox?.([pic.url], 0); }} />
      <span className="picgrip nodrag" title="拖动调整大小" onPointerDown={startResize} onMouseDown={stop} onClick={stop} />
    </div>
  );
}
// 展开成框的分组：半透明底框 + 标题栏（⊟ 收起；双击标题 = 钻进去）。大小由 main.jsx 按子节点算好传进来
// >v<🖼️UI节点-卡片-线框：宽高 = meta w / h（右下角拖着改，存进节点 frontmatter）；里面（双击标题钻进去）是正常画布，位置用里面那一页自己的坐标
export function UiCard({ node, dim, isSel }) {
  const compact = !node.framed && node.children.length > 0; // 有子节点又收起子图 = 缩成一条标题（不然收起没意义）；没子节点的空框保持线框大小
  const startResize = e => {
    e.stopPropagation(); e.preventDefault();
    const box = e.currentTarget.closest('.uibox');
    const w0 = box.offsetWidth, h0 = box.offsetHeight, z = box.getBoundingClientRect().width / w0 || 1, x0 = e.clientX, y0 = e.clientY;
    let w = w0, h = h0;
    const mv = ev => { w = Math.max(40, w0 + (ev.clientX - x0) / z); h = Math.max(30, h0 + (ev.clientY - y0) / z); box.style.width = w + 'px'; box.style.height = h + 'px'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); cardActions.resizeUi(node.id, w, h); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div className={'card uibox' + (compact ? ' compact' : '') + (dim ? ' dim' : '') + (isSel ? ' sel' : '')} style={{ ...(node.tint ? { '--box-tint': node.tint + '%' } : {}), ...(compact ? {} : { width: node.uiW, height: node.uiH }), ...(node.color ? { '--c': node.color } : {}) }}>
      <div className="title">{node.renaming ? <RenameInput id={node.id} label={node.label} /> : <span className="lab">{node.label}</span>}
        <span className="uidim" title="宽 × 高（右下角拖着改）">{Math.round(node.uiW)}×{Math.round(node.uiH)}</span>
        {node.propN > 0 && <span className={'propbadge' + (node.props?.length ? ' on' : '')} title={node.props?.length ? '收起框上的属性' : '展开属性（' + node.propN + ' 条）'} onPointerDown={stop} onMouseDown={stop}
          onClick={e => { e.stopPropagation(); cardActions.toggleProps(node.id); }}>☰</span>} {/* 👤 2026-10-16 UI 框也能像普通卡一样展开手写的属性 */}
        {node.children.length > 0 && <span className="kids" title="展开子级列表（2）；双击钻进去" onPointerDown={stop} onMouseDown={stop} onClick={e => { e.stopPropagation(); cardActions.toggle(node.id); }}>{node.open ? '▾' : '▸'} {node.children.length}</span>}
        {node.children.length > 0 && <span className="kids fr" title={node.framed ? '收起子图：里面的东西不画在框里' : '展开子图：里面的东西画在框里（位置 = 钻进去那一页的坐标）'} onPointerDown={stop} onMouseDown={stop} onClick={e => { e.stopPropagation(); cardActions.toggleFrame(node.id); }}>{node.framed ? '⊟' : '⊞'}</span>}</div>
      {node.props?.length > 0 && <div className="props uiprops">{node.props.slice(0, 4).map(([k, v]) => <div key={k} title={k + ': ' + v}><span className="pk">{k}</span>{String(v)}</div>)}
        {node.props.length > 4 && <div className="hint">… 还有 {node.props.length - 4} 条（Shift+Tab 看全部）</div>}</div>}
      {node.open && node.kids && <ul className="kidlist" style={{ margin: '2px 6px' }}>{node.kids.map(k => (
        <li key={k.id} data-nid={k.id} style={k.d ? { paddingLeft: 2 + k.d * 12 } : undefined} title="双击跳进去" onPointerDown={stop} onMouseDown={stop} onDoubleClick={e => { e.stopPropagation(); cardActions.openChild(k.id); }}>
          <span className="st">{k.status ? STATUS_ICON[k.status] : '·'}</span>{k.renaming ? <RenameInput id={k.id} label={k.label} /> : <span>{k.label}</span>}{k.n > 0 && <span className="kn">▸{k.n}</span>}
        </li>))}</ul>}
      {node.framed && node.children.length > 0 && <span className={'uiall nodrag' + (node.ovOn ? ' on' : '')} title={node.ovOn ? '回到原来的视角' : '复位视角：移到里面所有节点的中点，缩放到全部显示；再点一下回到原来的'} onPointerDown={stop} onMouseDown={stop} onClick={e => { e.stopPropagation(); cardActions.fitFrame?.(node.id); }}>⛶</span>}
      {!compact && <span className="uigrip nodrag" title="拖动调整大小" onPointerDown={startResize} onMouseDown={stop} onClick={stop} />}
    </div>
  );
}
export function FrameCard({ node, dim, isSel }) {
  return (
    <div className={'frame' + (dim ? ' dim' : '') + (isSel ? ' sel' : '') + (node.dropped ? ' dropped' : '')} style={{ '--c': node.color, ...(node.tint ? { '--box-tint': node.tint + '%' } : {}) }}>
      <div className="fhead" onDoubleClick={e => { e.stopPropagation(); cardActions.drill(node.id); }} title="双击钻进去">
        {node.status && <span className="st">{STATUS_ICON[node.status]}</span>}
        {node.renaming ? <RenameInput id={node.id} label={node.label} /> : <span className="lab">{node.label}</span>}
        <span className={'frall' + (node.ovOn ? ' on' : '')} title={node.ovOn ? '回到原来的缩放' : '缩放回 100%；再点一下回到原来的'} onPointerDown={stop} onMouseDown={stop} onClick={e => { e.stopPropagation(); cardActions.fitFrame?.(node.id); }}>⛶</span>
        <span className="kids" title="收起子图（F）" onPointerDown={stop} onMouseDown={stop} onClick={e => { e.stopPropagation(); cardActions.toggleFrame(node.id); }}>⊟</span>
      </div>
    </div>
  );
}
export function PortalCard({ portal, dim }) {
  return <div className={'card portal' + (dim ? ' dim' : '') + (portal.faded ? ' faded' : '') + (portal.dropped ? ' dropped' : '')} style={portal.color ? { '--c': portal.color } : undefined} title={'在别的层：' + portal.target.split('/').join(' / ') + '（双击跳过去）'}>{portal.label}</div>;
}
