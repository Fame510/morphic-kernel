// morphicKernel/runtime/codeSynthesizerV2.js
// Domain-aware synthesizer. Picks a template based on IntentParserV2 analysis,
// emits a self-contained CommonJS Express router, signs it, and caches it.
import { createHash } from 'crypto';
import { IntentParserV2 } from './intentParserV2.js';

const TEMPLATE_LOADERS = {
  quantum: () => import('./templates/quantumBackend.js'),
  vr: () => import('./templates/vrBackend.js'),
  ai_ml: () => import('./templates/aiBackend.js'),
  security: () => import('./templates/securityBackend.js'),
  backend: () => import('./templates/backendDefault.js')
};

export class AdvancedSynthesizer {
  constructor({ registry, securityPolicy = {} } = {}) {
    this.parser = new IntentParserV2();
    this.registry = registry;
    this.securityPolicy = securityPolicy;
    this.synthesisHistory = new Map();
  }

  async synthesize(intent, options = {}) {
    const intentHash = createHash('sha256').update(intent).digest('hex');
    if (this.synthesisHistory.has(intentHash) && !options.forceRegenerate) {
      return this.synthesisHistory.get(intentHash);
    }

    const analysis = await this.parser.parse(intent, options);
    const domain = analysis.domain.name;
    const loader = TEMPLATE_LOADERS[domain] || TEMPLATE_LOADERS.backend;
    let templateModule;
    try { templateModule = await loader(); }
    catch (_) { templateModule = await TEMPLATE_LOADERS.backend(); }
    const buildTemplate = templateModule.buildTemplate || templateModule.default;

    const name = options.name || `mod_${intentHash.slice(0, 12)}`;
    const route = options.route || `/api/${name}`;
    const backend = buildTemplate({ name, intent, analysis });

    const manifest = {
      name, version: '1.0.0', route, domain,
      complexity: analysis.domain.complexity,
      dependencies: analysis.dependencies,
      security: {
        riskLevel: analysis.riskProfile.maxRiskLevel,
        requiresSandbox: analysis.riskProfile.quarantineRequired,
        allowedCapabilities: this._deriveCapabilities(analysis)
      },
      resources: analysis.resources,
      interfaces: analysis.interfaces,
      createdAt: Date.now(),
      intentHash
    };

    const artifact = {
      name, manifest, bundleCode: backend, backend, frontend: null, driver: null,
      signature: this._signArtifact(backend, manifest),
      metadata: {
        owner: options.owner || null, intentHash,
        synthesisMethod: 'advanced_domain_aware',
        domainConfidence: analysis.domain.confidence,
        securityScore: analysis.securityMatrix.score,
        complexity: analysis.domain.complexity,
        createdAt: Date.now()
      }
    };

    this.synthesisHistory.set(intentHash, artifact);
    return artifact;
  }

  _deriveCapabilities(analysis) {
    const caps = ['read'];
    const highPatterns = analysis.riskProfile.high.map((r) => r.pattern);
    if (highPatterns.some((p) => p.includes('fs'))) caps.push('filesystem');
    if (highPatterns.some((p) => p.includes('fetch') || p.includes('http'))) caps.push('network');
    if (analysis.riskProfile.critical.length > 0) caps.push('privileged');
    return caps;
  }

  _signArtifact(code, manifest) {
    return createHash('sha256').update(code + JSON.stringify(manifest)).digest('hex');
  }
}
