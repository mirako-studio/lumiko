# lumiko

This file is read by Claude Code at the start of every session. It mirrors the `.context/` bundle — the source of truth for project context. For per-file details, load `.context/modules/<module>.json`.

## Overview

Lumiko is a CLI tool that auto-generates documentation from a codebase by delegating analysis to Claude. It scans source files, optionally chunks them when the codebase is large, sends them to Claude (via the Claude Code CLI or Anthropic API), and writes both human-facing markdown docs (README.md, architecture.md, api.md) and a machine-readable .context/ bundle for AI coding agents.

**Purpose:** Developers who want up-to-date documentation and an AI-readable project context bundle without writing it by hand.

## Stack

- **Language:** typescript
- **Runtime:** node-18
- **Build tool:** tsup
- **Package manager:** npm
- **Entry points:** `src/index.ts`

## Commands

- **Install:** `npm install`
- **Build:** `npm run build`

### Custom scripts

- `init` → `lumiko init`
- `generate` → `lumiko generate`
- `generate:dry` → `lumiko generate --dry-run`
- `generate:verbose` → `lumiko generate --verbose`
- `generate:api` → `lumiko generate --backend api`

### Environment variables

- `ANTHROPIC_API_KEY` *(optional)* — Required only when using the `api` backend. Format: sk-ant-xxxxx. Not needed for the default `claude-code` backend which uses the user's Claude Code subscription.

## Architecture

**Pattern:** CLI pipeline with optional map-reduce chunking

**Layers:** `CLI (commander entry + commands)` → `Core pipeline (scanner, chunker, prompts, parser, output)` → `Backend clients (Claude Code CLI, Anthropic API)` → `Types`

**Data flow:**

The CLI entry (src/index.ts) dispatches to init or generate. generate loads config, scans the project into ScannedFile[], builds a ChunkPlan, and creates a DocGenerator backend (Claude Code CLI or Anthropic API). If chunking is needed it runs a map-reduce pipeline: each chunk is analyzed into a ChunkAnalysis, then analyses are synthesized into markdown docs and a ContextBundle. Otherwise a single-shot pipeline calls generateDocs/generateContext directly. Claude responses are parsed via delimiter-based extractors (---README_START---, ---FILE:<path>---, ---CHUNK_*_START---) and written to the output directory and .context/ bundle, with a locally generated manifest.json.

### Modules

- **src** (`src/`) — CLI entry point wiring commander to init and generate commands.
- **src/commands** (`src/commands/`) — Command handlers for `lumiko init` and `lumiko generate`.
- **src/core** (`src/core/`) — Core pipeline: config, scanning, chunking, prompt building, response parsing, backend clients, and output writing.
- **src/types** (`src/types/`) — Shared TypeScript types for config, scanned files, chunk analyses, and context bundles.
- **(root)** (`./`) — Project root configuration (tsup build config).

### Diagram

```mermaid
graph TD
  A[CLI src/index.ts] --> B[generate command]
  A --> C[init command]
  B --> D[loadConfig]
  B --> E[scanProject]
  E --> F[ScannedFile[]]
  F --> G[buildChunkPlan]
  B --> H[createClient]
  H --> I[ClaudeCodeClient]
  H --> J[ClaudeApiClient]
  G -->|chunked| K[analyzeChunk per chunk]
  K --> L[synthesizeDocs / synthesizeContext]
  G -->|single-shot| M[generateDocs / generateContext]
  L --> N[parseGeneratedResponse / parseContextBundle]
  M --> N
  N --> O[writeOutput]
  O --> P[docs/*.md]
  O --> Q[.context/ bundle + manifest.json]
```

## Conventions

## Language & Module System
- TypeScript targeting Node 18, ESM modules (`"type": "module"` implied).
- Imports use explicit `.js` extensions on relative paths (ESM requirement): `import { x } from './foo.js'`.
- Type-only imports use `import type { ... }`.
- Built with `tsup` (see `tsup.config.ts`) — single ESM entry, DTS output, shebang banner for CLI.

## File & Module Organization
- `src/index.ts` — CLI entry (commander wiring only, no logic).
- `src/commands/` — one file per CLI subcommand; exports a single async function matching the command name.
- `src/core/` — pure pipeline logic, one concern per file (`scanner`, `chunker`, `parse`, `prompts`, `output`, `config`, `claude`, `claude-code`, `claude-api`).
- `src/types/index.ts` — single barrel of shared types; no runtime code.
- All user-facing paths reference `.lumiko/config.yaml` (config) and `.context/` / `docs/` (outputs).

## Naming
- Files: kebab-case (`claude-code.ts`, `claude-api.ts`).
- Types & interfaces: PascalCase (`LumikoConfig`, `ScannedFile`, `ChunkAnalysis`).
- Functions & variables: camelCase.
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants (`DEFAULT_CONFIG`, `MAX_FILE_SIZE`, `LUMIKO_VERSION`).
- Delimiter strings use the pattern `---SECTION_START---` / `---SECTION_END---` and `---FILE:<path>---`.

## Backends & Polymorphism
- Both backends implement the `DocGenerator` interface from `src/types/index.ts`.
- A factory (`createClient` in `src/core/claude.ts`) picks the backend based on config + CLI override and validates prerequisites (CLI installed / API key set) before returning.
- To add a backend: implement `DocGenerator`, extend the `Backend` type, and wire it into `createClient`.

