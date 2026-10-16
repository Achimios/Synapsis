// >v<🤖AI辅助-界面-顶栏「🤖 AI」面板（连接状态 / 选模型 / 语义配色开关 / 生成词表）+ 画布右边缘「潜在关联」小窗（core/ai.js）
import { useState, useEffect, useRef } from 'react';
import { MdLite } from './mdlite.jsx';
import { useStash } from './stash.js';

const opts = (list = [], cur) => {
  const ids = list.map(m => m.id);
  // 当前设置的模型不在列表里（比如「qwen3-8b:2」是 LM Studio 某次加载的实例名，卸载后就没了）→ 标出来，别让人以为有两个
  return [...(cur && !ids.includes(cur) ? [cur] : []), ...ids].map(id => <option key={id} value={id}>{(m => !m ? id + '（LM Studio 里没有了，换一个）' : m.online ? '☁ ' + m.name + '（在线，按量计费）' : id + (m.loaded ? '（已加载）' : ''))(list.find(m => m.id === id))}</option>);
};

const kfmt = n => n >= 1e6 ? Math.round(n / 1048576) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);

// >v<🤖AI指令-上下文-「🧠 已用 / 容量」：问过 = LM Studio 报的真实 token；没问 = 估算（≈）。超 80% 变黄、超 100% 变红（会被截断、忘掉前面）
export function CtxMeter({ ctx, usage }) {
  if (!ctx) return null;
  const used = usage?.total_tokens || ctx.estimate?.total || 0, cap = ctx.ctx;
  const pct = cap ? used / cap : 0;
  const tip = [
    `对话模型：${ctx.model || '?'}`,
    cap ? `上下文容量：${cap} token（${/^\w+:/.test(ctx.model || '') ? '在线模型' : 'LM Studio 加载时设的'}；这个模型最多 ${ctx.maxCtx || '?'}）` : `模型还没加载，容量未知（最多 ${ctx.maxCtx || '?'}）`,
    usage?.total_tokens ? `上一次实际用了：提示 ${usage.prompt_tokens} + 回答 ${usage.completion_tokens} = ${usage.total_tokens}` : '还没问过 → 下面是估算',
    ...(ctx.estimate ? Object.entries(ctx.estimate.parts).map(([k, v]) => `  ≈ ${k} ${v}`) : []),
    cap && cap < 16000 ? '嫌小：LM Studio 里卸载模型 → 加载时把 Context Length 调大（越大越吃显存）' : '',
  ].filter(Boolean).join('\n');
  return <span className={'ctxmeter' + (pct > 1 ? ' over' : pct > 0.8 ? ' warn' : '')} title={tip}>🧠 {usage?.total_tokens ? '' : '≈'}{kfmt(used)} / {cap ? kfmt(cap) : '?'}</span>;
}

// >v<🤖AI指令-用量-日志页顶上：今天 / 近 7 天 各用了多少 token，在线和本地分开（所有项目合计；指令框、配色、关联、词表……每次调对话模型都计）。悬停看按用途拆开
function UsageBar({ api, tick }) {
  const [u, setU] = useState(null);
  useEffect(() => { api('/ai/usage').then(setU).catch(() => setU(null)); }, [tick]);
  if (!u) return null;
  const tot = s => s.p + s.c;
  const line = (label, d) => `${label}　在线 ${kfmt(tot(d.online))}（${d.online.n} 次${d.online.h ? '，缓存命中 ' + kfmt(d.online.h) : ''}）· 本地 ${kfmt(tot(d.local))}（${d.local.n} 次）`;
  const kinds = (d, side) => Object.entries(d[side].kinds).sort((a, b) => tot(b[1]) - tot(a[1])).map(([k, e]) => `  ${k}：${kfmt(tot(e))}（${e.n} 次）`).join('\n') || '  （无）';
  const tip = `今天 · 在线\n${kinds(u.today, 'online')}\n今天 · 本地\n${kinds(u.today, 'local')}\n近 7 天 · 在线\n${kinds(u.week, 'online')}\n\n提示 + 回答的 token 数（服务端报的）。嵌入不计（一直在本地跑）。所有项目合计，存在 Synapsis 的 .synapsis/ai_usage.json。`;
  return <div className="usagebar hint" title={tip}>📊 {line('今天', u.today)}　｜　{line('近 7 天', u.week)}</div>;
}

