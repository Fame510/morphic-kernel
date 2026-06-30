// === File: lib/memoryFS.js ===
// Reactive in-memory file store + dependency DAG for morphic-kernel.
//
// Tracks generated/mutated files in memory, builds a directed dependency graph
// from each file's metadata (meta.dependencies), rejects mutations that would
// introduce a circular import, and lets UI surfaces (e.g. a D3 MindMap)
// subscribe to live graph snapshots. Pure in-process: no server round-trip, so
// the mutation loop can iterate immediately.

export class MemoryFSDAG {
  constructor() {
    // Core virtual file store: filename -> { code, meta, timestamp }
    this.store = new Map();

    // Forward adjacency: dependent -> [dependencies]
    this.graph = new Map();

    // Reverse adjacency: dependency -> [dependents] (for ripple reloads)
    this.reverseGraph = new Map();

    // Reactive subscribers (UI bindings)
    this.listeners = new Set();
  }

  /**
   * Commit or mutate a file in the virtual kernel file system.
   * Throws (and leaves state unchanged) if the new edges create a cycle.
   */
  write(filename, { code, meta = {} }) {
    const prevEntry = this.store.get(filename);
    // Stage the file first so snapshots include it, but be ready to roll back.
    this.store.set(filename, { code, meta, timestamp: Date.now() });
    try {
      this._updateDependencies(filename, meta.dependencies || []);
    } catch (err) {
      // Roll back the store mutation too, so a rejected write is fully atomic.
      if (prevEntry) this.store.set(filename, prevEntry);
      else this.store.delete(filename);
      throw err;
    }
    this._notify();
    return this.store.get(filename);
  }

  read(filename) {
    return this.store.get(filename) || null;
  }

  has(filename) {
    return this.store.has(filename);
  }

  /**
   * Safe dependency registration with cycle detection + rollback.
   */
  _updateDependencies(node, dependencies) {
    const oldDeps = this.graph.get(node);
    this.graph.set(node, [...dependencies]);

    if (this._hasCycle()) {
      // Rollback to the prior edge set for this node.
      if (oldDeps === undefined) this.graph.delete(node);
      else this.graph.set(node, oldDeps);
      throw new Error(`Morphic Mutation Rejected: Circular dependency detected involving ${node}`);
    }

    this._rebuildReverseGraph();
  }

  _hasCycle() {
    const visited = new Set();
    const recStack = new Set();

    const dfs = (node) => {
      if (recStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      recStack.add(node);

      const neighbors = this.graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (dfs(neighbor)) return true;
      }

      recStack.delete(node);
      return false;
    };

    for (const node of this.graph.keys()) {
      if (dfs(node)) return true;
    }
    return false;
  }

  _rebuildReverseGraph() {
    this.reverseGraph.clear();
    for (const [dependent, dependencies] of this.graph.entries()) {
      for (const dependency of dependencies) {
        if (!this.reverseGraph.has(dependency)) {
          this.reverseGraph.set(dependency, []);
        }
        this.reverseGraph.get(dependency).push(dependent);
      }
    }
  }

  /**
   * Trace the downward mutation cascade: if `mutatedFile` changes, return the
   * ordered list of files to reload, mutated file first, then its transitive
   * dependents in dependency-safe order.
   */
  getReloadSequence(mutatedFile) {
    const sequence = [];
    const visited = new Set();

    const topo = (node) => {
      if (visited.has(node)) return;
      visited.add(node);
      const dependents = this.reverseGraph.get(node) || [];
      for (const dependent of dependents) {
        topo(dependent);
      }
      // unshift => dependents end up after the things they depend on
      sequence.unshift(node);
    };

    topo(mutatedFile);
    // sequence is already in ripple order (mutatedFile first). No extra reverse.
    return sequence;
  }

  // ---- Pub/Sub for UI bindings ----
  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.getGraphSnapshot());
    return () => this.listeners.delete(callback);
  }

  _notify() {
    const snapshot = this.getGraphSnapshot();
    this.listeners.forEach((cb) => cb(snapshot));
  }

  /**
   * D3-friendly snapshot. Only emits links whose target is a known node, so a
   * dependency that has not been written yet does not produce a dangling link
   * that breaks force-graph rendering. Such pending deps are reported
   * separately under `pending` for optional ghost rendering.
   */
  getGraphSnapshot() {
    const nodes = [];
    const links = [];
    const pending = [];

    for (const [filename, fileData] of this.store.entries()) {
      nodes.push({ id: filename, domain: (fileData.meta && fileData.meta.domain) || 'unknown' });
    }
    const known = new Set(this.store.keys());

    for (const [filename] of this.store.entries()) {
      const deps = this.graph.get(filename) || [];
      for (const dep of deps) {
        if (known.has(dep)) links.push({ source: filename, target: dep });
        else pending.push({ source: filename, target: dep });
      }
    }

    return { nodes, links, pending };
  }
}

export const memoryFS = new MemoryFSDAG();
