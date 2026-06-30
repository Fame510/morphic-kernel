// morphicKernel/runtime/synthesizer.js
// Deterministic, offline synthesizer. Converts a collapsed truth vector into a
// self-contained CommonJS Express router bundle plus a cryptographic signature.
import { createHash } from 'crypto';

export async function synthesizeFromTruth(truthVector) {
  if (!truthVector || !truthVector.name) throw new Error('InvalidTruthVector');

  const name = truthVector.name;
  const intent = truthVector.intent || '';
  const metadata = JSON.stringify({
    owner: truthVector.owner,
    intentHash: truthVector.intentHash,
    createdAt: new Date(0).toISOString()
  });

  const bundleCode = `// Auto-generated ModuleCell bundle
const { Router } = require('express');
const router = Router();
router.get('/', (req, res) => {
  res.json({ module: ${JSON.stringify(name)}, intent: ${JSON.stringify(intent)}, meta: ${metadata} });
});
module.exports = router;
`;

  const signature = createHash('sha256')
    .update(bundleCode + (truthVector.intentHash || ''))
    .digest('hex');

  return {
    name,
    bundleCode,
    signature,
    metadata: {
      owner: truthVector.owner,
      intentHash: truthVector.intentHash,
      createdAt: Date.now()
    }
  };
}
