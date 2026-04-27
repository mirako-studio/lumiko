import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import prompts from 'prompts';
import { loadConfig } from '../core/config.js';
import { scanProject } from '../core/scanner.js';
import { createClient } from '../core/claude.js';
import { writeOutput } from '../core/output.js';
import { buildChunkPlan } from '../core/chunker.js';
import { buildGraph } from '../graph/index.js';
import { buildEmbeddings, writeEmbeddings } from '../embeddings/index.js';
import { getPreset, loadContextBundle, PRESET_NAMES } from '../presets/index.js';
import * as ui from '../ui/reporter.js';
import type { ScannedFile, ChunkAnalysis, DependencyGraph, ContextModule } from '../types/index.js';
import type { Backend, GeneratedDocs, PresetName, LumikoConfig, ContextBundle, DocGenerator } from '../types/index.js';

const LUMIKO_VERSION = '1.0.0';

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

function resolveFormats(config: LumikoConfig, options: GenerateOptions): OutputFormat[] {
  if (options.full) return ['markdown', 'context', 'embeddings'];
  const set = new Set<OutputFormat>(config.output.formats);
  if (options.embeddings) set.add('embeddings');
  return Array.from(set);
}

function resolvePresets(config: LumikoConfig, options: GenerateOptions): PresetName[] {
  if (options.presets === false) return [];
  if (options.full) return [...PRESET_NAMES];

  const flagged: PresetName[] = [];
  if (options.claudeCode) flagged.push('claude-code');
  if (options.cursor) flagged.push('cursor');
  if (options.copilot) flagged.push('copilot');
  if (options.windsurf) flagged.push('windsurf');
  if (options.agents) flagged.push('agents');

  return flagged.length > 0 ? flagged : [...config.presets];
}

// ── Main ────────────────────────────────────────────────────────────────

export async function generate(options: GenerateOptions): Promise<void> {
  const projectPath = process.cwd();
  const projectLabel = path.basename(projectPath) + '/';

  // Load config (before the header so we know the backend/model)
  let config: LumikoConfig;
  try {
    config = await loadConfig(projectPath);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }

  // Apply flag overrides. We mutate a fresh copy so downstream code sees
  // effective values without threading extra params.
  config = {
    ...config,
    output: { ...config.output, formats: resolveFormats(config, options) },
    presets: resolvePresets(config, options),
  };

  const backend: Backend = (options.backend as Backend) ?? config.claude.backend;

  ui.printHeader({ version: LUMIKO_VERSION, backend, model: config.claude.model });

  // ── Scan ──────────────────────────────────────────────────────────────
  ui.startPhase(`Scanning ${projectLabel}`);
  const { files, totalLines } = await scanProject(projectPath, config);
  if (files.length === 0) {
    ui.warn('No files matched your include patterns. Check .lumiko/config.yaml.');
    process.exit(1);
  }
  ui.scanList(ui.collapseScannedFiles(files));
  ui.blank();

  // Chunking plan
  const chunkPlan = buildChunkPlan(
    files,
    config.chunking.maxTokensPerChunk,
    config.chunking.threshold,
  );
  const shouldChunk =
    config.chunking.enabled === true ||
    (config.chunking.enabled === 'auto' && chunkPlan.needsChunking);

  // ── Dry run ───────────────────────────────────────────────────────────
  if (options.dryRun) {
    printDryRunPlan(config, files, shouldChunk, chunkPlan);
    ui.summary({ extras: [chalk.yellow('dry run')] });
    process.exit(0);
  }

  // ── Create client + confirm ───────────────────────────────────────────
  let client: DocGenerator;
  try {
    client = await createClient(config, {
      backendOverride: backend,
      verbose: options.verbose,
    });
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }

  if (!options.yes) {
    const message = shouldChunk
      ? `Proceed with chunked generation? (${chunkPlan.chunks.length} chunks)`
      : 'Proceed with generation?';
    const { proceed } = await prompts({ type: 'confirm', name: 'proceed', message, initial: true });
    if (!proceed) {
      ui.info('Cancelled.');
      process.exit(0);
    }
  }

  // ── Claude phase ──────────────────────────────────────────────────────
  const phaseLabel = shouldChunk
    ? `Sending to Claude in ${chunkPlan.chunks.length} chunks (${totalLines.toLocaleString()} loc · ${files.length} files)`
    : `Sending to Claude (${totalLines.toLocaleString()} loc · ${files.length} files)`;
  ui.startPhase(phaseLabel);

  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: null };
  if (shouldChunk) {
    docs = await runChunkedPipeline(client, files, chunkPlan, config, options);
  } else {
    docs = await runStandardPipeline(client, files, config, options);
  }
  ui.blank();

  // ── Graph ─────────────────────────────────────────────────────────────
  let depGraph: DependencyGraph | null = null;
  if (config.output.formats.includes('context')) {
    ui.startPhase('Building dependency graph');
    depGraph = buildGraph(files);
    ui.info(
      `${depGraph.stats.totalFiles} nodes · ` +
        `${depGraph.stats.totalInternalEdges} edges · ` +
        `${depGraph.stats.totalExternalPackages} external packages`,
    );
    ui.blank();
  }

  // ── Write bundle + markdown ───────────────────────────────────────────
  await writeOutput(docs, projectPath, config, { graph: depGraph });

  // Print outputs as a "Writing" phase
  const writtenRows = collectWrittenRows(docs, depGraph, config);
  if (writtenRows.length > 0) {
    const outputRoot =
      config.output.formats.includes('context') && writtenRows.some((r) => r.path.startsWith(config.output.contextDirectory))
        ? `${config.output.contextDirectory}/`
        : `${config.output.directory}/`;
    ui.startPhase(`Writing ${outputRoot}`);
    ui.outputList(writtenRows);
    ui.blank();
  }

  // ── Embeddings ────────────────────────────────────────────────────────
  if (config.output.formats.includes('embeddings') && depGraph) {
    ui.startPhase('Building RAG chunks');
    try {
      const modules = bundleToModuleMap(docs.context);
      const { chunks, metadata } = buildEmbeddings(files, config.project.name, {
        graph: depGraph,
        modules,
      });
      await writeEmbeddings(chunks, metadata, projectPath, config);
      ui.outputList([
        { path: `${config.output.contextDirectory}/embeddings/chunks.jsonl`, size: `${metadata.totals.chunks} chunks · ~${metadata.totals.estimatedTokens.toLocaleString()} tokens` },
        { path: `${config.output.contextDirectory}/embeddings/metadata.json`, size: '' },
      ]);
    } catch (error) {
      ui.warn(`Embeddings skipped: ${(error as Error).message}`);
    }
    ui.blank();
  }

  // ── Presets ───────────────────────────────────────────────────────────
  const runPresetsAfter =
    config.presets.length > 0 &&
    docs.context !== null &&
    config.output.formats.includes('context');

  if (runPresetsAfter) {
    ui.startPhase(`Running ${config.presets.length} preset${config.presets.length === 1 ? '' : 's'}`);
    try {
      const outputs = await runConfiguredPresets(projectPath, config);
      ui.outputList(outputs.map((o) => ({ path: o.path, size: `${o.size} · ${chalk.dim(o.preset)}` })));
    } catch (error) {
      ui.warn(`Presets skipped: ${(error as Error).message}`);
    }
    ui.blank();
  }

  // ── Summary ───────────────────────────────────────────────────────────
  const apiCalls = getApiCallsFromClient(client);
  ui.summary({ apiCalls });
}

