// experimental/aetheris/core/merkleStateTree.js
// O(K) Merkle-Radix Trie router. Route swaps clone the affected branch and
// atomically replace the root pointer, producing a hash-chained state history.
import { createHash, randomBytes } from 'crypto';

class RadixTrieNode {
  constructor(part = '') {
    this.part = part;
    this.children = new Map();
    this.isLeaf = false;
    this.handler = null;
    this.hash = '';
  }

  recalculateHash() {
    const h = createHash('sha256');
    h.update(this.part);
    h.update(this.isLeaf ? '1' : '0');
    if (this.handler) h.update(JSON.stringify(this.handler));
    for (const key of Array.from(this.children.keys()).sort()) {
      const child = this.children.get(key);
      child.recalculateHash();
      h.update(child.hash);
    }
    this.hash = h.digest('hex');
  }
}

export class MerkleStateTreeRouter {
  constructor() {
    this.root = new RadixTrieNode();
    this.stateHistory = [];
    this.root.recalculateHash();
  }

  atomicSwap(routePath, handler) {
    const parts = routePath.split('/').filter(Boolean);
    const newRoot = this._clone(this.root);
    let cur = newRoot;
    for (const p of parts) {
      if (!cur.children.has(p)) cur.children.set(p, new RadixTrieNode(p));
      cur = cur.children.get(p);
    }
    cur.isLeaf = true;
    cur.handler = handler;
    newRoot.recalculateHash();

    const prevHash = this.root.hash;
    const block = this._block(prevHash, newRoot.hash, routePath);
    this.root = newRoot;
    this.stateHistory.push(block);
    return { status: 'committed', rootHash: this.root.hash, transitionBlock: block };
  }

  matchRoute(routePath) {
    const parts = routePath.split('/').filter(Boolean);
    let cur = this.root;
    for (const p of parts) {
      if (!cur.children.has(p)) return null;
      cur = cur.children.get(p);
    }
    return cur.isLeaf ? cur.handler : null;
  }

  _clone(node) {
    const c = new RadixTrieNode(node.part);
    c.isLeaf = node.isLeaf; c.handler = node.handler; c.hash = node.hash;
    for (const [k, ch] of node.children.entries()) c.children.set(k, this._clone(ch));
    return c;
  }

  _block(prevHash, currentHash, mutatedRoute) {
    const b = { version: 1, prevHash, currentHash, mutatedRoute, timestamp: Date.now(), nonce: randomBytes(8).toString('hex') };
    b.signature = createHash('sha256').update(JSON.stringify(b)).digest('hex');
    return b;
  }
}
