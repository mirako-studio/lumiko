import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { buildGraph } from '../graph/index.js';
import * as ui from '../ui/reporter.js';

const LUMIKO_VERSION = '1.0.0';

interface GraphOptions {
  dryRun?: boolean;
}

export async function graph(options: GraphOptions): Promise<void> {
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
    subcommand: 'graph',
  });

  // Scan
  ui.startPhase(`Scanning ${projectLabel}`);
  const { files } = await scanProject(projectPath, config);
  ui.info(`${files.length} files`);
  ui.blank();

  // Analyze
  ui.startPhase('Analyzing imports');
  const depGraph = buildGraph(files);
  ui.info(
    `${depGraph.stats.totalFiles} nodes · ` +
      `${depGraph.stats.totalInternalEdges} edges · ` +
      `${depGraph.stats.totalExternalPackages} external packages`,
  );
  ui.blank();

  // Highlights
  if (depGraph.stats.mostImported.length > 0) {
    ui.startPhase('Hotspots');
    for (const entry of depGraph.stats.mostImported.slice(0, 5)) {
      console.log(`  ${chalk.cyan(String(entry.importers).padStart(3))}  ${chalk.gray(entry.path)}`);
    }
    ui.blank();
  }

  if (depGraph.stats.orphans.length > 0) {
    ui.startPhase(`Orphans (${depGraph.stats.orphans.length})`);
    for (const p of depGraph.stats.orphans.slice(0, 5)) {
      console.log(`  ${chalk.dim('—')}  ${chalk.gray(p)}`);
    }
    if (depGraph.stats.orphans.length > 5) {
      console.log(chalk.dim(`     …and ${depGraph.stats.orphans.length - 5} more`));
    }
    ui.blank();
  }

  // Write
  if (options.dryRun) {
    ui.info(`[dry run] Would write ${config.output.contextDirectory}/graph.json`);
    ui.summary({ extras: [chalk.yellow('dry run')] });
    return;
  }

  const outPath = path.join(projectPath, config.output.contextDirectory, 'graph.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(depGraph, null, 2) + '\n');

  const stat = await fs.stat(outPath);
  const relOut = path.relative(projectPath, outPath).replace(/\\/g, '/');
  ui.startPhase(`Writing ${config.output.contextDirectory}/`);
  ui.outputList([{ path: relOut, size: formatBytes(stat.size), kind: 'created' }]);
  ui.blank();
  ui.summary();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
