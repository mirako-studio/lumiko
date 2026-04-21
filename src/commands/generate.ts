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
import { buildGraph } from '../graph/index.js';
import { buildEmbeddings, writeEmbeddings } from '../embeddings/index.js';
import { getPreset, loadContextBundle, PRESET_NAMES } from '../presets/index.js';
import type { ScannedFile, ChunkAnalysis, DependencyGraph, ContextModule } from '../types/index.js';
import type { Backend, GeneratedDocs, PresetName, LumikoConfig, ContextBundle } from '../types/index.js';

type OutputFormat = LumikoConfig['output']['formats'][number];

interface GenerateOptions {
  yes?: boolean;
  dryRun?: boolean;
  backend?: string;
  verbose?: boolean;
  /** `--full` / `-f` — generate everything regardless of config. */
  full?: boolean;
  /** `--embeddings` — add embeddings format to this run. */
  embeddings?: boolean;
  /** Per-preset flags. When any are true, they replace config.presets for this run. */
  claudeCode?: boolean;
  cursor?: boolean;
  copilot?: boolean;
  windsurf?: boolean;
  agents?: boolean;
  /** commander's --no-presets sets this to false. */
  presets?: boolean;
}

// ── Flag resolution ─────────────────────────────────────────────────────

/**
 * Merge flag overrides into the configured output formats.
 *   --full         → markdown + context + embeddings
 *   --embeddings   → add embeddings (if not already there)
 *   Otherwise, config.formats wins.
 */
function resolveFormats(config: LumikoConfig, options: GenerateOptions): OutputFormat[] {
  if (options.full) {
    return ['markdown', 'context', 'embeddings'];
  }
  const set = new Set<OutputFormat>(config.output.formats);
  if (options.embeddings) set.add('embeddings');
  return Array.from(set);
}

/**
 * Decide which presets to run this invocation.
 *
 * Precedence (highest first):
 *   1. `--no-presets`          → []
 *   2. `--full`                → all built-in presets
 *   3. Any per-preset flag set → only those flagged presets (replaces config)
 *   4. Otherwise               → config.presets
 */
function resolvePresets(config: LumikoConfig, options: GenerateOptions): PresetName[] {
  if (options.presets === false) return [];
  if (options.full) return [...PRESET_NAMES];

  const flagged: PresetName[] = [];
  if (options.claudeCode) flagged.push('claude-code');
  if (options.cursor) flagged.push('cursor');
  if (options.copilot) flagged.push('copilot');
  if (options.windsurf) flagged.push('windsurf');
  if (options.agents) flagged.push('agents');

  if (flagged.length > 0) return flagged;
  return [...config.presets];
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

  // Apply flag overrides: --full, --embeddings, per-preset flags.
  // We mutate a fresh config copy so the rest of the pipeline sees the
  // effective (flag-resolved) values without threading extra params.
  const effectiveFormats = resolveFormats(config, options);
  const effectivePresets = resolvePresets(config, options);
  config = {
    ...config,
    output: { ...config.output, formats: effectiveFormats },
    presets: effectivePresets,
  };

  // Resolve backend: CLI flag > config > default
  const backend: Backend = (options.backend as Backend) ?? config.claude.backend;

  // Surface what the flag resolution ended up with, so users see the plan.
  if (options.full || options.embeddings || options.claudeCode || options.cursor ||
      options.copilot || options.windsurf || options.agents || options.presets === false) {
    const formatsDisplay = effectiveFormats.join(', ') || '(none)';
    const presetsDisplay = effectivePresets.length > 0 ? effectivePresets.join(', ') : '(none)';
    console.log(chalk.dim(`Formats: ${chalk.cyan(formatsDisplay)}`));
    console.log(chalk.dim(`Presets: ${chalk.cyan(presetsDisplay)}`));
  }

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
      console.log(`  - ${ctxDir}/graph.json ${chalk.dim('(dependency graph)')}`);
    }
    if (config.output.formats.includes('embeddings')) {
      const ctxDir = config.output.contextDirectory;
      console.log(`  - ${ctxDir}/embeddings/chunks.jsonl ${chalk.dim('(RAG chunks)')}`);
      console.log(`  - ${ctxDir}/embeddings/metadata.json`);
    }
    if (config.presets.length > 0) {
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

  // Build the dependency graph — pure static analysis, no Claude calls.
  let depGraph: DependencyGraph | null = null;
  if (config.output.formats.includes('context')) {
    spinner.start('Building dependency graph...');
    depGraph = buildGraph(files);
    spinner.succeed(
      `Dependency graph: ${depGraph.stats.totalFiles} nodes, ` +
        `${depGraph.stats.totalInternalEdges} edges, ` +
        `${depGraph.stats.totalExternalPackages} external packages`,
    );
  }

  // Write output
  spinner.start('Writing files...');
  await writeOutput(docs, projectPath, config, { graph: depGraph });
  spinner.succeed('Files written');

  // Build embeddings if requested. This runs AFTER the bundle is written
  // so it can pull per-module metadata (purposes, symbols) from the JSON
  // we just produced.
  if (config.output.formats.includes('embeddings') && depGraph) {
    spinner.start('Building RAG-ready chunks...');
    try {
      const modules = bundleToModuleMap(docs.context);
      const { chunks, metadata } = buildEmbeddings(files, config.project.name, {
        graph: depGraph,
        modules,
      });
      await writeEmbeddings(chunks, metadata, projectPath, config);
      spinner.succeed(
        `Embeddings: ${metadata.totals.chunks} chunks ` +
          `(${metadata.totals.codeChunks} code + ${metadata.totals.contextChunks} context, ` +
          `~${metadata.totals.estimatedTokens.toLocaleString()} tokens)`,
      );
    } catch (error) {
      spinner.warn('Embeddings generation failed (other outputs are saved)');
      if (options.verbose) {
        console.error(chalk.dim(`  ${(error as Error).message}`));
      }
    }
  }

  // Auto-run presets if any survived flag resolution and .context/ was generated
  const runPresetsAfter =
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
 * Extract module JSONs from a ContextBundle (the in-memory form we just
 * built) into the `Map<moduleKey, ContextModule>` shape the embeddings
 * enricher expects. Saves re-reading from disk right after writing.
 */
function bundleToModuleMap(bundle: ContextBundle | null): Map<string, ContextModule> {
  const out = new Map<string, ContextModule>();
  if (!bundle) return out;

  for (const entry of bundle.entries) {
    if (entry.kind !== 'json') continue;
    if (!entry.path.startsWith('modules/')) continue;
    const key = entry.path.replace(/^modules\//, '').replace(/\.json$/, '');
    if (typeof entry.content === 'object' && entry.content !== null) {
      out.set(key, entry.content as unknown as ContextModule);
    }
  }

  return out;
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
