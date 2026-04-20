# Lumiko

Auto-generate documentation from your codebase using Claude. Lumiko scans your project, analyzes it with Claude (via CLI subscription or API), and produces both human-readable markdown docs and a machine-readable `.context/` bundle for AI coding agents.

## Features

- **Dual backends** — Use Claude Code CLI (your subscription) or the Anthropic API directly
- **Human docs** — Generates `README.md`, `architecture.md`, and `api.md` with Mermaid diagrams
- **AI-readable `.context/` bundle** — Structured JSON + markdown files optimized for agents (Claude Code, Cursor, Copilot, RAG)
- **Smart chunking** — Automatically map-reduces large codebases that exceed the context window
- **Configurable** — YAML config controls includes/excludes, output formats, model, and chunking thresholds
- **Dry run & verbose modes** — Preview output and debug raw Claude responses

## Installation

```bash
npm install -g lumiko
```

You'll also need one of:

- **Claude Code CLI** (default, uses your subscription):
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- **Anthropic API key** (if using `backend: api`):
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-xxxxx
  ```

## Quick Start

```bash
# 1. Initialize Lumiko in your project
cd your-project
lumiko init

# 2. (Optional) Edit .lumiko/config.yaml

# 3. Generate docs
lumiko generate
```

### Commands

```bash
lumiko init [--force]              # Create .lumiko/config.yaml
lumiko generate                    # Generate all configured docs
lumiko generate --dry-run          # Show what would be generated
lumiko generate --yes              # Skip confirmation
lumiko generate --backend api      # Override backend
lumiko generate --verbose          # Show raw Claude output
```

### Example Output

```
docs/
  ├── README.md
  ├── architecture.md
  └── api.md

.context/
  ├── manifest.json
  ├── overview.json
  ├── architecture.json
  ├── conventions.md
  ├── commands.json
  └── modules/
      ├── src-core.json
      └── src-commands.json
```

## Project Structure

```
src/
├── commands/         # CLI command handlers (init, generate)
├── core/             # Core logic: scanner, chunker, Claude clients, prompts, parse, output
├── types/            # Shared TypeScript types
└── index.ts          # CLI entry point (Commander)
```

## Configuration

`.lumiko/config.yaml`:

```yaml
version: 1
project:
  name: my-project
  description: ""
include:
  - "src/**/*"
exclude:
  - "node_modules/**"
  - "dist/**"
output:
  directory: docs
  contextDirectory: .context
  formats: [markdown, context]
docs:
  readme: true
  architecture: true
  api: true
  diagrams: true
claude:
  backend: claude-code   # or "api"
  model: claude-sonnet-4-20250514
  maxTokens: 8192
chunking:
  enabled: auto          # true | false | "auto"
  maxTokensPerChunk: 80000
  threshold: 100000
```

## Contributing

Contributions welcome. See `CONTRIBUTING.md` (TBD).

## License

TBD.
