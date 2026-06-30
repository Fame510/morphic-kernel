// morphicKernel/reconfig/resolve.js
// Legacy in-process mutation engine. Rebuilds a ModuleCell handler and swaps it
// directly on the running app router. Kept for compatibility with the V1 path.
import { ModuleCell } from '../threadfield/ModuleCell.js';
import { synthesizeFromTruth } from '../runtime/synthesizer.js';

const reconfigEngine = {
  mutateCell: async (cell, mutationPrompt, app) => {
    console.log(`[Reconfig] Mutating ${cell.name}`);
    const artifact = await synthesizeFromTruth({
      name: cell.name,
      intent: mutationPrompt,
      owner: cell.manifest?.owner || 'owner::local',
      intentHash: cell.manifest?.intentHash || ''
    });
    const success = reconfigEngine.atomicSwap(cell, artifact.bundleCode, app);
    if (success) console.log(`[Reconfig] Module ${cell.name} live`);
    else console.error('[Reconfig] Swap failed');
    return success;
  },
  atomicSwap: (cell, newCode, app) => {
    const mountPath = `/api/${cell.name}`;
    const tempCell = new ModuleCell(cell.name, cell.manifest, newCode, cell.frontendCode, cell.driverCode, cell.driverExt);
    const newHandler = tempCell.evaluateBackend();
    if (!newHandler) return false;
    app._router.stack = app._router.stack.filter(
      (l) => !(l.regexp?.test(mountPath) || l.name === `${cell.name}-router`)
    );
    app.use(mountPath, newHandler);
    cell.backendCode = newCode;
    cell.backendInstance = newHandler;
    return true;
  }
};

export default reconfigEngine;
