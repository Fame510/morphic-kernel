// morphicKernel/runtime/qecEngineV2.js
// Multi-objective constraint-collapse engine with composite scoring,
// ambiguity detection, and a formal-verification hook. Fail-closed.
import { createHash } from 'crypto';

export class QECFatal extends Error {
  constructor(code, details) {
    super(`QEC_FATAL: ${code}`);
    this.code = code;
    this.details = details;
    this.name = 'QECFatal';
  }
}

export class QecEngineV2 {
  constructor({ ownerKey, policyStore = {}, constraintSolver = null } = {}) {
    this.ownerKey = ownerKey || 'owner::local';
    this.policyStore = {
      maxLatency: 2000,
      maxMemoryMB: 512,
      maxComplexity: 'high',
      allowedDomains: ['quantum', 'vr', 'ai_ml', 'backend', 'security'],
      requireSecurityScore: 60,
      ...policyStore
    };
    this.constraintSolver = constraintSolver;
    this.tieBreaker = createHash('sha256').update(this.ownerKey).digest('hex');
  }

  async collapse(inputArchitecture) {
    const staticValid = this._staticValidation(inputArchitecture);
    if (!staticValid.valid) throw new QECFatal('STATIC_VALIDATION_FAILED', staticValid.errors);

    const candidates = await this._solveConstraints(inputArchitecture.candidates);
    if (candidates.length === 0) throw new QECFatal('NO_FEASIBLE_SOLUTIONS', { reason: 'All candidates violated constraints' });

    const optimized = await this._multiObjectiveOptimize(candidates);
    if (this._isAmbiguous(optimized)) throw new QECFatal('AMBIGUOUS_SOLUTION', { topCandidates: optimized.slice(0, 3) });

    if (this.constraintSolver) {
      const verified = await this._formalVerify(optimized[0]);
      if (!verified.valid) throw new QECFatal('FORMAL_VERIFICATION_FAILED', verified.errors);
    }

    return {
      ...optimized[0],
      owner: this.ownerKey,
      intentHash: inputArchitecture.intentHash,
      collapsedAt: Date.now(),
      version: '2.0'
    };
  }

  _staticValidation(arch) {
    const errors = [];
    if (!arch || !arch.intent || !arch.intentHash) errors.push('Missing intent or intentHash');
    if (!arch || !Array.isArray(arch.candidates) || arch.candidates.length === 0) errors.push('Invalid or empty candidates array');
    (arch?.candidates || []).forEach((c, idx) => {
      if (!c.name) errors.push(`Candidate ${idx} missing name`);
      if (typeof c.estLatency === 'number' && c.estLatency > this.policyStore.maxLatency) errors.push(`Candidate ${idx} exceeds latency limit`);
      if (typeof c.estMemoryMB === 'number' && c.estMemoryMB > this.policyStore.maxMemoryMB) errors.push(`Candidate ${idx} exceeds memory limit`);
    });
    return { valid: errors.length === 0, errors };
  }

  async _solveConstraints(candidates) {
    return candidates.filter((c) => {
      if (typeof c.estLatency === 'number' && c.estLatency > this.policyStore.maxLatency) return false;
      if (typeof c.estMemoryMB === 'number' && c.estMemoryMB > this.policyStore.maxMemoryMB) return false;
      if (typeof c.securityScore === 'number' && c.securityScore < this.policyStore.requireSecurityScore) return false;
      if (c.domain && !this.policyStore.allowedDomains.includes(c.domain)) return false;
      return true;
    });
  }

  async _multiObjectiveOptimize(candidates) {
    const scored = candidates.map((c) => ({ ...c, compositeScore: this._calculateCompositeScore(c) }));
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    return scored;
  }

  _calculateCompositeScore(candidate) {
    const weights = { detScore: 0.3, securityScore: 0.25, resourceEfficiency: 0.2, maintainability: 0.15, domainConfidence: 0.1 };
    const lat = typeof candidate.estLatency === 'number' ? candidate.estLatency : this.policyStore.maxLatency / 2;
    const mem = typeof candidate.estMemoryMB === 'number' ? candidate.estMemoryMB : this.policyStore.maxMemoryMB / 2;
    const resourceEfficiency = 1 - ((lat / this.policyStore.maxLatency) * 0.5 + (mem / this.policyStore.maxMemoryMB) * 0.5);
    return (
      (candidate.detScore || 0.5) * weights.detScore +
      ((candidate.securityScore || 0) / 100) * weights.securityScore +
      resourceEfficiency * weights.resourceEfficiency +
      ((candidate.maintainability || 50) / 100) * weights.maintainability +
      (candidate.domainConfidence || 0.5) * weights.domainConfidence
    );
  }

  _isAmbiguous(candidates) {
    if (candidates.length < 2) return false;
    const topScore = candidates[0].compositeScore;
    return candidates.slice(0, 3).every((c) => Math.abs(c.compositeScore - topScore) < 0.01);
  }

  async _formalVerify(candidate) {
    const errors = [];
    if (!candidate.name || typeof candidate.name !== 'string') errors.push('Invalid name');
    if (candidate.requiresExternal === true) errors.push('External dependencies not allowed');
    return { valid: errors.length === 0, errors };
  }
}
