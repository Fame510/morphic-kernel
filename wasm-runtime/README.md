# wasm-runtime (capability-gated WebAssembly execution path)

A lower-level execution path for **untrusted** code. It compiles a structured intent
into WAT, compiles WAT to real WebAssembly (via the optional `wabt` package), verifies
the emitted WAT against policy, and runs it inside a capability-gated, gas-metered
isolate. Routing uses an O(K) Merkle-radix trie with a hash-chained state history.

## Per-component status

| Component | File | Status |
|---|---|---|
| WAT → WASM compiler | `core/watCompiler.js` | **Working** (needs `npm install wabt`) |
| WASM isolate + gas metering | `core/wasmIsolateEngine.js` | **Working** |
| Merkle-radix router | `core/merkleStateTree.js` | **Working** |
| Intent → WAT synthesizer | `core/watSynthesizer.js` | **Prototype** — supported op types: `compute_loop`, `conditional_branch`, `sys_write`, default add |
| Symbolic verifier | `core/symbolicVerifier.js` | **Prototype** — analyzes the actual WAT (counts loops/branches/gas calls, rejects unbounded or uninstrumented loops), then policy-checks via Z3 or a JS fallback |
| Native kernel | `core/aetherisKernel.js` | **Working** for the supported op set |

## Why this is the path for untrusted code

WebAssembly is a real capability sandbox: a module cannot touch the filesystem,
network, or host memory unless you explicitly pass an import. This runtime grants
nothing by default and meters execution with a gas budget, so a hostile or runaway
module cannot exhaust the host.

## Run it

```bash
npm install wabt
node wasm-runtime/core/aetherisKernel.js   # http://localhost:3002
curl -X POST http://localhost:3002/ingest \
  -H 'Content-Type: application/json' \
  -d '{"moduleName":"calc","functionName":"loop","type":"compute_loop","iterations":50}'
curl 'http://localhost:3002/api/calc/loop?p1=2&p2=3'
```

## Known gaps (honest list)

- The synthesizer covers a small fixed set of operations; it is not a general
  intent-to-WASM compiler yet.
- The verifier proves structural bounds (loop boundedness, instrumentation) — not
  full functional correctness.
- The swarm/consensus design referenced in the project history is not wired with a
  network transport here; treat it as a design sketch, not a running feature.
