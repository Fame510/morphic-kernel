// morphicKernel/runtime/templates/backendDefault.js
// Emits a self-contained CommonJS Express router (CRUD + health) as a string.
export function buildTemplate({ name, intent }) {
  const safeName = JSON.stringify(name);
  const safeIntent = JSON.stringify(intent || '');
  return `// Auto-generated backend module: ${name}
const { Router } = require('express');
const router = Router();
const store = new Map();

router.post('/', (req, res) => {
  const { id, ...data } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID_REQUIRED' });
  const now = Date.now();
  store.set(id, { id, ...data, createdAt: now, updatedAt: now });
  res.status(201).json({ status: 'created', resource: store.get(id) });
});

router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const all = Array.from(store.values());
  res.json({
    module: ${safeName},
    intent: ${safeIntent},
    data: all.slice(offset, offset + limit),
    pagination: { page, limit, total: all.length, totalPages: Math.ceil(all.length / limit) }
  });
});

router.put('/:id', (req, res) => {
  const existing = store.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });
  const updated = { ...existing, ...req.body, updatedAt: Date.now() };
  store.set(req.params.id, updated);
  res.json({ status: 'updated', resource: updated });
});

router.delete('/:id', (req, res) => {
  if (!store.has(req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
  store.delete(req.params.id);
  res.json({ status: 'deleted', id: req.params.id });
});

router.get('/health', (req, res) => res.json({ module: ${safeName}, status: 'operational', ts: Date.now() }));

module.exports = router;
`;
}
export default buildTemplate;
