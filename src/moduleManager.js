// morphicKernel/moduleManager.js
// Loads modules declared on disk under ./modules/<name>/manifest.json.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { injectSecrets } from './runtime/secretInjector.js';

const requireCJS = createRequire(import.meta.url);

const moduleManager = {
  loadAllModules: async () => {
    const base = path.resolve('./modules');
    const mods = [];
    if (!fs.existsSync(base)) { fs.mkdirSync(base, { recursive: true }); return mods; }
    for (const name of fs.readdirSync(base)) {
      const modDir = path.join(base, name);
      if (!fs.statSync(modDir).isDirectory()) continue;
      const manifestPath = path.join(modDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const secrets = injectSecrets(manifest);
      let backend = null;
      if (manifest.backend) {
        try { backend = requireCJS(path.join(modDir, manifest.backend)); }
        catch (e) { console.error(`[ERROR] Failed to load module ${name}:`, e.message); }
      }
      mods.push({
        name, route: manifest.route || `/${name.toLowerCase()}`,
        frontend: manifest.frontend, backend: backend?.default || backend,
        driver: manifest.driver, driverExt: manifest.driverExt, secrets
      });
    }
    return mods;
  }
};

export default moduleManager;
