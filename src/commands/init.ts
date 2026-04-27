import path from 'path';
import fs from 'fs/promises';
import chalk from 'chalk';
import { createConfig } from '../core/config.js';
import * as ui from '../ui/reporter.js';

const LUMIKO_VERSION = '1.0.0';

interface InitOptions {
  force?: boolean;
}

export async function init(options: InitOptions): Promise<void> {
  const projectPath = process.cwd();
  const configPath = path.join(projectPath, '.lumiko', 'config.yaml');

  ui.printHeader({
    version: LUMIKO_VERSION,
    backend: '(not configured yet)',
    subcommand: 'init',
  });

  // Check for existing config
  try {
    await fs.access(configPath);
    if (!options.force) {
      ui.warn('Config already exists at .lumiko/config.yaml');
      ui.info('Use --force to overwrite.');
      process.exit(1);
    }
  } catch {
    // Config doesn't exist — good
  }

  ui.startPhase('Scaffolding');
  await createConfig(projectPath);
  await fs.mkdir(path.join(projectPath, 'docs'), { recursive: true });

  ui.outputList([
    { path: '.lumiko/config.yaml', size: 'yaml', kind: 'created' },
    { path: 'docs/', size: 'directory', kind: 'created' },
  ]);
  ui.blank();

  console.log(chalk.bold('Next steps:'));
  console.log(`  1. ${chalk.cyan('Edit .lumiko/config.yaml')} to customize settings`);
  console.log(`  2. ${chalk.cyan('Install Claude Code CLI')} (npm i -g @anthropic-ai/claude-code)`);
  console.log(`  3. ${chalk.cyan('Run lumiko generate')} to create documentation`);
  console.log();
  console.log(chalk.dim('  Tip: Claude Code uses your subscription (no API key needed).'));
  console.log(chalk.dim('  For the API backend, set backend: "api" + ANTHROPIC_API_KEY.'));
  ui.summary();
}
