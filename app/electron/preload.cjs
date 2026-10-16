// 只把启动台需要的几个动作暴露给页面（contextIsolation 开着，页面拿不到 Node）
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('synapsisDesktop', {
  recent: () => ipcRenderer.invoke('syn:recent'),
  pickOpen: () => ipcRenderer.invoke('syn:pick-open'),
  open: dir => ipcRenderer.invoke('syn:open', dir),
  forget: dir => ipcRenderer.invoke('syn:forget', dir),
  info: () => ipcRenderer.invoke('syn:info'),
  pickDir: title => ipcRenderer.invoke('syn:pick-dir', title), // 选一个文件夹，只返回路径（「寻找 TTS 文件夹位置」用）
});
