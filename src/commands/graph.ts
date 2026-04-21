import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { buildGraph } from '../graph/index.js';

interface GraphOptions {
  dryRun?: boolean;
}

/**
 * `lumiko graph` — build and write just the dependency graph.
 * No Claude calls, no cost, fast enough to run on every commit.
 */
export async function graph(options: GraphOptions): Promise<void> {
  const projectPath = process.cwd();

  console.log(chalk.bold('\nLumiko graph'));
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

  // Build the graph
  spinner.start('Analyzing imports...');
  const depGraph = buildGraph(files);
  spinner.succeed(
    `Graph built: ${chalk.bold(depGraph.stats.totalFiles)} nodes, ` +
      `${chalk.bold(depGraph.stats.totalInternalEdges)} internal edges, ` +
      `${chalk.bold(depGraph.stats.totalExternalPackages)} external packages`,
  );

  // Highlights
  if (depGraph.stats.mostImported.length > 0) {
    console.log(chalk.bold('\nHotspots (most imported):'));
    for (const entry of depGraph.stats.mostImported.slice(0, 5)) {
      console.log(`  ${chalk.cyan(String(entry.importers).padStart(3))}  ${entry.path}`);
    }
  }

  if (depGraph.stats.orphans.length > 0) {
    console.log(chalk.bold(`\nOrphans (${depGraph.stats.orphans.length} files with no importers):`));
    for (const p of depGraph.stats.orphans.slice(0, 5)) {
      console.log(`  ${chalk.dim('—')}  ${p}`);
    }
    if (depGraph.stats.orphans.length > 5) {
      console.log(chalk.dim(`  …and ${depGraph.stats.orphans.length - 5} more`));
    }
  }

  // Write
  const outPath = path.join(projectPath, config.output.contextDirectory, 'graph.json');

  if (options.dryRun) {
    console.log(chalk.yellow(`\n[Dry run] Would write ${outPath}`));
    console.log('');
    return;
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(depGraph, null, 2) + '\n');

  const relOut = path.relative(projectPath, outPath).replace(/\\/g, '/');
  console.log(chalk.green(`\n\u2713 ${relOut}`));
  console.log('');
}
