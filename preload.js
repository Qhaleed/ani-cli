const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aniCli', {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime-info'),
  searchAnime: (query) => ipcRenderer.invoke('search-anime', query),
  getEpisodes: (animeId) => ipcRenderer.invoke('get-episodes', animeId),
  getStream: (options) => ipcRenderer.invoke('get-stream', options),
  downloadEpisode: (options) => ipcRenderer.invoke('download-episode', options),
  openSetup: () => ipcRenderer.invoke('open-setup'),
  openSource: () => ipcRenderer.invoke('open-source'),
  openLicense: () => ipcRenderer.invoke('open-license'),
  openNotices: () => ipcRenderer.invoke('open-notices'),
});
