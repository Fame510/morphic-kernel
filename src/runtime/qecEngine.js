// morphicKernel/runtime/qecEngine.js
// Deterministic constraint-collapse engine ("QEC").
// Filters candidate module architectures down to a single, policy-compliant
// "truth vector". Fail-closed: throws QEC_FATAL on ambiguity or violation.
import { createHash } from 'crypto';

export class QEC_FATAL extends Error {
  constructor(message) {
    super(message);
    this.name = 'QEC_FATAL';
  }
}

export class QecEngine {
  constructor({ ownerKey, policyStore = {} } = {}) {
    this.ownerKey = ownerKey || 'owner::local';
    this.policyStore = Object.assign(
      { maxLatency: 2000, maxMemoryMB: 512, constraints: [] },
      policyStore
    );
    this.tieBreaker = createHash('sha256').update(this.ownerKey).digest('hex');
  }

  async collapse(inputArchitecture) {
    if (!inputArchitecture || !Array.isArray(inputArchitecture.candidates)) {
      throw new QEC_FATAL('InvalidInputArchitecture');
    }

    // 1. Static deterministic filter (latency / memory policy).
    const staticPassed = inputArchitecture.candidates.filter((c) => {
      if (typeof c.estLatency === 'number' && c.estLatency > this.policyStore.maxLatency) return false;
      if (typeof c.estMemoryMB === 'number' && c.estMemoryMB > this.policyStore.maxMemoryMB) return false;
      return true;
    });
    if (staticPassed.length === 0) throw new QEC_FATAL('NoCandidatesAfterStaticFilter');

    // 2. Deterministic scoring + sort.
    const scored = staticPassed.map((c) => {
      const base = typeof c.detScore === 'number' ? c.detScore : this._deterministicScore(c);
      return Object.assign({}, c, { detScore: base });
    });
    scored.sort((a, b) => {
      if (b.detScore !== a.detScore) return b.detScore - a.detScore;
      const aKey = createHash('sha256').update(a.name + this.tieBreaker).digest('hex');
      const bKey = createHash('sha256').update(b.name + this.tieBreaker).digest('hex');
      return aKey.localeCompare(bKey);
    });

    // 3. Ambiguity detector (fail-closed).
    const top = scored[0];
    const ambiguous = scored
      .slice(0, 3)
      .every((s) => s.detScore === top.detScore && this._metaSig(s) === this._metaSig(top));
    if (ambiguous && scored.length > 1) throw new QEC_FATAL('AmbiguityDetected');

    // 4. Formal verification gate.
    if (!this._formalVerify(top)) throw new QEC_FATAL('FormalVerificationFailed');

    // 5. Optional accelerator hook (deterministic no-op by default).
    const refined = await this._optionalAccelerate(top);

    // 6. Bind to owner + intent.
    refined.owner = this.ownerKey;
    refined.intentHash = inputArchitecture.intentHash || this._intentHash(inputArchitecture.intent || '');
    refined.collapsedAt = Date.now();
    return refined;
  }

  _deterministicScore(c) {
    const nm = String(c.name || 'n');
    const h = createHash('sha256').update(nm).digest('hex').slice(0, 8);
    const num = parseInt(h, 16) % 1000;
    const memBias = typeof c.estMemoryMB === 'number' ? 100 - Math.min(100, c.estMemoryMB / 10) : 50;
    return (num / 1000) * 0.6 + (memBias / 100) * 0.4;
  }

  _metaSig(c) {
    return createHash('sha1').update(JSON.stringify(c.metadata || {})).digest('hex');
  }

  _formalVerify(candidate) {
    if (!candidate.name) return false;
    if (candidate.requiresExternal === true) return false;
    return true;
  }

  async _optionalAccelerate(candidate) {
    return candidate;
  }

  _intentHash(intent) {
    return createHash('sha256').update(String(intent)).digest('hex');
  }
}
