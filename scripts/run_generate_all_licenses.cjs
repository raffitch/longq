#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const scriptPath = path.resolve(__dirname, 'generate_all_licenses.sh');
const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

const pickBashExecutable = () => {
  if (!isWindows) {
    return 'bash';
  }

  const candidatePaths = [];

  const gitEnvPaths = [
    process.env.GIT_BASH,
    process.env.GIT_SHELL,
    process.env.BASH_PATH,
  ].filter(Boolean);
  candidatePaths.push(...gitEnvPaths);

  const addProgramCandidates = (baseDir) => {
    if (!baseDir) {
      return;
    }
    candidatePaths.push(path.join(baseDir, 'Git', 'bin', 'bash.exe'));
    candidatePaths.push(path.join(baseDir, 'Git', 'usr', 'bin', 'bash.exe'));
  };

  addProgramCandidates(process.env.ProgramFiles);
  addProgramCandidates(process.env['ProgramFiles(x86)']);
  addProgramCandidates(process.env.ProgramW6432);
  if (process.env.LOCALAPPDATA) {
    candidatePaths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
    candidatePaths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'));
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const sanitizedDir = dir.replace(/^"|"$/g, '');
    if (!sanitizedDir) continue;
    candidatePaths.push(path.join(sanitizedDir, 'bash.exe'));
  }

  const seen = new Set();
  for (const candidate of candidatePaths) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const whereResult = spawnSync('cmd', ['/c', 'where bash.exe'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!whereResult.error && whereResult.status === 0) {
      const locations = whereResult.stdout
        .toString()
        .split(/\r?\n/)
        .map((entry) => entry.replace(/^"|"$/g, ''))
        .filter(Boolean);
      for (const location of locations) {
        if (existsSync(location.trim())) {
          return location.trim();
        }
      }
    }
  } catch (error) {
    console.warn('Warning: failed to query "where bash.exe":', error.message);
  }

  return 'bash';
};

const bashExecutable = pickBashExecutable();

let scriptContent = readFileSync(scriptPath, 'utf8');
if (scriptContent.includes('\r')) {
  // Normalize CRLF endings so bash on Windows can execute the script.
  scriptContent = scriptContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

let repoRootForShell = repoRoot;
if (isWindows) {
  repoRootForShell = repoRoot.replace(/\\/g, '/');
  if (bashExecutable === 'bash') {
    const result = spawnSync('wsl', ['wslpath', '-a', repoRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (!result.error && result.status === 0) {
      const mapped = result.stdout.toString().trim();
      if (mapped) {
        repoRootForShell = mapped;
      }
    } else {
      console.warn(
        'Warning: Git Bash not found; falling back to default bash. Ensure WSL can access the repository paths.'
      );
    }
  }
}

const env = {
  ...process.env,
  GENERATE_LICENSES_ROOT: repoRootForShell,
};

const child = spawn(bashExecutable, ['-s', '--', ...args], {
  cwd: repoRoot,
  env,
  stdio: ['pipe', 'inherit', 'inherit'],
});

child.stdin.write(scriptContent);
child.stdin.end();

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to run generate_all_licenses.sh:', error);
  process.exitCode = 1;
});
