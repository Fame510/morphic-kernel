// wasm-runtime/core/symbolicVerifier.js
// Analyzes the ACTUAL emitted WAT (not a self-declared metric): counts real
// loop/branch structure, detects unbounded loops (a `(loop` whose body has no
// `br_if`/`br` exit and no `;;; bound=` annotation), sums gas instrumentation,
// and derives a worst-case step estimate. Those measured values are then
// checked against policy via the optional Z3 SMT bridge, with a pure-JS
// fallback when Z3 is not installed or cannot be spawned.
import { SMTBridge } from '../../src/runtime/smtBridge.js';

const GAS_LOOP = 10;

export class SymbolicVerifier {
  constructor(z3Path = 'z3') {
    this.smt = new SMTBridge(z3Path);
  }

  analyzeWat(wat) {
    // Work on the whole text so single-line and multi-line WAT behave identically.
    const text = String(wat);
    let loops = 0, branches = 0, gasCalls = 0, memOps = 0;
    let unboundedLoops = 0;
    const loopBounds = [];

    // Locate every '(loop' token, regardless of line breaks.
    const loopRe = /\(loop\b/g;
    let m;
    while ((m = loopRe.exec(text)) !== null) {
      loops++;
      const start = m.index;
      // Look back ~160 chars for a bound annotation that precedes this loop.
      const back = text.slice(Math.max(0, start - 160), start);
      const annot = back.match(/;;;\s*bound=(\d+)/);
      // Look forward to the matching close of this loop for an explicit exit.
      const fwd = text.slice(start, _matchParen(text, start));
      const hasExit = /\bbr_if\b/.test(fwd) || /\bbr\s+\$(exit|done|end|out)\b/.test(fwd);
      if (annot) {
        loopBounds.push(parseInt(annot[1], 10));
      } else if (!hasExit) {
        unboundedLoops++;
        loopBounds.push(Infinity);
      } else {
        loopBounds.push(100000); // bounded but unknown -> conservative cap
      }
    }

    branches = (text.match(/\bbr_if\b/g) || []).length + (text.match(/\(if\b/g) || []).length;
    gasCalls = (text.match(/\(call \$use_gas/g) || []).length;
    memOps = (text.match(/i32\.store|i64\.store|memory\.grow/g) || []).length;

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

    // SMT (or JS fallback) check on the measured worst-case values. The Z3
    // bridge returns { valid:false, reason:'SMT execution failed...' } when the
    // z3 binary is unavailable; that is NOT a policy violation, so fall back to
    // the pure-JS bounds check rather than failing closed.
    const jsValid = a.worstCaseSteps <= maxSteps && a.memoryBytes <= maxMem;
    let smtResult;
    try {
      smtResult = await this.smt.verifyCandidate(
        { estLatency: Math.min(a.worstCaseSteps / 1000, 2_000_000), estMemoryMB: a.memoryBytes / (1024 * 1024), securityScore: a.safetyScore },
        { maxLatency: policy.maxLatency || 1000, maxMemoryMB: policy.maxMemoryMB || 64, requireSecurityScore: policy.requireSecurityScore || 50 }
      );
    } catch (_) {
      smtResult = { valid: jsValid, reason: 'z3_unavailable_js_fallback' };
    }

    // Treat an unavailable/errored solver as "use the JS fallback verdict".
    if (smtResult && typeof smtResult.reason === 'string' && /SMT execution failed|z3|ENOENT|unavailable|Solver:/i.test(smtResult.reason) && smtResult.valid !== true) {
      smtResult = { valid: jsValid, reason: 'z3_unavailable_js_fallback', solverTime: smtResult.solverTime || 0 };
    }

    if (!smtResult.valid) return { verified: false, reason: smtResult.reason || 'POLICY_VIOLATION', analysis: a };
    return { verified: true, analysis: a, solverTime: smtResult.solverTime || 0 };
  }
}

// Returns the index just past the matching ')' for the '(' that begins at or
// after `from`. Falls back to end-of-string if unbalanced.
function _matchParen(text, from) {
  let depth = 0;
  let i = from;
  // advance to first '('
  while (i < text.length && text[i] !== '(') i++;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}