export function AiPanel({ api, status, onStatus, onClose }) {
  const [busy, setBusy] = useState('');
  const cfg = status?.cfg || {};
  const save = patch => api('/ai/config', { method: 'PUT', body: JSON.stringify(patch) }).then(onStatus).catch(e => setBusy('❌ ' + e.message));
  // >v<🤖AI辅助-设置分页-👤 2026-10-08「一页本地，一页在线，通用设置丢哪？」→ 上面「通用」（谁用本地谁用在线、语义配色、生成词表），下面两页分别配本地 / 在线
  const [tab, setTab] = useState(cfg.agentSrc === 'online' && !cfg.offline ? 'online' : 'local');
  const src = (k, label, hint) => (
    <div className="srcrow"><span>{label}<span className="hint"> {hint}</span></span>
      <span className="seg">{[['local', '本地'], ['online', '☁ 在线']].map(([v, t]) => <a key={v} className={(cfg[k] || 'local') === v ? 'on' : ''} onClick={() => save({ [k]: v })}>{t}</a>)}</span></div>
  );
  return (
    <div className="modal" onClick={onClose}>
      <div className="aipanel" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>🤖 AI 设置</b><span style={{ flex: 1 }} /><button onClick={onClose}>✕</button></div>
        <div className="aibody">
          <div className="aigroup">
            <b>通用</b>
            <TaskRows {...{ status, cfg, save }} />
            <label className="chk"><input type="checkbox" checked={!!cfg.semColors} onChange={e => save({ semColors: e.target.checked })} />语义配色：词表没认出的节点让对话模型归到词表某一行（结果缓存，有新节点才再问）</label>
            {/* >v<🤖AI指令-压缩记忆-设置（👤 2026-10-11「自动压缩参数可调丢 AI 配置页面」） */}
            {[['', '☁ 在线', 64000, 4], ['Local', '本地', 3000, 2]].map(([s, name, dl, dk]) => { const L = 'memLimit' + s, K = 'memKeep' + s, A = 'autoCompact' + s; return (
              <div key={name} className="memrow" title="指令框短记忆（不含提示词和当前页）超过这个数，就把旧对话压成一段摘要；关掉 = 超了直接丢最老的。🗜 随时手动压">
                <label className="chk"><input type="checkbox" checked={cfg[A] !== false} onChange={e => save({ [A]: e.target.checked })} />{name}短记忆超过</label>
                <input type="number" min="500" step="1000" key={L + cfg[L]} defaultValue={cfg[L] ?? dl} onBlur={e => { const v = Math.max(500, Math.round(+e.target.value || dl)); if (v !== cfg[L]) save({ [L]: v }); }} /><span>token 自动压缩，留</span>
                <input type="number" min="0" max="20" key={K + cfg[K]} defaultValue={cfg[K] ?? dk} onBlur={e => { const v = Math.max(0, Math.min(20, Math.round(+e.target.value) || 0)); if (v !== cfg[K]) save({ [K]: v }); }} /><span>轮原文</span>
              </div>); })}
            <div className="hint">按节点生成配色词表在 AI 指令框（Shift+F）的「🎨 配色词表」页 —— 这里只放设置。{busy}</div>
          </div>
          <div className="bar tabs aitabs">{[['local', '本地（LM Studio）'], ['online', '☁ 在线（DeepSeek）']].map(([k, t]) => <a key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</a>)}</div>
          {tab === 'local' ? <LocalTab {...{ api, status, cfg, save, onStatus }} /> : <OnlineTab {...{ api, status, cfg, save, onStatus }} />}
          <p className="hint">设置存在本机（Synapsis/.synapsis/ai.json），不跟项目走。连不上时 Synapsis 照常用，只是没有这些辅助。</p>
        </div>
      </div>
    </div>
  );
}

// >v<🤖AI辅助-按用途选模型-👤 2026-10-10：每个用途一行（继承 / 本地 / ☁在线 + 模型）。清单和 core/ai.js 的 TASKS 同一份（浏览器里不能 import 那个文件，改了要两边一起改）
const TASK_ROWS = [
  ['agent', 'AI 指令框', '含 ⇅ 自动排序；在线 = 宽松版，本地 = 严格版'], ['qa', '问答', '问「怎么用」时（本地严格版才走）'], ['words', '生成词表', '配色词表草稿'], ['relation', '「?」关系说明', '潜在关联里点 ? 时'],
  ['rerank', '潜在关联精排', '嵌入先召回，这一步才用对话模型逐条打分；高频、后台自动跑', true], ['semColors', '语义配色归类', '高频，改节点时触发', true], ['semPatterns', '语义图案归类', '高频，改节点时触发', true],
];
function TaskRows({ status, cfg, save }) {
  const tasks = cfg.tasks || {};
  const set = (id, patch) => {
    const t = { ...(tasks[id] || {}), ...patch };
    for (const k of Object.keys(t)) if (t[k] == null || t[k] === '') delete t[k];
    const next = { ...tasks, [id]: t }; if (!Object.keys(t).length) delete next[id];
    save({ tasks: next });
  };
  return <div className="taskrows">
    <div className="hint">每个用途单独选本地还是在线、用哪个模型；「继承」= 跟下面「默认」走。</div>
    <div className="srcrow"><span>默认：指令框 / 问答 / 词表 / 关系说明<span className="hint"> （一次一问，在线更聪明）</span></span>
      <span className="seg">{[['local', '本地'], ['online', '☁ 在线']].map(([v, t]) => <a key={v} className={(cfg.agentSrc || 'local') === v ? 'on' : ''} onClick={() => save({ agentSrc: v })}>{t}</a>)}</span></div>
    <div className="srcrow"><span>默认：高频后台（精排 / 语义配色 / 语义图案）<span className="hint"> （默认本地，免得悄悄花钱）</span></span>
      <span className="seg">{[['local', '本地'], ['online', '☁ 在线']].map(([v, t]) => <a key={v} className={(cfg.bulkSrc || 'local') === v ? 'on' : ''} onClick={() => save({ bulkSrc: v })}>{t}</a>)}</span></div>
    <div className="srcrow embedrow"><span>潜在关联召回<span className="hint"> 嵌入模型，只能本地（DeepSeek 没有嵌入接口）</span></span>
      <select value={cfg.embed || ''} onChange={e => save({ embed: e.target.value })}>{[...(cfg.embed && !(status?.embed || []).some(m => m.id === cfg.embed) ? [{ id: cfg.embed }] : []), ...(status?.embed || [])].map(m => <option key={m.id} value={m.id}>{m.id}</option>)}</select></div>
    {TASK_ROWS.map(([id, name, hint, bulk]) => {
      const own = tasks[id] || {}, dflt = cfg.offline ? 'local' : (bulk ? cfg.bulkSrc : cfg.agentSrc) === 'online' ? 'online' : 'local';
      const cur = own.src === 'local' ? 'local:' + (own.chat || '') : own.src === 'online' ? 'online:' + (own.model || '') : own.model ? 'online:' + own.model : own.chat ? 'local:' + own.chat : '';
      const pick = v => { const [src, ...m] = v.split(':'), model = m.join(':'); set(id, v ? (src === 'local' ? { src, chat: model || null, model: null } : { src, model: model || null, chat: null }) : { src: null, model: null, chat: null }); };
      return <div key={id} className="srcrow task">
        <span>{name}<span className="hint"> {hint}</span></span>
        <select value={cur} onChange={e => pick(e.target.value)} title="这个用途用哪个模型；「继承默认」= 跟上面的默认走">
          <option value="">{'继承默认（' + (dflt === 'online' ? '☁ 在线' : '本地') + '）'}</option>
          <optgroup label="本地"><option value="local:">本地 · 默认本地模型</option>{(status?.chat || []).map(m => <option key={m.id} value={'local:' + m.id}>本地 · {m.id}</option>)}</optgroup>
          <optgroup label="在线"><option value="online:">☁ 在线 · 默认在线模型</option>{(status?.online || []).map(m => <option key={m.id} value={'online:' + m.id.replace(/^\w+:/, '')}>☁ 在线 · {m.id}</option>)}</optgroup>
        </select>
      </div>;
    })}
  </div>;
}

