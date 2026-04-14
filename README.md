# Lumiko

Auto-generate documentation from your codebase using Claude.

Lumiko scans your project, sends the source to Claude, and produces structured docs — README, architecture, API reference, and an AI-optimized `context.json` that agents can consume directly.

No custom parsers. No AST walking. Claude reads your code and writes the docs.

## How it works

```
your codebase ──> Lumiko scans files ──> Claude analyzes ──> docs/ written
```

Lumiko uses **Claude Code** (your existing subscription) by default. No API key needed — just have the Claude Code CLI installed.

## Quick start

```bash
npm install -g lumiko

cd your-project
lumiko init        # creates .lumiko/config.yaml
lumiko generate    # generates docs/
```

That's it. Your `docs/` folder now has:

| File | What it is |
|------|-----------|
| `README.md` | Project overview, install instructions, usage |
| `architecture.md` | System design, Mermaid diagrams, module breakdown |
| `api.md` | Exported functions, types, signatures, examples |
| `context.json` | AI-optimized — every file mapped with purpose, exports, and function signatures |

## The `context.json`

This is what makes Lumiko different. It's not just human docs — it produces a structured JSON file designed for AI agents:

```json
{
  "project": {
    "name": "your-project",
    "summary": "What this project does",
    "language": "TypeScript",
    "runtime": "Node.js 18+"
  },
  "architecture": {
    "pattern": "How the system is structured",
    "entryPoints": ["src/index.ts"],
    "dataFlow": "How data moves through the system"
  },
  "files": [
    {
      "path": "src/core/engine.ts",
      "purpose": "Main processing engine",
      "exports": ["Engine", "createEngine"],
      "keyFunctions": [
        { "name": "process", "signature": "process(input: Input): Output" }
      ]
    }
  ],
  "quickReference": {
    "commands": { "build": "npm run build", "test": "npm test" },
    "envVars": ["API_KEY", "DATABASE_URL"]
  }
}
```

Drop this into any agent's context and it instantly understands your codebase without reading every file.

## CLI

```bash
lumiko init                        # set up config
lumiko init --force                # overwrite existing config

lumiko generate                    # generate docs (asks for confirmation)
lumiko generate -y                 # skip confirmation
lumiko generate --dry-run          # preview without calling Claude
lumiko generate --backend api      # use Anthropic API instead of Claude Code
lumiko generate --verbose          # show raw Claude output for debugging
```

## Configuration

After `lumiko init`, edit `.lumiko/config.yaml`:

```yaml
version: 1

project:
  name: my-project
  description: "Optional description"

# what to scan
include:
  - "src/**/*"
  - "lib/**/*"
  - "*.ts"

# what to skip
exclude:
  - "node_modules/**"
  - "dist/**"
  - "**/*.test.ts"

output:
  directory: docs
  formats:
    - markdown   # README, architecture, api
    - context    # context.json for AI agents

docs:
  readme: true
  architecture: true
  api: true
  diagrams: true

claude:
  backend: claude-code   # or "api" (requires ANTHROPIC_API_KEY)
  model: claude-sonnet-4-20250514
  maxTokens: 8192
```

## Backends

| Backend | How it works | What you need |
|---------|-------------|---------------|
| `claude-code` (default) | Runs `claude --print` under the hood | [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed |
| `api` | Calls the Anthropic API directly | `ANTHROPIC_API_KEY` env var |

Claude Code uses your existing subscription — no extra API costs.

## Requirements

- Node.js 18+
- Claude Code CLI (`npm i -g @anthropic-ai/claude-code`) or an Anthropic API key

## License

MIT

---

Built by [Mirako Studio](https://mirako.computer)
