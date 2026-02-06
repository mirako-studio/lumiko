import ora from 'ora';
import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { createClient } from '../core/claude.js';
import { writeOutput, getOutputStats } from '../core/output.js';
import type { ScannedFile } from '../types/index.js';
import type { Backend, GeneratedDocs } from '../types/index.js';

interface GenerateOptions {
  yes?: boolean;
  dryRun?: boolean;
  backend?: string;
  verbose?: boolean;
}

export async function generate(options: GenerateOptions): Promise<void> {
  const projectPath = process.cwd();

  console.log(chalk.bold('\nLumiko v1.0.0'));
  console.log(chalk.dim('\u2500'.repeat(40)));

  // Load config
  const spinner = ora();
  spinner.start('Loading configuration...');
  let config;

  try {
    config = await loadConfig(projectPath);
    spinner.succeed('Configuration loaded');
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }

  // Resolve backend: CLI flag > config > default
  const backend: Backend = (options.backend as Backend) ?? config.claude.backend;

  // Scan project
  spinner.start('Scanning project...');
  const { files, totalLines } = await scanProject(projectPath, config);
  spinner.succeed(
    `Found ${chalk.bold(files.length)} files (${totalLines.toLocaleString()} lines)`,
  );

  if (files.length === 0) {
    console.log(chalk.yellow('\nNo files found matching your include patterns.'));
    console.log('Check your .lumiko/config.yaml configuration.');
    process.exit(1);
  }

  // Show info
  const estimatedTokens = estimateTokens(files);
  if (backend === 'api') {
    const estimatedCost = estimateCost(estimatedTokens);
    console.log(
      chalk.dim(
        `\nEstimated: ~${estimatedTokens.toLocaleString()} tokens ($${estimatedCost.toFixed(2)})`,
      ),
    );
  } else {
    console.log(
      chalk.dim(`\nBackend: ${chalk.cyan('Claude Code')} (uses your subscription)`),
    );
    console.log(
      chalk.dim(`Estimated: ~${estimatedTokens.toLocaleString()} tokens`),
    );
  }

  // Dry run
  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] Would generate:'));
    if (config.docs.readme) console.log(`  - ${config.output.directory}/README.md`);
    if (config.docs.architecture) console.log(`  - ${config.output.directory}/architecture.md`);
    if (config.docs.api) console.log(`  - ${config.output.directory}/api.md`);
    if (config.output.formats.includes('context')) console.log(`  - ${config.output.directory}/context.json`);
    console.log('');
    process.exit(0);
  }

  // Create the client
  let client;
  try {
    client = await createClient(config, {
      backendOverride: backend,
      verbose: options.verbose,
    });
  } catch (error) {
    console.log(chalk.red(`\n${(error as Error).message}`));
    process.exit(1);
  }

  // Confirm
  if (!options.yes) {
    const { proceed } = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'Proceed with generation?',
      initial: true,
    });

    if (!proceed) {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  console.log('');

  // Step 1: Generate markdown docs
  const wantsDocs = config.docs.readme || config.docs.architecture || config.docs.api;
  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: {} };

  if (wantsDocs) {
    spinner.start('Generating documentation (README, architecture, API)...');
    try {
      docs = await client.generateDocs(files, config.project.name);
      spinner.succeed('Documentation generated');
    } catch (error) {
      spinner.fail('Documentation generation failed');
      console.error(chalk.red(`\n${(error as Error).message}`));
      process.exit(1);
    }
  }

  // Step 2: Generate context.json (separate call)
  const wantsContext = config.output.formats.includes('context');

  if (wantsContext) {
    spinner.start('Generating context.json (AI-optimized)...');
    try {
      docs.context = await client.generateContext(files, config.project.name);
      spinner.succeed('Context generated');
    } catch (error) {
      spinner.warn('context.json generation failed (docs are still saved)');
      if (options.verbose) {
        console.error(chalk.dim(`  ${(error as Error).message}`));
      }
      docs.context = {};
    }
  }

  // Write output
  spinner.start('Writing files...');
  await writeOutput(docs, projectPath, config);
  spinner.succeed('Files written');

  // Show summary
  const stats = await getOutputStats(projectPath, config);

  console.log(chalk.bold('\nOutput:'));
  for (const file of stats) {
    console.log(`  ${chalk.green('\u2713')} ${file.name} ${chalk.dim(`(${file.size})`)}`);
  }

  // Show usage info (API mode only)
  const usage = (docs as Record<string, unknown>)._usage as
    | { inputTokens: number; outputTokens: number }
    | undefined;
  if (usage) {
    const totalTokens = usage.inputTokens + usage.outputTokens;
    console.log(chalk.dim(`\nTokens used: ${totalTokens.toLocaleString()}`));
  }

  console.log(chalk.dim(`Documentation saved to ${config.output.directory}/\n`));
}

function estimateTokens(files: ScannedFile[]): number {
  const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
  const promptOverhead = 2000;
  return Math.ceil(totalChars / 4) + promptOverhead;
}

function estimateCost(tokens: number): number {
  const inputTokens = tokens * 0.7;
  const outputTokens = tokens * 0.3;
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}
