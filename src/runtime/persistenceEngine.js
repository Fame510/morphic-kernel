// morphicKernel/runtime/persistenceEngine.js
// Optional SQLite-backed persistence. If better-sqlite3 is not installed, the
// kernel still runs and provenance is served by the file-based ledger instead.
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';

const DATA_DIR = path.resolve('./.morphic_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sqlite = null;
let available = false;
try {
  const Database = (await import('better-sqlite3')).default;
  sqlite = new Database(path.join(DATA_DIR, 'morphic.sqlite'));
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, route TEXT NOT NULL,
      domain TEXT, signature TEXT NOT NULL, bundle_code TEXT NOT NULL,
      manifest TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT UNIQUE NOT NULL, prev_hash TEXT,
      module_name TEXT NOT NULL, action TEXT NOT NULL, signature TEXT, metadata TEXT, ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, module_name TEXT, metric_type TEXT NOT NULL,
      value REAL NOT NULL, ts INTEGER NOT NULL
    );
  `);
  available = true;
} catch (_) {
  console.warn('[persistence] better-sqlite3 not installed; persistence disabled (file ledger still active).');
}

export const persistence = {
  available,
  saveModule(m) {
    if (!available) return false;
    sqlite.prepare(`INSERT INTO modules (id,name,route,domain,signature,bundle_code,manifest,created_at,updated_at)
      VALUES (@id,@name,@route,@domain,@signature,@bundleCode,@manifest,@createdAt,@updatedAt)
      ON CONFLICT(name) DO UPDATE SET route=excluded.route, domain=excluded.domain, signature=excluded.signature,
        bundle_code=excluded.bundle_code, manifest=excluded.manifest, updated_at=excluded.updated_at`).run({
      id: createHash('sha256').update(m.name + Date.now()).digest('hex').slice(0, 16),
      name: m.name, route: m.route || `/api/${m.name}`, domain: m.domain || 'unknown',
      signature: m.signature, bundleCode: m.bundleCode, manifest: JSON.stringify(m.manifest || {}),
      createdAt: Date.now(), updatedAt: Date.now()
    });
    return true;
  },
  getModule(name) {
    if (!available) return null;
    const row = sqlite.prepare('SELECT * FROM modules WHERE name=?').get(name);
    if (!row) return null;
    return { ...row, manifest: JSON.parse(row.manifest), bundleCode: row.bundle_code };
  },
  getAllModules() {
    if (!available) return [];
    return sqlite.prepare('SELECT * FROM modules ORDER BY updated_at DESC').all().map((r) => ({ ...r, manifest: JSON.parse(r.manifest) }));
  },
  recordHealth(moduleName, metricType, value) {
    if (!available) return;
    sqlite.prepare('INSERT INTO health_snapshots (module_name,metric_type,value,ts) VALUES (?,?,?,?)').run(moduleName, metricType, value, Date.now());
  },
  appendProvenance(record) {
    if (!available) return null;
    const last = sqlite.prepare('SELECT hash FROM provenance ORDER BY id DESC LIMIT 1').get();
    const prevHash = last ? last.hash : null;
    const payload = { ...record, prevHash, ts: Date.now() };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    sqlite.prepare('INSERT INTO provenance (hash,prev_hash,module_name,action,signature,metadata,ts) VALUES (?,?,?,?,?,?,?)')
      .run(hash, prevHash, record.module, record.action, record.signature, JSON.stringify(record.metadata || {}), Date.now());
    return { hash, prevHash };
  },
  readLedger() {
    if (!available) return [];
    return sqlite.prepare('SELECT * FROM provenance ORDER BY id ASC').all().map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));
  },
  close() { if (available && sqlite) sqlite.close(); }
};
