// morphicKernel/reconfig/atomicSwap.js
// Zero-downtime hot-swap of a module into the live Express router.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { evaluateBundleSafely } from '../runtime/sandboxEvaluator.js';
import { appendProvenance } from '../runtime/provenanceLedger.js';

const requireCJS = createRequire(import.meta.url);

export async function atomicSwap(app, mountName, moduleArtifact, registry) {
  const mountPath = `/api/${mountName}`;
  if (!app || !app._router) throw new Error('InvalidApp');
  if (app.get('reconfigLock')) throw new Error('ReconfigLocked');

  app.set('reconfigLock', true);
  try {
    await evaluateBundleSafely(moduleArtifact.bundleCode);

    app._router.stack = app._router.stack.filter((layer) => {
      try {
        return !(layer?.route?.path && String(layer.route.path).startsWith(mountPath));
      } catch (_) {
        return true;
      }
    });

    const modulesDir = path.resolve('./modules');
    if (!fs.existsSync(modulesDir)) fs.mkdirSync(modulesDir, { recursive: true });
    const outFile = path.join(modulesDir, mountName + '.autobundle.cjs');
    fs.writeFileSync(outFile, moduleArtifact.bundleCode, { encoding: 'utf8' });

    try { delete requireCJS.cache[requireCJS.resolve(outFile)]; } catch (_) {}
    const handler = requireCJS(outFile);
    app.use(mountPath, handler.default || handler);

    await appendProvenance({
      module: mountName,
      signature: moduleArtifact.signature,
      metadata: moduleArtifact.metadata || {},
      action: 'atomic_swap',
      ts: Date.now()
    });

    if (registry && registry.broadcastUpdate) registry.broadcastUpdate();
    return { ok: true, mountPath };
  } finally {
    app.set('reconfigLock', false);
  }
}
