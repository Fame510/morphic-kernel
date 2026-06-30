// morphicKernel/runtime/provenanceLedger.js
// Append-only, hash-chained provenance ledger for every runtime mutation.
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const LEDGER_DIR = path.resolve('./.morphic_ledger');
const LEDGER_FILE = path.join(LEDGER_DIR, 'ledger.log');

function _init() {
  if (!fs.existsSync(LEDGER_DIR)) fs.mkdirSync(LEDGER_DIR, { recursive: true });
  if (!fs.existsSync(LEDGER_FILE)) fs.writeFileSync(LEDGER_FILE, '', { encoding: 'utf8' });
}

export async function appendProvenance(record) {
  _init();
  const prev = await _lastHash();
  const payload = Object.assign({}, record, { prevHash: prev || null, ts: Date.now() });
  const line = JSON.stringify(payload);
  const hash = createHash('sha256').update(line).digest('hex');
  const entry = JSON.stringify({ hash, payload }) + '\n';
  fs.appendFileSync(LEDGER_FILE, entry, { encoding: 'utf8' });
  return { ok: true, hash };
}

export async function readLedger() {
  _init();
  const data = fs.readFileSync(LEDGER_FILE, { encoding: 'utf8' }).trim();
  if (!data) return [];
  return data.split('\n').map((l) => JSON.parse(l));
}

export async function verifyLedger() {
  const entries = await readLedger();
  let prev = null;
  for (const e of entries) {
    const recomputed = createHash('sha256').update(JSON.stringify(e.payload)).digest('hex');
    if (recomputed !== e.hash) return { ok: false, reason: 'HashMismatch', at: e.hash };
    if (e.payload.prevHash !== prev) return { ok: false, reason: 'ChainBreak', at: e.hash };
    prev = e.hash;
  }
  return { ok: true, length: entries.length };
}

async function _lastHash() {
  const arr = await readLedger();
  if (arr.length === 0) return null;
  return arr[arr.length - 1].hash;
}
