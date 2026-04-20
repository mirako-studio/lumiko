# API Reference

Lumiko is primarily a CLI, but its internal modules are structured for reuse. All exports are ESM.

## CLI

```bash
lumiko init [--force]
lumiko generate [--yes] [--dry-run] [--backend <claude-code|api>] [--verbose]
```

## Commands

### `init(options: InitOptions): Promise<void>`

`src/commands/init.ts` — Creates `.lumiko/config.yaml` and `docs/`.

```ts
interface InitOptions { force?: boolean }
```

Exits 1 if config exists and `--force` is not set.

### `generate(options: GenerateOptions): Promise<void>`

`src/commands/generate.ts` — Full pipeline: load config → scan → chunk plan → generate → write.

```ts
interface GenerateOptions {
  yes?: boolean;
  dryRun?: boolean;
  backend?: string;   // "claude-code" | "api"
  verbose?: boolean;
}
```

## Core

### Config — `src/core/config.ts`

```ts
loadConfig(projectPath: string): Promise<LumikoConfig>
createConfig(projectPath: string): Promise<void>
```

`loadConfig` throws `"No config found. Run \"lumiko init\" first."` if `.lumiko/config.yaml` is missing. `createConfig` auto-detects project name from `package.json`.

### Scanner — `src/core/scanner.ts`

```ts
scanProject(projectPath: string, config: LumikoConfig): Promise<ScanResult>
buildFileTree(files: ScannedFile[]): string

interface ScanResult {
  files: ScannedFile[];
  totalSize: number;
  totalLines: number;
}
```

Skips files >100KB and any file containing null bytes. Sorts paths for deterministic output.

### Chunker — `src/core/chunker.ts`

```ts
buildChunkPlan(
  files: ScannedFile[],
  maxTokensPerChunk?: number,   // default 80_000
  chunkingThreshold?: number,   // default 100_000
): ChunkPlan

estimateFileTokens(file: ScannedFile): number
estimateTotalTokens(files: ScannedFile[]): number

interface Chunk {
  index: number;
  label: string;
  files: ScannedFile[];
  estimatedTokens: number;
}

interface ChunkPlan {
  needsChunking: boolean;
  totalTokens: number;
  chunks: Chunk[];
}
```

Token estimate ≈ `content.length / 4 + 50` per file. Groups files by top-level directory, splits oversized groups by budget, merges chunks below 20% of budget.

### Claude factory — `src/core/claude.ts`

```ts
createClient(
  config: LumikoConfig,
  options?: CreateClientOptions,
): Promise<DocGenerator>

interface CreateClientOptions {
  backendOverride?: Backend;
  verbose?: boolean;
}
```

Validates backend prerequisites before returning: throws if `claude` CLI is missing (claude-code) or `ANTHROPIC_API_KEY` is unset (api).

### `ClaudeCodeClient` — `src/core/claude-code.ts`

```ts
class ClaudeCodeClient implements DocGenerator {
  constructor(config: LumikoConfig, verbose?: boolean);
  static check(): Promise<void>;   // throws if CLI not installed
  generateDocs(files, projectName): Promise<GeneratedDocs>;
  generateContext(files, projectName): Promise<ContextBundle>;
  analyzeChunk(files, chunkLabel, projectName): Promise<ChunkAnalysis>;
  synthesizeDocs(analyses, projectName, config): Promise<GeneratedDocs>;
  synthesizeContext(analyses, files, projectName, config): Promise<ContextBundle>;
}
```

Spawns `claude --print --output-format text <instruction>` with codebase content via stdin. 10-minute timeout. On parse failure, writes raw response to `.lumiko/last-*.txt` and throws a diagnostic error. Does not pass `--model`.

### `ClaudeApiClient` — `src/core/claude-api.ts`

```ts
class ClaudeApiClient implements DocGenerator {
  constructor(config: LumikoConfig);   // throws if ANTHROPIC_API_KEY unset
  // same 5 methods as ClaudeCodeClient
}
```

Returns `{ _usage: { inputTokens, outputTokens } }` attached to `GeneratedDocs` for cost reporting.

### Prompts — `src/core/prompts.ts`

```ts
buildClaudeCodeInstruction(): string
buildContextInstruction(): string
buildChunkAnalysisInstruction(): string
buildSynthesisInstruction(): string
buildContextSynthesisInstruction(): string

buildCodebaseContext(files, projectName, config): string
buildContextPrompt(files, projectName, config): string
buildApiPrompt(files, projectName, config): string
buildChunkAnalysisPrompt(files, chunkLabel, projectName): string
buildSynthesisPrompt(analyses, projectName, config, allFiles): string
buildContextSynthesisPrompt(analyses, projectName, config, allFiles): string

getModuleKey(filePath: string): string
getModuleDisplayPath(moduleKey: string): string
groupFilesByModule(files: ScannedFile[]): Map<string, ScannedFile[]>
groupPathsByModule(paths: string[]): Map<string, string[]>
```

