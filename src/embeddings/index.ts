import fs from 'fs/promises';
import path from 'path';
import type {
  ContextModule,
  DependencyGraph,
  EmbeddingChunk,
  EmbeddingsMetadata,
  LumikoConfig,
  ScannedFile,
} from '../types/index.js';
import { getParser } from '../graph/parsers/index.js';
import { sliceFile, estimateTokens, DEFAULT_OPTIONS, type ChunkerOptions } from './chunker.js';
import { buildContextChunk, enrichCodeChunk, type EnrichmentSources } from './metadata.js';

export const EMBEDDINGS_SCHEMA_VERSION = 1;

/**
 * Build RAG-ready chunks from scanned files, enriched with graph + module data.
 * Returns both the chunks (one per line in chunks.jsonl) and summary metadata.
 */
export function buildEmbeddings(
  files: ScannedFile[],
  projectName: string,
  sources: EnrichmentSources,
  options: Partial<ChunkerOptions> = {},
): { chunks: EmbeddingChunk[]; metadata: EmbeddingsMetadata } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: EmbeddingChunk[] = [];

  let codeCount = 0;
  let contextCount = 0;
  let totalTokens = 0;
  const fileCount = files.filter((f) => getParser(f.extension) !== null).length;

  // ── Code chunks ────────────────────────────────────────────────────────
  for (const file of files) {
    const parser = getParser(file.extension);
    if (!parser) continue; // Skip files we can't classify

    const slices = sliceFile(file, opts);

    for (let i = 0; i < slices.length; i++) {
      const chunk = enrichCodeChunk(file, slices[i], i, slices.length, sources);
      chunks.push(chunk);
      codeCount++;
      totalTokens += chunk.tokens;
    }
  }

  // ── Context bundle chunks ──────────────────────────────────────────────
  // These are the descriptive docs about the codebase. Agents retrieving
  // chunks for "what does this project do?" should get overview/architecture.
  const contextChunks = buildContextBundleChunks(sources);
  for (const chunk of contextChunks) {
    chunks.push(chunk);
    contextCount++;
    totalTokens += chunk.tokens;
  }

  const metadata: EmbeddingsMetadata = {
    schemaVersion: EMBEDDINGS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    projectName,
    totals: {
      chunks: chunks.length,
      codeChunks: codeCount,
      contextChunks: contextCount,
      estimatedTokens: totalTokens,
      files: fileCount,
    },
    config: {
      maxTokensPerChunk: opts.maxTokens,
      overlapTokens: opts.overlapTokens,
    },
  };

  return { chunks, metadata };
}

/**
 * Write chunks.jsonl + metadata.json to the embeddings output directory.
 * Creates the directory if it doesn't exist.
 */
export async function writeEmbeddings(
  chunks: EmbeddingChunk[],
  metadata: EmbeddingsMetadata,
  projectPath: string,
  config: LumikoConfig,
): Promise<{ chunksPath: string; metadataPath: string }> {
  const outDir = path.join(projectPath, config.output.contextDirectory, 'embeddings');
  await fs.mkdir(outDir, { recursive: true });

  const chunksPath = path.join(outDir, 'chunks.jsonl');
  const metadataPath = path.join(outDir, 'metadata.json');

  // JSONL: one JSON object per line, no trailing comma, no outer array
  const jsonl = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  await fs.writeFile(chunksPath, jsonl);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');

  return { chunksPath, metadataPath };
}

// ── Internal: chunk the .context/ bundle itself ─────────────────────────

function buildContextBundleChunks(sources: EnrichmentSources): EmbeddingChunk[] {
  const out: EmbeddingChunk[] = [];

  // Each module JSON becomes a chunk so "what's in src/core?" retrieves well.
  for (const [key, mod] of sources.modules) {
    const content = JSON.stringify(mod, null, 2);
    out.push(
      buildContextChunk({
        contextRelPath: `modules/${key}.json`,
        content,
        tokens: estimateTokens(content),
        lines: content.split('\n').length,
        purpose: mod.purpose,
        language: 'json',
      }),
    );
  }

  // The graph summary is small enough to fit in one chunk — useful for
  // retrieval queries about dependencies and hotspots.
  if (sources.graph) {
    const graphSummary = summarizeGraph(sources.graph);
    out.push(
      buildContextChunk({
        contextRelPath: 'graph.summary.json',
        content: graphSummary,
        tokens: estimateTokens(graphSummary),
        lines: graphSummary.split('\n').length,
        purpose: 'Dependency graph summary: hotspots, orphans, and external packages.',
        language: 'json',
      }),
    );
  }

  return out;
}

/**
 * Produce a compact JSON summary of the graph — just the stats + package
 * list, not the full per-file node data (that's too big and would flood
 * retrieval results). The full graph.json is still available for targeted
 * reads.
 */
function summarizeGraph(graph: DependencyGraph): string {
  return JSON.stringify(
    {
      schemaVersion: graph.schemaVersion,
      languages: graph.languages,
      stats: graph.stats,
      externalPackages: graph.externalPackages,
    },
    null,
    2,
  );
}

/** Re-export for callers that want to load modules themselves. */
export type { EnrichmentSources };
export type { ContextModule };
