// morphicKernel/runtime/registry.js
// Threadfield registry: live module tracking + UI broadcast hub.
import { Router } from 'express';

const runtimeRegistryRouter = Router();
const liveModules = new Map();
const subscribers = [];

export function broadcastUpdate() {
  const data = registry.getBundledUiData();
  subscribers.forEach((s) => {
    try { s(data); } catch (_) { /* subscriber errors must not break the loop */ }
  });
}

export const registry = {
  add: (cell) => { liveModules.set(cell.name, cell); broadcastUpdate(); },
  remove: (name) => { liveModules.delete(name); broadcastUpdate(); },
  get: (name) => liveModules.get(name),
  getAll: () => Array.from(liveModules.values()),
  getFrontendRegistry: () =>
    Array.from(liveModules.values())
      .filter((c) => c.frontendCode)
      .map((c) => ({ name: c.name, frontendCode: c.frontendCode, route: c.manifest?.route })),
  getBundledUiData: () =>
    Array.from(liveModules.values())
      .filter((c) => c.frontendCode)
      .map((c) => ({ name: c.name, route: c.manifest?.route, rawCode: c.frontendCode, secrets: c.secrets || {} })),
  addModuleArtifact: (name, artifact) => {
    const existing = liveModules.get(name) || { name };
    existing.artifact = artifact;
    existing.manifest = existing.manifest || artifact.manifest || { route: `/api/${name}` };
    liveModules.set(name, existing);
    broadcastUpdate();
  },
  logEvent: (evt) => { /* hook for external observers */ if (process.env.MORPHIC_DEBUG) console.log('[registry:event]', evt); },
  broadcastUpdate,
  subscribe: (fn) => { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; }
};

runtimeRegistryRouter.get('/modules', (req, res) => res.json(registry.getFrontendRegistry()));
runtimeRegistryRouter.get('/ui-bundle', (req, res) => res.json(registry.getBundledUiData()));
runtimeRegistryRouter.get('/live', (req, res) => res.json(registry.getAll().map((c) => ({ name: c.name, route: c.manifest?.route }))));

export { runtimeRegistryRouter };
