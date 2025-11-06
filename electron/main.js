const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { createStaticServer } = require('./serve');
const { randomUUID } = require('node:crypto');
const preloadPath = path.join(__dirname, 'preload.js');

let backendProcess = null;
let staticServer = null;
let staticPort = null;
let operatorWindow = null;
let guestWindow = null;
let backendLogPath = null;
let isAppQuitting = false;
let backendPort = Number(process.env.LONGQ_BACKEND_PORT || 0);
let apiToken = process.env.LONGQ_API_TOKEN || null;
const DEFAULT_BACKEND_PORT = 8000;
const UI_PORT = Number(process.env.LONGQ_UI_PORT || 5173);
const HEALTH_TIMEOUT_MS = 200;
const HEALTH_RETRIES = 80;
const MAX_BACKEND_LOG_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTIC_EVENTS = 32;
const diagnosticEventHistory = [];
let trimPending = false;

if (!apiToken) {
  apiToken = randomUUID();
  process.env.LONGQ_API_TOKEN = apiToken;
}

function resolveRepoRoot() {
  const candidates = [
    app.getAppPath && app.getAppPath(),
    path.resolve(__dirname),
    process.resourcesPath ? path.resolve(process.resourcesPath) : null,
  ].filter(Boolean);

  for (const start of candidates) {
    let dir = start;
    while (dir && dir !== path.parse(dir).root) {
      if (fs.existsSync(path.join(dir, 'backend', 'runner.py'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
  }
  throw new Error('Unable to locate backend/runner.py');
}

let repoRoot;
try {
  repoRoot = resolveRepoRoot();
  console.log('[longq] repo root:', repoRoot);
} catch (err) {
  console.error('[longq] failed to resolve repo root', err);
  repoRoot = path.resolve(__dirname);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      try {
        tester.close();
      } catch {
        /* ignore */
      }
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        resolve(false);
      } else {
        console.warn('[longq] unexpected error while probing port', port, err);
        resolve(false);
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

function acquireEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      server.close(() => reject(err));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error('Failed to obtain ephemeral port'));
        }
      });
    });
  });
}

async function resolveBackendPort() {
  if (backendPort && backendPort > 0) {
    if (await isPortAvailable(backendPort)) {
      return backendPort;
    }
    console.warn('[longq] requested backend port not available:', backendPort);
  }
  if (await isPortAvailable(DEFAULT_BACKEND_PORT)) {
    return DEFAULT_BACKEND_PORT;
  }
  const dynamic = await acquireEphemeralPort();
  console.log('[longq] using dynamic backend port', dynamic);
  return dynamic;
}

function pythonCandidatesForRoot(root) {
  if (!root) {
    return [];
  }
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(root, 'Scripts', 'python.exe'));
    candidates.push(path.join(root, 'python.exe'));
  } else {
    candidates.push(path.join(root, 'bin', 'python3'));
    candidates.push(path.join(root, 'bin', 'python'));
  }
  return candidates;
}

function resolveBundledPython() {
  const explicit = process.env.LONGQ_BUNDLED_PYTHON;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const roots = [];
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'backend-python'));
  }
  roots.push(path.join(repoRoot, 'backend', 'runtime'));
  roots.push(path.join(repoRoot, 'backend', '.venv'));

  for (const root of roots) {
    for (const candidate of pythonCandidatesForRoot(root)) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function resolvePythonExecutable() {
  const candidate = process.env.LONGQ_PYTHON;
  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }

  const bundled = resolveBundledPython();
  if (bundled) {
    return bundled;
  }

  const fallback = process.platform === 'win32' ? 'python' : 'python3';
  console.warn('[longq] falling back to system interpreter:', fallback);
  return fallback;
}

function getUserRoot() {
  const base = app.getPath('userData');
  const root = path.join(base, 'LongQ');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function runtimeDir(root) {
  const dir = path.join(root, 'runtime');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRuntimeFile(root, filename, contents) {
  const dir = runtimeDir(root);
  fs.writeFileSync(path.join(dir, filename), contents);
}

function ensureMaintenance(root) {
  return new Promise((resolve) => {
    const python = resolvePythonExecutable();
    const maintenanceArgs = ['-m', 'backend.maintenance', '--prune-locks', '--clean-runtime', '--nuke-tmp', '--purge-sessions'];
    if (process.env.LONGQ_SESSION_RETENTION_HOURS) {
      maintenanceArgs.push('--session-max-age-hours', String(process.env.LONGQ_SESSION_RETENTION_HOURS));
    }
    const child = spawn(
      python,
      maintenanceArgs,
      {
        cwd: repoRoot,
        env: { ...process.env, LONGQ_ROOT: root, PYTHONPATH: buildPythonPath(process.env.PYTHONPATH) },
        stdio: 'ignore',
      },
    );
    child.on('error', () => resolve());
    child.on('exit', () => resolve());
  });
}

function waitForHealth(port) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: HEALTH_TIMEOUT_MS }, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          retry();
        }
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (attempts >= HEALTH_RETRIES) {
        reject(new Error('Backend health check timed out'));
        return;
      }
      setTimeout(attempt, HEALTH_TIMEOUT_MS);
    };
    attempt();
  });
}

