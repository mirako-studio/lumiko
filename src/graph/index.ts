import type {
  DependencyGraph,
  GraphExternalImport,
  GraphInternalImport,
  GraphNode,
  ScannedFile,
} from '../types/index.js';
import { getLanguage, getParser } from './parsers/index.js';
import { extractPackageName, normalize, resolveImport } from './resolver.js';
import { computeStats } from './stats.js';

export const GRAPH_SCHEMA_VERSION = 1;

/**
 * Build a dependency graph from scanned files. Pure code analysis — no Claude,
 * no network. Deterministic output given the same input.
 */
export function buildGraph(files: ScannedFile[]): DependencyGraph {
  // Normalize paths so imports resolve the same way across platforms.
  const normalized = files.map((f) => ({ ...f, path: normalize(f.path) }));
  const fileSet = new Set(normalized.map((f) => f.path));

  const nodes: Record<string, GraphNode> = {};
  const externalPackages: Record<string, Set<string>> = {};
  const languages = new Set<string>();

  // First pass: parse each file's imports and classify them internal vs external
  for (const file of normalized) {
    const parser = getParser(file.extension);
    if (!parser) continue; // Skip files we don't have a parser for

    languages.add(parser.language);

    const raw = parser.parse(file.content);
    const internal: GraphInternalImport[] = [];
    const external: GraphExternalImport[] = [];

    for (const imp of raw) {
      const resolved = resolveImport(imp.source, file.path, fileSet);

      if (resolved) {
        // Internal — don't self-reference
        if (resolved === file.path) continue;
        internal.push({
          path: resolved,
          symbols: imp.symbols,
          style: imp.style,
        });
      } else {
        const pkg = extractPackageName(imp.source);
        // Skip Python builtins and local relative markers we couldn't resolve
        if (/^\.+$/.test(pkg) || pkg === '') continue;

        external.push({
          package: pkg,
          symbols: imp.symbols,
          style: imp.style,
        });

        if (!externalPackages[pkg]) externalPackages[pkg] = new Set();
        externalPackages[pkg].add(file.path);
      }
    }

    nodes[file.path] = {
      language: parser.language,
      loc: countLoc(file.content),
      imports: {
        internal: dedupeInternal(internal),
        external: dedupeExternal(external),
      },
      importedBy: [], // filled in the second pass
    };
  }

  // Second pass: build the reverse index (importedBy)
  for (const [path, node] of Object.entries(nodes)) {
    for (const imp of node.imports.internal) {
      const target = nodes[imp.path];
      if (target && !target.importedBy.includes(path)) {
        target.importedBy.push(path);
      }
    }
  }

  // Sort importedBy alphabetically for deterministic output
  for (const node of Object.values(nodes)) {
    node.importedBy.sort();
  }

  // Convert externalPackages sets to sorted arrays
  const externalPackagesOut: Record<string, string[]> = {};
  for (const [pkg, fileSet2] of Object.entries(externalPackages)) {
    externalPackagesOut[pkg] = Array.from(fileSet2).sort();
  }

  // Compute stats once everything's wired up
  const stats = computeStats(nodes, externalPackagesOut);

  // Sort nodes object keys alphabetically for stable diffs
  const sortedNodes: Record<string, GraphNode> = {};
  for (const k of Object.keys(nodes).sort()) {
    sortedNodes[k] = nodes[k];
  }

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: GRAPH_SCHEMA_VERSION,
    languages: Array.from(languages).sort(),
    stats,
    nodes: sortedNodes,
    externalPackages: sortAlpha(externalPackagesOut),
  };
}

/** Re-export for callers that want to identify parser coverage. */
export { getLanguage };

// ── Internal helpers ────────────────────────────────────────────────────

function countLoc(content: string): number {
  if (!content) return 0;
  // Count non-blank lines — useful as a rough size signal without penalizing
  // files that end with trailing newlines.
  let count = 0;
  for (const line of content.split('\n')) {
    if (line.trim().length > 0) count++;
  }
  return count;
}

function dedupeInternal(imports: GraphInternalImport[]): GraphInternalImport[] {
  const byPath = new Map<string, GraphInternalImport>();
  for (const imp of imports) {
    const existing = byPath.get(imp.path);
    if (!existing) {
      byPath.set(imp.path, { ...imp, symbols: [...imp.symbols] });
      continue;
    }
    // Merge symbols
    const merged = new Set([...existing.symbols, ...imp.symbols]);
    existing.symbols = Array.from(merged).sort();
    // Prefer the more specific style
    if (existing.style === 'unknown') existing.style = imp.style;
  }
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function dedupeExternal(imports: GraphExternalImport[]): GraphExternalImport[] {
  const byPkg = new Map<string, GraphExternalImport>();
  for (const imp of imports) {
    const existing = byPkg.get(imp.package);
    if (!existing) {
      byPkg.set(imp.package, { ...imp, symbols: [...imp.symbols] });
      continue;
    }
    const merged = new Set([...existing.symbols, ...imp.symbols]);
    existing.symbols = Array.from(merged).sort();
    if (existing.style === 'unknown') existing.style = imp.style;
  }
  return Array.from(byPkg.values()).sort((a, b) => a.package.localeCompare(b.package));
}

function sortAlpha<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = obj[k];
  }
  return out;
}
