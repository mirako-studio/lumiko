import type { ScannedFile } from '../types/index.js';

/**
 * One slice of a file — content + 1-indexed line range. No enrichment yet;
 * that happens in metadata.ts after all slices are produced.
 */
export interface FileSlice {
  content: string;
  startLine: number;
  endLine: number;
  /** Estimated tokens. ~4 chars/token. */
  tokens: number;
}

export interface ChunkerOptions {
  /** Target tokens per chunk (default 600). */
  targetTokens: number;
  /** Hard cap — if a file fits under this, it becomes one chunk (default 1200). */
  maxTokens: number;
  /** Overlap between adjacent chunks in tokens (default 100). */
  overlapTokens: number;
}

export const DEFAULT_OPTIONS: ChunkerOptions = {
  targetTokens: 600,
  maxTokens: 1200,
  overlapTokens: 100,
};

/**
 * Split a file into slices. Tries to respect structural boundaries:
 *   - empty lines
 *   - top-level function / class / interface declarations (TS/JS/Py)
 *
 * Most files under ~5KB will fit in one slice. Only large files get split.
 */
export function sliceFile(file: ScannedFile, options: Partial<ChunkerOptions> = {}): FileSlice[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const content = file.content;

  const tokens = estimateTokens(content);
  if (tokens <= opts.maxTokens) {
    // Fits in one chunk — easiest path
    return [
      {
        content,
        startLine: 1,
        endLine: Math.max(1, content.split('\n').length),
        tokens,
      },
    ];
  }

  // File too large — split at natural boundaries, targeting `targetTokens`
  // per slice with `overlapTokens` of overlap between adjacent slices.
  return splitAtBoundaries(content, opts);
}

// ── Internals ───────────────────────────────────────────────────────────

/** Rough tokens/char ratio — good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split content line-by-line, grouping lines until we hit the target token
 * count, then finding the nearest structural boundary to break at.
 */
function splitAtBoundaries(content: string, opts: ChunkerOptions): FileSlice[] {
  const lines = content.split('\n');
  const slices: FileSlice[] = [];

  let sliceStart = 0; // 0-indexed start line
  let i = 0;
  let accumulatedChars = 0;

  while (i < lines.length) {
    accumulatedChars += lines[i].length + 1; // +1 for the newline
    const approxTokens = Math.ceil(accumulatedChars / 4);

    if (approxTokens >= opts.targetTokens) {
      // Find the nearest natural boundary at or before line i
      const breakAt = findNearestBoundary(lines, i, sliceStart);
      const endLine = breakAt >= sliceStart ? breakAt : i;

      const sliceContent = lines.slice(sliceStart, endLine + 1).join('\n');
      slices.push({
        content: sliceContent,
        startLine: sliceStart + 1,
        endLine: endLine + 1,
        tokens: estimateTokens(sliceContent),
      });

      // Next slice starts with some overlap
      const overlapLines = estimateOverlapLines(lines, endLine, opts.overlapTokens);
      sliceStart = Math.max(endLine + 1 - overlapLines, endLine + 1);
      // If overlap pushed us back past endLine, advance past it
      if (sliceStart > endLine) sliceStart = endLine + 1;
      // Recount accumulated from the new start
      accumulatedChars = 0;
      for (let j = sliceStart; j <= i; j++) {
        accumulatedChars += lines[j].length + 1;
      }
    }

    i++;
  }

  // Flush the tail
  if (sliceStart < lines.length) {
    const sliceContent = lines.slice(sliceStart).join('\n');
    if (sliceContent.trim().length > 0) {
      slices.push({
        content: sliceContent,
        startLine: sliceStart + 1,
        endLine: lines.length,
        tokens: estimateTokens(sliceContent),
      });
    }
  }

  return slices;
}

/**
 * Find the nearest structural boundary at or before lineIdx, not going
 * before sliceStart. Boundaries are:
 *   - blank lines
 *   - lines starting with top-level declarations (export, function, class,
 *     interface, type, const/let/var at column 0, def, class, async def)
 *
 * Returns the line index to END the current slice on (inclusive).
 */
function findNearestBoundary(lines: string[], lineIdx: number, sliceStart: number): number {
  // Look back up to 30 lines
  const lookback = Math.min(30, lineIdx - sliceStart);

  for (let offset = 0; offset <= lookback; offset++) {
    const candidate = lineIdx - offset;
    if (candidate < sliceStart + 5) break; // Don't make slices too tiny

    const line = lines[candidate];
    // Blank line ends a slice nicely
    if (line.trim() === '') {
      return candidate - 1; // End on the line before the blank
    }
    // A line below a blank, that starts a new top-level declaration, is
    // also a great break point (end slice on the blank line above).
    if (candidate > 0 && lines[candidate - 1].trim() === '' && isTopLevelDecl(line)) {
      return candidate - 1;
    }
  }

  // No good boundary found — just split at the token-budget line
  return lineIdx;
}

function isTopLevelDecl(line: string): boolean {
  return /^(export\s+(default\s+)?(async\s+)?(function|class|interface|type|const|let|var|enum)|function\s|class\s|interface\s|type\s|const\s|let\s|var\s|enum\s|async\s+function|def\s|async\s+def\s)/.test(line);
}

function estimateOverlapLines(lines: string[], endLine: number, overlapTokens: number): number {
  if (overlapTokens <= 0) return 0;
  let chars = 0;
  let count = 0;
  for (let i = endLine; i >= 0 && chars < overlapTokens * 4; i--) {
    chars += lines[i].length + 1;
    count++;
  }
  return count;
}
