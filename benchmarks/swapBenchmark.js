// benchmarks/swapBenchmark.js
// Measures in-process hot-swap latency. Numbers are produced on YOUR machine;
// this repo does not ship pre-baked "Nx faster" claims — run it and see.
import { performance } from 'perf_hooks';
import express from 'express';
import { atomicSwap } from '../src/reconfig/atomicSwap.js';
import { registry } from '../src/runtime/registry.js';

const ITER = parseInt(process.env.ITER || '100', 10);

function bundle(i) {
  return `const { Router } = require('express'); const r = Router(); r.get('/health',(q,s)=>s.json({iter:${i}})); module.exports = r;`;
}

async function run() {
  const app = express();
  app.use(express.json());
  app.set('morphicApp', app);

  for (let i = 0; i < 10; i++) await atomicSwap(app, `warm_${i}`, { name: `warm_${i}`, bundleCode: bundle(i), signature: 'w', metadata: {} }, registry);

  const lat = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await atomicSwap(app, `bench_${i}`, { name: `bench_${i}`, bundleCode: bundle(i), signature: `s${i}`, metadata: {} }, registry);
    lat.push(performance.now() - t0);
  }
  lat.sort((a, b) => a - b);
  const mean = lat.reduce((a, b) => a + b, 0) / lat.length;
  console.log(JSON.stringify({
    operation: 'hot_swap', iterations: ITER,
    mean_ms: +mean.toFixed(3),
    p50_ms: +lat[Math.floor(ITER * 0.5)].toFixed(3),
    p99_ms: +lat[Math.floor(ITER * 0.99)].toFixed(3),
    min_ms: +lat[0].toFixed(3), max_ms: +lat[lat.length - 1].toFixed(3)
  }, null, 2));
}
run().catch((e) => { console.error(e); process.exit(1); });
