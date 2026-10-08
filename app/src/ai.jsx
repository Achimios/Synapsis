// >v<🤖AI辅助-界面-顶栏「🤖 AI」面板（连接状态 / 选模型 / 语义配色开关 / 生成词表）+ 画布右边缘「潜在关联」小窗（core/ai.js）
import { useState, useEffect, useRef } from 'react';
import { MdLite } from './mdlite.jsx';

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

export function AiPanel({ api, status, onStatus, onClose, onWordsApplied }) {
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState('');
  const cfg = status?.cfg || {};
  const save = patch => api('/ai/config', { method: 'PUT', body: JSON.stringify(patch) }).then(onStatus).catch(e => setBusy('❌ ' + e.message));
  const gen = () => {
    setBusy('生成中…（对话模型第一次加载要等一会儿）');
    api('/ai/words', { method: 'POST' }).then(d => { setDraft(d.text); setBusy(d.bad.length ? `有 ${d.bad.length} 行认不出，写入前可以手改` : `${d.rules} 行，看过可以手改再写入`); }).catch(e => setBusy('❌ ' + e.message));
  };
  const apply = () => api('/ai/words/apply', { method: 'POST', body: JSON.stringify({ text: draft }) })
    .then(d => { onWordsApplied(d); setDraft(null); setBusy('已写入 ' + d.file + '（旧的备份在 __synapsis/_过期的/）'); }).catch(e => setBusy('❌ ' + e.message));
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
            {src('agentSrc', 'AI 指令框 / 问答 / 生成词表 / 「?」关系说明', '（一次一问，用在线更聪明）')}
            {src('bulkSrc', '潜在关联精排 / 语义配色归类', '（高频、后台自动跑，默认本地，免得悄悄花钱）')}
            <label className="chk"><input type="checkbox" checked={!!cfg.semColors} onChange={e => save({ semColors: e.target.checked })} />语义配色：词表没认出的节点让对话模型归到词表某一行（结果缓存，有新节点才再问）</label>
            <div className="row"><button onClick={gen} disabled={!status?.ok}>✨ 按这个工作区的节点生成词表…</button><span className="hint">{busy}</span></div>
            {draft != null && <>
              <textarea className="mono" value={draft} onChange={e => setDraft(e.target.value)} rows={14} />
              <div className="row"><button onClick={apply}>写入 _配色.md</button><button onClick={() => setDraft(null)}>不要</button></div>
            </>}
          </div>
          <div className="bar tabs aitabs">{[['local', '本地（LM Studio）'], ['online', '☁ 在线（DeepSeek）']].map(([k, t]) => <a key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</a>)}</div>
          {tab === 'local' ? <LocalTab {...{ api, status, cfg, save, onStatus }} /> : <OnlineTab {...{ api, status, cfg, save, onStatus }} />}
          <p className="hint">设置存在本机（Synapsis/.synapsis/ai.json），不跟项目走。连不上时 Synapsis 照常用，只是没有这些辅助。</p>
        </div>
      </div>
    </div>
  );
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
export function AgentBox({ api, scope, selected, boxes, onApplied, onPreview, onClose }) {
  const [tab, setTab] = useState('chat');
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState(null); // {say, actions}
  const [log, setLog] = useState(null);
  const [openLog, setOpenLog] = useState(null);
  const inp = useRef(null), list = useRef(null);
  // 上下文：没问之前显示估算（≈），问过之后显示 LM Studio 报的真实用量；容量 = 模型加载时设的上下文长度
  const [ctx, setCtx] = useState(null), [usage, setUsage] = useState(null);
  const loadCtx = () => api('/ai/context?scope=' + encodeURIComponent(scope || '') + '&selected=' + encodeURIComponent((selected || []).join('\n'))).then(setCtx).catch(() => {});
  useEffect(() => { loadCtx(); }, [turns.length]);
  useEffect(() => { api('/ai/chat').then(d => setTurns(d.turns)).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'log') api('/ai/log').then(d => setLog(d.entries)).catch(e => setLog([{ kind: '❌', raw: e.message }])); }, [tab, turns.length]);
  useEffect(() => { list.current && (list.current.scrollTop = list.current.scrollHeight); }, [turns, plan, busy]);
  useEffect(() => { if (!busy) inp.current?.focus(); }, [busy, plan, tab]);
  const send = () => {
    const t = text.trim(); if (!t || busy) return;
    setBusy('🧠 思考中…（第一次要等模型加载）'); setPlan(null);
    api('/ai/agent', { method: 'POST', body: JSON.stringify({ scope, selected, text: t, boxes: boxes?.() || {} }) })
      .then(d => {
        setText(''); setBusy(''); setUsage(d.usage?.total_tokens ? d.usage : null);
        setTurns(ts => [...ts, { user: t, say: d.say, done: [], know: d.knowledge, memRead: d.memRead }]);
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
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); e.stopPropagation();
      if (plan && !text.trim() && plan.actions.some(a => a.ok)) run(); else send();
    }
  };
  const fmt = t => new Date(t).toLocaleTimeString();
  return (
    <div className="agentbox" onKeyDown={key}>
      <div className="bar">
        <b>🤖 AI 指令</b>
        <a className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>💬 对话</a>
        <a className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>📜 日志</a>
        <span style={{ flex: 1 }} />
        <CtxMeter ctx={ctx} usage={usage} />
        {tab === 'chat' && <button title="清空短记忆（换个话题）" onClick={() => api('/ai/chat', { method: 'DELETE' }).then(d => { setTurns(d.turns); setPlan(null); setUsage(null); })}>🧹 清空记忆</button>}
        <button title="关闭（Esc）" onClick={onClose}>✕</button>
      </div>
      {tab === 'chat' ? <>
        <div className="turns" ref={list}>
          {!turns.length && !plan && <div className="hint pad">在当前页交代要做的事，比如：<br />「把这几个左对齐」「按流程从左到右排开」「观测做完了」「在决策后面加一个执行」「个性调节决策」<br />它只能做：选中 / 对齐 / 排列 / 大纲排序 / 配色 / 状态 / 连线 / 删线 / 新建 / 改名 / 移进别的节点（不能删节点）。每一步都先给你看，Enter 才执行，Ctrl+Z 能撤销。<br />也可以问怎么用：「怎么连线」「有哪些快捷键」「怎么切白色主题」—— 它查快捷键表和 AI 接入手册回答。</div>}
          {turns.map((t, i) => <div key={i} className="turn">
            <div className="u">🙂 {t.user}</div>
            {t.say && <div className="a">{t.say.includes('\n') ? <><span>🤖</span><MdLite text={t.say} /></> : '🤖 ' + t.say}</div>}
            {t.know?.length > 0 && !t.done?.length && <div className="know" title={t.know.join('\n')}>📖 参考了：{[...new Set(t.know.map(k => k.split('·')[0]))].join('、')}（{t.know.length} 段）</div>}
            {t.memRead?.length > 0 && <div className="know">🧠 读了记忆：{t.memRead.join('、')}</div>}
            {t.done?.length > 0 && <ul className="done">{t.done.map((d, j) => <li key={j}>✓ {d}</li>)}</ul>}
          </div>)}
          {plan && plan.actions.length > 0 && <div className="plan">
            <ul>{plan.actions.map((a, i) => <li key={i} className={a.ok ? 'ok' : 'no'}>{a.ok ? '✓ ' + a.desc : `✗ ${a.do || '?'}：${a.why}`}</li>)}</ul>
            {plan.actions.some(a => a.ok)
              ? <div className="row"><button className="go" onClick={run}>✓ 执行（Enter）</button><button onClick={() => setPlan(null)}>✗ 不要（Esc）</button><span className="hint">✗ 的不会执行</span></div>
              : <div className="hint">没有能执行的动作</div>}
          </div>}
          {busy && <div className={'hint pad' + (busy.startsWith('❌') ? ' bad' : '')}>{busy}</div>}
        </div>
        <textarea ref={inp} className="ask" rows={2} value={text} onChange={e => setText(e.target.value)}
          placeholder={plan?.actions.some(a => a.ok) ? 'Enter = 执行上面的动作；或者接着说（改主意 / 补充）' : '说要做什么…（Enter 发送，Shift+Enter 换行）' + (selected.length ? `　已选 ${selected.length} 个` : '')} />
      </> : <div className="logs">
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
