// morphicKernel/runtime/smtBridge.js
// Optional Z3 SMT bridge. Spawns the `z3` binary if present on PATH.
// IMPORTANT: this verifies SELF-DECLARED candidate metadata (latency, memory,
// security score) against policy bounds. It does NOT prove properties of the
// generated code's runtime behavior. Treat it as a policy/contract check, not
// algorithmic verification. See experimental/aetheris for AST-level analysis.
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export class SMTBridge {
  constructor(z3Path = 'z3') {
    this.z3Path = z3Path;
    this.timeout = 30000;
  }

  async verifyCandidate(candidate, constraints) {
    const file = join(tmpdir(), `morphic_z3_${Date.now()}_${Math.random().toString(36).slice(2)}.smt2`);
    const smt = `(set-logic QF_LIA)
(declare-fun latency () Int)
(declare-fun memory () Int)
(declare-fun security_score () Int)
(assert (= latency ${Math.round(candidate.estLatency || 0)}))
(assert (= memory ${Math.round(candidate.estMemoryMB || 0)}))
(assert (= security_score ${Math.round(candidate.securityScore || 0)}))
(assert (<= latency ${constraints.maxLatency || 2000}))
(assert (<= memory ${constraints.maxMemoryMB || 512}))
(assert (>= security_score ${constraints.requireSecurityScore || 0}))
(check-sat)`;
    try {
      await writeFile(file, smt, 'utf8');
      const result = await this._runZ3(file);
      await unlink(file).catch(() => {});
      if (result.status === 'sat') return { valid: true, solverTime: result.time, proof: result.stdout };
      return { valid: false, reason: result.status === 'unsat' ? 'Constraints unsatisfiable' : `Solver: ${result.status}`, solverTime: result.time };
    } catch (err) {
      await unlink(file).catch(() => {});
      return { valid: false, reason: `SMT execution failed: ${err.message}` };
    }
  }

  _runZ3(file, extraArgs = []) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let proc;
      try { proc = spawn(this.z3Path, ['-smt2', ...extraArgs, file]); }
      catch (e) { return reject(e); }
      let stdout = '', stderr = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('close', () => {
        const time = Date.now() - start;
        const status = stdout.includes('unsat') ? 'unsat' : stdout.includes('sat') ? 'sat' : 'unknown';
        resolve({ status, stdout, stderr, time });
      });
      setTimeout(() => { try { proc.kill('SIGTERM'); } catch (_) {} reject(new Error('Z3 timeout')); }, this.timeout);
    });
  }
}
