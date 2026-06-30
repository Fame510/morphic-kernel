// morphicKernel/kernel.js
// Main runtime: Express + optional Socket.IO, module loading, registry,
// health monitor, and the /runtime/ingest pipeline.
import express from 'express';
import http from 'http';
import moduleManager from './moduleManager.js';
import { loadDriversInMem } from './runtime/driverExecutor.js';
import { runtimeRegistryRouter, registry } from './runtime/registry.js';
import { ingestPrompt } from './backend/autoModuleIngest.js';
import { readLedger, verifyLedger } from './runtime/provenanceLedger.js';
import { HealthMonitor } from './runtime/healthMonitor.js';
import { startHotBackendWatcher } from './runtime/hotBackend.js';
import path from 'path';

export async function createKernel() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const server = http.createServer(app);

  // Optional Socket.IO (graceful if not installed).
  let io = null;
  try {
    const { Server } = await import('socket.io');
    io = new Server(server, { cors: { origin: '*' } });
  } catch (_) {
    console.warn('[kernel] socket.io not installed; live WebSocket push disabled.');
  }

  app.set('morphicApp', app);
  app.set('morphicRegistry', registry);
  if (io) app.set('morphicIO', io);

  // Load existing modules from disk.
  const modules = await moduleManager.loadAllModules();
  modules.forEach((mod) => {
    if (mod.backend) app.use(`/api/${mod.name}`, mod.backend);
    if (mod.driver) loadDriversInMem(mod.driver, mod.name, mod.driverExt);
  });

  // Runtime registry + provenance + ingest endpoints.
  app.use('/runtime', runtimeRegistryRouter);
  app.post('/runtime/ingest', ingestPrompt);

  app.get('/runtime/health', (req, res) => {
    res.json({
      status: 'healthy',
      mountedModules: modules.length,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      ts: Date.now()
    });
  });

  app.get('/runtime/ledger', async (req, res) => {
    res.json({ verification: await verifyLedger(), entries: await readLedger() });
  });

  // SSE live UI push.
  app.get('/runtime/ui-sse', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = () => res.write(`data: ${JSON.stringify(registry.getBundledUiData())}\n\n`);
    send();
    const interval = setInterval(send, 2000);
    req.on('close', () => clearInterval(interval));
  });

  if (io) {
    io.on('connection', (socket) => {
      socket.emit('init', registry.getBundledUiData());
      const unsub = registry.subscribe((data) => socket.emit('update', data));
      socket.on('disconnect', () => unsub && unsub());
    });
  }

  // Filesystem hot-reload watcher (optional chokidar).
  await startHotBackendWatcher(app, path.resolve('./modules'));

  const monitor = new HealthMonitor(app, { interval: 5000 });
  monitor.start();

  return { app, server, io, registry, monitor };
}

// Direct execution entry point.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { server } = await createKernel();
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log('===============================================');
    console.log(` Morphic Kernel live at http://localhost:${PORT}`);
    console.log(' POST /runtime/ingest  { "prompt": "..." }');
    console.log(' GET  /runtime/health');
    console.log(' GET  /runtime/ledger');
    console.log('===============================================');
  });
}
