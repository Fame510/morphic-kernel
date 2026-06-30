// morphicKernel/runtime/codeSynthesizer.js
// Minimal offline V1 synthesizer (deterministic, template-based). Used by the
// legacy ingest/mutation path. No external model calls.
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 6);

export async function synthesizeModule(prompt, oldManifest = null) {
  const name = oldManifest?.name || 'mod_' + nanoid();
  const manifest = oldManifest || { name, route: `/api/${name}`, requires: {} };
  const backendCode = `const { Router } = require('express');
const router = Router();
router.get('/', (req, res) => res.json({ module: ${JSON.stringify(name)}, intent: ${JSON.stringify(prompt)}, status: 'executed' }));
router.get('/health', (req, res) => res.json({ module: ${JSON.stringify(name)}, status: 'operational', ts: Date.now() }));
module.exports = router;
`;
  return { name, manifest, backend: backendCode, frontend: null, driver: null };
}
