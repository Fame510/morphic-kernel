// morphicKernel/runtime/intentParserV2.js
// Multi-pass, AST-aware, risk-aware analyzer for candidate module source.
// Optional dependency: @babel/parser + @babel/traverse. Falls back to regex
// analysis when Babel is unavailable so the core kernel still runs.
import { createHash } from 'crypto';

let babelParse = null;
let babelTraverse = null;
try {
  const p = await import('@babel/parser');
  const t = await import('@babel/traverse');
  babelParse = p.parse;
  babelTraverse = t.default || t.traverse || t;
} catch (_) {
  // Babel not installed; AST passes degrade to regex heuristics.
}

const DOMAIN_SIGNATURES = {
  quantum: {
    keywords: ['qiskit', 'cirq', 'qubit', 'hadamard', 'entanglement', 'superposition'],
    imports: ['qiskit', 'cirq', '@quantum-sdk'],
    patterns: [/QuantumCircuit/, /quantum\./, /qubit\(/],
    complexity: 'extreme'
  },
  vr: {
    keywords: ['three.js', 'babylon', 'a-frame', 'webgl', 'shader', 'mesh', 'texture'],
    imports: ['three', '@react-three', 'babylonjs'],
    patterns: [/THREE\./, /<a-scene/, /WebGLRenderer/],
    complexity: 'high'
  },
  ai_ml: {
    keywords: ['tensorflow', 'pytorch', 'neural', 'inference', 'training', 'federated'],
    imports: ['tensorflow', 'torch', 'onnx', '@tensorflow'],
    patterns: [/model\.predict/, /\.fit\(/, /Tensor\(/],
    complexity: 'extreme'
  },
  backend: {
    keywords: ['express', 'fastify', 'router', 'middleware', 'auth', 'database'],
    imports: ['express', 'fastify', 'pg', 'mongoose'],
    patterns: [/app\.(get|post|use)/, /Router\(\)/],
    complexity: 'medium'
  },
  security: {
    keywords: ['encryption', 'signature', 'hash', 'auth', 'jwt', 'oauth'],
    imports: ['crypto', 'jsonwebtoken', 'bcrypt'],
    patterns: [/encrypt\(/, /verify\(/, /hash\(/],
    complexity: 'high'
  }
};

const RISK_PATTERNS = {
  critical: [
    /eval\(/, /new Function\(/, /child_process/, /exec\(/, /spawn\(/,
    /fs\.(write|unlink|rm)/, /process\.exit/, /require\(['"]vm['"]\)/
  ],
  high: [/fetch\(/, /http\.(get|request)/, /net\.connect/, /dns\.resolve/, /process\.env/, /process\.cwd/],
  medium: [/setTimeout\(/, /setInterval\(/, /Promise\./, /async/]
};

export class IntentParserV2 {
  constructor() {
    this.intentCache = new Map();
  }

  async parse(code, context = {}) {
    const cacheKey = createHash('sha256').update(code).digest('hex');
    if (this.intentCache.has(cacheKey)) return this.intentCache.get(cacheKey);

    const analysis = {
      domain: this._detectDomain(code),
      riskProfile: this._assessRisk(code),
      dependencies: this._extractDependencies(code),
      interfaces: this._extractInterfaces(code),
      resources: this._estimateResources(code),
      securityMatrix: this._analyzeSecurity(code),
      astMetrics: this._analyzeAST(code),
      confidence: 0,
      timestamp: Date.now()
    };
    analysis.confidence = this._calculateConfidence(analysis);

    const validation = this._validateIntent(analysis, context);
    if (!validation.valid) throw new Error(`IntentValidationFailed: ${validation.reason}`);

    this.intentCache.set(cacheKey, analysis);
    return analysis;
  }

  _detectDomain(code) {
    const scores = {};
    for (const [domain, sigs] of Object.entries(DOMAIN_SIGNATURES)) {
      let score = 0;
      sigs.keywords.forEach((kw) => { if (code.toLowerCase().includes(kw.toLowerCase())) score += 1; });
      sigs.imports.forEach((imp) => { if (code.includes(imp)) score += 3; });
      sigs.patterns.forEach((pat) => { if (pat.test(code)) score += 5; });
      scores[domain] = score;
    }
    const maxScore = Math.max(...Object.values(scores));
    const detectedDomain = Object.entries(scores).find(([, s]) => s === maxScore)?.[0] || 'backend';
    return {
      name: detectedDomain,
      confidence: maxScore > 0 ? Math.min(maxScore / 15, 0.99) : 0.3,
      allScores: scores,
      complexity: DOMAIN_SIGNATURES[detectedDomain]?.complexity || 'medium'
    };
  }

  _assessRisk(code) {
    const findings = { critical: [], high: [], medium: [], overallScore: 0 };
    for (const [level, patterns] of Object.entries(RISK_PATTERNS)) {
      patterns.forEach((pat) => {
        const matches = code.match(pat);
        if (matches) {
          findings[level].push({ pattern: pat.toString(), count: matches.length, lines: this._findLineNumbers(code, pat) });
          findings.overallScore += level === 'critical' ? 10 : level === 'high' ? 5 : 2;
        }
      });
    }
    findings.quarantineRequired = findings.overallScore >= 15;
    findings.maxRiskLevel = findings.critical.length > 0 ? 'critical' : findings.high.length > 0 ? 'high' : findings.medium.length > 0 ? 'medium' : 'low';
    return findings;
  }

  _extractDependencies(code) {
    const deps = [];
    const seen = new Set();
    const es6Regex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]+\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = es6Regex.exec(code)) !== null) {
      if (!seen.has(match[1])) { seen.add(match[1]); deps.push({ name: match[1], type: 'es6', version: 'latest' }); }
    }
    const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = cjsRegex.exec(code)) !== null) {
      if (!seen.has(match[1])) { seen.add(match[1]); deps.push({ name: match[1], type: 'commonjs', version: 'latest' }); }
    }
    return deps;
  }

  _extractInterfaces(code) {
    const interfaces = { exports: [], endpoints: [], events: [], config: [] };
    if (babelParse && babelTraverse) {
      try {
        const ast = babelParse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
        babelTraverse(ast, {
          ExportNamedDeclaration(path) {
            if (path.node.declaration) {
              interfaces.exports.push({ name: path.node.declaration.id?.name || 'anonymous', type: path.node.declaration.type });
            }
          },
          ExportDefaultDeclaration() { interfaces.exports.push({ name: 'default', type: 'default' }); },
          CallExpression(path) {
            if (path.node.callee.type === 'MemberExpression') {
              const obj = path.node.callee.object?.name;
              const prop = path.node.callee.property?.name;
              if (obj === 'router' || obj === 'app') {
                interfaces.endpoints.push({ method: prop, path: path.node.arguments[0]?.value || '/' });
              }
            }
          }
        });
        return interfaces;
      } catch (_) { /* fall through to regex */ }
    }
    let match;
    const exportRegex = /export\s+(?:default\s+)?(?:function|const|class)\s+(\w+)/g;
    while ((match = exportRegex.exec(code)) !== null) interfaces.exports.push({ name: match[1], type: 'regex' });
    return interfaces;
  }

  _estimateResources(code) {
    const lines = code.split('\n').length;
    const hasAsync = /async|Promise|setTimeout/.test(code);
    const hasLoops = /for\s*\(|while\s*\(|\.forEach\(|\.map\(/.test(code);
    const hasRecursion = /function\s+\w+\([^)]*\)\s*\{[^}]*\w+\([^)]*\)/.test(code);
    let estimatedMemoryMB = Math.min(lines * 0.1, 512);
    let estimatedLatency = 50;
    if (hasAsync) estimatedLatency += 100;
    if (hasLoops) { estimatedMemoryMB *= 2; estimatedLatency += 50; }
    if (hasRecursion) { estimatedMemoryMB *= 3; estimatedLatency += 200; }
    return {
      estimatedMemoryMB: Math.round(estimatedMemoryMB),
      estimatedLatency: Math.round(estimatedLatency),
      complexity: lines > 500 ? 'high' : lines > 200 ? 'medium' : 'low',
      linesOfCode: lines
    };
  }

  _analyzeSecurity(code) {
    const checks = {
      inputValidation: /sanitize|validate|escape|trim/.test(code),
      errorHandling: /try\s*\{|catch\s*\(|\.catch\(/.test(code),
      authentication: /auth|token|session|jwt/.test(code.toLowerCase()),
      encryption: /encrypt|decrypt|hash|crypto/.test(code.toLowerCase()),
      rateLimiting: /rate.?limit|throttle/.test(code.toLowerCase()),
      sqlInjection: /\$?\w+\s*=.*req\.(body|query|params)/.test(code),
      xssProtection: /DOMPurify|sanitize|escapeHTML/.test(code)
    };
    const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
    return {
      checks,
      score: Math.round(score * 100),
      grade: score >= 0.8 ? 'A' : score >= 0.6 ? 'B' : score >= 0.4 ? 'C' : 'F',
      recommendations: this._generateSecurityRecommendations(checks)
    };
  }

  _analyzeAST(code) {
    if (!babelParse || !babelTraverse) return { fallback: true, note: 'babel not installed' };
    try {
      const ast = babelParse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      let functionCount = 0, classCount = 0, importCount = 0, maxDepth = 0;
      babelTraverse(ast, {
        FunctionDeclaration() { functionCount++; },
        ClassDeclaration() { classCount++; },
        ImportDeclaration() { importCount++; },
        BlockStatement(path) {
          const depth = path.getAncestry().filter((p) => p.isBlockStatement()).length;
          maxDepth = Math.max(maxDepth, depth);
        }
      });
      return { functionCount, classCount, importCount, maxNestingDepth: maxDepth, maintainability: this._calculateMaintainability(functionCount, classCount, maxDepth) };
    } catch (e) {
      return { error: 'AST parsing failed', fallback: true };
    }
  }

  _calculateConfidence(analysis) {
    let confidence = 0.5;
    if (analysis.domain.confidence > 0.7) confidence += 0.2;
    if (analysis.riskProfile.overallScore < 10) confidence += 0.1;
    if (analysis.dependencies.length > 0) confidence += 0.05;
    if (analysis.securityMatrix.score > 60) confidence += 0.1;
    if (analysis.astMetrics.error === undefined) confidence += 0.05;
    return Math.min(confidence, 0.99);
  }

  _validateIntent(analysis, context) {
    if (analysis.confidence < 0.4) return { valid: false, reason: 'Low confidence score' };
    if (analysis.riskProfile.quarantineRequired && !context.allowCriticalRisk) return { valid: false, reason: 'Critical risk patterns detected' };
    if (analysis.domain.complexity === 'extreme' && !context.allowExtremeComplexity) return { valid: false, reason: 'Extreme complexity not permitted' };
    return { valid: true };
  }

  _findLineNumbers(code, pattern) {
    const lines = code.split('\n');
    const out = [];
    lines.forEach((line, idx) => { if (pattern.test(line)) out.push(idx + 1); });
    return out;
  }

  _generateSecurityRecommendations(checks) {
    const recs = [];
    if (!checks.inputValidation) recs.push('Add input validation/sanitization');
    if (!checks.errorHandling) recs.push('Implement proper error handling');
    if (!checks.authentication) recs.push('Add authentication/authorization');
    if (!checks.sqlInjection) recs.push('Use parameterized queries to prevent SQL injection');
    if (!checks.xssProtection) recs.push('Implement XSS protection');
    return recs;
  }

  _calculateMaintainability(funcs, classes, depth) {
    return Math.max(0, Math.min(100, 100 - funcs * 2 - classes * 5 - depth * 10));
  }
}