function buildPythonPath(existing) {
  const parts = [];
  if (existing) parts.push(existing);
  parts.push(repoRoot);
  return parts.join(path.delimiter);
}

function shouldResetDatabase() {
  const flag = (process.env.LONGQ_RESET_DB || process.env.LONGQ_CLEAN_DB || '1').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function resetDatabaseIfRequested(root) {
  if (!shouldResetDatabase()) {
    return;
  }
  try {
    const backendDir = path.join(root, 'backend');
    const dbPath = path.join(backendDir, 'app.db');
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
      console.log('[longq] removed database at', dbPath);
    }
  } catch (err) {
    console.warn('[longq] failed to remove database:', err);
  }
}

function getFrontendDistPath() {
  const candidates = [
    path.join(repoRoot, 'frontend', 'dist'),
    path.join(process.resourcesPath || '', 'frontend', 'dist'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function startStaticServerIfNeeded() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return Promise.resolve();
  }
  if (staticServer) {
    return Promise.resolve();
  }
  const distPath = getFrontendDistPath();
  if (!distPath) {
    console.warn('[longq] frontend/dist not found; continuing without static server.');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const server = createStaticServer(distPath);
    server.on('error', (err) => {
      console.error('[longq] static server error', err);
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      staticServer = server;
      const address = server.address();
      staticPort = address && typeof address === 'object' ? address.port : null;
      console.log('[longq] static server serving', distPath, 'on port', staticPort);
      resolve();
    });
  });
}

function stopStaticServer() {
  if (staticServer) {
    try {
      staticServer.close();
    } catch (err) {
      console.warn('[longq] failed to stop static server:', err);
    }
    staticServer = null;
    staticPort = null;
  }
}

function readLogTail(filePath, maxBytes = 4000) {
  if (!filePath) {
    return 'No backend log available.';
  }
  try {
    const stats = fs.statSync(filePath);
    const start = Math.max(0, stats.size - maxBytes);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8') || '(log empty)';
  } catch (err) {
    return `Unable to read backend log (${err})`;
  }
}

function maybeTrimBackendLog() {
  if (!backendLogPath) {
    return;
  }
  try {
    const stats = fs.statSync(backendLogPath);
    if (stats.size <= MAX_BACKEND_LOG_BYTES) {
      return;
    }
    const buffer = Buffer.alloc(MAX_BACKEND_LOG_BYTES);
    const fd = fs.openSync(backendLogPath, 'r');
    fs.readSync(fd, buffer, 0, MAX_BACKEND_LOG_BYTES, stats.size - MAX_BACKEND_LOG_BYTES);
    fs.closeSync(fd);
    fs.writeFileSync(backendLogPath, buffer);
    console.log('[longq] trimmed backend log to', MAX_BACKEND_LOG_BYTES, 'bytes');
  } catch (err) {
    console.warn('[longq] failed to trim backend log file', err);
  }
}

function scheduleLogTrim() {
  if (trimPending) {
    return;
  }
  trimPending = true;
  setTimeout(() => {
    trimPending = false;
    maybeTrimBackendLog();
  }, 300);
}

function broadcastDiagnosticsEvent(event) {
  if (operatorWindow && !operatorWindow.isDestroyed()) {
    operatorWindow.webContents.send('diagnostics:event', event);
  }
}

function recordDiagnosticEvent(event) {
  diagnosticEventHistory.push(event);
  if (diagnosticEventHistory.length > MAX_DIAGNOSTIC_EVENTS) {
    diagnosticEventHistory.shift();
  }
  broadcastDiagnosticsEvent(event);
}

ipcMain.handle('diagnostics:get-history', () => diagnosticEventHistory);

