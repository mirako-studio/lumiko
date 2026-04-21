import { describe, it, expect } from 'vitest';
import { resolveImport, extractPackageName, normalize } from '../../src/graph/resolver.js';

// Helper: build a file set from a list of paths
const set = (...paths: string[]) => new Set(paths);

// ── resolveImport ───────────────────────────────────────────────────────

describe('resolveImport — relative TS/JS', () => {
  it('resolves exact relative paths', () => {
    const files = set('src/foo.ts', 'src/bar.ts');
    expect(resolveImport('./bar', 'src/foo.ts', files)).toBe('src/bar.ts');
  });

  it('resolves .js imports to .ts files (ESM quirk)', () => {
    const files = set('src/foo.ts', 'src/bar.ts');
    expect(resolveImport('./bar.js', 'src/foo.ts', files)).toBe('src/bar.ts');
  });

  it('resolves .js to .tsx', () => {
    const files = set('src/foo.ts', 'src/Button.tsx');
    expect(resolveImport('./Button.js', 'src/foo.ts', files)).toBe('src/Button.tsx');
  });

  it('resolves directory imports to index.ts', () => {
    const files = set('src/foo.ts', 'src/lib/index.ts');
    expect(resolveImport('./lib', 'src/foo.ts', files)).toBe('src/lib/index.ts');
  });

  it('resolves parent-relative paths', () => {
    const files = set('src/a/foo.ts', 'src/b/bar.ts');
    expect(resolveImport('../b/bar', 'src/a/foo.ts', files)).toBe('src/b/bar.ts');
  });

  it('returns null for unresolvable relative paths', () => {
    const files = set('src/foo.ts');
    expect(resolveImport('./missing', 'src/foo.ts', files)).toBeNull();
  });

  it('returns null for external packages', () => {
    const files = set('src/foo.ts');
    expect(resolveImport('commander', 'src/foo.ts', files)).toBeNull();
    expect(resolveImport('@scope/pkg', 'src/foo.ts', files)).toBeNull();
  });
});

describe('resolveImport — Python', () => {
  it('resolves `.` to same-dir __init__.py or module', () => {
    const files = set('pkg/__init__.py', 'pkg/foo.py');
    expect(resolveImport('.', 'pkg/foo.py', files)).toBe('pkg/__init__.py');
  });

  it('resolves `.foo` to same-dir foo.py', () => {
    const files = set('pkg/foo.py', 'pkg/bar.py');
    // `.bar` from pkg/foo.py should resolve to pkg/bar.py
    expect(resolveImport('.bar', 'pkg/foo.py', files)).toBe('pkg/bar.py');
  });

  it('resolves `..foo.bar` across parents', () => {
    const files = set('pkg/a/x.py', 'pkg/b/bar.py');
    expect(resolveImport('..b.bar', 'pkg/a/x.py', files)).toBe('pkg/b/bar.py');
  });
});

describe('resolveImport — cross-platform', () => {
  it('normalizes backslash paths', () => {
    const files = set('src/foo.ts', 'src/bar.ts');
    expect(resolveImport('./bar', 'src\\foo.ts', files)).toBe('src/bar.ts');
  });
});

// ── extractPackageName ──────────────────────────────────────────────────

describe('extractPackageName', () => {
  it('handles simple packages', () => {
    expect(extractPackageName('commander')).toBe('commander');
  });

  it('handles scoped packages', () => {
    expect(extractPackageName('@anthropic-ai/sdk')).toBe('@anthropic-ai/sdk');
  });

  it('strips subpaths from scoped packages', () => {
    expect(extractPackageName('@scope/pkg/sub/path')).toBe('@scope/pkg');
  });

  it('strips subpaths from unscoped packages', () => {
    expect(extractPackageName('lodash/fp')).toBe('lodash');
  });

  it('preserves node: prefix as-is', () => {
    expect(extractPackageName('node:fs')).toBe('node:fs');
  });

  it('strips subpath from unprefixed builtins', () => {
    expect(extractPackageName('fs/promises')).toBe('fs');
  });
});

// ── normalize ───────────────────────────────────────────────────────────

describe('normalize', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalize('src\\core\\foo.ts')).toBe('src/core/foo.ts');
  });

  it('is a no-op for already-normalized paths', () => {
    expect(normalize('src/foo.ts')).toBe('src/foo.ts');
  });
});
