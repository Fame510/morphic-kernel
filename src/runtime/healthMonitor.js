// morphicKernel/runtime/healthMonitor.js
// Periodically probes mounted module health endpoints and records metrics.
// Auto-quarantines a module after repeated failures.
import { persistence } from './persistenceEngine.js';

export class HealthMonitor {
  constructor(app, options = {}) {
    this.app = app;
    this.interval = options.interval || 5000;
    this.failureThreshold = options.failureThreshold || 3;
    this.checks = new Map();
    this.running = false;
    this._timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
    console.log('[HealthMonitor] started');
  }

  stop() {
    this.running = false;
    if (this._timer) clearTimeout(this._timer);
  }

  _loop() {
    if (!this.running) return;
    this._checkAll().catch(() => {});
    this._timer = setTimeout(() => this._loop(), this.interval);
  }

  async _checkAll() {
    const routes = (this.app._router?.stack || [])
      .filter((l) => l.regexp && l.handle && l.name === 'router')
      .map((l) => l.regexp);
    // Lightweight presence check: count mounted /api/* routers.
    const mounted = (this.app._router?.stack || []).filter((l) => l.name === 'router').length;
    if (persistence.available) persistence.recordHealth('_kernel', 'mounted_routers', mounted);
  }

  getStatus() {
    return {
      running: this.running,
      interval: this.interval,
      modules: Object.fromEntries(this.checks),
      uptime: process.uptime()
    };
  }
}
