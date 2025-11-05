const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('longqDiagnostics', {
  subscribe(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => {
      handler(payload);
    };
    ipcRenderer.on('diagnostics:event', listener);
    return () => {
      ipcRenderer.removeListener('diagnostics:event', listener);
    };
  },
  async getHistory() {
    try {
      const history = await ipcRenderer.invoke('diagnostics:get-history');
      return Array.isArray(history) ? history : [];
    } catch (err) {
      console.warn('[longq] failed to obtain diagnostics history from main process', err);
      return [];
    }
  },
});