function LocalTab({ api, status, cfg, save, onStatus }) {
  const m = status?.chat?.find(x => x.id === cfg.chat) || status?.chat?.find(x => x.loaded && x.id.replace(/:\d+$/, '') === cfg.chat);
  const [want, setWant] = useState(''), [est, setEst] = useState(null), [msg, setMsg] = useState('');
  const n = Number(want) || m?.ctx || 8192;
  const estimate = () => { setMsg('估算中…'); api('/ai/lms/estimate?model=' + encodeURIComponent(cfg.chat) + '&ctx=' + n).then(e => { setEst(e); setMsg(''); }).catch(e => setMsg('❌ ' + e.message)); };
  const reload = () => {
    setMsg('卸载 → 按 ' + n + ' 重新加载中…（几秒到几十秒）');
    api('/ai/lms/load', { method: 'POST', body: JSON.stringify({ model: cfg.chat, ctx: n }) }).then(r => { setMsg('✓ 已按 ' + r.ctx + ' 加载'); setEst(null); setWant(''); onStatus(r.status); }).catch(e => setMsg('❌ ' + e.message));
  };
  return (
    <div className="aigroup">
      <div className={'aistat ' + (status?.local ? 'on' : 'off')}>{!status ? '检查中…' : status.local ? '● 已连上 ' + cfg.url : '● ' + (status.warn || status.error)}</div>
      <details open={status && !status.local}><summary>怎么连？</summary>
        <p>LM Studio 左边 <b>Developer</b>（开发者）→ <b>Start Server</b>（或命令行 <code>lms server start</code>），默认端口 1234。
          它提供 OpenAI 兼容的 HTTP 接口，Synapsis 的本机服务直接调，<b>不需要通讯桥</b>。模型不用先手动加载，第一次用时 LM Studio 会自动加载（会慢一下）。
          玩游戏前可以在 LM Studio 里卸载模型（<code>lms unload --all</code>）腾显存。</p>
      </details>
      <label>地址<input key={cfg.url} defaultValue={cfg.url} onBlur={e => e.target.value.trim() && e.target.value !== cfg.url && save({ url: e.target.value.trim() })} /></label>
      <label>嵌入模型 <span className="hint">潜在关联（只能本地：DeepSeek 没有嵌入接口）</span><select value={cfg.embed || ''} onChange={e => save({ embed: e.target.value })}>{opts(status?.embed, cfg.embed)}</select></label>
      <label>本地对话模型 <span className="hint">「通用」里选了本地的那些活用它</span><select value={cfg.chat || ''} onChange={e => save({ chat: e.target.value })}>{opts(status?.chat, cfg.chat)}</select></label>
      {/* >v<🤖AI辅助-上下文长度-👤「context 长度能直接在 syna 里配置吗」：先估显存，再卸载 → 按新长度重新加载（core/lmstudio.js） */}
      <div className="ctxline">
        <span>🧠 上下文：{m?.ctx ? <b>{m.ctx}</b> : '未加载'} token{m?.maxCtx ? `（最多 ${m.maxCtx}）` : ''}　改成</span>
        <select value={want} onChange={e => { setWant(e.target.value); setEst(null); }}>
          <option value="">选…</option>{[8192, 16384, 24576, 32768, 40960, 65536, 131072].filter(v => !m?.maxCtx || v <= m.maxCtx).map(v => <option key={v} value={v}>{v / 1024}k</option>)}
        </select>
        <button disabled={!want} onClick={estimate}>估显存</button>
        <button disabled={!want} onClick={reload}>重新加载</button>
        <span className="hint">{msg}{est && `${est.ok ? '' : '⚠ 可能装不下：'}约 ${est.gpu ?? '?'} GiB 显存（5070 12GB，桌面常驻 ≈ 3GB）`}</span>
      </div>
    </div>
  );
}

