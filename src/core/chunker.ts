import type { ScannedFile } from '../types/index.js';

export interface Chunk {
  /** Zero-based chunk index */
  index: number;
  /** Human label, e.g. "src/core" */
  label: string;
  files: ScannedFile[];
  /** Estimated token count for this chunk's content */
  estimatedTokens: number;
}

export interface ChunkPlan {
  /** Whether chunking is needed at all */
  needsChunking: boolean;
  /** Total estimated tokens across all files */
  totalTokens: number;
  chunks: Chunk[];
}

/**
 * Rough token estimate: ~4 chars per token, plus overhead per file
 * for the formatting (path header, code fences, etc.).
 */
export function estimateFileTokens(file: ScannedFile): number {
  const contentTokens = Math.ceil(file.content.length / 4);
  const overhead = 50; // path header, code fences, spacing
  return contentTokens + overhead;
}

export function estimateTotalTokens(files: ScannedFile[]): number {
  return files.reduce((sum, f) => sum + estimateFileTokens(f), 0);
}

/**
 * Build a chunking plan for the given files.
 *
 * Strategy:
 * 1. Group files by their top-level directory for coherence.
 * 2. If a directory group fits within the budget, keep it as one chunk.
 * 3. If a group exceeds the budget, split it into sub-chunks by size.
 * 4. Merge very small groups together to avoid many tiny Claude calls.
 *
 * @param files          All scanned files
 * @param maxTokensPerChunk  Target ceiling per chunk (default 80_000)
 * @param chunkingThreshold  Don't chunk if total tokens are under this (default 100_000)
 */
export function buildChunkPlan(
  files: ScannedFile[],
  maxTokensPerChunk = 80_000,
  chunkingThreshold = 100_000,
): ChunkPlan {
  const totalTokens = estimateTotalTokens(files);

  if (totalTokens <= chunkingThreshold) {
    return {
      needsChunking: false,
      totalTokens,
      chunks: [
        {
          index: 0,
          label: 'all',
          files,
          estimatedTokens: totalTokens,
        },
      ],
    };
  }

  // Group files by top-level directory
  const groups = groupByDirectory(files);

  // Build chunks from groups
  const rawChunks: Chunk[] = [];

  for (const [dir, groupFiles] of groups) {
    const groupTokens = estimateTotalTokens(groupFiles);

    if (groupTokens <= maxTokensPerChunk) {
      // Whole directory group fits in one chunk
      rawChunks.push({
        index: 0, // re-indexed below
        label: dir,
        files: groupFiles,
        estimatedTokens: groupTokens,
      });
    } else {
      // Split large directory group into sub-chunks
      const subChunks = splitByTokenBudget(groupFiles, maxTokensPerChunk, dir);
      rawChunks.push(...subChunks);
    }
  }

  // Merge very small chunks (< 20% of budget) with adjacent ones
  const merged = mergeSmallChunks(rawChunks, maxTokensPerChunk);

  // Re-index
  merged.forEach((chunk, i) => {
    chunk.index = i;
  });

  return {
    needsChunking: true,
    totalTokens,
    chunks: merged,
  };
}

/**
 * Group files by their first path segment (top-level directory).
 * Root-level files go under "(root)".
 */
function groupByDirectory(files: ScannedFile[]): Map<string, ScannedFile[]> {
  const groups = new Map<string, ScannedFile[]>();

  for (const file of files) {
    const sep = file.path.includes('/') ? '/' : '\\';
    const parts = file.path.split(sep);
    const dir = parts.length > 1 ? parts[0] : '(root)';

    if (!groups.has(dir)) {
      groups.set(dir, []);
    }
    groups.get(dir)!.push(file);
  }

  return groups;
}

/**
 * Split a list of files into chunks that each stay under the token budget.
 */
function splitByTokenBudget(
  files: ScannedFile[],
  maxTokens: number,
  labelPrefix: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  let currentFiles: ScannedFile[] = [];
  let currentTokens = 0;
  let subIndex = 1;

  for (const file of files) {
    const fileTokens = estimateFileTokens(file);

    // If a single file exceeds the budget, put it alone in a chunk
    if (fileTokens > maxTokens) {
      if (currentFiles.length > 0) {
        chunks.push({
          index: 0,
          label: `${labelPrefix} (part ${subIndex})`,
          files: currentFiles,
          estimatedTokens: currentTokens,
        });
        subIndex++;
        currentFiles = [];
        currentTokens = 0;
      }

      chunks.push({
        index: 0,
        label: `${labelPrefix}/${file.path}`,
        files: [file],
        estimatedTokens: fileTokens,
      });
      subIndex++;
      continue;
    }

    if (currentTokens + fileTokens > maxTokens && currentFiles.length > 0) {
      chunks.push({
        index: 0,
        label: `${labelPrefix} (part ${subIndex})`,
        files: currentFiles,
        estimatedTokens: currentTokens,
      });
      subIndex++;
      currentFiles = [];
      currentTokens = 0;
    }

    currentFiles.push(file);
    currentTokens += fileTokens;
  }

  // Flush remaining
  if (currentFiles.length > 0) {
    const label = chunks.length === 0
      ? labelPrefix
      : `${labelPrefix} (part ${subIndex})`;
    chunks.push({
      index: 0,
      label,
      files: currentFiles,
      estimatedTokens: currentTokens,
    });
  }

  return chunks;
}

/**
 * Merge chunks that are very small (< 20% of budget) with their neighbors.
 */
function mergeSmallChunks(chunks: Chunk[], maxTokens: number): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const minSize = maxTokens * 0.2;
  const result: Chunk[] = [];

  for (const chunk of chunks) {
    const prev = result[result.length - 1];

    if (
      prev &&
      (prev.estimatedTokens < minSize || chunk.estimatedTokens < minSize) &&
      prev.estimatedTokens + chunk.estimatedTokens <= maxTokens
    ) {
      // Merge into previous
      prev.files.push(...chunk.files);
      prev.estimatedTokens += chunk.estimatedTokens;
      prev.label = `${prev.label} + ${chunk.label}`;
    } else {
      result.push({ ...chunk });
    }
  }

  return result;
}
