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

contextBridge.exposeInMainWorld('longqLicense', {
  onManageRequest(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const channel = 'license:open-modal';
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  async openPath(targetPath) {
    if (!targetPath) {
      return { ok: false, error: 'No license path provided.' };
    }
    try {
      const result = await ipcRenderer.invoke('license:open-path', targetPath);
      return result;
    } catch (err) {
      console.warn('[longq] failed to open path', err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  },
  async openDirectory(targetPath) {
    return this.openPath ? this.openPath(targetPath) : { ok: false, error: 'openPath unavailable' };
  },
  notifyActivated() {
    ipcRenderer.send('license:activated');
  },
});
