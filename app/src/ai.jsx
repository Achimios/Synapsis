// >v<🤖AI辅助-界面-顶栏「🤖 AI」面板（连接状态 / 选模型 / 语义配色开关 / 生成词表）+ 画布右边缘「潜在关联」小窗（core/ai.js）
import { useState, useEffect, useRef } from 'react';

const opts = (list = [], cur) => {
  const ids = list.map(m => m.id);
  return [...(cur && !ids.includes(cur) ? [cur] : []), ...ids].map(id => <option key={id} value={id}>{id}{list.find(m => m.id === id)?.loaded ? '（已加载）' : ''}</option>);
};

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
  return (
    <div className="modal" onClick={onClose}>
      <div className="aipanel" onClick={e => e.stopPropagation()}>
        <div className="bar"><b>🤖 AI 辅助（LM Studio）</b><span style={{ flex: 1 }} /><button onClick={onClose}>✕</button></div>
        <div className="aibody">
          <div className={'aistat ' + (status?.ok ? 'on' : 'off')}>{!status ? '检查中…' : status.ok ? '● 已连上 ' + cfg.url : '● ' + status.error}</div>
          <details open={status && !status.ok}><summary>怎么连？</summary>
            <p>LM Studio 左边 <b>Developer</b>（开发者）→ <b>Start Server</b>（或命令行 <code>lms server start</code>），默认端口 1234。
              它提供 OpenAI 兼容的 HTTP 接口，Synapsis 的本机服务直接调，<b>不需要通讯桥</b>。模型不用先手动加载，第一次用时 LM Studio 会自动加载（会慢一下）。
              玩游戏前可以在 LM Studio 里卸载模型（<code>lms unload --all</code>）腾显存。</p>
          </details>
          <label>地址<input key={cfg.url} defaultValue={cfg.url} onBlur={e => e.target.value.trim() && e.target.value !== cfg.url && save({ url: e.target.value.trim() })} /></label>
          <label>嵌入模型 <span className="hint">潜在关联</span><select value={cfg.embed || ''} onChange={e => save({ embed: e.target.value })}>{opts(status?.embed, cfg.embed)}</select></label>
          <label>对话模型 <span className="hint">配色归类 / 生成词表 / 一句话说明关系</span><select value={cfg.chat || ''} onChange={e => save({ chat: e.target.value })}>{opts(status?.chat, cfg.chat)}</select></label>
          <label className="chk"><input type="checkbox" checked={!!cfg.semColors} onChange={e => save({ semColors: e.target.checked })} />语义配色：词表没认出的节点让对话模型归到词表某一行（结果缓存，有新节点才再问）</label>
          <div className="row"><button onClick={gen} disabled={!status?.ok}>✨ 按这个工作区的节点生成词表…</button><span className="hint">{busy}</span></div>
          {draft != null && <>
            <textarea className="mono" value={draft} onChange={e => setDraft(e.target.value)} rows={14} />
            <div className="row"><button onClick={apply}>写入 _配色.md</button><button onClick={() => setDraft(null)}>不要</button></div>
          </>}
          <p className="hint">设置存在本机（Synapsis/.synapsis/ai.json），不跟项目走。连不上时 Synapsis 照常用，只是没有这些辅助。</p>
        </div>
      </div>
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

// >v<🤖AI指令-界面-AI 指令框（Ctrl+J）：说一句 → 8B 给动作草案（✓ 能做 / ✗ 不做 + 原因）→ 预览（涉及的节点先选中高亮）→ Enter 执行 / Esc 不要。
//   「日志」页 = 每次调对话模型的原始记录（core/ai.js aiLog）。短记忆存在工作区（「清空记忆」= 新话题）
export function AgentBox({ api, scope, selected, onApplied, onPreview, onClose }) {
  const [tab, setTab] = useState('chat');
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState(null); // {say, actions}
  const [log, setLog] = useState(null);
  const [openLog, setOpenLog] = useState(null);
  const inp = useRef(null), list = useRef(null);
  useEffect(() => { api('/ai/chat').then(d => setTurns(d.turns)).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'log') api('/ai/log').then(d => setLog(d.entries)).catch(e => setLog([{ kind: '❌', raw: e.message }])); }, [tab, turns.length]);
  useEffect(() => { list.current && (list.current.scrollTop = list.current.scrollHeight); }, [turns, plan, busy]);
  useEffect(() => { if (!busy) inp.current?.focus(); }, [busy, plan, tab]);
  const send = () => {
    const t = text.trim(); if (!t || busy) return;
    setBusy('🧠 思考中…（第一次要等模型加载）'); setPlan(null);
    api('/ai/agent', { method: 'POST', body: JSON.stringify({ scope, selected, text: t }) })
      .then(d => {
        setText(''); setBusy('');
        setTurns(ts => [...ts, { user: t, say: d.say, done: [] }]);
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
        {tab === 'chat' && <button title="清空短记忆（换个话题）" onClick={() => api('/ai/chat', { method: 'DELETE' }).then(d => { setTurns(d.turns); setPlan(null); })}>🧹 清空记忆</button>}
        <button title="关闭（Esc / Ctrl+J）" onClick={onClose}>✕</button>
      </div>
      {tab === 'chat' ? <>
        <div className="turns" ref={list}>
          {!turns.length && !plan && <div className="hint pad">在当前页交代要做的事，比如：<br />「把这几个左对齐」「按流程从左到右排开」「观测做完了」「在决策后面加一个执行」「个性调节决策」<br />它只能做：选中 / 对齐 / 排列 / 大纲排序 / 配色 / 状态 / 连线 / 删线 / 新建 / 改名 / 移进别的节点（不能删节点）。每一步都先给你看，Enter 才执行，Ctrl+Z 能撤销。</div>}
          {turns.map((t, i) => <div key={i} className="turn">
            <div className="u">🙂 {t.user}</div>
            {t.say && <div className="a">🤖 {t.say}</div>}
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
