// wasm-runtime/core/symbolicVerifier.js
// Analyzes the ACTUAL emitted WAT (not a self-declared metric): counts real
// loop/branch structure, detects unbounded loops (a `(loop` whose body has no
// `br_if`/`br` exit and no `;;; bound=` annotation), sums gas instrumentation,
// and derives a worst-case step estimate. Those measured values are then
// checked against policy via the optional Z3 SMT bridge, with a pure-JS
// fallback when Z3 is not installed.
import { SMTBridge } from '../../src/runtime/smtBridge.js';

export class SymbolicVerifier {
  constructor(z3Path = 'z3') {
    this.smt = new SMTBridge(z3Path);
  }

  analyzeWat(wat) {
    const lines = wat.split('\n').map((l) => l.trim());
    let loops = 0, branches = 0, gasCalls = 0, memOps = 0;
    let unboundedLoops = 0;
    const loopBounds = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('(loop')) {
        loops++;
        // Look back a few lines for a bound annotation, and forward for an exit.
        const windowBack = lines.slice(Math.max(0, i - 4), i).join(' ');
        const annot = windowBack.match(/;;;\s*bound=(\d+)/);
        const windowFwd = lines.slice(i, Math.min(lines.length, i + 12)).join(' ');
        const hasExit = /br_if|br\s+\$exit/.test(windowFwd);
        if (annot) loopBounds.push(parseInt(annot[1], 10));
        else if (!hasExit) { unboundedLoops++; loopBounds.push(Infinity); }
        else loopBounds.push(100000); // bounded but unknown -> conservative cap
      }
      if (/\bbr_if\b|\(if\b/.test(line)) branches++;
      if (/\(call \$use_gas/.test(line)) gasCalls++;
      if (/i32\.store|i64\.store|memory\.grow/.test(line)) memOps++;
    }

    const finiteBounds = loopBounds.filter((b) => Number.isFinite(b));
    const worstCaseSteps = finiteBounds.reduce((s, b) => s + b * GAS_LOOP, 10 + branches * 10);
    const memoryBytes = memOps * 65536;
    const safetyScore = Math.max(0, 100 - unboundedLoops * 50 - memOps * 3);

    return { loops, branches, gasCalls, memOps, unboundedLoops, loopBounds, worstCaseSteps, memoryBytes, safetyScore };
  }

  async verify(wat, policy = {}) {
    const a = this.analyzeWat(wat);
    const maxSteps = (policy.maxLatency || 1000) * 1000;
    const maxMem = (policy.maxMemoryMB || 64) * 1024 * 1024;

    // Hard, code-derived rejections (independent of Z3).
    if (a.unboundedLoops > 0) {
      return { verified: false, reason: 'UNBOUNDED_LOOP_DETECTED', analysis: a };
    }
    if (a.gasCalls < a.loops) {
      return { verified: false, reason: 'UNINSTRUMENTED_LOOP', analysis: a };
    }

    // SMT (or JS fallback) check on the measured worst-case values.
    let smtResult;
    try {
      smtResult = await this.smt.verifyCandidate(
        { estLatency: Math.min(a.worstCaseSteps / 1000, 2_000_000), estMemoryMB: a.memoryBytes / (1024 * 1024), securityScore: a.safetyScore },
        { maxLatency: policy.maxLatency || 1000, maxMemoryMB: policy.maxMemoryMB || 64, requireSecurityScore: policy.requireSecurityScore || 50 }
      );
    } catch (_) {
      smtResult = { valid: a.worstCaseSteps <= maxSteps && a.memoryBytes <= maxMem, reason: 'z3_unavailable_js_fallback' };
    }

    if (!smtResult.valid) return { verified: false, reason: smtResult.reason || 'POLICY_VIOLATION', analysis: a };
    return { verified: true, analysis: a, solverTime: smtResult.solverTime || 0 };
  }
}

const GAS_LOOP = 10;
