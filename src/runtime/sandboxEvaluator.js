// morphicKernel/runtime/sandboxEvaluator.js
// Validates a generated bundle inside an isolated worker thread + VM context.
// No network, no process.env, no fs access is exposed to evaluated code.
// The only module the sandbox may require is 'express', and it is resolved from
// the host project's node_modules (not the worker script's tmp location).
import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { pathToFileURL } from 'url';

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const { createRequire } = require('module');
const path = require('path');

// Resolve allowed modules from the HOST project root, not this worker's tmp dir.
const projectRoot = (workerData && workerData.projectRoot) || process.cwd();
const hostRequire = createRequire(path.join(projectRoot, 'package.json'));

parentPort.on('message', ({ code }) => {
  try {
    const sandboxRequire = (name) => {
      if (name === 'express') return hostRequire('express');
      throw new Error('Forbidden require: ' + name);
    };
    const context = {
      require: sandboxRequire,
      module: { exports: {} },
      exports: {},
      console: { log: (...a) => parentPort.postMessage({ log: a.map(String).join(' ') }) }
    };
    vm.createContext(context);
    vm.runInContext(code, context, { timeout: 1000 });
    const exported = context.module.exports;
    parentPort.postMessage({ ok: true, hasDefault: !!exported, exportType: typeof exported });
  } catch (err) {
    parentPort.postMessage({ ok: false, err: String(err) });
  }
});
`;

function _ensureWorkerScript() {
  const dir = path.join(os.tmpdir(), 'morphic_kernel_workers');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'sandbox_worker.cjs');
  // Always rewrite to keep worker logic in sync with this module version.
  fs.writeFileSync(p, WORKER_SCRIPT, { encoding: 'utf8' });
  return p;
}

export async function evaluateBundleSafely(bundleCode) {
  const scriptPath = _ensureWorkerScript();
  return new Promise((resolve, reject) => {
    const w = new Worker(scriptPath, { workerData: { projectRoot: process.cwd() } });
    const timeout = setTimeout(() => {
      w.terminate();
      reject(new Error('SandboxTimeout'));
    }, 3000);

    w.on('message', (msg) => {
      if (msg && msg.ok) {
        clearTimeout(timeout);
        w.terminate();
        resolve({ ok: true, info: msg });
      } else if (msg && msg.ok === false) {
        clearTimeout(timeout);
        w.terminate();
        reject(new Error('SandboxEvalError: ' + (msg.err || 'unknown')));
      }
    });
    w.on('error', (err) => {
      clearTimeout(timeout);
      w.terminate();
      reject(err);
    });

    w.postMessage({ code: bundleCode });
  });
}
