import type {
  ContextModule,
  DependencyGraph,
  EmbeddingChunk,
  GraphNode,
  ScannedFile,
} from '../types/index.js';
import { getLanguage } from '../graph/parsers/index.js';
import { getModuleKey, getModuleDisplayPath } from '../core/prompts.js';
import type { FileSlice } from './chunker.js';

/**
 * Data available to enrich a chunk. Every field is optional — the enricher
 * just fills in whatever it can find and leaves the rest off.
 */
export interface EnrichmentSources {
  graph: DependencyGraph | null;
  /** Module key → ContextModule, loaded from .context/modules/<key>.json */
  modules: Map<string, ContextModule>;
}

/**
 * Enrich a file slice into a full EmbeddingChunk. Pulls:
 *   - language / LOC   from the graph
 *   - imports / importedBy from the graph
 *   - purpose / exports / keyFunctions from .context/modules/
 *
 * Falls back to sensible defaults when enrichment data isn't available.
 */
export function enrichCodeChunk(
  file: ScannedFile,
  slice: FileSlice,
  chunkIndex: number,
  totalChunksForFile: number,
  sources: EnrichmentSources,
): EmbeddingChunk {
  const normalizedPath = file.path.replace(/\\/g, '/');
  const language = getLanguage(file.extension) ?? 'text';
  const moduleKey = getModuleKey(normalizedPath);
  const moduleDisplay = getModuleDisplayPath(moduleKey).replace(/\/$/, '');

  const id = totalChunksForFile === 1 ? normalizedPath : `${normalizedPath}#${chunkIndex}`;

  // Pull graph data
  const node: GraphNode | undefined = sources.graph?.nodes[normalizedPath];
  const imports = node?.imports.internal.map((i) => i.path);
  const importedBy = node?.importedBy;

  // Pull module data: find the file entry in the module JSON
  const moduleData = sources.modules.get(moduleKey);
  const fileEntry = moduleData?.files.find((f) => f.path === normalizedPath);

  const purpose = fileEntry?.purpose ?? moduleData?.purpose;
  const symbols = collectSymbols(fileEntry, slice);

  return {
    id,
    path: normalizedPath,
    module: moduleDisplay === '(root)' ? '' : moduleDisplay,
    language,
    type: 'code',
    content: buildChunkContent(normalizedPath, language, purpose, slice.content),
    tokens: slice.tokens,
    startLine: slice.startLine,
    endLine: slice.endLine,
    ...(purpose ? { purpose } : {}),
    ...(symbols.length > 0 ? { symbols } : {}),
    ...(imports && imports.length > 0 ? { imports } : {}),
    ...(importedBy && importedBy.length > 0 ? { importedBy } : {}),
  };
}

/**
 * Build a chunk of a .context/ bundle file (overview, architecture, modules,
 * conventions, etc.). Context chunks aren't enriched from the graph — they
 * ARE the descriptive metadata.
 */
export function buildContextChunk(params: {
  contextRelPath: string; // e.g. "overview.json", "modules/src-core.json"
  content: string;
  tokens: number;
  lines: number;
  purpose?: string;
  language: string; // "json" | "markdown"
}): EmbeddingChunk {
  return {
    id: `.context/${params.contextRelPath}`,
    path: `.context/${params.contextRelPath}`,
    module: '',
    language: params.language,
    type: 'context',
    content: params.content,
    tokens: params.tokens,
    startLine: 1,
    endLine: params.lines,
    ...(params.purpose ? { purpose: params.purpose } : {}),
  };
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Build the actual text that gets embedded. We prefix with structural hints
 * (path, language, purpose) because they meaningfully improve retrieval
 * quality — an embedding of "foo" next to "path: src/core/chunker.ts" will
 * retrieve better for "where is chunker defined?" than the raw code alone.
 */
function buildChunkContent(
  path: string,
  language: string,
  purpose: string | undefined,
  sliceContent: string,
): string {
  const lines: string[] = [];
  lines.push(`Path: ${path}`);
  lines.push(`Language: ${language}`);
  if (purpose) {
    lines.push(`Purpose: ${purpose}`);
  }
  lines.push('');
  lines.push(sliceContent);
  return lines.join('\n');
}

/**
 * Best-effort symbol extraction. Prefers explicit symbols from the module
 * JSON (keyFunctions, exports); falls back to regex-sniffing the slice.
 */
function collectSymbols(
  fileEntry:
    | {
        exports?: string[];
        keyFunctions?: Array<{ name: string }>;
      }
    | undefined,
  slice: FileSlice,
): string[] {
  const symbols = new Set<string>();

  if (fileEntry?.exports) {
    for (const s of fileEntry.exports) symbols.add(s);
  }
  if (fileEntry?.keyFunctions) {
    for (const fn of fileEntry.keyFunctions) {
      const name = fn.name.split('.').pop();
      if (name) symbols.add(name);
    }
  }

  // Regex fallback: catch top-level declarations actually present in the slice.
  // This handles the case where the module JSON is missing or the slice only
  // contains part of a file.
  const declRe =
    /(?:^|\n)(?:export\s+(?:default\s+)?(?:async\s+)?)?(?:function|class|interface|type|const|let|var|enum|def)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(slice.content)) !== null) {
    symbols.add(m[1]);
  }

  return Array.from(symbols).sort();
}
