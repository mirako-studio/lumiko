import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import {
  PRESETS,
  PRESET_NAMES,
  getPreset,
  isPresetName,
  loadContextBundle,
  BundleNotFoundError,
  BundleIncompleteError,
} from '../presets/index.js';
import * as ui from '../ui/reporter.js';
import type { PresetName } from '../types/index.js';

const LUMIKO_VERSION = '1.0.0';

interface PresetOptions {
  dryRun?: boolean;
}

export async function preset(targets: string[], options: PresetOptions): Promise<void> {
  const projectPath = process.cwd();

  if (targets.length === 1 && targets[0] === 'list') {
    printPresetList();
    return;
  }

  // Load config first so the header can show backend/model.
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
    subcommand: 'preset',
  });

  // Resolve which presets to run
  const toRun = resolvePresetTargets(targets, config.presets);
  if (toRun.length === 0) {
    ui.warn('No presets specified. Options:');
    ui.info(`${chalk.cyan('lumiko preset list')}            — show available presets`);
    ui.info(`${chalk.cyan('lumiko preset <name>...')}       — generate specific presets`);
    ui.info(`${chalk.cyan('lumiko preset all')}             — generate every preset`);
    ui.info(`Set ${chalk.cyan('presets:')} in .lumiko/config.yaml to run by default`);
    ui.summary();
    process.exit(1);
  }

  // Load bundle
  ui.startPhase('Loading .context/ bundle');
  let bundle;
  try {
    bundle = await loadContextBundle(projectPath, config);
    ui.info(`${bundle.modules.size} modules · ${bundle.graph ? 'graph loaded' : 'no graph'}`);
  } catch (error) {
    if (error instanceof BundleNotFoundError || error instanceof BundleIncompleteError) {
      ui.error((error as Error).message);
      process.exit(1);
    }
    throw error;
  }
  ui.blank();

  // Generate files
  ui.startPhase(`Running ${toRun.length} preset${toRun.length === 1 ? '' : 's'}: ${toRun.join(', ')}`);
  const allRows: Array<{ path: string; size: string; kind?: 'created' | 'updated' | 'warning' }> = [];

  for (const name of toRun) {
    const p = getPreset(name);
    const output = p.generate({
      bundle,
      projectPath,
      projectName: config.project.name,
      config,
    });

    for (const file of output.files) {
      const fullPath = path.join(projectPath, file.path);
      const toWrite = file.content.endsWith('\n') ? file.content : file.content + '\n';
      const bytes = Buffer.byteLength(toWrite, 'utf-8');

      if (!options.dryRun) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, toWrite);
      }

      allRows.push({
        path: file.path,
        size: `${formatBytes(bytes)} · ${chalk.dim(name)}`,
        kind: 'created',
      });
    }
  }

  ui.outputList(allRows);
  ui.blank();
  ui.summary(options.dryRun ? { extras: [chalk.yellow('dry run')] } : undefined);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function resolvePresetTargets(targets: string[], configPresets: PresetName[]): PresetName[] {
  if (targets.length === 1 && targets[0] === 'all') return [...PRESET_NAMES];
  if (targets.length === 0) return [...configPresets];

  const resolved: PresetName[] = [];
  const unknown: string[] = [];

  for (const t of targets) {
    if (isPresetName(t)) {
      if (!resolved.includes(t)) resolved.push(t);
    } else {
      unknown.push(t);
    }
  }

  if (unknown.length > 0) {
    ui.error(`Unknown preset${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
    ui.info(`Available: ${PRESET_NAMES.join(', ')}`);
    ui.info('Run `lumiko preset list` for details.');
    process.exit(1);
  }

  return resolved;
}

function printPresetList(): void {
  console.log();
  console.log(chalk.bold('Available presets:'));
  console.log();

  for (const name of PRESET_NAMES) {
    const p = PRESETS[name];
    console.log(`  ${chalk.cyan(name.padEnd(14))} ${chalk.dim(p.description)}`);
    for (const out of p.outputPaths) {
      console.log(`  ${' '.repeat(14)} ${chalk.dim('→ ' + out)}`);
    }
    console.log();
  }

  console.log(chalk.dim('Run a preset with:  lumiko preset <name>'));
  console.log(chalk.dim('Run all presets:    lumiko preset all'));
  console.log();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