function setupMenu() {
  const template = [
    {
      label: process.platform === 'darwin' ? app.name : 'Quantum Qi™',
      submenu: [
        {
          label: 'About Quantum Qi™',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              buttons: ['OK'],
              title: 'About Quantum Qi™',
              message: 'Quantum Qi™ Operator Portal',
              detail: 'Desktop shell for managing guest sessions.',
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: process.platform === 'darwin' ? 'Quit' : 'Exit' },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function launchBackend(root, port) {
  return new Promise((resolve, reject) => {
    const python = resolvePythonExecutable();
    console.log('[longq] backend interpreter:', python);
    const env = {
      ...process.env,
      LONGQ_ROOT: root,
      EXIT_WHEN_IDLE: process.env.EXIT_WHEN_IDLE || 'true',
      EXIT_IDLE_DEBOUNCE_SEC: process.env.EXIT_IDLE_DEBOUNCE_SEC || '20',
      BACKEND_PORT: String(port),
      PYTHONPATH: buildPythonPath(process.env.PYTHONPATH),
    };
    const allowedOrigins = computeAllowedOrigins();
    env.ALLOWED_ORIGINS = allowedOrigins;
    console.log('[longq] backend allowed origins:', allowedOrigins);
    const runtime = runtimeDir(root);
    backendLogPath = path.join(runtime, 'backend.log');
    try {
      fs.writeFileSync(backendLogPath, '');
    } catch (err) {
      console.warn('[longq] failed to prepare backend log file', err);
    }
    const logStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
    const finishLog = () => {
      if (!logStream.destroyed) {
        logStream.end(() => maybeTrimBackendLog());
      }
    };
    const child = spawn(python, ['-m', 'backend.runner'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProcess = child;
    writeRuntimeFile(root, 'backend.pid', String(child.pid));
    writeRuntimeFile(root, 'backend.port', String(port));
    const appendLog = (chunk) => {
      try {
        if (!logStream.write(chunk)) {
          logStream.once('drain', scheduleLogTrim);
        } else {
          scheduleLogTrim();
        }
      } catch (err) {
        console.warn('[longq] failed to write backend log chunk', err);
      }
    };
    child.stdout.on('data', appendLog);
    child.stderr.on('data', appendLog);
    child.on('exit', (code, signal) => {
      appendLog(`\n[${new Date().toISOString()}] backend exited (code=${code ?? ''} signal=${signal ?? ''})\n`);
      finishLog();
      backendProcess = null;

      if (!isAppQuitting) {
        const logTail = readLogTail(backendLogPath, 16000);
        recordDiagnosticEvent({
          id: randomUUID(),
          type: 'backend-crash',
          message: `Backend exited (code=${code ?? ''} signal=${signal ?? 'none'})`,
          timestamp: new Date().toISOString(),
          logTail,
          code: code ?? null,
          signal: signal ?? null,
        });
      }
    });

    child.on('error', (err) => {
      appendLog(`\n[${new Date().toISOString()}] spawn error: ${err}\n`);
      finishLog();
      backendProcess = null;
      err.logPath = backendLogPath;

      if (!isAppQuitting) {
        const logTail = readLogTail(backendLogPath, 16000);
        recordDiagnosticEvent({
          id: randomUUID(),
          type: 'backend-error',
          message: `Backend spawn error: ${err && err.message ? err.message : err}`,
          timestamp: new Date().toISOString(),
          logTail,
          code: 999,
          signal: null,
        });
      }
      reject(err);
    });

    waitForHealth(port)
      .then(resolve)
      .catch((err) => {
        appendLog(`\n[${new Date().toISOString()}] health check failed: ${err}\n`);
        finishLog();
        err.logPath = backendLogPath;
        if (!isAppQuitting) {
          const logTail = readLogTail(backendLogPath, 16000);
          recordDiagnosticEvent({
            id: randomUUID(),
            type: 'backend-error',
            message: `Backend health check failed: ${err && err.message ? err.message : err}`,
            timestamp: new Date().toISOString(),
            logTail,
            code: 998,
            signal: null,
          });
        }
        reject(err);
      });
  });
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }
  const pid = backendProcess.pid;
  const treeKill = (() => {
    try {
      return require('tree-kill');
    } catch (err) {
      return null;
    }
  })();
  if (treeKill) {
    treeKill(pid, 'SIGTERM');
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      // ignore
    }
  }
  backendProcess = null;
}

function normalizeBaseUrl(value) {
  if (!value) {
    return value;
  }
  return value.endsWith('/') ? value : `${value}/`;
}

function resolveUiBase() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return normalizeBaseUrl(process.env.VITE_DEV_SERVER_URL);
  }
  if (process.env.LONGQ_UI_URL) {
    return normalizeBaseUrl(process.env.LONGQ_UI_URL);
  }
  if (staticPort) {
    return `http://127.0.0.1:${staticPort}/`;
  }
  return `http://127.0.0.1:${UI_PORT}/`;
}

function buildWindowUrl(pathname = '/operator', queryParams = {}) {
  const base = resolveUiBase();
  const url = new URL(pathname, base);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function injectRuntimeConfig(win, apiBase, token) {
  if (!win) {
    return;
  }
  const assignments = [
    `window.__LONGQ_API_BASE__ = ${JSON.stringify(apiBase)};`,
    token ? `window.__LONGQ_API_TOKEN__ = ${JSON.stringify(token)};` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const script = `(function(){ ${assignments} })();`;
  win.webContents.executeJavaScript(script, true).catch((err) => {
    console.warn('[longq] failed to inject runtime config into window', err);
  });
}

function computeAllowedOrigins() {
  const origins = [];
  const appendOrigin = (value) => {
    if (!value) {
      return;
    }
    let origin;
    try {
      origin = new URL(value).origin;
    } catch {
      if (typeof value === 'string') {
        const trimmed = value.trim().replace(/\/+$/, '');
        if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
          return;
        }
        try {
          origin = new URL(trimmed).origin;
        } catch {
          origin = trimmed;
        }
      }
    }
    if (origin && !origins.includes(origin)) {
      origins.push(origin);
    }
  };

  const seed = process.env.ALLOWED_ORIGINS;
  if (seed && seed.trim()) {
    for (const part of seed.split(',')) {
      appendOrigin(part.trim());
    }
  }

  appendOrigin('http://127.0.0.1:5173');
  appendOrigin('http://localhost:5173');

  if (UI_PORT && UI_PORT !== 5173) {
    appendOrigin(`http://127.0.0.1:${UI_PORT}`);
    appendOrigin(`http://localhost:${UI_PORT}`);
  }

  if (staticPort) {
    appendOrigin(`http://127.0.0.1:${staticPort}`);
    appendOrigin(`http://localhost:${staticPort}`);
  }

  appendOrigin(resolveUiBase());
  appendOrigin(process.env.VITE_DEV_SERVER_URL);
  appendOrigin(process.env.LONGQ_UI_URL);

  return origins.join(',');
}

async function createWindows() {
  const apiBase = `http://127.0.0.1:${backendPort}`;
  const query = { apiBase };
  operatorWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });
  operatorWindow.on('closed', () => {
    operatorWindow = null;
  });
  await operatorWindow.loadURL(buildWindowUrl('/operator', query));
  injectRuntimeConfig(operatorWindow, apiBase, apiToken);

  guestWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });
  guestWindow.on('closed', () => {
    guestWindow = null;
  });
  await guestWindow.loadURL(buildWindowUrl('/guest', query));
  injectRuntimeConfig(guestWindow, apiBase, apiToken);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isAppQuitting = true;
  stopBackend();
  stopStaticServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindows().catch((err) => {
      console.error('[longq] failed to recreate windows:', err);
    });
  }
});