`getModuleKey("src/core/chunker.ts") === "src-core"`. Root-level files map to `"_root"`.

### Parse — `src/core/parse.ts`

```ts
parseGeneratedResponse(content: string): GeneratedDocs
isDocsEmpty(docs: GeneratedDocs): boolean

parseChunkAnalysis(content, chunkIndex, chunkLabel, filePaths): ChunkAnalysis
isChunkAnalysisEmpty(analysis: ChunkAnalysis): boolean

parseContextBundle(content: string): {
  bundle: ContextBundle;
  invalidEntries: Array<{ path: string; error: string }>;
}
isBundleEmpty(bundle: ContextBundle): boolean
```

Tolerant to whitespace variants in delimiters and stray code fences around JSON/markdown content. Invalid JSON in a bundle entry is recorded in `invalidEntries` rather than throwing.

### Output — `src/core/output.ts`

```ts
writeOutput(docs: GeneratedDocs, projectPath: string, config: LumikoConfig): Promise<void>
getOutputStats(projectPath: string, config: LumikoConfig): Promise<FileStat[]>

interface FileStat { name: string; size: string }
```

Writes `docs/{README,architecture,api}.md`, the `.context/` bundle, a locally-generated `manifest.json`, and a human-readable `.context/README.md`.

## Types — `src/types/index.ts`

```ts
type Backend = 'claude-code' | 'api';

interface LumikoConfig {
  version: number;
  project: { name: string; description: string };
  include: string[];
  exclude: string[];
  output: {
    directory: string;
    contextDirectory: string;
    formats: ('markdown' | 'context')[];
  };
  docs: {
    readme: boolean;
    architecture: boolean;
    api: boolean;
    dataFlow?: boolean;
    diagrams: boolean;
  };
  claude: { backend: Backend; model: string; maxTokens: number };
  chunking: ChunkingConfig;
}

interface ChunkingConfig {
  enabled: boolean | 'auto';
  maxTokensPerChunk: number;
  threshold: number;
}

interface ScannedFile {
  path: string;
  content: string;
  size: number;
  lines: number;
  extension: string;
}

interface GeneratedDocs {
  readme: string;
  architecture: string;
  api: string;
  context: ContextBundle | null;
}

interface ContextBundleEntry {
  path: string;
  kind: 'json' | 'markdown';
  content: string | Record<string, unknown>;
}

interface ContextBundle { entries: ContextBundleEntry[] }

interface ChunkAnalysis {
  index: number;
  label: string;
  files: string[];
  summary: string;
  exports: string[];
  architectureNotes: string;
  apiSignatures: string;
}

interface DocGenerator {
  generateDocs(files, projectName): Promise<GeneratedDocs>;
  generateContext(files, projectName): Promise<ContextBundle>;
  analyzeChunk(files, chunkLabel, projectName): Promise<ChunkAnalysis>;
  synthesizeDocs(analyses, projectName, config): Promise<GeneratedDocs>;
  synthesizeContext(analyses, files, projectName, config): Promise<ContextBundle>;
}
```

Schema types `ContextOverview`, `ContextArchitecture`, `ContextCommands`, `ContextModule`, `ContextManifest` describe the shape of the files emitted into `.context/`.

## Error Handling

- **Missing config** — `loadConfig` throws `"No config found. Run \"lumiko init\" first."`
- **Missing CLI / API key** — `createClient` throws with installation/setup instructions.
- **Parse failures** — Raw Claude output is saved to `.lumiko/last-response.txt`, `.lumiko/last-context-response.txt`, `.lumiko/last-synthesis-response.txt`, etc. The error message points to the file.
- **Chunk failures during map phase** — Logged as warnings; synthesis proceeds with surviving chunks. Aborts only if zero chunks succeed.
- **Invalid JSON in bundle** — Collected in `invalidEntries`; valid entries are still written.
- **Oversized/binary files** — Silently skipped by scanner.

## Usage Example (Programmatic)

```ts
import { loadConfig } from 'lumiko/core/config.js';
import { scanProject } from 'lumiko/core/scanner.js';
import { buildChunkPlan } from 'lumiko/core/chunker.js';
import { createClient } from 'lumiko/core/claude.js';
import { writeOutput } from 'lumiko/core/output.js';

const config = await loadConfig(process.cwd());
const { files } = await scanProject(process.cwd(), config);
const plan = buildChunkPlan(files, config.chunking.maxTokensPerChunk, config.chunking.threshold);

const client = await createClient(config, { verbose: true });

const docs = plan.needsChunking
  ? await (async () => {
      const analyses = await Promise.all(
        plan.chunks.map(c => client.analyzeChunk(c.files, c.label, config.project.name))
      );
      return client.synthesizeDocs(analyses, config.project.name, config);
    })()
  : await client.generateDocs(files, config.project.name);

await writeOutput(docs, process.cwd(), config);
```
