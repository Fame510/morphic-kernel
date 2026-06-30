// morphicKernel/spine/executionSpine.js
// Unified pipeline: Intent -> Parse -> QEC collapse -> Synthesize -> Atomic swap -> Provenance.
import { createHash } from 'crypto';
import { IntentParserV2 } from '../runtime/intentParserV2.js';
import { QecEngineV2 } from '../runtime/qecEngineV2.js';
import { AdvancedSynthesizer } from '../runtime/codeSynthesizerV2.js';
import { atomicSwap } from '../reconfig/atomicSwap.js';
import { appendProvenance } from '../runtime/provenanceLedger.js';
import { registry } from '../runtime/registry.js';

export class ExecutionSpine {
  constructor({ ownerKey, app } = {}) {
    this.ownerKey = ownerKey || 'owner::local';
    this.app = app;
    this.parser = new IntentParserV2();
    this.qec = new QecEngineV2({ ownerKey: this.ownerKey });
    this.synth = new AdvancedSynthesizer({ registry });
  }

  async execute(intent) {
    const intentHash = this._hash(intent);
    const analysis = await this.parser.parse(intent, { allowExtremeComplexity: true, allowCriticalRisk: false });
    const inputArch = this._buildInputArchitecture(intent, intentHash, analysis);
    const truth = await this.qec.collapse(inputArch);
    const artifact = await this.synth.synthesize(intent, {
      name: truth.name,
      route: `/api/${truth.name}`,
      owner: this.ownerKey
    });
    await atomicSwap(this.app, truth.name, artifact, registry);
    await appendProvenance({
      action: 'execution_spine_deploy',
      module: truth.name,
      signature: artifact.signature,
      intent,
      intentHash,
      ts: Date.now()
    });
    return {
      status: 'complete',
      module: truth.name,
      signature: artifact.signature,
      domain: analysis.domain.name,
      complexity: analysis.domain.complexity
    };
  }

  _buildInputArchitecture(intent, intentHash, analysis) {
    return {
      intent,
      intentHash,
      candidates: [
        {
          name: `mod_${intentHash.slice(0, 12)}`,
          domain: analysis.domain.name,
          detScore: analysis.confidence,
          estLatency: analysis.resources.estimatedLatency,
          estMemoryMB: analysis.resources.estimatedMemoryMB,
          securityScore: analysis.securityMatrix.score,
          maintainability: analysis.astMetrics?.maintainability ?? 60,
          domainConfidence: analysis.domain.confidence,
          metadata: { domain: analysis.domain.name },
          requiresExternal: false
        }
      ]
    };
  }

  _hash(str) {
    return createHash('sha256').update(str).digest('hex');
  }
}
