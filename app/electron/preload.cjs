// 只把启动台需要的几个动作暴露给页面（contextIsolation 开着，页面拿不到 Node）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('synapsisDesktop', {
  recent: () => ipcRenderer.invoke('syn:recent'),
  pickOpen: () => ipcRenderer.invoke('syn:pick-open'),
  open: dir => ipcRenderer.invoke('syn:open', dir),
  forget: dir => ipcRenderer.invoke('syn:forget', dir),
  info: () => ipcRenderer.invoke('syn:info'),
});
