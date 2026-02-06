import path from 'path';
import fs from 'fs/promises';
import ora from 'ora';
import chalk from 'chalk';
import { createConfig } from '../core/config.js';

interface InitOptions {
  force?: boolean;
}

export async function init(options: InitOptions): Promise<void> {
  const projectPath = process.cwd();
  const configPath = path.join(projectPath, '.lumiko', 'config.yaml');

  console.log(chalk.bold('\nInitializing Lumiko...\n'));

  // Check if config already exists
  try {
    await fs.access(configPath);
    if (!options.force) {
      console.log(chalk.yellow('Config already exists at .lumiko/config.yaml'));
      console.log(chalk.dim('Use --force to overwrite.'));
      process.exit(1);
    }
  } catch {
    // Config doesn't exist — good, proceed
  }

  const spinner = ora();

  // Create config
  spinner.start('Creating configuration...');
  await createConfig(projectPath);
  spinner.succeed('Created .lumiko/config.yaml');

  // Create docs directory
  spinner.start('Creating docs directory...');
  await fs.mkdir(path.join(projectPath, 'docs'), { recursive: true });
  spinner.succeed('Created docs/ directory');

  console.log(chalk.bold.green('\n\u2713 Lumiko initialized!\n'));
  console.log('Next steps:');
  console.log(`  1. ${chalk.cyan('Edit .lumiko/config.yaml')} to customize settings`);
  console.log(`  2. ${chalk.cyan('Make sure Claude Code CLI is installed')} (npm i -g @anthropic-ai/claude-code)`);
  console.log(`  3. ${chalk.cyan('Run lumiko generate')} to create documentation`);
  console.log(chalk.dim('\n  Tip: Lumiko uses Claude Code by default (your subscription).'));
  console.log(chalk.dim('  To use the API instead, set backend: "api" in config + ANTHROPIC_API_KEY.\n'));
}