// ── Dry run ─────────────────────────────────────────────────────────────

function printDryRunPlan(
  config: LumikoConfig,
  files: ScannedFile[],
  shouldChunk: boolean,
  chunkPlan: ReturnType<typeof buildChunkPlan>,
): void {
  ui.startPhase('Would write');

  const rows: Array<{ path: string; size: string }> = [];
  if (config.docs.readme) rows.push({ path: `${config.output.directory}/README.md`, size: 'markdown' });
  if (config.docs.architecture) rows.push({ path: `${config.output.directory}/architecture.md`, size: 'markdown' });
  if (config.docs.api) rows.push({ path: `${config.output.directory}/api.md`, size: 'markdown' });

  if (config.output.formats.includes('context')) {
    const cd = config.output.contextDirectory;
    rows.push({ path: `${cd}/manifest.json`, size: 'json' });
    rows.push({ path: `${cd}/overview.json`, size: 'json' });
    rows.push({ path: `${cd}/architecture.json`, size: 'json' });
    rows.push({ path: `${cd}/conventions.md`, size: 'markdown' });
    rows.push({ path: `${cd}/commands.json`, size: 'json' });
    const moduleDirs = new Set(
      files.map((f) => {
        const parts = f.path.split(/[/\\]/);
        return parts.length > 1 ? parts.slice(0, -1).join('-') : '_root';
      }),
    );
    rows.push({ path: `${cd}/modules/*.json`, size: `${moduleDirs.size} modules` });
    rows.push({ path: `${cd}/graph.json`, size: 'dependency graph' });
  }

  if (config.output.formats.includes('embeddings')) {
    const cd = config.output.contextDirectory;
    rows.push({ path: `${cd}/embeddings/chunks.jsonl`, size: 'RAG chunks' });
    rows.push({ path: `${cd}/embeddings/metadata.json`, size: 'json' });
  }

  for (const name of config.presets) {
    const p = getPreset(name);
    for (const out of p.outputPaths) {
      rows.push({ path: out, size: chalk.dim(name) });
    }
  }

  ui.outputList(rows);
  if (shouldChunk) {
    ui.blank();
    ui.info(`Strategy: chunked (${chunkPlan.chunks.length} chunks → analyze → synthesize)`);
  }
  ui.blank();
}

// ── Pipelines (now write via reporter) ──────────────────────────────────

