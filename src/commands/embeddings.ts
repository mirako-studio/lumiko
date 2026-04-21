import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { buildGraph } from '../graph/index.js';
import { buildEmbeddings, writeEmbeddings } from '../embeddings/index.js';
import type { ContextModule, DependencyGraph } from '../types/index.js';

interface EmbeddingsOptions {
  dryRun?: boolean;
}

/**
 * `lumiko embeddings` — build .context/embeddings/chunks.jsonl from the
 * project source files, enriched with the dep graph and .context/modules/
 * data (if available).
 *
 * Cheap to run — pure static analysis, no Claude. Useful for CI after any
 * code change to keep the RAG index warm.
 */
export async function embeddings(options: EmbeddingsOptions): Promise<void> {
  const projectPath = process.cwd();

  console.log(chalk.bold('\nLumiko embeddings'));
  console.log(chalk.dim('\u2500'.repeat(40)));

  const spinner = ora();

  // Load config
  let config;
  try {
    spinner.start('Loading configuration...');
    config = await loadConfig(projectPath);
    spinner.succeed('Configuration loaded');
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }

  // Scan files
  spinner.start('Scanning project...');
  const { files } = await scanProject(projectPath, config);
  spinner.succeed(`Scanned ${chalk.bold(files.length)} files`);

  // Build a fresh dep graph — cheap and guarantees the enrichment matches
  // the current state of the code (even if .context/graph.json is stale).
  spinner.start('Building dependency graph...');
  const graph: DependencyGraph = buildGraph(files);
  spinner.succeed(
    `Graph built: ${graph.stats.totalFiles} nodes, ${graph.stats.totalInternalEdges} edges`,
  );

  // Try to load .context/modules/ for richer metadata. It's optional —
  // embeddings still work without it, just with fewer purpose/symbol hints.
  spinner.start('Loading module metadata...');
  const modules = await loadModuleMetadata(projectPath, config.output.contextDirectory);
  if (modules.size > 0) {
    spinner.succeed(`Loaded ${modules.size} module metadata files`);
  } else {
    spinner.warn('No module metadata found — run `lumiko generate` for richer chunks');
  }

  // Build the chunks
  spinner.start('Building embedding chunks...');
  const { chunks, metadata } = buildEmbeddings(files, config.project.name, {
    graph,
    modules,
  });
  spinner.succeed(
    `Built ${chalk.bold(metadata.totals.chunks)} chunks ` +
      `(${metadata.totals.codeChunks} code + ${metadata.totals.contextChunks} context, ` +
      `~${metadata.totals.estimatedTokens.toLocaleString()} tokens)`,
  );

  // Dry-run: stop here
  if (options.dryRun) {
    const outDir = path.join(config.output.contextDirectory, 'embeddings');
    console.log(chalk.yellow(`\n[Dry run] Would write:`));
    console.log(`  - ${outDir}/chunks.jsonl`);
    console.log(`  - ${outDir}/metadata.json`);
    console.log('');
    return;
  }

  // Write files
  const { chunksPath, metadataPath } = await writeEmbeddings(chunks, metadata, projectPath, config);

  const relChunks = path.relative(projectPath, chunksPath).replace(/\\/g, '/');
  const relMeta = path.relative(projectPath, metadataPath).replace(/\\/g, '/');
  const chunksStat = await fs.stat(chunksPath);

  console.log(chalk.green(`\n\u2713 ${relChunks} (${formatBytes(chunksStat.size)})`));
  console.log(chalk.green(`\u2713 ${relMeta}`));
  console.log('');
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function loadModuleMetadata(
  projectPath: string,
  contextDir: string,
): Promise<Map<string, ContextModule>> {
  const out = new Map<string, ContextModule>();
  const modulesDir = path.join(projectPath, contextDir, 'modules');

  try {
    const entries = await fs.readdir(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const key = entry.name.replace(/\.json$/, '');
      try {
        const raw = await fs.readFile(path.join(modulesDir, entry.name), 'utf-8');
        out.set(key, JSON.parse(raw) as ContextModule);
      } catch {
        // Skip unreadable module files
      }
    }
  } catch {
    // No modules dir — that's fine
  }

  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
