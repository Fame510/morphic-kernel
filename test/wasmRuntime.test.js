import { describe, it, expect } from 'vitest';
import { WATSynthesizer } from '../wasm-runtime/core/watSynthesizer.js';
import { SymbolicVerifier } from '../wasm-runtime/core/symbolicVerifier.js';
import { MerkleStateTreeRouter } from '../wasm-runtime/core/merkleStateTree.js';

describe('WAT synthesizer', () => {
  it('emits a bounded, gas-instrumented loop', () => {
    const { wat } = new WATSynthesizer().synthesize({ name: 'm', operations: [{ name: 'loop', type: 'compute_loop', iterations: 25 }] });
    expect(wat).toContain('(loop $lp');
    expect(wat).toContain(';;; bound=25');
    expect(wat).toContain('(call $use_gas');
  });
});

describe('Symbolic verifier (analyzes real WAT)', () => {
  it('verifies a bounded loop', async () => {
    const { wat } = new WATSynthesizer().synthesize({ name: 'm', operations: [{ name: 'loop', type: 'compute_loop', iterations: 10 }] });
    const r = await new SymbolicVerifier().verify(wat, { maxLatency: 1000, maxMemoryMB: 64 });
    expect(r.verified).toBe(true);
    expect(r.analysis.unboundedLoops).toBe(0);
  });
  it('rejects an unbounded loop', async () => {
    const wat = `(module (import "env" "use_gas" (func $use_gas (param i32))) (func $bad (loop $lp (br $lp))))`;
    const r = await new SymbolicVerifier().verify(wat, {});
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('UNBOUNDED_LOOP_DETECTED');
  });
});

describe('Merkle radix router', () => {
  it('swaps routes and changes the root hash', () => {
    const router = new MerkleStateTreeRouter();
    const h0 = router.root.hash;
    const c = router.atomicSwap('/api/calc/loop', { moduleName: 'calc', funcName: 'loop' });
    expect(c.rootHash).not.toBe(h0);
    expect(router.matchRoute('/api/calc/loop')).toEqual({ moduleName: 'calc', funcName: 'loop' });
    expect(router.matchRoute('/api/missing')).toBeNull();
  });
});
