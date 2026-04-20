import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
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
import type { PresetName } from '../types/index.js';

interface PresetOptions {
  dryRun?: boolean;
}

/**
 * Handle `lumiko preset <targets...>` — generate tool-specific files from
 * the .context/ bundle.
 *
 * Targets:
 *   - A list of preset names: `cursor claude-code`
 *   - The special keyword `list` — prints available presets and exits
 *   - The special keyword `all` — runs every preset
 *   - No targets + config.presets is set — runs what's in config
 */
export async function preset(targets: string[], options: PresetOptions): Promise<void> {
  const projectPath = process.cwd();

  // `lumiko preset list` — list available presets and exit
  if (targets.length === 1 && targets[0] === 'list') {
    printPresetList();
    return;
  }

  console.log(chalk.bold('\nLumiko Presets'));
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

  // Resolve which presets to run
  const toRun = resolvePresetTargets(targets, config.presets);
  if (toRun.length === 0) {
    console.log(chalk.yellow('\nNo presets specified. Options:'));
    console.log(`  ${chalk.cyan('lumiko preset list')}            — show available presets`);
    console.log(`  ${chalk.cyan('lumiko preset <name>...')}       — generate specific presets`);
    console.log(`  ${chalk.cyan('lumiko preset all')}             — generate every preset`);
    console.log(`  Set ${chalk.cyan('presets:')} in .lumiko/config.yaml to run by default`);
    console.log('');
    process.exit(1);
  }

  // Load the bundle
  let bundle;
  try {
    spinner.start('Loading .context/ bundle...');
    bundle = await loadContextBundle(projectPath, config);
    spinner.succeed(`.context/ bundle loaded (${bundle.modules.size} modules)`);
  } catch (error) {
    spinner.fail((error as Error).message);
    if (error instanceof BundleNotFoundError || error instanceof BundleIncompleteError) {
      process.exit(1);
    }
    throw error;
  }

  console.log(chalk.dim(`\nRunning ${toRun.length} preset${toRun.length === 1 ? '' : 's'}: ${toRun.join(', ')}`));

  const results = await runPresets(toRun, {
    bundle,
    projectPath,
    projectName: config.project.name,
    config,
  }, options.dryRun ?? false);

  // Summary
  console.log(chalk.bold('\nOutput:'));
  for (const { presetName, files } of results) {
    console.log(chalk.cyan(`\n  ${presetName}`));
    for (const file of files) {
      const marker = options.dryRun ? chalk.yellow('[dry]') : chalk.green('\u2713');
      const sizeBadge = chalk.dim(`(${formatBytes(file.sizeBytes)})`);
      console.log(`    ${marker} ${file.path} ${sizeBadge}`);
    }
  }

  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] No files written.\n'));
  } else {
    console.log('');
  }
}

// ── Orchestration ───────────────────────────────────────────────────────

interface RunResult {
  presetName: PresetName;
  files: Array<{ path: string; sizeBytes: number }>;
}

async function runPresets(
  names: PresetName[],
  ctx: import('../presets/index.js').PresetContext,
  dryRun: boolean,
): Promise<RunResult[]> {
  const results: RunResult[] = [];

  for (const name of names) {
    const p = getPreset(name);
    const output = p.generate(ctx);

    const fileResults: RunResult['files'] = [];

    for (const file of output.files) {
      const fullPath = path.join(ctx.projectPath, file.path);
      const sizeBytes = Buffer.byteLength(file.content, 'utf-8');

      if (!dryRun) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        // Ensure a trailing newline for POSIX-friendliness
        const toWrite = file.content.endsWith('\n') ? file.content : file.content + '\n';
        await fs.writeFile(fullPath, toWrite);
      }

      fileResults.push({ path: file.path, sizeBytes });
    }

    results.push({ presetName: name, files: fileResults });
  }

  return results;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function resolvePresetTargets(
  targets: string[],
  configPresets: PresetName[],
): PresetName[] {
  // `all` keyword
  if (targets.length === 1 && targets[0] === 'all') {
    return [...PRESET_NAMES];
  }

  // No targets — fall back to config
  if (targets.length === 0) {
    return [...configPresets];
  }

  // Validate each target
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
    console.error(chalk.red(`\nUnknown preset${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`));
    console.error(chalk.dim(`Available: ${PRESET_NAMES.join(', ')}`));
    console.error(chalk.dim('Run `lumiko preset list` for details.\n'));
    process.exit(1);
  }

  return resolved;
}

function printPresetList(): void {
  console.log(chalk.bold('\nAvailable presets:\n'));

  for (const name of PRESET_NAMES) {
    const p = PRESETS[name];
    console.log(`  ${chalk.cyan(name.padEnd(14))} ${p.description}`);
    for (const out of p.outputPaths) {
      console.log(`  ${' '.repeat(14)} ${chalk.dim('→ ' + out)}`);
    }
    console.log('');
  }

  console.log(chalk.dim('Run a preset with:  lumiko preset <name>'));
  console.log(chalk.dim('Run all presets:    lumiko preset all\n'));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