app.whenReady().then(async () => {
  setupMenu();
  const root = getUserRoot();
  try {
    backendPort = await resolveBackendPort();
  } catch (err) {
    console.error('[longq] failed to allocate backend port:', err);
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['OK'],
      title: 'Quantum Qi™ Backend',
      message: 'Failed to allocate a port for the backend server.',
      detail: err && err.message ? err.message : String(err),
    });
    app.exit(1);
    return;
  }
  process.env.LONGQ_BACKEND_PORT = String(backendPort);
  await ensureMaintenance(root);
  resetDatabaseIfRequested(root);
  try {
    await startStaticServerIfNeeded();
    await launchBackend(root, backendPort);
  } catch (err) {
    console.error('Failed to launch backend:', err);
    const message = err && err.message ? err.message : String(err);
    const logTail = readLogTail(err && err.logPath ? err.logPath : backendLogPath);
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['OK'],
      title: 'Quantum Qi™ Backend',
      message: 'Failed to launch backend.',
      detail: `${message}\n\nLog tail:\n${logTail}`,
    });
    stopBackend();
    stopStaticServer();
    app.exit(1);
    return;
  }
  await createWindows();
});

process.on('exit', () => {
  stopBackend();
  stopStaticServer();
});

process.on('SIGINT', () => {
  isAppQuitting = true;
  stopBackend();
  stopStaticServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  isAppQuitting = true;
  stopBackend();
  stopStaticServer();
  process.exit(0);
});
