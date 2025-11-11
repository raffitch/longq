#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const scriptPath = path.resolve(__dirname, 'generate_all_licenses.sh');

let scriptContent = readFileSync(scriptPath, 'utf8');
if (scriptContent.includes('\r')) {
  // Normalize CRLF endings so bash on Windows can execute the script.
  scriptContent = scriptContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const child = spawn('bash', ['-s', '--', ...args], {
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
