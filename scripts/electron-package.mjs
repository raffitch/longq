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
import { rmSync, existsSync, statSync, copyFileSync } from 'node:fs';
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

function commandWorks(command, args = []) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function detectPythonLauncher() {
  const candidates = isWindows
    ? [
        { command: 'py', args: ['-3'] },
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ];
  for (const candidate of candidates) {
    if (commandWorks(candidate.command, [...candidate.args, '--version'])) {
      console.log(`Detected Python launcher: ${candidate.command} ${candidate.args.join(' ')}`.trim());
      return candidate;
    }
  }
  fail('Unable to locate a Python 3 interpreter. Ensure Python 3.11+ is installed and on PATH.');
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

function buildRuntime() {
  const launcher = detectPythonLauncher();

  removeDir(runtimeDir);
  run(launcher.command, [...launcher.args, '-m', 'venv', 'runtime', '--upgrade-deps'], { cwd: backendDir });

  const python = runtimePythonPath();

  run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: backendDir });
  run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: backendDir });

   // Make sure 'join' is imported at the top if not already

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
  try {
    copyFileSync(join(repoRoot, 'THIRD_PARTY_NOTICES.md'), join(repoRoot, 'licenses', 'THIRD_PARTY_NOTICES.md'));
  } catch (err) {
    console.warn('Unable to copy THIRD_PARTY_NOTICES.md into licenses/', err);
  }
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
