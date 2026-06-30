# Contributing

Thanks for your interest in Morphic Kernel.

## Authorship
Morphic Kernel is authored and maintained solely by **Dante Bullock (Sovereign Logic)**.

## Ground rules
- Keep claims honest. If something is a prototype, label it a prototype.
- New runtime features that execute code must go through `sandboxEvaluator` (core)
  or a WASM isolate (`wasm-runtime/`).
- Every module mutation must append to the provenance ledger.

## Development
```bash
npm install
npm test        # vitest
npm start       # boot the kernel
```

## Pull requests
- Add or update tests for any behavior change.
- Update the README status tables if you change what is "working" vs "prototype".
- Keep dependencies minimal; prefer optional + graceful-degradation for heavy deps.