async function runStandardPipeline(
  client: DocGenerator,
  files: ScannedFile[],
  config: LumikoConfig,
  options: GenerateOptions,
): Promise<GeneratedDocs> {
  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: null };
  const wantsDocs = config.docs.readme || config.docs.architecture || config.docs.api;

  if (wantsDocs) {
    const sp = ui.spinner().start('generating markdown docs');
    try {
      docs = await client.generateDocs(files, config.project.name);
      sp.succeed('markdown docs generated');
    } catch (error) {
      sp.fail((error as Error).message);
      process.exit(1);
    }
  }

  if (config.output.formats.includes('context')) {
    const sp = ui.spinner().start('generating .context/ bundle');
    try {
      docs.context = await client.generateContext(files, config.project.name);
      sp.succeed(`.context/ bundle generated (${docs.context.entries.length} files)`);
    } catch (error) {
      sp.warn(`.context/ bundle skipped: ${(error as Error).message}`);
      if (options.verbose) ui.info((error as Error).stack ?? '');
      docs.context = null;
    }
  }

  return docs;
}

async function runChunkedPipeline(
  client: DocGenerator,
  files: ScannedFile[],
  chunkPlan: ReturnType<typeof buildChunkPlan>,
  config: LumikoConfig,
  options: GenerateOptions,
): Promise<GeneratedDocs> {
  const { chunks } = chunkPlan;
  let docs: GeneratedDocs = { readme: '', architecture: '', api: '', context: null };
  const analyses: ChunkAnalysis[] = [];

  // Phase 1 — map
  for (const chunk of chunks) {
    const label = `[${chunk.index + 1}/${chunks.length}] ${chunk.label} (${chunk.files.length} files)`;
    const sp = ui.spinner().start(`analyzing ${label}`);
    try {
      const analysis = await client.analyzeChunk(chunk.files, chunk.label, config.project.name);
      analysis.index = chunk.index;
      analyses.push(analysis);
      sp.succeed(`analyzed ${label}`);
    } catch (error) {
      sp.warn(`skipped ${label}: ${(error as Error).message}`);
      if (options.verbose) ui.info((error as Error).stack ?? '');
    }
  }

  if (analyses.length === 0) {
    ui.error('all chunk analyses failed — cannot synthesize');
    process.exit(1);
  }

  // Phase 2 — reduce docs
  const wantsDocs = config.docs.readme || config.docs.architecture || config.docs.api;
  if (wantsDocs) {
    const sp = ui.spinner().start('synthesizing markdown docs');
    try {
      docs = await client.synthesizeDocs(analyses, config.project.name, config);
      sp.succeed('markdown docs synthesized');
    } catch (error) {
      sp.fail((error as Error).message);
      process.exit(1);
    }
  }

  // Phase 3 — reduce context bundle
  if (config.output.formats.includes('context')) {
    const sp = ui.spinner().start('synthesizing .context/ bundle');
    try {
      docs.context = await client.synthesizeContext(analyses, files, config.project.name, config);
      sp.succeed(`.context/ bundle synthesized (${docs.context.entries.length} files)`);
    } catch (error) {
      sp.warn(`.context/ bundle skipped: ${(error as Error).message}`);
      if (options.verbose) ui.info((error as Error).stack ?? '');
      docs.context = null;
    }
  }

  return docs;
}

// ── Output row collection ───────────────────────────────────────────────

function collectWrittenRows(
  docs: GeneratedDocs,
  depGraph: DependencyGraph | null,
  config: LumikoConfig,
): Array<{ path: string; size: string }> {
  const rows: Array<{ path: string; size: string }> = [];

  if (config.docs.readme && docs.readme) rows.push({ path: `${config.output.directory}/README.md`, size: formatBytes(docs.readme.length) });
  if (config.docs.architecture && docs.architecture) rows.push({ path: `${config.output.directory}/architecture.md`, size: formatBytes(docs.architecture.length) });
  if (config.docs.api && docs.api) rows.push({ path: `${config.output.directory}/api.md`, size: formatBytes(docs.api.length) });

  if (config.output.formats.includes('context') && docs.context && docs.context.entries.length > 0) {
    const cd = config.output.contextDirectory;
    for (const entry of docs.context.entries) {
      const serialized = entry.kind === 'json'
        ? JSON.stringify(entry.content, null, 2)
        : String(entry.content);
      rows.push({ path: `${cd}/${entry.path}`, size: formatBytes(serialized.length) });
    }
    rows.push({ path: `${cd}/manifest.json`, size: 'json' });
    if (depGraph) rows.push({ path: `${cd}/graph.json`, size: formatBytes(JSON.stringify(depGraph).length) });
  }

  return rows;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

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

async function runConfiguredPresets(
  projectPath: string,
  config: LumikoConfig,
): Promise<Array<{ preset: PresetName; path: string; size: string }>> {
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

  return results;
}

/** Extract api-call count from either backend without leaking types. */
function getApiCallsFromClient(client: DocGenerator): number {
  const maybe = (client as unknown as { getApiCalls?: () => number }).getApiCalls;
  return typeof maybe === 'function' ? maybe.call(client) : 0;
}
