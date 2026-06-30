// test/memoryFS.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFSDAG } from '../lib/memoryFS.js';

describe('MemoryFSDAG', () => {
  let fs;
  beforeEach(() => { fs = new MemoryFSDAG(); });

  it('writes and reads a file with metadata', () => {
    fs.write('a.js', { code: 'export const a = 1;', meta: { domain: 'backend', dependencies: [] } });
    const entry = fs.read('a.js');
    expect(entry).toBeTruthy();
    expect(entry.code).toContain('a = 1');
    expect(entry.meta.domain).toBe('backend');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('builds forward and reverse edges', () => {
    fs.write('a.js', { code: '', meta: { dependencies: ['b.js'] } });
    fs.write('b.js', { code: '', meta: { dependencies: [] } });
    const snap = fs.getGraphSnapshot();
    expect(snap.nodes.map((n) => n.id).sort()).toEqual(['a.js', 'b.js']);
    expect(snap.links).toContainEqual({ source: 'a.js', target: 'b.js' });
  });

  it('rejects a direct circular dependency and rolls back atomically', () => {
    fs.write('a.js', { code: '', meta: { dependencies: ['b.js'] } });
    fs.write('b.js', { code: '', meta: { dependencies: [] } });
    // Now make b depend on a -> cycle a->b->a
    expect(() => fs.write('b.js', { code: 'v2', meta: { dependencies: ['a.js'] } }))
      .toThrow(/Circular dependency/);
    // b.js must remain at its previous (non-cyclic) state
    expect(fs.read('b.js').code).toBe('');
    expect(fs.getGraphSnapshot().links).toContainEqual({ source: 'a.js', target: 'b.js' });
  });

  it('rejects an indirect (transitive) cycle', () => {
    fs.write('a.js', { code: '', meta: { dependencies: ['b.js'] } });
    fs.write('b.js', { code: '', meta: { dependencies: ['c.js'] } });
    expect(() => fs.write('c.js', { code: '', meta: { dependencies: ['a.js'] } }))
      .toThrow(/Circular dependency/);
  });

  it('rolls back a brand-new file that introduces a cycle (no ghost node)', () => {
    fs.write('a.js', { code: '', meta: { dependencies: ['new.js'] } });
    // writing new.js depending back on a.js would form a cycle
    expect(() => fs.write('new.js', { code: '', meta: { dependencies: ['a.js'] } }))
      .toThrow(/Circular dependency/);
    expect(fs.has('new.js')).toBe(false);
  });

  it('computes a reload cascade in ripple order (mutated file first)', () => {
    // c depends on b depends on a;  changing a should reload a, then b, then c
    fs.write('a.js', { code: '', meta: { dependencies: [] } });
    fs.write('b.js', { code: '', meta: { dependencies: ['a.js'] } });
    fs.write('c.js', { code: '', meta: { dependencies: ['b.js'] } });
    const seq = fs.getReloadSequence('a.js');
    expect(seq[0]).toBe('a.js');
    expect(seq.indexOf('b.js')).toBeLessThan(seq.indexOf('c.js'));
    expect(seq).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('notifies subscribers on write and supports unsubscribe', () => {
    const seen = [];
    const unsub = fs.subscribe((snap) => seen.push(snap.nodes.length));
    // immediate snapshot on subscribe (0 nodes)
    expect(seen[0]).toBe(0);
    fs.write('a.js', { code: '', meta: { dependencies: [] } });
    expect(seen[seen.length - 1]).toBe(1);
    unsub();
    fs.write('b.js', { code: '', meta: { dependencies: [] } });
    // no new notification after unsubscribe
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('keeps unresolved dependencies out of links and reports them as pending', () => {
    fs.write('a.js', { code: '', meta: { dependencies: ['missing.js'] } });
    const snap = fs.getGraphSnapshot();
    expect(snap.links).toHaveLength(0);
    expect(snap.pending).toContainEqual({ source: 'a.js', target: 'missing.js' });
  });
});
