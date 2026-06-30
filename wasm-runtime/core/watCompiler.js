// experimental/aetheris/core/watCompiler.js
// REAL WAT -> WASM compiler via the optional `wabt` dependency.
// This replaces the original hardcoded-stub compiler. If `wabt` is not
// installed, compilation throws a clear error instead of silently returning a
// fake module. Install with: npm install wabt
let wabtPromise = null;

async function getWabt() {
  if (!wabtPromise) {
    wabtPromise = import('wabt')
      .then((m) => (m.default || m)())
      .catch(() => null);
  }
  return wabtPromise;
}

export async function wat2wasm(watSource, { moduleName = 'module' } = {}) {
  const wabt = await getWabt();
  if (!wabt) {
    throw new Error(
      'WAT_COMPILER_UNAVAILABLE: the optional `wabt` package is not installed. ' +
      'Run `npm install wabt` to enable real WAT->WASM compilation.'
    );
  }
  const parsed = wabt.parseWat(moduleName, watSource);
  try {
    parsed.resolveNames();
    parsed.validate();
    const { buffer } = parsed.toBinary({ log: false, write_debug_names: false });
    return new Uint8Array(buffer);
  } finally {
    parsed.destroy();
  }
}

export async function isCompilerAvailable() {
  return (await getWabt()) !== null;
}
