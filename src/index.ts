import { Command } from 'commander';
import { init } from './commands/init.js';
import { generate } from './commands/generate.js';
import { preset } from './commands/preset.js';
import { graph } from './commands/graph.js';
import { embeddings } from './commands/embeddings.js';

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
  .option('-f, --full', 'Generate everything — all formats (markdown+context+embeddings) and all presets')
  .option('--embeddings', 'Include RAG-ready embeddings this run (adds to config formats)')
  .option('--claude-code', 'Run the claude-code preset this run (overrides config.presets)')
  .option('--cursor', 'Run the cursor preset this run (overrides config.presets)')
  .option('--copilot', 'Run the copilot preset this run (overrides config.presets)')
  .option('--windsurf', 'Run the windsurf preset this run (overrides config.presets)')
  .option('--agents', 'Run the agents preset this run (overrides config.presets)')
  .option('--no-presets', 'Skip all presets (overrides --full and per-preset flags)')
  .action(generate);

program
  .command('preset [targets...]')
  .description(
    'Generate tool-specific files (CLAUDE.md, .cursorrules, AGENTS.md, etc.) from the .context/ bundle. Run `lumiko preset list` to see options.',
  )
  .option('--dry-run', 'Show what would be written without creating files')
  .action(preset);

program
  .command('graph')
  .description('Build just the dependency graph (.context/graph.json) — no Claude, no cost')
  .option('--dry-run', 'Analyze imports and show stats without writing the file')
  .action(graph);

program
  .command('embeddings')
  .description('Build RAG-ready chunks (.context/embeddings/chunks.jsonl) — no Claude, no cost')
  .option('--dry-run', 'Build chunks and show stats without writing files')
  .action(embeddings);

program.parse();
