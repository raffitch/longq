#!/usr/bin/env node

/**
 * Cross-platform helper to build the bundled Python runtime, package the Electron app,
 * and clean generated artifacts. Usage:
 *
 *   node scripts/electron-package.mjs build-runtime
 *   node scripts/electron-package.mjs package [--skip-runtime] [--clean]
 *   node scripts/electron-package.mjs clean
 */

import { spawnSync } from 'node:child_process';
import { rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendDir = join(repoRoot, 'backend');
const frontendDir = join(repoRoot, 'frontend');
const electronDir = join(repoRoot, 'electron');
const runtimeDir = join(backendDir, 'runtime');
const distDir = join(electronDir, 'dist');
const isWindows = process.platform === 'win32';

function fail(message, error) {
  console.error(`\n❌ ${message}`);
  if (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

function run(command, args = [], options = {}) {
  console.log(`\n▶ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function probePython(command, args = []) {
  const result = spawnSync(command, [...args, '--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    return null;
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const match = output.match(/Python\s+(\d+)\.(\d+)/i);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (Number.isNaN(major) || Number.isNaN(minor)) {
    return null;
  }
  if (major === 3 && minor >= 13) {
    return { command, args };
  }
  return null;
}

function detectPythonLauncher() {
  const candidates = isWindows
    ? [
        { command: 'py', args: ['-3.13'] },
        { command: 'py', args: ['-3'] },
        { command: 'python3.13', args: [] },
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ]
    : [
        { command: 'python3.13', args: [] },
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ];
  for (const candidate of candidates) {
    const match = probePython(candidate.command, candidate.args);
    if (match) {
      console.log(`Detected Python launcher: ${candidate.command} ${candidate.args.join(' ')}`.trim());
      return match;
    }
  }
  fail('Unable to locate a Python 3.13 interpreter. Install Python 3.13 and ensure it is on PATH (or set LONGQ_PYTHON).');
}

function runtimePythonPath() {
  const subdir = isWindows ? 'Scripts' : 'bin';
  const binary = isWindows ? 'python.exe' : 'python3';
  return join(runtimeDir, subdir, binary);
}

function ensureRuntimeExists() {
  try {
    const stats = statSync(runtimeDir);
    if (!stats.isDirectory()) {
      throw new Error('runtime path exists but is not a directory');
    }
    return true;
  } catch {
    return false;
  }
}

function removeDir(target) {
  if (!existsSync(target)) {
    return;
  }
  console.log(`Removing ${target}`);
  rmSync(target, { recursive: true, force: true });
}

function ensureNpmInstall(targetDir) {
  const nodeModules = join(targetDir, 'node_modules');
  if (existsSync(nodeModules)) {
    return;
  }
  run(npmCommand(), ['install'], { cwd: targetDir });
}

function npmCommand() {
  return isWindows ? 'npm.cmd' : 'npm';
}

function copyStdlibIntoRuntime(pythonBinary) {
  const script = `
import os
import shutil
import sys
import sysconfig

runtime = os.environ.get('LONGQ_RUNTIME_DIR')
if not runtime:
    raise SystemExit('LONGQ_RUNTIME_DIR is not set')
runtime = os.path.abspath(runtime)
stdlib = sysconfig.get_path('stdlib')
runtime_abs = os.path.abspath(runtime)
stdlib_abs = os.path.abspath(stdlib)

if os.path.commonpath([runtime_abs, stdlib_abs]) == runtime_abs:
    print(f'[longq:package] stdlib already resides inside runtime: {stdlib_abs}')
    raise SystemExit(0)

target = os.path.join(runtime_abs, 'lib', f'python{sys.version_info.major}.{sys.version_info.minor}')
os.makedirs(target, exist_ok=True)

skip = {'site-packages'}
print(f'[longq:package] copying stdlib from {stdlib_abs} -> {target}')

for entry in os.listdir(stdlib_abs):
    if entry in skip:
        continue
    src = os.path.join(stdlib_abs, entry)
    dst = os.path.join(target, entry)
    if os.path.isdir(src):
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst, symlinks=True)
    else:
        parent = os.path.dirname(dst)
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)
        if os.path.exists(dst):
            os.remove(dst)
        shutil.copy2(src, dst)

print('[longq:package] stdlib copy complete')
`;
  const env = { ...process.env, LONGQ_RUNTIME_DIR: runtimeDir };
  run(pythonBinary, ['-c', script], { cwd: backendDir, env });
}

function buildRuntime() {
  const launcher = detectPythonLauncher();

  removeDir(runtimeDir);
  run(launcher.command, [...launcher.args, '-m', 'venv', 'runtime', '--copies', '--upgrade-deps'], { cwd: backendDir });

  const python = runtimePythonPath();

  run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: backendDir });
  run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: backendDir });

  copyStdlibIntoRuntime(python);

  run(python, [join(backendDir, 'maintenance.py'), '--help']);
}

function buildFrontend() {
  ensureNpmInstall(frontendDir);
  run(npmCommand(), ['run', 'build'], { cwd: frontendDir });
}

function generateLicenseData(pythonBinary) {
  const scriptsDir = join(repoRoot, 'scripts');
  run(pythonBinary, [join(scriptsDir, 'generate_backend_licenses.py'), '--output', join(repoRoot, 'licenses/backend_licenses.json')], {
    cwd: repoRoot,
  });
  run('node', [join(scriptsDir, 'generate_js_licenses.mjs'), '--project', 'frontend', '--output', 'licenses/frontend_licenses.json'], {
    cwd: repoRoot,
  });
  run('node', [join(scriptsDir, 'generate_js_licenses.mjs'), '--project', 'electron', '--output', 'licenses/electron_licenses.json'], {
    cwd: repoRoot,
  });
  run(pythonBinary, [join(scriptsDir, 'generate_third_party_notice.py'), '--output', join(repoRoot, 'licenses/THIRD_PARTY_NOTICES.md'), '--group-by-license'], {
    cwd: repoRoot,
  });
}

function packageElectron() {
  ensureNpmInstall(electronDir);
  const script = process.platform === 'darwin' ? 'dist:mac' : process.platform === 'win32' ? 'dist:win' : null;
  if (!script) {
    fail(`Electron packaging not configured for platform: ${process.platform}`);
  }
  const pythonBinary = runtimePythonPath();
  generateLicenseData(pythonBinary);
  run(npmCommand(), ['run', script], { cwd: electronDir });
}

function cleanArtifacts() {
  removeDir(runtimeDir);
  removeDir(distDir);
}

function printUsage() {
  console.log(`
Usage: node scripts/electron-package.mjs <command> [options]

Commands:
  build-runtime            Build the bundled Python runtime (backend/runtime)
  package [--skip-runtime] [--clean]
                           Build runtime (unless skipped), frontend, and Electron package.
                           --skip-runtime  Use existing runtime directory.
                           --clean         Remove backend/runtime and electron/dist after packaging.
  clean                    Remove backend/runtime and electron/dist
`);
}

function main() {
  const [, , command, ...rest] = process.argv;
  const options = new Set(rest);

  switch (command) {
    case 'build-runtime':
      buildRuntime();
      break;
    case 'package': {
      const skipRuntime = options.has('--skip-runtime');
      const doClean = options.has('--clean');

      if (!skipRuntime || !ensureRuntimeExists()) {
        buildRuntime();
      } else {
        console.log('Using existing backend/runtime directory.');
      }

      buildFrontend();
      packageElectron();

      if (doClean) {
        cleanArtifacts();
      }
      break;
    }
    case 'clean':
      cleanArtifacts();
      break;
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      if (!command) {
        process.exit(1);
      }
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
