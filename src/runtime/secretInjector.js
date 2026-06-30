// morphicKernel/runtime/secretInjector.js
// Injects only the env secrets a module manifest explicitly requires.
import dotenv from 'dotenv';
dotenv.config();

export function injectSecrets(manifest = {}) {
  const injected = {};
  if (!manifest.requires) return injected;
  Object.keys(manifest.requires).forEach((k) => {
    if (process.env[k]) injected[k] = process.env[k];
    else console.warn(`[WARN] Missing secret ${k} required by ${manifest.name || 'module'}`);
  });
  return injected;
}
