// wasm-runtime/core/watSynthesizer.js
// Emits gas-instrumented WAT from a structured operation spec. Every loop and
// branch is bounded and carries an explicit `(call $use_gas ...)` so the
// isolate can enforce a hard execution budget. Each emitted loop also carries a
// `;;; bound=<n>` annotation that the verifier reads to prove termination.
import { createHash } from 'crypto';

const GAS = { functionEntry: 15, loopIteration: 10, sysCall: 50, basicBlock: 2 };

export class WATSynthesizer {
  synthesize(spec) {
    const { name = 'module', operations = [] } = spec;
    const intentHash = createHash('sha256').update(JSON.stringify(spec)).digest('hex');

    let wat = `(module
  (import "env" "memory" (memory 1 10))
  (import "env" "use_gas" (func $use_gas (param i32)))
  (import "env" "sys_write" (func $sys_write (param i32 i32) (result i32)))
  (data (i32.const 0) "morphic wasm-runtime: ${name}")
`;
    for (const op of operations) wat += '\n' + this._compileOp(op);
    wat += '\n)';
    return { wat, intentHash, name };
  }

  _compileOp(op) {
    const fname = op.name || 'run';
    const L = [];
    L.push(`  (func $${fname} (export "${fname}") (param $p1 i32) (param $p2 i32) (result i32)`);
    L.push(`    (local $i i32) (local $acc i32)`);
    L.push(`    (call $use_gas (i32.const ${GAS.functionEntry}))`);

    if (op.type === 'compute_loop') {
      const bound = Math.max(1, Math.min(op.iterations || 100, 1000000));
      L.push(`    ;;; bound=${bound}`);
      L.push(`    (local.set $i (i32.const 0))`);
      L.push(`    (local.set $acc (i32.const 0))`);
      L.push(`    (block $exit`);
      L.push(`      (loop $lp`);
      L.push(`        (call $use_gas (i32.const ${GAS.loopIteration}))`);
      L.push(`        (local.set $acc (i32.add (local.get $acc) (i32.const 5)))`);
      L.push(`        (local.set $i (i32.add (local.get $i) (i32.const 1)))`);
      L.push(`        (br_if $exit (i32.ge_s (local.get $i) (i32.const ${bound})))`);
      L.push(`        (br $lp)`);
      L.push(`      )`);
      L.push(`    )`);
      L.push(`    (local.get $acc)`);
    } else if (op.type === 'conditional_branch') {
      L.push(`    (call $use_gas (i32.const ${GAS.basicBlock}))`);
      L.push(`    (local.get $p1)`);
      L.push(`    (if (result i32)`);
      L.push(`      (then (call $use_gas (i32.const ${GAS.basicBlock})) (i32.mul (local.get $p2) (i32.const 2)))`);
      L.push(`      (else (call $use_gas (i32.const ${GAS.basicBlock})) (i32.sub (local.get $p2) (i32.const 1))))`);
    } else if (op.type === 'sys_write') {
      const off = op.offset || 0;
      const len = op.length || 16;
      L.push(`    (call $use_gas (i32.const ${GAS.sysCall}))`);
      L.push(`    (call $sys_write (i32.const ${off}) (i32.const ${len}))`);
    } else {
      // default: add the two params
      L.push(`    (i32.add (local.get $p1) (local.get $p2))`);
    }

    L.push(`  )`);
    return L.join('\n');
  }
}
