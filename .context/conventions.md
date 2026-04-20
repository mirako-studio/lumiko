# Conventions

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
