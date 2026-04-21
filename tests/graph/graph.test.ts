import { describe, it, expect } from 'vitest';
import { buildGraph } from '../../src/graph/index.js';
import type { ScannedFile } from '../../src/types/index.js';

/**
 * Build a fake ScannedFile without touching the filesystem. Used to make
 * graph integration tests fully hermetic.
 */
function file(path: string, content: string): ScannedFile {
  const ext = path.includes('.') ? '.' + path.split('.').pop()! : '';
  return {
    path,
    content,
    size: content.length,
    lines: content.split('\n').length,
    extension: ext,
  };
}

describe('buildGraph — integration', () => {
  it('produces an empty-ish graph for a single isolated file', () => {
    const graph = buildGraph([file('src/a.ts', 'export const x = 1;')]);

    expect(graph.stats.totalFiles).toBe(1);
    expect(graph.stats.totalInternalEdges).toBe(0);
    expect(graph.stats.orphans).toEqual(['src/a.ts']);
    expect(graph.languages).toEqual(['typescript']);
    expect(graph.nodes['src/a.ts']).toBeDefined();
    expect(graph.nodes['src/a.ts'].importedBy).toEqual([]);
  });

  it('tracks a simple a → b edge', () => {
    const files = [
      file('src/a.ts', `import { thing } from './b.js';\nexport const x = thing;`),
      file('src/b.ts', `export const thing = 1;`),
    ];
    const graph = buildGraph(files);

    expect(graph.stats.totalFiles).toBe(2);
    expect(graph.stats.totalInternalEdges).toBe(1);
    expect(graph.nodes['src/a.ts'].imports.internal).toEqual([
      expect.objectContaining({ path: 'src/b.ts', symbols: ['thing'] }),
    ]);
    expect(graph.nodes['src/b.ts'].importedBy).toEqual(['src/a.ts']);
  });

  it('identifies orphans (no incoming edges)', () => {
    const files = [
      file('src/a.ts', `import './b.js';`),
      file('src/b.ts', `export {};`),
      file('src/c.ts', `export const lonely = true;`),
    ];
    const graph = buildGraph(files);

    expect(graph.stats.orphans).toContain('src/a.ts');
    expect(graph.stats.orphans).toContain('src/c.ts');
    expect(graph.stats.orphans).not.toContain('src/b.ts');
  });

  it('records external packages and their importers', () => {
    const files = [
      file('src/a.ts', `import { Command } from 'commander';`),
      file('src/b.ts', `import chalk from 'chalk';\nimport { Command } from 'commander';`),
    ];
    const graph = buildGraph(files);

    expect(graph.externalPackages.commander).toEqual(['src/a.ts', 'src/b.ts']);
    expect(graph.externalPackages.chalk).toEqual(['src/b.ts']);
    expect(graph.stats.totalExternalPackages).toBe(2);
  });

  it('handles .js → .ts resolution in the file set', () => {
    // Realistic case: file in src/commands importing from src/core via `../core/...`
    const files = [
      file('src/commands/a.ts', `import { x } from '../core/config.js';`),
      file('src/core/config.ts', `export const x = 1;`),
    ];
    const graph = buildGraph(files);
    expect(graph.nodes['src/commands/a.ts'].imports.internal).toEqual([
      expect.objectContaining({ path: 'src/core/config.ts' }),
    ]);
  });

  it('does not create self-references', () => {
    const files = [file('src/a.ts', `import './a.js';`)];
    const graph = buildGraph(files);
    expect(graph.nodes['src/a.ts'].imports.internal).toEqual([]);
    expect(graph.nodes['src/a.ts'].importedBy).toEqual([]);
  });

  it('ranks most-imported files correctly', () => {
    const files = [
      file('src/types.ts', `export type X = number;`),
      file('src/a.ts', `import { X } from './types.js';`),
      file('src/b.ts', `import { X } from './types.js';`),
      file('src/c.ts', `import { X } from './types.js';`),
    ];
    const graph = buildGraph(files);
    expect(graph.stats.mostImported[0]).toEqual({ path: 'src/types.ts', importers: 3 });
  });

  it('ranks most-importing files correctly', () => {
    const files = [
      file('src/a.ts', `import './b.js';\nimport './c.js';\nimport 'external';`),
      file('src/b.ts', `export {};`),
      file('src/c.ts', `export {};`),
    ];
    const graph = buildGraph(files);
    const top = graph.stats.mostImporting.find((e) => e.path === 'src/a.ts');
    expect(top?.imports).toBe(3); // 2 internal + 1 external
  });

  it('produces deterministic (alphabetically sorted) output', () => {
    const files = [
      file('src/z.ts', `import './a.js';`),
      file('src/a.ts', `export {};`),
      file('src/m.ts', `export {};`),
    ];
    const graph = buildGraph(files);
    expect(Object.keys(graph.nodes)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('skips files with no parser (unknown extension)', () => {
    const files = [
      file('README.txt', `Hello world`),
      file('src/a.ts', `export const x = 1;`),
    ];
    const graph = buildGraph(files);
    expect(Object.keys(graph.nodes)).toEqual(['src/a.ts']);
  });

  it('counts LOC (non-blank lines)', () => {
    const content = `// hello\n\n\nexport const x = 1;\n`;
    const graph = buildGraph([file('src/a.ts', content)]);
    expect(graph.nodes['src/a.ts'].loc).toBe(2);
  });
});
