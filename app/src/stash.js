// >v<🎛界面暂存-前端：useStash(key, 初值) = 像 useState，但值同时存到服务进程内存（/ui/stash，见 vite.config.js）。
//   关掉 AI 框、关掉窗口再打开都还在；托盘程序重启才清。shell.jsx 启动时 initStash(api) 一次。
import { useState, useEffect, useRef } from 'react';

let api = null, data = null;
const waiters = new Set();
export function initStash(a) {
  api = a; data = null;
  a('/ui/stash').catch(() => ({})).then(d => { data = d || {}; for (const f of [...waiters]) f(); });
}
export const peekStash = key => data?.[key];
export function putStash(patch) {
  if (data) Object.assign(data, patch);
  api?.('/ui/stash', { method: 'PUT', body: JSON.stringify(patch) }).catch(() => {});
}
// 服务端读回来之前先用初值；读回来时如果有存的就换上（只换一次，之后以本地为准）
export function useStash(key, init) {
  const [v, setV] = useState(() => data && key in data ? data[key] : init);
  useEffect(() => {
    if (data) return;
    const f = () => { waiters.delete(f); if (key in data) setV(data[key]); };
    waiters.add(f);
    return () => waiters.delete(f);
  }, [key]);
  const t = useRef(null);
  const set = x => setV(prev => {
    const nv = typeof x === 'function' ? x(prev) : x;
    clearTimeout(t.current);
    t.current = setTimeout(() => putStash({ [key]: nv }), 250); // 打字时别每个字发一次
    return nv;
  });
  return [v, set];
}
