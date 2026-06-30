// wasm-runtime/core/aetherisKernel.js
// Native-HTTP kernel that compiles intent -> WAT -> WASM, verifies it against
// policy from the ACTUAL emitted WAT, instantiates a capability-gated isolate,
// and routes via a Merkle-radix trie. Requires the optional `wabt` package for
// real WAT->WASM compilation (npm install wabt).
import http from 'http';
import { MerkleStateTreeRouter } from './merkleStateTree.js';
import { WasmIsolateEngine } from './wasmIsolateEngine.js';
import { SymbolicVerifier } from './symbolicVerifier.js';
import { WATSynthesizer } from './watSynthesizer.js';
import { wat2wasm, isCompilerAvailable } from './watCompiler.js';

export class AetherisKernel {
  constructor({ port = 3002, z3Path = 'z3' } = {}) {
    this.port = port;
    this.router = new MerkleStateTreeRouter();
    this.isolates = new WasmIsolateEngine();
    this.verifier = new SymbolicVerifier(z3Path);
    this.synth = new WATSynthesizer();
    this.server = null;
  }

  async boot() {
    const compilerReady = await isCompilerAvailable();
    this.server = http.createServer((req, res) => this._handle(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[wasm-runtime] AetherisKernel on http://localhost:${this.port}`);
        console.log(`[wasm-runtime] WAT->WASM compiler (wabt): ${compilerReady ? 'available' : 'NOT installed (run: npm install wabt)'}`);
        resolve(this.server);
      });
    });
  }

  async _handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (url.pathname === '/health') {
      return json(200, { status: 'healthy', rootStateHash: this.router.root.hash, ts: Date.now() });
    }

    if (url.pathname === '/ingest' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const { moduleName, functionName, type, iterations, capabilities = [] } = payload;
          if (!moduleName || !functionName) return json(400, { error: 'moduleName and functionName required' });

          const built = this.synth.synthesize({ name: moduleName, operations: [{ name: functionName, type, iterations }] });
          const verification = await this.verifier.verify(built.wat, { maxMemoryMB: 64, maxLatency: 1000 });
          if (!verification.verified) return json(422, { error: 'VERIFICATION_FAILED', reason: verification.reason, analysis: verification.analysis });

          let binary;
          try { binary = await wat2wasm(built.wat, { moduleName }); }
          catch (e) { return json(501, { error: 'COMPILER_UNAVAILABLE', message: e.message, wat: built.wat }); }

          await this.isolates.createIsolate(moduleName, binary, capabilities);
          const route = `/api/${moduleName}/${functionName}`;
          const commit = this.router.atomicSwap(route, { moduleName, funcName: functionName });
          return json(200, { status: 'deployed', route, rootHash: commit.rootHash, analysis: verification.analysis });
        } catch (e) {
          return json(500, { error: 'INGEST_FATAL', message: e.message });
        }
      });
      return;
    }

    const handler = this.router.matchRoute(url.pathname);
    if (!handler) return json(404, { error: 'route_not_found' });
    try {
      const p1 = parseInt(url.searchParams.get('p1')) || 0;
      const p2 = parseInt(url.searchParams.get('p2')) || 0;
      const result = this.isolates.execute(handler.moduleName, handler.funcName, p1, p2);
      const iso = this.isolates.instances.get(handler.moduleName);
      return json(200, { source: 'wasm_isolate', module: handler.moduleName, result, gasRemaining: iso.getGasRemaining() });
    } catch (e) {
      return json(500, { error: 'ISOLATE_EXECUTION_FAULT', message: e.message });
    }
  }

  async shutdown() { return new Promise((r) => (this.server ? this.server.close(r) : r())); }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const kernel = new AetherisKernel({ port: process.env.WASM_PORT || 3002 });
  await kernel.boot();
}
