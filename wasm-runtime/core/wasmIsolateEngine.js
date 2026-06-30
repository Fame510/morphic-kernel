// experimental/aetheris/core/wasmIsolateEngine.js
// Capability-secured WebAssembly isolate with gas metering and proxied syscalls.
// Uses the native WebAssembly API. Memory ceilings are enforced by the WASM
// Memory `maximum`. Host syscalls are gated by an explicit capability list.
export class WasmIsolateEngine {
  constructor() {
    this.instances = new Map();
  }

  async createIsolate(moduleName, binaryBuffer, capabilities = [], gasLimit = 100000) {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
    let currentGas = gasLimit;

    const importObject = {
      env: {
        memory,
        use_gas: (amount) => {
          currentGas -= amount;
          if (currentGas <= 0) throw new Error('RESOURCE_EXHAUSTION: gas budget depleted');
        },
        sys_write: (ptr, len) => {
          if (!capabilities.includes('filesystem') && !capabilities.includes('privileged')) {
            throw new Error('SECURITY_VIOLATION: unauthorized write in isolate');
          }
          const view = new Uint8Array(memory.buffer, ptr, len);
          process.stdout.write(`[ISOLATE ${moduleName}] ` + new TextDecoder('utf8').decode(view) + '\n');
          return len;
        },
        sys_net_send: () => {
          if (!capabilities.includes('network')) throw new Error('SECURITY_VIOLATION: unauthorized network send');
          return 0;
        },
        sys_time: () => BigInt(Date.now())
      }
    };

    const module = await WebAssembly.compile(binaryBuffer);
    const instance = await WebAssembly.instantiate(module, importObject);
    const ref = {
      instance, memory, capabilities,
      getGasRemaining: () => currentGas,
      resetGas: (n) => { currentGas = n; }
    };
    this.instances.set(moduleName, ref);
    return ref;
  }

  execute(moduleName, exportFuncName, ...args) {
    const isolate = this.instances.get(moduleName);
    if (!isolate) throw new Error(`ISOLATE_NOT_FOUND: ${moduleName}`);
    const fn = isolate.instance.exports[exportFuncName];
    if (typeof fn !== 'function') throw new Error(`FUNCTION_NOT_EXPORTED: ${exportFuncName}`);
    return fn(...args);
  }

  destroyIsolate(moduleName) { this.instances.delete(moduleName); }
}
