// morphicKernel/backend/autoModuleIngest.js
// HTTP ingest endpoint. Runs the full Execution Spine pipeline for a prompt
// with a global token-bucket rate limit. Falls back to QEC_FATAL-safe errors.
import { createHash } from 'crypto';
import { QecEngine, QEC_FATAL } from '../runtime/qecEngine.js';
import { synthesizeFromTruth } from '../runtime/synthesizer.js';
import { atomicSwap } from '../reconfig/atomicSwap.js';
import { appendProvenance } from '../runtime/provenanceLedger.js';

const RATE = { capacity: 20, tokens: 20, refillIntervalMs: 1000, refillAmount: 2 };
let lastRefill = Date.now();
function refill() {
  const now = Date.now();
  const delta = Math.floor((now - lastRefill) / RATE.refillIntervalMs);
  if (delta > 0) {
    RATE.tokens = Math.min(RATE.capacity, RATE.tokens + delta * RATE.refillAmount);
    lastRefill = now;
  }
}

function detName(prompt) {
  const h = createHash('sha1').update(prompt).digest('hex').slice(0, 8);
  return `${prompt.replace(/\W+/g, '_').slice(0, 12)}_${h}`;
}

export async function ingestPrompt(req, res) {
  try {
    refill();
    if (RATE.tokens < 1) return res.status(429).send({ error: 'RateLimit' });
    RATE.tokens -= 1;

    const app = req.app.get('morphicApp');
    const registry = req.app.get('morphicRegistry') || req.app.get('registry');
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).send({ error: 'Prompt required' });

    const name = 'mod_' + detName(prompt);
    const candidate = {
      name, detScore: 0.9, estLatency: 50, estMemoryMB: 50,
      metadata: { sourcePrompt: prompt }, requiresExternal: false
    };
    const inputArch = {
      intent: prompt,
      intentHash: createHash('sha256').update(prompt).digest('hex'),
      candidates: [candidate]
    };

    const qec = new QecEngine({ ownerKey: process.env.OWNER_KEY || 'local::owner' });
    let truth;
    try { truth = await qec.collapse(inputArch); }
    catch (e) {
      if (e instanceof QEC_FATAL) return res.status(400).send({ error: 'QEC_FATAL', message: e.message });
      throw e;
    }

    truth.intent = prompt;
    const artifact = await synthesizeFromTruth(truth);
    await atomicSwap(app, truth.name, artifact, registry);
    await appendProvenance({ action: 'ingest_deploy', module: truth.name, signature: artifact.signature, prompt });

    return res.send({ status: 'deployed', module: truth.name, route: `/api/${truth.name}`, signature: artifact.signature });
  } catch (err) {
    console.error('IngestError', err);
    return res.status(500).send({ error: 'IngestFailed', message: String(err) });
  }
}
