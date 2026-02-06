import { Command } from 'commander';
import { init } from './commands/init.js';
import { generate } from './commands/generate.js';

const program = new Command();

program
  .name('lumiko')
  .description('Auto-generate documentation from your codebase using Claude')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Lumiko in the current directory')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(init);

program
  .command('generate')
  .description('Generate documentation from your codebase')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--dry-run', 'Show what would be generated without calling Claude')
  .option(
    '-b, --backend <backend>',
    'Backend to use: "claude-code" (default, uses subscription) or "api" (requires ANTHROPIC_API_KEY)',
  )
  .option('--verbose', 'Show raw Claude output for debugging')
  .action(generate);

program.parse();
