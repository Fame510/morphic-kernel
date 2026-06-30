// morphicKernel/runtime/sandboxEvaluator.js
// Validates a generated bundle inside an isolated worker thread + VM context.
// No network, no process.env, no fs access is exposed to evaluated code.
import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import fs from 'fs';

const WORKER_SCRIPT = `
const { parentPort } = require('worker_threads');
const vm = require('vm');
parentPort.on('message', ({ code }) => {
  try {
    const sandboxRequire = (name) => {
      if (name === 'express') return require('express');
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
    const w = new Worker(scriptPath);
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