## Prompting
- All Claude prompts are centralized in `src/core/prompts.ts`. Never inline prompts in backend clients.
- Each prompt has a short `buildXxxInstruction()` (used as the Claude Code CLI `-p` argument) and a long `buildXxxPrompt()` (used as stdin / API user message).
- Prompts must emit strict delimiter formats (`---README_START---`, `---FILE:<path>---`, etc.) because responses are machine-parsed.

## Parsing
- All response parsing lives in `src/core/parse.ts`. Parsers are defensive: they tolerate stray markdown code fences, extra whitespace, and invalid JSON (recorded in `invalidEntries`, not thrown).
- Each parser has a matching `isXxxEmpty()` helper used by callers to decide whether to fail / save debug output.

## Error Handling
- User-facing errors (missing config, missing CLI, missing API key, parse failure) use multi-line messages with remediation hints.
- On parse failure, Claude's raw response is saved to `.lumiko/last-*-response.txt` for debugging.
- Chunk analysis failures are non-fatal — the pipeline logs and continues so partial analyses can still be synthesized.
- Avoid `try/catch` around internal calls where errors are already meaningful; let them propagate.

## CLI UX
- Use `ora` spinners for each phase (`spinner.start` → `spinner.succeed`/`fail`/`warn`).
- Use `chalk` for color: `bold` for headings, `dim` for metadata, `cyan` for emphasis, `yellow` for warnings, `red` for errors, `green` for success checkmarks (`\u2713`).
- Use `prompts` for confirmations; honor `--yes` to skip.
- Honor `--dry-run` to print planned outputs without calling Claude.
- Honor `--verbose` to log prompt sizes and raw Claude output.

## Config
- Config is YAML at `.lumiko/config.yaml`, loaded via `js-yaml`, deep-merged with `DEFAULT_CONFIG` in `src/core/config.ts`.
- New config fields: add to `LumikoConfig` in `src/types/index.ts` AND to `DEFAULT_CONFIG`. Respect deep-merge semantics (objects merge, arrays/scalars replace).

## Paths
- File paths from the scanner are relative and may use either `/` or `\` depending on platform. Helpers (`getModuleKey`, `groupByDirectory`) split on `/[/\\]/` to stay cross-platform.
- Output paths are always joined via `path.join` on `projectPath`.

## Testing
- No test suite is currently present. If adding tests, prefer `vitest` given the ESM + TypeScript setup.

## Adding a New Feature
- New CLI command: add a file under `src/commands/`, export an async function, register it in `src/index.ts`.
- New doc artifact: add a prompt builder in `prompts.ts`, a parser in `parse.ts`, a `DocGenerator` method in both backends, and a write step in `output.ts`.
- New config field: update `LumikoConfig` type, `DEFAULT_CONFIG`, and surface it in the relevant pipeline step.

## Comments
- Minimal comments — types and names carry the meaning. Use block comments only for non-obvious invariants (e.g. why `--model` is not passed to `claude`).

## File Map

### `./`

Project root configuration files.

- `tsup.config.ts` — tsup build config: single ESM entry (src/index.ts), Node 18 target, DTS output, sourcemaps, and a #!/usr/bin/env node shebang banner for the CLI.

### `src/`

CLI entry point. Wires commander to the init and generate subcommands; contains no business logic.

- `src/index.ts` — Defines the `lumiko` CLI with commander and registers the `init` and `generate` commands.

### `src/commands/`

CLI subcommand handlers. Each file exports the async function invoked by commander for one subcommand.

- `src/commands/generate.ts` — Orchestrates the full generate pipeline: load config, scan project, plan chunks, create backend client, run standard or chunked pipeline, and write outputs.
- `src/commands/init.ts` — Creates `.lumiko/config.yaml` and the `docs/` directory for a new project.

### `src/core/`

Core pipeline logic: configuration, file scanning, chunk planning, prompt construction, response parsing, backend clients for Claude, and output writing.

- `src/core/chunker.ts` — Groups scanned files into token-budgeted chunks for map-reduce generation on large codebases.
- `src/core/claude-api.ts` — Anthropic SDK-backed DocGenerator; sends prompts to the Claude Messages API and parses the responses.
- `src/core/claude-code.ts` — Claude Code CLI-backed DocGenerator; spawns the `claude` binary with --print, pipes prompt via stdin, and parses the text output. Intentionally omits --model to avoid empty responses with large stdin.
- `src/core/claude.ts` — Factory that picks and validates the DocGenerator backend (claude-code or api) based on config and CLI override.
- `src/core/config.ts` — Loads, creates, and deep-merges `.lumiko/config.yaml` with sensible defaults; detects project name from package.json.
- `src/core/output.ts` — Writes generated markdown docs and the .context/ bundle to disk, generates manifest.json locally, and reports output stats.
- `src/core/parse.ts` — Defensive parsers for Claude responses: markdown doc sections, chunk analyses, and multi-file .context/ bundles with ---FILE:<path>--- delimiters.
- `src/core/prompts.ts` — Central prompt builders for both backends: short CLI instructions and long stdin/API prompts for docs, context bundles, chunk analysis, and synthesis.
- `src/core/scanner.ts` — Walks the project using include/exclude globs, reads files under 100KB, skips binaries, and builds a file tree string.

### `src/types/`

Single barrel of shared TypeScript types used across CLI, core pipeline, and backend clients. No runtime code.

- `src/types/index.ts` — Defines LumikoConfig, ScannedFile, GeneratedDocs, ChunkAnalysis, ContextBundle and related schemas, plus the DocGenerator interface that both backends implement.

---

_This file was generated by [Lumiko](https://github.com/mirako-dev/lumiko) from the `.context/` bundle._
_Do not edit by hand — re-run `lumiko preset` to regenerate._
