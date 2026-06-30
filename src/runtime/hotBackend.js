// morphicKernel/runtime/hotBackend.js
// Filesystem hot-reload watcher for ./modules/<name>/backend.* files.
// chokidar is an optional dependency; watcher is a no-op if unavailable.
import path from 'path';
import { createRequire } from 'module';

const requireCJS = createRequire(import.meta.url);

export async function startHotBackendWatcher(app, modulesDir) {
  let chokidar;
  try {
    chokidar = (await import('chokidar')).default;
  } catch (_) {
    console.warn('[Hot-FS] chokidar not installed; filesystem watcher disabled.');
    return null;
  }

  const watcher = chokidar.watch(path.join(modulesDir, '*/backend.*'), { ignoreInitial: true });

  const mount = (file) => {
    try { delete requireCJS.cache[requireCJS.resolve(file)]; } catch (_) {}
    const modName = path.basename(path.dirname(file));
    const mountPath = `/api/${modName}`;
    app._router.stack = app._router.stack.filter((l) => !l.route?.path?.startsWith(mountPath));
    try {
      const handler = requireCJS(file);
      app.use(mountPath, handler.default || handler);
      console.log(`[Hot-FS] Mounted/Updated ${mountPath}`);
    } catch (e) {
      console.error(`[Hot-FS] Failed ${mountPath}:`, e.message);
    }
  };

  watcher.on('add', mount);
  watcher.on('change', mount);
  watcher.on('unlink', (file) => {
    const modName = path.basename(path.dirname(file));
    const mountPath = `/api/${modName}`;
    app._router.stack = app._router.stack.filter((l) => !l.route?.path?.startsWith(mountPath));
    console.log(`[Hot-FS] Unmounted ${mountPath}`);
  });

  return watcher;
}
