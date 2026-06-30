// === File: lib/sandboxRouter.js ===
// Routes a mutation cascade into isolated worker contexts.
//
// Given a file that just changed, it asks the MemoryFSDAG for the ripple-order
// reload sequence, then loads each affected module inside its OWN worker thread
// (one VM context per module). Isolation guarantees:
//   - no shared global scope between modules,
//   - no process.env / fs / network handed to evaluated code,
//   - only 'express' may be required, resolved from the host project root
//     (matches sandboxEvaluator so CI runners without local cwd deps still pass).
//
// This is the concrete consumer of memoryFS.getReloadSequence(): it proves a
// cascade actually executes in dependency-safe order, isolate by isolate.
import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import fs from 'fs';

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const { createRequire } = require('module');
const path = require('path');

const projectRoot = (workerData && workerData.projectRoot) || process.cwd();
const hostRequire = createRequire(path.join(projectRoot, 'package.json'));

parentPort.on('message', ({ filename, code }) => {
  const started = Date.now();
  try {
    const sandboxRequire = (name) => {
      if (name === 'express') return hostRequire('express');
      throw new Error('Forbidden require: ' + name);
    };
    const sandbox = {
      require: sandboxRequire,
      module: { exports: {} },
      exports: {},
      console: { log: (...a) => parentPort.postMessage({ kind: 'log', filename, line: a.map(String).join(' ') }) }
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { timeout: 1000, filename });
    const exported = sandbox.module.exports;
    parentPort.postMessage({
      kind: 'done', ok: true, filename,
      exportType: typeof exported,
      hasDefault: !!exported,
      ms: Date.now() - started
    });
  } catch (err) {
    parentPort.postMessage({ kind: 'done', ok: false, filename, err: String(err && err.message || err), ms: Date.now() - started });
  }
});
`;

function _ensureWorkerScript() {
  const dir = path.join(os.tmpdir(), 'morphic_kernel_workers');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'router_worker.cjs');
  fs.writeFileSync(p, WORKER_SCRIPT, { encoding: 'utf8' });
  return p;
}

export class SandboxRouter {
  /**
   * @param {import('./memoryFS.js').MemoryFSDAG} memoryFS
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=3000] hard ceiling per module isolate
   * @param {string} [opts.projectRoot=process.cwd()] root used to resolve 'express'
   */
  constructor(memoryFS, opts = {}) {
    if (!memoryFS) throw new Error('SandboxRouter requires a MemoryFSDAG instance');
    this.fs = memoryFS;
    this.timeoutMs = opts.timeoutMs || 3000;
    this.projectRoot = opts.projectRoot || process.cwd();
    this._scriptPath = _ensureWorkerScript();
  }

  /** Run a single module's code in its own worker isolate. */
  runModule(filename, code) {
    return new Promise((resolve) => {
      const w = new Worker(this._scriptPath, { workerData: { projectRoot: this.projectRoot } });
      const logs = [];
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.terminate();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ filename, ok: false, err: 'SandboxTimeout', logs }), this.timeoutMs);

      w.on('message', (msg) => {
        if (!msg) return;
        if (msg.kind === 'log') { logs.push(msg.line); return; }
        if (msg.kind === 'done') {
          finish({ filename, ok: msg.ok, err: msg.err || null, exportType: msg.exportType, hasDefault: msg.hasDefault, ms: msg.ms, logs });
        }
      });
      w.on('error', (err) => finish({ filename, ok: false, err: String(err && err.message || err), logs }));

      w.postMessage({ filename, code });
    });
  }

  /**
   * Execute the full ripple cascade for a mutated file, one isolate per module,
   * in dependency-safe order. Stops at the first failure (a broken dependency
   * makes downstream reloads meaningless) unless opts.continueOnError is set.
   * @returns {Promise<{ok:boolean, sequence:string[], results:object[], failedAt:?string}>}
   */
  async routeCascade(mutatedFile, opts = {}) {
    const sequence = this.fs.getReloadSequence(mutatedFile);
    const results = [];
    let failedAt = null;

    for (const filename of sequence) {
      const entry = this.fs.read(filename);
      if (!entry) {
        const r = { filename, ok: false, err: 'NotInMemoryFS', logs: [] };
        results.push(r);
        failedAt = filename;
        if (!opts.continueOnError) break;
        continue;
      }
      const r = await this.runModule(filename, entry.code);
      results.push(r);
      if (!r.ok) {
        failedAt = filename;
        if (!opts.continueOnError) break;
      }
    }

    return { ok: failedAt === null, sequence, results, failedAt };
  }
}

export function createRouter(memoryFS, opts) {
  return new SandboxRouter(memoryFS, opts);
}
