// morphicKernel/threadfield/ModuleCell.js
// Live representation of a module. Evaluates backend code in a restricted
// require scope and weaves it into the running Express app.
import { createRequire } from 'module';
import { customAlphabet } from 'nanoid';

const requireCJS = createRequire(import.meta.url);
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz', 6);

export class ModuleCell {
  constructor(name, manifest, backendCode, frontendCode, driverCode, driverExt) {
    this.name = name || 'mod_' + nanoid();
    this.manifest = manifest || { route: `/api/${this.name}` };
    this.backendCode = backendCode;
    this.frontendCode = frontendCode;
    this.driverCode = driverCode;
    this.driverExt = driverExt;
    this.backendInstance = null;
    this.driverInstance = null;
    this.isLive = false;
    this.secrets = {};
  }

  evaluateBackend() {
    if (!this.backendCode) return null;
    const module = { exports: {} };
    const safeRequire = (dep) => {
      if (dep === 'express') return requireCJS('express');
      if (dep === 'crypto') return requireCJS('crypto');
      if (dep === 'nanoid') return { nanoid };
      throw new Error(`Forbidden dependency: ${dep}`);
    };
    try {
      const moduleFactory = new Function('require', 'module', 'exports', 'process', 'console', this.backendCode);
      moduleFactory(safeRequire, module, module.exports, process, console);
      const instance = module.exports.default || module.exports;
      if (instance && !instance.name) instance.name = `${this.name}-router`;
      this.backendInstance = instance;
      return instance;
    } catch (e) {
      console.error(`[ERROR] Backend eval failed ${this.name}:`, e.message);
      return null;
    }
  }

  weave(app, loadDriverFn, secretInjectorFn) {
    if (this.isLive) return;
    this.secrets = secretInjectorFn ? secretInjectorFn(this.manifest) : {};
    const backendHandler = this.evaluateBackend();
    if (backendHandler) {
      const mountPath = `/api/${this.name}`;
      app.use(mountPath, backendHandler);
      console.log(`[Threadfield] Backend woven at ${mountPath}`);
    }
    if (this.driverCode && loadDriverFn) loadDriverFn(this.driverCode, this.name, this.driverExt);
    this.isLive = true;
  }
}
