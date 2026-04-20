import fs from 'fs/promises';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { createClient } from '../core/claude.js';
import { writeOutput, getOutputStats } from '../core/output.js';
import { buildChunkPlan, estimateTotalTokens } from '../core/chunker.js';
import { getPreset, loadContextBundle } from '../presets/index.js';
import type { ScannedFile, ChunkAnalysis } from '../types/index.js';
import type { Backend, GeneratedDocs, PresetName, LumikoConfig } from '../types/index.js';

interface GenerateOptions {
  yes?: boolean;
  dryRun?: boolean;
  backend?: string;
  verbose?: boolean;
  /** commander's --no-presets sets this to false. */
  presets?: boolean;
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

  // Build chunk plan
  const chunkPlan = buildChunkPlan(
    files,
    config.chunking.maxTokensPerChunk,
    config.chunking.threshold,
  );

  // Determine if we should chunk
  const shouldChunk =
    config.chunking.enabled === true ||
    (config.chunking.enabled === 'auto' && chunkPlan.needsChunking);

  // Show info
  const estimatedTokens = estimateTokens(files);

  if (shouldChunk) {
    console.log(
      chalk.cyan(
        `\nChunking: ${chalk.bold(chunkPlan.chunks.length)} chunks ` +
          `(~${chunkPlan.totalTokens.toLocaleString()} tokens total)`,
      ),
    );
    for (const chunk of chunkPlan.chunks) {
      console.log(
        chalk.dim(
          `  ${chunk.index + 1}. ${chunk.label} — ${chunk.files.length} files (~${chunk.estimatedTokens.toLocaleString()} tokens)`,
        ),
      );
    }
  }

