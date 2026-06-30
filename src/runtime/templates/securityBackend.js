// morphicKernel/runtime/templates/securityBackend.js
// Emits a router exposing HMAC verification and JWT (HS256) issuance.
export function buildTemplate({ name }) {
  const safeName = JSON.stringify(name);
  return `// Auto-generated security module: ${name}
const { Router } = require('express');
const { createHmac } = require('crypto');
const router = Router();

router.post('/auth/issue', (req, res) => {
  const { subject, claims = {}, expiresIn = 3600, secret } = req.body || {};
  if (!subject || !secret) return res.status(400).json({ error: 'MISSING_SUBJECT_OR_SECRET' });
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: subject, iat: now, exp: now + expiresIn, ...claims })).toString('base64url');
  const sig = createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  res.json({ token: header + '.' + payload + '.' + sig, expiresIn });
});

router.post('/verify/hmac', (req, res) => {
  const { payload, signature, secret } = req.body || {};
  if (!payload || !signature || !secret) return res.status(400).json({ error: 'MISSING_DATA' });
  const expected = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  res.json({ valid: signature === expected, algorithm: 'HMAC-SHA256' });
});

router.get('/health', (req, res) => res.json({ module: ${safeName}, domain: 'security', status: 'operational', ts: Date.now() }));

module.exports = router;
`;
}
export default buildTemplate;
