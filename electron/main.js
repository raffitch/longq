const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { createStaticServer } = require('./serve');

let backendProcess = null;
let staticServer = null;
let staticPort = null;
let operatorWindow = null;
let guestWindow = null;
let backendLogPath = null;
const BACKEND_PORT = Number(process.env.LONGQ_BACKEND_PORT || 8000);
const UI_PORT = Number(process.env.LONGQ_UI_PORT || 5173);
const HEALTH_TIMEOUT_MS = 200;
const HEALTH_RETRIES = 80;

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

function resolvePythonExecutable() {
  const candidate = process.env.LONGQ_PYTHON;
  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }

  const venvDir = path.join(repoRoot, 'backend', '.venv');
  const venvPython = path.join(
    venvDir,
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python3',
  );
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  if (process.platform === 'win32') {
    return 'python';
  }
  return 'python3';
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
    const child = spawn(
      python,
      ['-m', 'backend.maintenance', '--prune-locks', '--clean-runtime', '--nuke-tmp'],
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

function setupMenu() {
  const template = [
    {
      label: process.platform === 'darwin' ? app.name : 'Quantum Qi',
      submenu: [
        {
          label: 'About Quantum Qi',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              buttons: ['OK'],
              title: 'About Quantum Qi',
              message: 'Quantum Qi Operator Portal',
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

function launchBackend(root) {
  return new Promise((resolve, reject) => {
    const python = resolvePythonExecutable();
    const env = {
      ...process.env,
      LONGQ_ROOT: root,
      EXIT_WHEN_IDLE: process.env.EXIT_WHEN_IDLE || 'true',
      EXIT_IDLE_DEBOUNCE_SEC: process.env.EXIT_IDLE_DEBOUNCE_SEC || '20',
      BACKEND_PORT: String(BACKEND_PORT),
      PYTHONPATH: buildPythonPath(process.env.PYTHONPATH),
    };
    const runtime = runtimeDir(root);
    backendLogPath = path.join(runtime, 'backend.log');
    try {
      fs.writeFileSync(backendLogPath, '');
    } catch (err) {
      console.warn('[longq] failed to prepare backend log file', err);
    }
    const logStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
    const child = spawn(python, ['-m', 'backend.runner'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProcess = child;
    writeRuntimeFile(root, 'backend.pid', String(child.pid));
    writeRuntimeFile(root, 'backend.port', String(BACKEND_PORT));
    const appendLog = (chunk) => {
      try {
        logStream.write(chunk);
      } catch (err) {
        console.warn('[longq] failed to write backend log chunk', err);
      }
    };
    child.stdout.on('data', appendLog);
    child.stderr.on('data', appendLog);
    child.on('exit', (code, signal) => {
      appendLog(`\n[${new Date().toISOString()}] backend exited (code=${code ?? ''} signal=${signal ?? ''})\n`);
      logStream.end();
      backendProcess = null;
    });
    child.on('error', (err) => {
      appendLog(`\n[${new Date().toISOString()}] spawn error: ${err}\n`);
      logStream.end();
      backendProcess = null;
      err.logPath = backendLogPath;
      reject(err);
    });
    waitForHealth(BACKEND_PORT)
      .then(resolve)
      .catch((err) => {
        appendLog(`\n[${new Date().toISOString()}] health check failed: ${err}\n`);
        logStream.end();
        err.logPath = backendLogPath;
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

function buildWindowUrl(pathname = '/operator') {
  const normalizeBase = (base) => base.replace(/\/$/, '');
  const normalizePath = (p) => (p.startsWith('/') ? p : `/${p}`);
  const targetPath = normalizePath(pathname);

  if (process.env.VITE_DEV_SERVER_URL) {
    return `${normalizeBase(process.env.VITE_DEV_SERVER_URL)}${targetPath}`;
  }
  if (process.env.LONGQ_UI_URL) {
    return `${normalizeBase(process.env.LONGQ_UI_URL)}${targetPath}`;
  }
  if (staticPort) {
    return `http://127.0.0.1:${staticPort}${targetPath}`;
  }
  return `http://127.0.0.1:${UI_PORT}${targetPath}`;
}

async function createWindows() {
  operatorWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  operatorWindow.on('closed', () => {
    operatorWindow = null;
  });
  await operatorWindow.loadURL(buildWindowUrl('/operator'));

  guestWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  guestWindow.on('closed', () => {
    guestWindow = null;
  });
  await guestWindow.loadURL(buildWindowUrl('/guest'));
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
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
  await ensureMaintenance(root);
  resetDatabaseIfRequested(root);
  try {
    await startStaticServerIfNeeded();
    await launchBackend(root);
  } catch (err) {
    console.error('Failed to launch backend:', err);
    const message = err && err.message ? err.message : String(err);
    const logTail = readLogTail(err && err.logPath ? err.logPath : backendLogPath);
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['OK'],
      title: 'Quantum Qi Backend',
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
  stopBackend();
  stopStaticServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopBackend();
  stopStaticServer();
  process.exit(0);
});