  if (backend === 'api') {
    const estimatedCost = estimateCost(estimatedTokens);
    const multiplier = shouldChunk ? chunkPlan.chunks.length + 2 : 1; // chunks + synthesis + context
    console.log(
      chalk.dim(
        `\nEstimated: ~${estimatedTokens.toLocaleString()} tokens ($${(estimatedCost * multiplier).toFixed(2)}${shouldChunk ? ' across all calls' : ''})`,
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
    if (config.output.formats.includes('context')) {
      const ctxDir = config.output.contextDirectory;
      console.log(`  - ${ctxDir}/manifest.json`);
      console.log(`  - ${ctxDir}/overview.json`);
      console.log(`  - ${ctxDir}/architecture.json`);
      console.log(`  - ${ctxDir}/conventions.md`);
      console.log(`  - ${ctxDir}/commands.json`);
      // Count modules so users know what's coming
      const moduleDirs = new Set(
        files.map((f) => {
          const parts = f.path.split(/[/\\]/);
          return parts.length > 1 ? parts.slice(0, -1).join('-') : '_root';
        }),
      );
      console.log(`  - ${ctxDir}/modules/*.json ${chalk.dim(`(${moduleDirs.size} modules)`)}`);
    }
    if (options.presets !== false && config.presets.length > 0) {
      console.log(chalk.bold('\n  Presets:'));
      for (const name of config.presets) {
        const p = getPreset(name);
        for (const out of p.outputPaths) {
          console.log(`    - ${out} ${chalk.dim(`[${name}]`)}`);
        }
      }
    }
    if (shouldChunk) {
      console.log(chalk.dim(`\n  Strategy: chunked (${chunkPlan.chunks.length} chunks → analyze → synthesize)`));
    }
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
    const message = shouldChunk
      ? `Proceed with chunked generation? (${chunkPlan.chunks.length} chunks)`
      : 'Proceed with generation?';

    const { proceed } = await prompts({
      type: 'confirm',
      name: 'proceed',
      message,
      initial: true,
    });

    if (!proceed) {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  console.log('');

  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: null };

  if (shouldChunk) {
    // ── Chunked pipeline ──────────────────────────────────────────────
    docs = await runChunkedPipeline(client, files, chunkPlan, config, options, spinner);
  } else {
    // ── Standard (single-shot) pipeline ───────────────────────────────
    docs = await runStandardPipeline(client, files, config, options, spinner);
  }

  // Write output
  spinner.start('Writing files...');
  await writeOutput(docs, projectPath, config);
  spinner.succeed('Files written');

  // Auto-run presets if configured and .context/ was generated
  const runPresetsAfter =
    options.presets !== false &&
    config.presets.length > 0 &&
    docs.context !== null &&
    config.output.formats.includes('context');

  const presetOutputs: Array<{ preset: PresetName; path: string; size: string }> = [];
  if (runPresetsAfter) {
    try {
      presetOutputs.push(...(await runConfiguredPresets(projectPath, config, spinner)));
    } catch (error) {
      spinner.warn('Preset generation failed (docs and .context/ are still saved)');
      if (options.verbose) {
        console.error(chalk.dim(`  ${(error as Error).message}`));
      }
    }
  }

  // Show summary
  const stats = await getOutputStats(projectPath, config);

  console.log(chalk.bold('\nOutput:'));
  for (const file of stats) {
    console.log(`  ${chalk.green('\u2713')} ${file.name} ${chalk.dim(`(${file.size})`)}`);
  }

  if (presetOutputs.length > 0) {
    console.log(chalk.bold('\nPresets:'));
    for (const out of presetOutputs) {
      console.log(
        `  ${chalk.green('\u2713')} ${out.path} ${chalk.dim(`(${out.size})`)} ${chalk.dim(`[${out.preset}]`)}`,
      );
    }
  }

  // Show usage info (API mode only)
  const usage = (docs as unknown as Record<string, unknown>)._usage as
    | { inputTokens: number; outputTokens: number }
    | undefined;
  if (usage) {
    const totalTokens = usage.inputTokens + usage.outputTokens;
    console.log(chalk.dim(`\nTokens used: ${totalTokens.toLocaleString()}`));
  }

  console.log(chalk.dim(`Documentation saved to ${config.output.directory}/\n`));
}

// ── Standard pipeline (no chunking) ─────────────────────────────────────

async function runStandardPipeline(
  client: import('../types/index.js').DocGenerator,
  files: ScannedFile[],
  config: import('../types/index.js').LumikoConfig,
  options: GenerateOptions,
  spinner: ReturnType<typeof ora>,
): Promise<GeneratedDocs> {
  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: null };

  const wantsDocs = config.docs.readme || config.docs.architecture || config.docs.api;

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

  const wantsContext = config.output.formats.includes('context');

  if (wantsContext) {
    spinner.start('Generating .context/ bundle (AI-readable)...');
    try {
      docs.context = await client.generateContext(files, config.project.name);
      spinner.succeed(`Context bundle generated (${docs.context.entries.length} files)`);
    } catch (error) {
      spinner.warn('.context/ bundle generation failed (markdown docs are still saved)');
      if (options.verbose) {
        console.error(chalk.dim(`  ${(error as Error).message}`));
      }
      docs.context = null;
    }
  }

  return docs;
}

// ── Chunked pipeline ────────────────────────────────────────────────────

async function runChunkedPipeline(
  client: import('../types/index.js').DocGenerator,
  files: ScannedFile[],
  chunkPlan: ReturnType<typeof buildChunkPlan>,
  config: import('../types/index.js').LumikoConfig,
  options: GenerateOptions,
  spinner: ReturnType<typeof ora>,
): Promise<GeneratedDocs> {
  const { chunks } = chunkPlan;
  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: null };

  // Phase 1: Analyze each chunk
  const analyses: ChunkAnalysis[] = [];

  for (const chunk of chunks) {
    const label = `[${chunk.index + 1}/${chunks.length}] ${chunk.label}`;
    spinner.start(`Analyzing chunk ${label} (${chunk.files.length} files)...`);

    try {
      const analysis = await client.analyzeChunk(
        chunk.files,
        chunk.label,
        config.project.name,
      );
      analysis.index = chunk.index;
      analyses.push(analysis);
      spinner.succeed(`Chunk ${label} analyzed`);
    } catch (error) {
      spinner.fail(`Chunk ${label} analysis failed`);
      if (options.verbose) {
        console.error(chalk.dim(`  ${(error as Error).message}`));
      }
      // Continue with other chunks — partial analysis is still useful
      console.log(chalk.yellow(`  Skipping chunk "${chunk.label}" — will synthesize with available data`));
    }
  }

  if (analyses.length === 0) {
    console.error(chalk.red('\nAll chunk analyses failed. Cannot synthesize documentation.'));
    process.exit(1);
  }

  console.log(
    chalk.dim(`\n  ${analyses.length}/${chunks.length} chunks analyzed successfully\n`),
  );

  // Phase 2: Synthesize markdown docs
  const wantsDocs = config.docs.readme || config.docs.architecture || config.docs.api;

  if (wantsDocs) {
    spinner.start('Synthesizing documentation from chunk analyses...');
    try {
      docs = await client.synthesizeDocs(analyses, config.project.name, config);
      spinner.succeed('Documentation synthesized');
    } catch (error) {
      spinner.fail('Documentation synthesis failed');
      console.error(chalk.red(`\n${(error as Error).message}`));
      process.exit(1);
    }
  }

  // Phase 3: Synthesize .context/ bundle
  const wantsContext = config.output.formats.includes('context');

  if (wantsContext) {
    spinner.start('Synthesizing .context/ bundle from chunk analyses...');
    try {
      docs.context = await client.synthesizeContext(analyses, files, config.project.name, config);
      spinner.succeed(`Context bundle synthesized (${docs.context.entries.length} files)`);
    } catch (error) {
      spinner.warn('.context/ bundle synthesis failed (markdown docs are still saved)');
      if (options.verbose) {
        console.error(chalk.dim(`  ${(error as Error).message}`));
      }
      docs.context = null;
    }
  }

  return docs;
}

// ── Helpers ─────────────────────────────────────────────────────────────

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * After a successful generate, transform the freshly-written .context/ bundle
 * into tool-specific files listed in config.presets.
 */
async function runConfiguredPresets(
  projectPath: string,
  config: LumikoConfig,
  spinner: ReturnType<typeof ora>,
): Promise<Array<{ preset: PresetName; path: string; size: string }>> {
  spinner.start(`Running ${config.presets.length} preset${config.presets.length === 1 ? '' : 's'}...`);

  const bundle = await loadContextBundle(projectPath, config);
  const results: Array<{ preset: PresetName; path: string; size: string }> = [];

  for (const name of config.presets) {
    const p = getPreset(name);
    const output = p.generate({
      bundle,
      projectPath,
      projectName: config.project.name,
      config,
    });

    for (const file of output.files) {
      const fullPath = path.join(projectPath, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const toWrite = file.content.endsWith('\n') ? file.content : file.content + '\n';
      await fs.writeFile(fullPath, toWrite);
      const size = formatBytes(Buffer.byteLength(toWrite, 'utf-8'));
      results.push({ preset: name, path: file.path, size });
    }
  }

  spinner.succeed(`Presets generated (${results.length} files)`);
  return results;
}
