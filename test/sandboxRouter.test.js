// test/sandboxRouter.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFSDAG } from '../lib/memoryFS.js';
import { SandboxRouter } from '../lib/sandboxRouter.js';

describe('SandboxRouter', () => {
  let fs, router;
  beforeEach(() => {
    fs = new MemoryFSDAG();
    router = new SandboxRouter(fs, { timeoutMs: 4000 });
  });

  it('runs safe module code in an isolate and reports the export', async () => {
    const r = await router.runModule('a.js', 'module.exports = { hello: () => 42 };');
    expect(r.ok).toBe(true);
    expect(r.exportType).toBe('object');
    expect(typeof r.ms).toBe('number');
  });

  it('captures console output from the isolate', async () => {
    const r = await router.runModule('log.js', 'console.log("inside isolate"); module.exports = 1;');
    expect(r.ok).toBe(true);
    expect(r.logs.join(' ')).toContain('inside isolate');
  });

  it('allows requiring express (resolved from project root)', async () => {
    const r = await router.runModule('srv.js', 'const e = require("express"); module.exports = typeof e;');
    expect(r.ok).toBe(true);
  });

  it('blocks a forbidden require', async () => {
    const r = await router.runModule('bad.js', 'const f = require("fs"); module.exports = f;');
    expect(r.ok).toBe(false);
    expect(r.err).toContain('Forbidden require');
  });

  it('reports a runtime error without crashing the router', async () => {
    const r = await router.runModule('boom.js', 'throw new Error("kaboom");');
    expect(r.ok).toBe(false);
    expect(r.err).toContain('kaboom');
  });

  it('routes a cascade in dependency-safe ripple order', async () => {
    // c depends on b depends on a
    fs.write('a.js', { code: 'module.exports = "A";', meta: { dependencies: [] } });
    fs.write('b.js', { code: 'module.exports = "B";', meta: { dependencies: ['a.js'] } });
    fs.write('c.js', { code: 'module.exports = "C";', meta: { dependencies: ['b.js'] } });

    const out = await router.routeCascade('a.js');
    expect(out.ok).toBe(true);
    expect(out.sequence).toEqual(['a.js', 'b.js', 'c.js']);
    expect(out.results.map((r) => r.filename)).toEqual(['a.js', 'b.js', 'c.js']);
    expect(out.results.every((r) => r.ok)).toBe(true);
  });

  it('stops the cascade at the first failing module by default', async () => {
    fs.write('a.js', { code: 'module.exports = "A";', meta: { dependencies: [] } });
    fs.write('b.js', { code: 'throw new Error("b is broken");', meta: { dependencies: ['a.js'] } });
    fs.write('c.js', { code: 'module.exports = "C";', meta: { dependencies: ['b.js'] } });

    const out = await router.routeCascade('a.js');
    expect(out.ok).toBe(false);
    expect(out.failedAt).toBe('b.js');
    // c.js should NOT have run (cascade halted at b)
    expect(out.results.map((r) => r.filename)).toEqual(['a.js', 'b.js']);
  });

  it('continues past failures when continueOnError is set', async () => {
    fs.write('a.js', { code: 'module.exports = "A";', meta: { dependencies: [] } });
    fs.write('b.js', { code: 'throw new Error("b is broken");', meta: { dependencies: ['a.js'] } });
    fs.write('c.js', { code: 'module.exports = "C";', meta: { dependencies: ['b.js'] } });

    const out = await router.routeCascade('a.js', { continueOnError: true });
    expect(out.ok).toBe(false);
    expect(out.failedAt).toBe('b.js');
    expect(out.results.map((r) => r.filename)).toEqual(['a.js', 'b.js', 'c.js']);
    expect(out.results.find((r) => r.filename === 'c.js').ok).toBe(true);
  });
});
