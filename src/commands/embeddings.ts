import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { buildGraph } from '../graph/index.js';
import { buildEmbeddings, writeEmbeddings } from '../embeddings/index.js';
import * as ui from '../ui/reporter.js';
import type { ContextModule, DependencyGraph } from '../types/index.js';

const LUMIKO_VERSION = '1.0.0';

interface EmbeddingsOptions {
  dryRun?: boolean;
}

export async function embeddings(options: EmbeddingsOptions): Promise<void> {
  const projectPath = process.cwd();
  const projectLabel = path.basename(projectPath) + '/';

  let config;
  try {
    config = await loadConfig(projectPath);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }

  ui.printHeader({
    version: LUMIKO_VERSION,
    backend: config.claude.backend,
    model: config.claude.model,
    subcommand: 'embeddings',
  });

  // Scan
  ui.startPhase(`Scanning ${projectLabel}`);
  const { files } = await scanProject(projectPath, config);
  ui.info(`${files.length} files`);
  ui.blank();

  // Graph (enrichment input)
  ui.startPhase('Building dependency graph');
  const graph: DependencyGraph = buildGraph(files);
  ui.info(`${graph.stats.totalFiles} nodes · ${graph.stats.totalInternalEdges} edges`);
  ui.blank();

  // Modules (optional enrichment)
  ui.startPhase('Loading module metadata');
  const modules = await loadModuleMetadata(projectPath, config.output.contextDirectory);
  if (modules.size > 0) {
    ui.info(`${modules.size} module metadata files loaded`);
  } else {
    ui.warn('no module metadata — run `lumiko generate` for richer chunks');
  }
  ui.blank();

  // Build chunks
  ui.startPhase('Building RAG chunks');
  const { chunks, metadata } = buildEmbeddings(files, config.project.name, { graph, modules });
  ui.info(
    `${metadata.totals.chunks} chunks · ` +
      `${metadata.totals.codeChunks} code + ${metadata.totals.contextChunks} context · ` +
      `~${metadata.totals.estimatedTokens.toLocaleString()} tokens`,
  );
  ui.blank();

  if (options.dryRun) {
    const cd = config.output.contextDirectory;
    ui.info(`[dry run] Would write:`);
    ui.info(`  ${cd}/embeddings/chunks.jsonl`);
    ui.info(`  ${cd}/embeddings/metadata.json`);
    ui.summary({ extras: [chalk.yellow('dry run')] });
    return;
  }

  // Write
  const { chunksPath, metadataPath } = await writeEmbeddings(chunks, metadata, projectPath, config);
  const chunksStat = await fs.stat(chunksPath);
  const metaStat = await fs.stat(metadataPath);

  ui.startPhase(`Writing ${config.output.contextDirectory}/embeddings/`);
  ui.outputList([
    { path: path.relative(projectPath, chunksPath).replace(/\\/g, '/'), size: formatBytes(chunksStat.size), kind: 'created' },
    { path: path.relative(projectPath, metadataPath).replace(/\\/g, '/'), size: formatBytes(metaStat.size), kind: 'created' },
  ]);
  ui.blank();
  ui.summary();
}

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