const EFFORT_ZH = { off: '不思考（快、省钱，推荐）', low: '低', high: '高', max: '最高（慢、贵）' };
function OnlineTab({ api, status, cfg, save, onStatus }) {
  const [key, setKey] = useState(''), [msg, setMsg] = useState('');
  const has = status?.hasKey?.deepseek, list = status?.online || [];
  const putKey = k => api('/ai/key', { method: 'PUT', body: JSON.stringify({ provider: 'deepseek', key: k }) }).then(s => { onStatus(s); setKey(''); setMsg(k ? '✓ 已存' : '已删除'); }).catch(e => setMsg('❌ ' + e.message));
  const cur = list.find(x => x.id === 'deepseek:' + cfg.onlineModel);
  return (
    <div className="aigroup">
      <div className={'aistat ' + (list.length ? 'on' : 'off')}>{!status ? '检查中…' : list.length ? '● 已连上 DeepSeek（' + list.length + ' 个模型）' : has ? '● 有 key，但连不上 DeepSeek（网络？key 失效？）' : '● 还没有 key'}</div>
      <label>API key <span className="hint">只存本机 Synapsis/.synapsis/keys.json（不进 git，也不会回传到页面）</span>
        <span className="row"><input type="password" value={key} placeholder={has ? '已设置（要换就填新的）' : 'sk-…'} onChange={e => setKey(e.target.value)} style={{ flex: 1 }} />
          <button disabled={!key.trim()} onClick={() => putKey(key.trim())}>保存</button>{has && <button onClick={() => putKey('')}>删除</button>}</span></label>
      <label>在线模型<select value={cfg.onlineModel || 'deepseek-flash'} onChange={e => save({ onlineModel: e.target.value })}>
        {(list.length ? list : [{ id: 'deepseek:deepseek-flash', name: 'deepseek-flash' }, { id: 'deepseek:deepseek-v4-pro', name: 'deepseek-v4-pro' }]).map(x => <option key={x.id} value={x.id.replace(/^deepseek:/, '')}>{x.name}{/flash/i.test(x.id) ? '（快、便宜，推荐）' : /pro/i.test(x.id) ? '（更强、更贵）' : ''}</option>)}
      </select></label>
      <label>思考强度<select value={cfg.onlineEffort || 'off'} onChange={e => save({ onlineEffort: e.target.value })}>{Object.entries(EFFORT_ZH).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
      <div className="hint">{cur?.ctx ? `🧠 上下文 ${kfmt(cur.ctx)} token。` : ''}按量计费，余额在 DeepSeek 平台看。{msg}</div>
    </div>
  );
}

// >v<🤖AI辅助-潜在关联-选中一个节点 → 画布右边缘一个小签「🔗 潜在关联」；点开 = 列出最像但还没连上的节点 / 项目文档。
//   每条：点名字 = 跳过去（文档 = 打开预览），「连」= 连线，「?」= 让对话模型一句话说为什么相关
export function RelatedDock({ api, id, label, onJump, onOpenFile, onLink }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState({}); // id → {items} | {error} | {loading}
  const [why, setWhy] = useState({}); // id + '>' + otherId → 文本
  const cur = res[id];
  useEffect(() => {
    if (!open || !id || res[id]) return;
    setRes(r => ({ ...r, [id]: { loading: true } }));
    // 先给嵌入的粗排（快），再让对话模型精排前 20 条（慢几秒，带一句理由）
    api('/ai/related?id=' + encodeURIComponent(id)).then(d => {
      setRes(r => ({ ...r, [id]: { ...d, ranking: true } }));
      return api('/ai/rerank', { method: 'POST', body: JSON.stringify({ id, items: d.items }) })
        .then(x => setRes(r => ({ ...r, [id]: { items: x.items, ranked: true } })))
        .catch(e => setRes(r => ({ ...r, [id]: { ...d, rankErr: e.message } })));
    }).catch(e => setRes(r => ({ ...r, [id]: { error: e.message } })));
  }, [open, id]);
  const ask = it => {
    const k = id + '>' + it.id;
    if (why[k]) return;
    setWhy(w => ({ ...w, [k]: '…' }));
    api('/ai/explain', { method: 'POST', body: JSON.stringify({ id, other: { kind: it.kind, id: it.id } }) })
      .then(d => setWhy(w => ({ ...w, [k]: d.text }))).catch(e => setWhy(w => ({ ...w, [k]: '❌ ' + e.message })));
  };
  if (!id) return null;
  if (!open) return <div className="reldock tab" title={'和「' + label + '」可能有关、但还没连上的节点 / 文档（LM Studio 嵌入）'} onClick={() => setOpen(true)}>🔗 潜在关联</div>;
  const max = Math.max(...(cur?.items || []).map(x => x.score), 0.01), min = Math.min(...(cur?.items || []).map(x => x.score), 0);
  return (
    <div className="reldock">
      <div className="bar"><b>🔗 潜在关联</b><span className="hint" title={label}>「{label}」</span><span style={{ flex: 1 }} />
        <button title="重新算" onClick={() => setRes(r => { const q = { ...r }; delete q[id]; return q; })}>↻</button>
        <button title="收起" onClick={() => setOpen(false)}>▸</button></div>
      {!cur || cur.loading ? <div className="hint pad">算相似度…（第一次要把整个工作区嵌入一遍，之后有缓存）</div>
        : cur.error ? <div className="hint pad bad">{cur.error}</div>
        : <>{cur.ranking && <div className="hint pad">🧠 对话模型精排中…（先显示的是嵌入粗排）</div>}
          {cur.rankErr && <div className="hint pad bad">精排失败：{cur.rankErr}</div>}
          <ul>{cur.items.map(it => {
          const k = id + '>' + it.id;
          return (
            <li key={it.kind + it.id} className={it.llm === 0 ? 'weak' : ''}>
              <div className="relrow">
                {it.llm != null ? <span className={'llm l' + it.llm} title={'对话模型打分 ' + it.llm + ' / 3（0 无关 1 弱 2 有关 3 强）；嵌入相似度 ' + it.score}>{'●'.repeat(it.llm) + '○'.repeat(3 - it.llm)}</span>
                  : <span className="score" title={'嵌入相似度 ' + it.score}><i style={{ width: Math.round(20 + 80 * (it.score - min) / (max - min || 1)) + '%' }} /></span>}
                <a className={it.kind} title={it.where} onClick={() => it.kind === 'node' ? onJump(it.id) : onOpenFile(it.id)}>{it.kind === 'file' ? '📄 ' : ''}{it.label}</a>
                {it.kind === 'node' && <button title="连一条线：当前节点 → 它" onClick={() => onLink(it.id)}>连</button>}
                <button title="让对话模型一句话说说为什么相关" onClick={() => ask(it)}>?</button>
              </div>
              {it.where && <div className="where">{it.where}</div>}
              {it.why && !why[k] && <div className="why short">{it.why}</div>}
              {why[k] && <div className="why">{why[k]}</div>}
            </li>
          );
        })}</ul></>}
    </div>
  );
}

// >v<🤖AI指令-界面-AI 指令框（Shift+F）：说一句 → 8B 给动作草案（✓ 能做 / ✗ 不做 + 原因）→ 预览（涉及的节点先选中高亮）→ Enter 执行 / Esc 不要。
//   「日志」页 = 每次调对话模型的原始记录（core/ai.js aiLog）。短记忆存在工作区（「清空记忆」= 新话题）
// >v<🤖AI辅助-生成词表-按这个工作区的节点让对话模型起草 _配色.md（看过、可手改，再写入；旧的进 _过期的/）。
//   👤 2026-10-08「这种操作不该丢 AI 配置页面…丢指令页面」→ 指令框的一页
// >v<🤖AI指令-语音页-👤 2026-10-16：只选 TTS 文件夹 / 角色 / 优先后端（存 .synapsis/语音.json）；TTS 的数据每次从它的 bridge/roles.json 现读
function VoiceTab({ api }) {
  // 👤 2026-10-16 Synapsis 只是 TTS 的调用端：这里只选三样（TTS 文件夹、角色、优先后端）；角色、情绪、简介、口吻都每次从 TTS 的 bridge/roles.json 现读，
  //   读不到就停用语音、提示去找文件夹。Synapsis 不存 TTS 的任何数据
  const [d, setD] = useState(null), [msg, setMsg] = useState('');
  useEffect(() => { api('/ai/voice').then(setD).catch(e => setMsg('❌ ' + e.message)); }, []);
  const pick = set => api('/ai/voice', { method: 'PUT', body: JSON.stringify({ set }) }).then(r => { setD(r); setMsg(''); }).catch(e => setMsg('❌ ' + e.message));
  const findTts = async () => {
    const dir = window.synapsisDesktop?.pickDir ? await window.synapsisDesktop.pickDir('选 TTS 文件夹（里面有 tts_v1.py 和 bridge/roles.json）') : prompt('TTS 文件夹的完整路径（里面有 tts_v1.py）', d?.tts || '');
    if (dir) pick({ tts: dir });
  };
  if (!d) return <div className="hint pad">{msg || '读取中…'}</div>;
  return <div className="voicetab">
    <div className="row vpick">
      <label>角色 <select value={d.role} disabled={!d.roles.length} onChange={e => pick({ role: e.target.value })}>{(d.roles.includes(d.role) ? d.roles : [d.role, ...d.roles]).map(r => <option key={r} value={r}>{r}</option>)}</select></label>
      <label>优先后端 <select value={d.backend || ''} disabled={!d.ok} onChange={e => pick({ backend: e.target.value })}><option value="">自动</option>{d.backends.map(b => <option key={b} value={b}>{b}</option>)}</select></label>
      <button onClick={findTts} title={d.tts || '还没指定'}>📁 寻找 TTS 文件夹位置</button>
    </div>
    {d.ok ? <div className="hint vdesc" title={d.tts}>{d.desc}{d.moods.length ? `　情绪：${d.moods.join(' / ')}（AI 自己挑）` : ''}{d.persona ? '　有口吻设定（闲聊时可用）' : ''}</div>
      : <div className="warn">⚠ 语音停用：{d.error}</div>}
    <div className="hint">右上角 📢 打开后，☁ 在线模型自己决定什么时候说一句。角色、情绪、口吻都在 TTS 那边改。{msg}</div>
  </div>;
}
function WordsTab({ api, onWordsApplied, scope = '', label = '项目' }) { // 👤 2026-10-12 按层起草：画布没选中 = 当前画布那个节点，选中分组 = 它；写进那一层的 _词表.md
  const [draft, setDraft] = useState(null), [pdraft, setPDraft] = useState(null), [busy, setBusy] = useState('');
  const gen = () => {
    setBusy('生成中…（颜色 + 图案两份）');
    api('/ai/words', { method: 'POST', body: JSON.stringify({ scope }) }).then(d => { setDraft(d.text); setPDraft(d.pattern?.text ?? null); const bad = d.bad.length + (d.pattern?.bad.length || 0); setBusy(bad ? `有 ${bad} 行认不出，写入前可以手改` : `颜色 ${d.rules} 行 + 图案 ${d.pattern?.rules ?? 0} 行，看过可以手改再写入`); }).catch(e => setBusy('❌ ' + e.message));
  };
  const apply = () => api('/ai/words/apply', { method: 'POST', body: JSON.stringify({ text: draft, patternText: pdraft, scope }) })
    .then(d => { onWordsApplied?.(d); setDraft(null); setPDraft(null); setBusy('已写入 ' + d.file + '（旧的备份在 __synapsis/_过期的/）'); }).catch(e => setBusy('❌ ' + e.message));
  return (
    <div className="wordstab">
      <div className="hint">词表 = 每一层一份 _词表.md：「颜色」一节（名字里有某行的词，就用那行的颜色）+「图案」一节（词 → 网格 / 点阵 / 斜纹 / 横纹 / 波纹）。现在给「<b>{label}</b>」{scope ? '这个分组（只看它里面的节点）' : '整个项目'}起草；画布上选中别的分组就换成它。</div>
      <div className="row"><button onClick={gen}>✨ 给「{label}」生成词表（颜色 + 图案）…</button><span className="hint">{busy}</span></div>
      {draft != null && <>
        <div className="hint">🎨 颜色那一节</div>
        <textarea className="mono" value={draft} onChange={e => setDraft(e.target.value)} rows={10} />
        {pdraft != null && <><div className="hint">▦ 图案那一节</div><textarea className="mono" value={pdraft} onChange={e => setPDraft(e.target.value)} rows={8} /></>}
        <div className="row"><button onClick={apply}>写入「{label}」的 _词表.md</button><button onClick={() => { setDraft(null); setPDraft(null); }}>不要</button></div>
      </>}
    </div>
  );
}

// >v<🤖AI指令-框的位置和大小-👤 2026-10-08「AI 界面位置最好能拖动位置和大小」：拖标题栏移动、拖右下角改大小，记在本机（localStorage，换工作区也一样）。
//   没拖过 = 默认底部居中；双击标题栏空白处回默认。拖出窗口的会被拉回来
const GEO_KEY = 'syn.agentbox';
export function useBoxGeometry(storeKey = GEO_KEY) { // 钉子窗口也用（pindock.jsx），各自记各自的位置
  const ref = useRef(null), styleSize = useRef(null), [, bump] = useState(0);
  // 窗口缩小 → 重画一遍：记下来的位置 / 大小不改，只是显示时拉回屏幕里（窗口再放大，框回到原来记的位置）
  useEffect(() => { const f = () => bump(n => n + 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const [g, setG] = useState(() => { try { return JSON.parse(localStorage.getItem(storeKey)) || null; } catch { return null; } });
  const keep = v => { setG(v); try { v ? localStorage.setItem(storeKey, JSON.stringify(v)) : localStorage.removeItem(storeKey); } catch { /* 存不了就只这次有效 */ } };
  // 整个框都留在窗口里：太大就缩，位置超出就拉回（以前只管左上角别出去 120px，缩小窗口会把框整个挤没）
  const clamp = v => { if (!v) return v; const w = Math.min(v.width || 360, window.innerWidth - 8), h = Math.min(v.height || 200, window.innerHeight - 8); return { ...v, width: w, height: h, left: Math.max(0, Math.min(window.innerWidth - w, v.left)), top: Math.max(0, Math.min(window.innerHeight - h, v.top)) }; };
  const drag = e => {
    if (e.button !== 0 || e.target.closest('a, button, input, select, textarea, .ctxmeter')) return;
    const r = ref.current.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    const move = m => setG({ left: r.left + m.clientX - x0, top: r.top + m.clientY - y0, width: r.width, height: r.height });
    const up = m => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); keep(clamp({ left: r.left + m.clientX - x0, top: r.top + m.clientY - y0, width: r.width, height: r.height })); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    e.preventDefault();
  };
  // 拖右下角（CSS resize）改了大小 → 记下来
  useEffect(() => {
    const el = ref.current; if (!el || typeof ResizeObserver === 'undefined') return;
    let t = null, first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; }
      clearTimeout(t);
      t = setTimeout(() => { const r = el.getBoundingClientRect(), s = styleSize.current; if (s && Math.abs(r.width - s.w) < 2 && Math.abs(r.height - s.h) < 2) return; /* 这是我们自己按窗口大小缩的，不是人拖的 → 别记 */ setG(old => { const v = { left: r.left, top: r.top, width: r.width, height: r.height }; if (old && Math.abs(old.width - v.width) < 2 && Math.abs(old.height - v.height) < 2) return old; try { localStorage.setItem(storeKey, JSON.stringify(v)); } catch { /* */ } return v; }); }, 300);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [storeKey]);
  const c = clamp(g);
  styleSize.current = c ? { w: c.width, h: c.height } : null;
  return { ref, drag, reset: () => keep(null), style: c ? { left: c.left, top: c.top, width: c.width, height: c.height, bottom: 'auto', transform: 'none', maxHeight: 'none' } : undefined };
}

// >v<🤖AI指令-发图-👤 2026-10-11：指令框里 Ctrl+V / 拖进图片 → 输入框上面一排缩略图（单击放大，✕ 去掉），发送时随这一句给在线模型。
//   图不进短记忆（只记「附了几张」），也不存盘；边长超过 2048 的先缩小（省 token）
const MAX_SIDE = 2048;
const readImg = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
const shrink = url => new Promise(ok => {
  const im = new Image();
  im.onload = () => {
    const s = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight)); if (s >= 1) return ok(url);
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL(/^data:image\/jpe?g/.test(url) ? 'image/jpeg' : 'image/png', 0.9));
  };
  im.onerror = () => ok(url); im.src = url;
});
const imgFiles = dt => [...(dt?.items || [])].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);

