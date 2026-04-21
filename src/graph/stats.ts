import type { GraphNode, GraphStats } from '../types/index.js';

const TOP_N = 10;

/**
 * Compute aggregate statistics from a graph's nodes and external packages.
 */
export function computeStats(
  nodes: Record<string, GraphNode>,
  externalPackages: Record<string, string[]>,
): GraphStats {
  const paths = Object.keys(nodes);

  let totalInternalEdges = 0;
  const orphans: string[] = [];
  const incoming: Array<{ path: string; importers: number }> = [];
  const outgoing: Array<{ path: string; imports: number }> = [];

  for (const p of paths) {
    const node = nodes[p];
    totalInternalEdges += node.imports.internal.length;

    if (node.importedBy.length === 0) {
      orphans.push(p);
    }

    incoming.push({ path: p, importers: node.importedBy.length });
    outgoing.push({ path: p, imports: node.imports.internal.length + node.imports.external.length });
  }

  incoming.sort((a, b) => b.importers - a.importers || a.path.localeCompare(b.path));
  outgoing.sort((a, b) => b.imports - a.imports || a.path.localeCompare(b.path));

  return {
    totalFiles: paths.length,
    totalInternalEdges,
    totalExternalPackages: Object.keys(externalPackages).length,
    orphans: orphans.sort(),
    mostImported: incoming.filter((e) => e.importers > 0).slice(0, TOP_N),
    mostImporting: outgoing.filter((e) => e.imports > 0).slice(0, TOP_N),
  };
}
