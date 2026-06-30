# Security Policy

## Threat model & boundaries

Morphic Kernel executes code modules. Be explicit about what is and is not a
security boundary:

- The core `src/` sandbox (`sandboxEvaluator.js`) uses Node's `worker_thread` +
  `vm` with a `require` whitelist and an execution timeout. This is a **validation
  gate**, useful against accidental crashes and obvious misbehavior. It is **not**
  a hardened boundary against a determined attacker — Node's `vm` is not designed
  to contain hostile code.
- For **untrusted** code, use the `wasm-runtime/` path. WebAssembly isolates provide
  a real capability boundary: no filesystem, network, or host memory access unless
  explicitly granted, plus gas metering to bound execution.

## Hardening recommendations for production

- Run the kernel as a non-root user, in a restricted container, with a read-only
  root filesystem where possible.
- Place the ingest endpoint behind authentication and rate limiting.
- Prefer the WASM runtime for any code you did not author.
- Persist and monitor the provenance ledger; verify the chain on startup.

## Reporting a vulnerability

Please report security issues privately to the maintainer rather than opening a
public issue. Include reproduction steps and impact. We aim to acknowledge within
a few business days.
