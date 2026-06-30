import { describe, it, expect } from 'vitest';
import express from 'express';
import { QecEngine, QEC_FATAL } from '../src/runtime/qecEngine.js';
import { QecEngineV2, QECFatal } from '../src/runtime/qecEngineV2.js';
import { evaluateBundleSafely } from '../src/runtime/sandboxEvaluator.js';
import { atomicSwap } from '../src/reconfig/atomicSwap.js';
import { appendProvenance, verifyLedger } from '../src/runtime/provenanceLedger.js';
import { registry } from '../src/runtime/registry.js';
import { AdvancedSynthesizer } from '../src/runtime/codeSynthesizerV2.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.set('morphicApp', app);
  return app;
}

describe('QEC V1', () => {
  it('collapses a valid candidate', async () => {
    const qec = new QecEngine({ ownerKey: 'test::owner' });
    const truth = await qec.collapse({
      intent: 'x', intentHash: 'h',
      candidates: [{ name: 'm', detScore: 0.9, estLatency: 50, estMemoryMB: 50 }]
    });
    expect(truth.name).toBe('m');
    expect(truth.owner).toBe('test::owner');
  });
  it('rejects when all candidates violate latency policy', async () => {
    const qec = new QecEngine({ ownerKey: 't', policyStore: { maxLatency: 10 } });
    await expect(qec.collapse({ intent: 'x', intentHash: 'h', candidates: [{ name: 'm', estLatency: 9999 }] }))
      .rejects.toBeInstanceOf(QEC_FATAL);
  });
});

describe('QEC V2', () => {
  it('detects ambiguity', async () => {
    const qec = new QecEngineV2({ ownerKey: 't' });
    await expect(qec.collapse({
      intent: 'x', intentHash: 'h',
      candidates: [
        { name: 'a', detScore: 0.9, estLatency: 100, estMemoryMB: 128, securityScore: 80 },
        { name: 'b', detScore: 0.9, estLatency: 100, estMemoryMB: 128, securityScore: 80 }
      ]
    })).rejects.toBeInstanceOf(QECFatal);
  });
});

describe('Sandbox', () => {
  it('accepts safe express code', async () => {
    const code = `const { Router } = require('express'); const r = Router(); r.get('/', (q,s)=>s.json({ok:true})); module.exports = r;`;
    const res = await evaluateBundleSafely(code);
    expect(res.ok).toBe(true);
  });
  it('blocks forbidden require', async () => {
    await expect(evaluateBundleSafely(`const fs = require('fs'); module.exports = {};`)).rejects.toThrow();
  });
  it('times out infinite loops', async () => {
    await expect(evaluateBundleSafely('while(true){}')).rejects.toThrow();
  });
});

describe('Atomic swap + provenance', () => {
  it('hot-swaps and records provenance chain', async () => {
    const app = makeApp();
    const artifact = {
      name: 'swap_test',
      bundleCode: `const { Router } = require('express'); const r = Router(); r.get('/health',(q,s)=>s.json({status:'ok'})); module.exports = r;`,
      signature: 'sig123', metadata: { owner: 'test' }
    };
    const result = await atomicSwap(app, 'swap_test', artifact, registry);
    expect(result.ok).toBe(true);
    expect(result.mountPath).toBe('/api/swap_test');

    await appendProvenance({ module: 'swap_test', action: 'deploy', signature: 'sig123' });
    const v = await verifyLedger();
    expect(v.ok).toBe(true);
  });

  it('refuses concurrent swaps when locked', async () => {
    const app = makeApp();
    app.set('reconfigLock', true);
    await expect(atomicSwap(app, 'locked', { name: 'locked', bundleCode: 'module.exports={}', signature: 's', metadata: {} }, registry))
      .rejects.toThrow('ReconfigLocked');
  });
});

describe('Synthesizer V2', () => {
  it('emits a signed backend bundle for a generic intent', async () => {
    const synth = new AdvancedSynthesizer({ registry });
    const artifact = await synth.synthesize('Build a backend resource API for orders', { name: 'orders' });
    expect(artifact.bundleCode).toContain("require('express')");
    expect(artifact.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.manifest.domain).toBeDefined();
  });
});
