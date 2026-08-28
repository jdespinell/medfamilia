#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const serverNodeModules = path.join(projectRoot, 'server/node_modules');
const tsxBin = path.join(serverNodeModules, '.bin/tsx');
const runnerTs = path.join(__dirname, 'run_all_tests.ts');

const child = spawn(tsxBin, [runnerTs], {
  cwd: path.join(projectRoot, 'server'),
  env: {
    ...process.env,
    NODE_PATH: serverNodeModules,
  },
  stdio: 'inherit',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
