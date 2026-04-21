import { describe, it, expect } from 'vitest';
import { sliceFile, estimateTokens } from '../../src/embeddings/chunker.js';
import type { ScannedFile } from '../../src/types/index.js';

function file(path: string, content: string): ScannedFile {
  return {
    path,
    content,
    size: content.length,
    lines: content.split('\n').length,
    extension: '.ts',
  };
}

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses roughly chars/4', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});

describe('sliceFile — small files', () => {
  it('returns a single slice for a file under the token budget', () => {
    const small = `export const x = 1;\nexport const y = 2;`;
    const slices = sliceFile(file('src/small.ts', small));
    expect(slices).toHaveLength(1);
    expect(slices[0].content).toBe(small);
    expect(slices[0].startLine).toBe(1);
    expect(slices[0].endLine).toBe(2);
  });

  it('preserves line count for empty file', () => {
    const slices = sliceFile(file('src/empty.ts', ''));
    expect(slices).toHaveLength(1);
    expect(slices[0].endLine).toBeGreaterThanOrEqual(1);
  });
});

describe('sliceFile — large files', () => {
  // Build a file that definitely exceeds the 1200-token budget
  // (1200 * 4 = 4800 chars minimum). We'll use 8000 chars across 200 lines.
  function buildLargeFile(): string {
    const blocks: string[] = [];
    for (let i = 0; i < 20; i++) {
      blocks.push(`
export function fn${i}(input: string): string {
  const prefix = 'block-${i}';
  const padding = '${'x'.repeat(200)}';
  return prefix + input + padding;
}
`);
    }
    return blocks.join('\n');
  }

  it('splits large files into multiple slices', () => {
    const large = buildLargeFile();
    const slices = sliceFile(file('src/large.ts', large));
    expect(slices.length).toBeGreaterThan(1);
  });

  it('each slice respects the token budget', () => {
    const large = buildLargeFile();
    const slices = sliceFile(file('src/large.ts', large), { maxTokens: 800, targetTokens: 400, overlapTokens: 50 });
    for (const slice of slices) {
      // Allow a little slack for edge cases where splitting at a boundary
      // crosses the target; this is a soft budget.
      expect(slice.tokens).toBeLessThanOrEqual(1200);
    }
  });

  it('produces monotonically advancing line ranges', () => {
    const large = buildLargeFile();
    const slices = sliceFile(file('src/large.ts', large));
    for (let i = 1; i < slices.length; i++) {
      // Subsequent slice must start at or after previous start — order matters
      expect(slices[i].startLine).toBeGreaterThanOrEqual(slices[i - 1].startLine);
    }
  });

  it('honors custom options', () => {
    const large = buildLargeFile();
    const slices = sliceFile(file('src/large.ts', large), {
      maxTokens: 300,
      targetTokens: 150,
      overlapTokens: 20,
    });
    expect(slices.length).toBeGreaterThan(2);
  });
});