export function AgentBox({ api, scope, selected, boxes, onApplied, onPreview, onClose, onWordsApplied, onZoom, preset = null, wordsScope = '', wordsLabel = '项目' }) {
  const [imgs, setImgs] = useState([]); // 这一句要附的图（dataURL）
  const addImgs = files => Promise.all(files.map(f => readImg(f).then(shrink))).then(us => setImgs(a => [...a, ...us].slice(0, 6)));
  const [summary, setSummary] = useState({}), [compacting, setCompacting] = useState(false); // 记忆摘要 {loose|strict: {text, upto}}；后台在压
  const takeChat = d => { setTurns(d.turns.map(t => ({ ...t, done: t.executed || [] }))); setSummary(d.summary || {}); setCompacting(!!d.compacting); }; // done = 人确认执行了的（服务端的 done 只是提议）
  // 关掉框 / 关窗口不丢（托盘重启才清，见 stash.js）：没发出的话、在哪一页、待确认的动作
  const [tab, setTab] = useStash('agent.tab', 'chat');
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem('syn.voice') === '1'; } catch { return false; } }); // 📢 AI 可以自己发语音（本机记住）
  const flipVoice = () => setVoiceOn(o => { try { localStorage.setItem('syn.voice', o ? '0' : '1'); } catch { /* */ } return !o; });
  const [turns, setTurns] = useState([]);
  const [text, setText] = useStash('agent.text', '');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (preset) { setTab('chat'); setText(preset.text); } }, [preset?.n]); // 外面的按钮（大纲 ⇅ 自动排序）预先写好一句话，人改改再 Enter
  const [plan, setPlan] = useStash('plan', null); // {say, actions}；服务端在 AI 回话时也会记一份
  // 打开时 AI 还在想（上次没等它回就关了框）→ 等它想完，把结果接回来
  useEffect(() => {
    let stop = false;
    const poll = () => api('/ui/stash').then(s => {
      if (stop) return;
      if (s.thinking) { setBusy('🧠 还在想：「' + s.thinking + '」…'); setTimeout(poll, 1000); }
      else { setBusy(b => b.startsWith('🧠') ? '' : b); if (s.plan) setPlan(s.plan); if (!('agent.text' in s) && !preset) setText(''); api('/ai/chat').then(takeChat).catch(() => {}); }
    }).catch(() => {});
    poll();
    return () => { stop = true; };
  }, []);
  const geo = useBoxGeometry();
  const [log, setLog] = useState(null);
  const [openLog, setOpenLog] = useState(null);
  const inp = useRef(null), list = useRef(null);
  // 上下文：没问之前显示估算（≈），问过之后显示 LM Studio 报的真实用量；容量 = 模型加载时设的上下文长度
  const [ctx, setCtx] = useState(null), [usage, setUsage] = useState(null);
  const loadCtx = () => api('/ai/context?scope=' + encodeURIComponent(scope || '') + '&selected=' + encodeURIComponent((selected || []).join('\n'))).then(setCtx).catch(() => {});
  useEffect(() => { loadCtx(); }, [turns.length]);
  useEffect(() => { api('/ai/chat').then(takeChat).catch(() => {}); }, []);
  // 后台在压缩：等它压完，把摘要接回来（界面上「以上已压缩」那条线跟着挪）
  useEffect(() => { if (!compacting) return; const t = setInterval(() => api('/ai/chat').then(d => { if (!d.compacting) takeChat(d); }).catch(() => {}), 1500); return () => clearInterval(t); }, [compacting]);
  const loose = /^\w+:/.test(ctx?.model || ''), mySum = summary[loose ? 'loose' : 'strict'];
  const [note, setNote] = useState(''); // 一次性提示（不挡发送；busy 非空时发不出去）
  const compact = () => { if (busy) return; setBusy('🗜 压缩中…'); setNote(''); api('/ai/chat/compact', { method: 'POST', body: '{}' }).then(d => { takeChat(d); setBusy(''); setNote(d.ok ? `🗜 压进摘要 ${d.n} 轮（原文还在，只是不再发给模型）` : '🗜 ' + d.why); }).catch(e => setBusy('❌ ' + e.message)); };
  useEffect(() => { if (tab === 'log') api('/ai/log').then(d => setLog(d.entries)).catch(e => setLog([{ kind: '❌', raw: e.message }])); }, [tab, turns.length]);
  useEffect(() => { list.current && (list.current.scrollTop = list.current.scrollHeight); }, [turns, plan, busy]);
  useEffect(() => { if (!busy) inp.current?.focus(); }, [busy, plan, tab]);
  const send = () => {
    const t = text.trim(), im = imgs; if ((!t && !im.length) || (busy && !busy.startsWith('❌'))) return;
    setBusy('🧠 思考中…（第一次要等模型加载）' + (im.length ? `　附 ${im.length} 张图` : '')); setPlan(null); setNote('');
    api('/ai/agent', { method: 'POST', body: JSON.stringify({ scope, selected, text: t, images: im, boxes: boxes?.() || {}, voice: voiceOn }) })
      .then(d => {
        setText(''); setImgs([]); setBusy(''); setUsage(d.usage?.total_tokens ? d.usage : null); if (d.compacting) setCompacting(true);
        setTurns(ts => [...ts, { t: new Date().toISOString(), user: t || '（看图）', ...(im.length ? { imgs: im } : {}), say: d.say, done: [], know: d.knowledge, memRead: d.memRead, looked: d.looked, ...(d.voice ? { voice: d.voice.text } : {}) }]); if (d.spoke && !d.spoke.ok) setNote('🔊 没念出来：' + d.spoke.why); // imgs 在这里是图本身（这次会话里还能点开看），刷新后只剩张数
        const good = d.actions.filter(a => a.ok);
        if (d.actions.length) { setPlan(d); onPreview([...new Set(good.flatMap(a => a.ids || [a.id, a.from, a.to].filter(Boolean)))]); }
      })
      .catch(e => setBusy('❌ ' + e.message));
  };
  const run = () => {
    const good = plan.actions.filter(a => a.ok); if (!good.length) return setPlan(null);
    setBusy('执行中…');
    onApplied(good).then(() => { setTurns(ts => ts.map((x, i) => i === ts.length - 1 ? { ...x, done: good.map(a => a.desc) } : x)); setPlan(null); setBusy(''); })
      .catch(e => setBusy('❌ ' + e.message));
  };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (plan) setPlan(null); else onClose(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target === inp.current) { // 只认指令输入框（词表页的文本框里 Enter = 换行）
      e.preventDefault(); e.stopPropagation();
      if (plan && !text.trim() && plan.actions.some(a => a.ok)) run(); else send();
    }
  };
  const fmt = t => new Date(t).toLocaleTimeString();
  return (
    <div className={'agentbox' + (geo.style ? ' placed' : '')} onKeyDown={key} ref={geo.ref} style={geo.style}
      onPaste={e => { if (tab !== 'chat') return; const fs = imgFiles(e.clipboardData); if (!fs.length) return; e.preventDefault(); e.stopPropagation(); addImgs(fs); }}
      onDragOver={e => { if (tab === 'chat' && [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={e => { if (tab !== 'chat') return; const fs = imgFiles(e.dataTransfer); if (!fs.length) return; e.preventDefault(); e.stopPropagation(); addImgs(fs); }}>
      <div className="bar" onPointerDown={geo.drag} onDoubleClick={e => !e.target.closest('a, button, input, select, textarea, .ctxmeter') && geo.reset()} title="拖这条移动框；拖右下角改大小；双击空白处回到默认位置">
        <b>🤖 AI 指令</b>
        <a className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>💬 对话</a>
        <a className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>📜 日志</a>
        <a className={tab === 'words' ? 'on' : ''} onClick={() => setTab('words')}>🎨 词表</a>
        <a className={tab === 'voice' ? 'on' : ''} onClick={() => setTab('voice')}>🔊 语音</a>
        <span style={{ flex: 1 }} />
        <button className={'voicebtn' + (voiceOn ? ' on' : '')} title={voiceOn ? '📢 开着：AI 可以自己决定发一句语音（只有 ☁ 在线模型）。点一下关' : '📢 关着：AI 不发语音。点一下打开（只有 ☁ 在线模型；角色、后端在「🔊 语音」页）'} onClick={flipVoice}>📢</button>
        <CtxMeter ctx={ctx} usage={usage} />
        {tab === 'chat' && <button title={'压缩短记忆：除了最近几轮，旧的对话让模型写成一段摘要（原文不删，只是不再发给模型）。自动压缩的参数在 ⋯ → 🤖 AI 设置' + (mySum ? '\n\n现在的摘要：\n' + mySum.text : '')} disabled={compacting} onClick={compact}>{compacting ? '🗜 压缩中…' : '🗜 压缩'}</button>}
        {tab === 'chat' && <button title="清空短记忆（换个话题；摘要一起清）" onClick={() => api('/ai/chat', { method: 'DELETE' }).then(d => { takeChat(d); setPlan(null); setUsage(null); setNote(''); })}>🧹 清空记忆</button>}
        <button title="关闭（Esc / Shift+F）" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
      </div>
      {tab === 'chat' ? <>
        <div className="turns" ref={list}>
          {!turns.length && !plan && <div className="hint pad">在当前页交代要做的事，比如：<br />「把这几个左对齐」「按流程从左到右排开」「观测做完了」「在决策后面加一个执行」「个性调节决策」<br />它只能做：选中 / 对齐 / 排列 / 大纲排序 / 配色 / 状态 / 连线 / 删线 / 新建 / 改名 / 移进别的节点（不能删节点）。每一步都先给你看，Enter 才执行，Ctrl+Z 能撤销。<br />也可以问怎么用：「怎么连线」「有哪些快捷键」「怎么切白色主题」—— 它查快捷键表和 AI 接入手册回答。</div>}
          {turns.map((t, i) => <div key={i} className={'turn' + (mySum?.upto && t.t && t.t <= mySum.upto ? ' squashed' : '')}>
            <div className="u">🙂 {t.user}{Array.isArray(t.imgs) ? <span className="timgs">{t.imgs.map((u, j) => <img key={j} src={u} title="单击放大" onClick={() => onZoom?.(t.imgs, j)} />)}</span> : t.imgs ? <span className="hint">　🖼 附了 {t.imgs} 张图（没保存）</span> : null}</div>
            {t.voice && <div className="know">🔊 {t.voice}</div>}
            {t.say && <div className="a">{t.say.includes('\n') ? <><span>🤖</span><MdLite text={t.say} /></> : '🤖 ' + t.say}</div>}
            {t.know?.length > 0 && !t.done?.length && <div className="know" title={t.know.join('\n')}>📖 参考了：{[...new Set(t.know.map(k => k.split('·')[0]))].join('、')}（{t.know.length} 段）</div>}
            {t.memRead?.length > 0 && <div className="know">🧠 读了记忆：{t.memRead.join('、')}</div>}
            {t.looked?.length > 0 && <div className="know">🔎 查看了：{t.looked.join('、')}</div>}
            {t.done?.length > 0 && <ul className="done">{t.done.map((d, j) => <li key={j}>✓ {d}</li>)}</ul>}
            {t.warnings?.length > 0 && <div className="know">⚠ 执行后检查：{t.warnings.join('；')}</div>}
            {mySum?.upto && t.t === mySum.upto && <details className="sumline"><summary>🗜 以上已压缩成摘要（模型只看摘要，原文留着给你看）</summary><MdLite text={mySum.text} /></details>}
          </div>)}
          {plan && plan.actions.length > 0 && <div className="plan">
            <ul>{plan.actions.map((a, i) => <li key={i} className={a.ok ? 'ok' : 'no'}>{a.ok ? '✓ ' + a.desc : `✗ ${a.do || '?'}：${a.why}`}</li>)}</ul>
            {plan.actions.some(a => a.ok)
              ? <div className="row"><button className="go" onClick={run}>✓ 执行（Enter）</button><button onClick={() => setPlan(null)}>✗ 不要（Esc）</button><span className="hint">✗ 的不会执行</span></div>
              : <div className="hint">没有能执行的动作</div>}
          </div>}
          {busy && <div className={'hint pad' + (busy.startsWith('❌') ? ' bad' : '')}>{busy}</div>}
          {note && !busy && <div className="hint pad">{note}</div>}
        </div>
        {imgs.length > 0 && <div className="askimgs">{imgs.map((u, i) => <span key={i}><img src={u} title="单击放大" onClick={() => onZoom?.(imgs, i)} /><a title="不附这张" onClick={() => setImgs(a => a.filter((_, j) => j !== i))}>✕</a></span>)}<span className="hint">{loose ? '随下一句发出（不进短记忆）' : '随下一句发出（本地模型要能看图，比如 Qwen VL）'}</span></div>}
        <textarea ref={inp} className="ask" rows={2} value={text} onChange={e => setText(e.target.value)}
          placeholder={plan?.actions.some(a => a.ok) ? 'Enter = 执行上面的动作；或者接着说（改主意 / 补充）' : '说要做什么…（Enter 发送，Shift+Enter 换行，Ctrl+V / 拖进来 = 附图）' + (selected.length ? `　已选 ${selected.length} 个` : '')} />
      </> : tab === 'voice' ? <VoiceTab api={api} /> : tab === 'words' ? <WordsTab api={api} onWordsApplied={onWordsApplied} scope={wordsScope} label={wordsLabel} /> : <div className="logs">
        <UsageBar api={api} tick={log} />
        {!log ? <div className="hint pad">读取中…</div> : !log.length ? <div className="hint pad">还没有调用记录</div> : log.map((l, i) => <div key={i} className="logrow">
          <div className="head" onClick={() => setOpenLog(openLog === i ? null : i)}>
            <span className="t">{fmt(l.t)}</span><b>{l.kind}</b><span className="hint">{l.model} · {l.ms} ms</span>{l.error && <span className="bad">❌ {l.error}</span>}
          </div>
          {openLog === i && <div className="body">
            {(l.messages || []).map((m, j) => <details key={j} open={m.role !== 'system'}><summary>{m.role}（{m.content.length} 字）</summary><pre>{m.content}</pre></details>)}
            <details open><summary>原始回答</summary><pre>{l.raw}</pre></details>
          </div>}
        </div>)}
      </div>}
    </div>
  );
}
