const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronOllama', {
  check: () => ipcRenderer.invoke('ollama:check'),
  query: (messages) => ipcRenderer.invoke('ollama:query', messages),
  pullModel: () => ipcRenderer.invoke('ollama:pull'),
});

contextBridge.exposeInMainWorld('electronEnv', {
  isElectron: true,
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
});

window.addEventListener('DOMContentLoaded', () => {
  localStorage.setItem('blackout_ollama_confirmed', 'true');
  localStorage.setItem('blackout_model_confirmed', 'true');
});
