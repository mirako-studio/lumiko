export type Backend = 'claude-code' | 'api';

/** Identifiers for built-in tooling presets. */
export type PresetName =
  | 'claude-code'
  | 'cursor'
  | 'copilot'
  | 'windsurf'
  | 'agents';

export interface ChunkingConfig {
  /** Enable chunking: true, false, or "auto" (chunk only when needed) */
  enabled: boolean | 'auto';
  /** Max estimated tokens per chunk (default 80_000) */
  maxTokensPerChunk: number;
  /** Total token threshold to trigger auto-chunking (default 100_000) */
  threshold: number;
}

export interface LumikoConfig {
  version: number;
  project: {
    name: string;
    description: string;
  };
  include: string[];
  exclude: string[];
  output: {
    /** Directory for human-facing markdown docs (README.md, architecture.md, api.md) */
    directory: string;
    /** Directory for the AI-readable .context/ bundle (default ".context") */
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
  claude: {
    backend: Backend;
    model: string;
    maxTokens: number;
  };
  chunking: ChunkingConfig;
  /**
   * Tooling presets to generate from the .context/ bundle.
   * Auto-run after `lumiko generate` when non-empty.
   * Run on demand with `lumiko preset <name>`.
   */
  presets: PresetName[];
}

export interface ScannedFile {
  path: string;
  content: string;
  size: number;
  lines: number;
  extension: string;
}

export interface GeneratedDocs {
  readme: string;
  architecture: string;
  api: string;
  /** AI-readable .context/ bundle — multiple files, written to config.output.contextDirectory */
  context: ContextBundle | null;
}

// ── .context/ bundle types ──────────────────────────────────────────────

/**
 * A single file inside the .context/ bundle.
 * Path is relative to the bundle root (e.g. "overview.json", "modules/src-core.json").
 * For JSON files, content is a parsed object. For markdown, it's a raw string.
 */
export interface ContextBundleEntry {
  path: string;
  kind: 'json' | 'markdown';
  content: string | Record<string, unknown>;
}

/**
 * A structured, multi-file bundle of AI-readable context documents.
 * Written to .context/ (or the configured directory).
 */
export interface ContextBundle {
  entries: ContextBundleEntry[];
}

/**
 * Schema for overview.json — high-level project summary.
 */
export interface ContextOverview {
  name: string;
  summary: string;
  purpose: string;
  stack: {
    language: string;
    runtime: string;
    framework: string | null;
    packageManager: string;
    buildTool: string | null;
  };
  entryPoints: string[];
}

/**
 * Schema for architecture.json — system design details.
 */
export interface ContextArchitecture {
  pattern: string;
  layers: string[];
  dataFlow: string;
  modules: Array<{
    name: string;
    path: string;
    purpose: string;
    file: string;
  }>;
  diagrams?: {
    mermaid?: string;
  };
}

/**
 * Schema for commands.json — build, test, dev, lint commands + env vars.
 */
export interface ContextCommands {
  install: string | null;
  build: string | null;
  dev: string | null;
  test: string | null;
  lint: string | null;
  custom: Record<string, string>;
  envVars: Array<{
    name: string;
    required: boolean;
    purpose: string;
  }>;
}

/**
 * Schema for modules/<module>.json — per-directory/module file details.
 */
export interface ContextModule {
  path: string;
  purpose: string;
  files: Array<{
    path: string;
    purpose: string;
    exports: string[];
    dependencies: string[];
    keyFunctions: Array<{
      name: string;
      signature: string;
      purpose: string;
    }>;
  }>;
}

/**
 * Schema for manifest.json — bundle index + metadata (generated locally, not by Claude).
 */
export interface ContextManifest {
  lumiko: {
    version: string;
    generatedAt: string;
    model: string;
  };
  project: {
    name: string;
    summary: string;
  };
  files: Array<{
    path: string;
    description: string;
  }>;
}

/**
 * Per-chunk analysis produced during the "map" phase.
 * Each chunk gets independently analyzed, then results are synthesized.
 */
export interface ChunkAnalysis {
  /** Chunk index */
  index: number;
  /** Chunk label (e.g. "src/core") */
  label: string;
  /** Files included in this chunk */
  files: string[];
  /** Claude's analysis of this chunk */
  summary: string;
  /** Key exports discovered */
  exports: string[];
  /** Architecture notes */
  architectureNotes: string;
  /** API signatures discovered */
  apiSignatures: string;
}

/** Common interface for both backends */
export interface DocGenerator {
  generateDocs(files: ScannedFile[], projectName: string): Promise<GeneratedDocs>;
  generateContext(files: ScannedFile[], projectName: string): Promise<ContextBundle>;
  /** Analyze a single chunk of files — used in the "map" phase of chunked generation */
  analyzeChunk(files: ScannedFile[], chunkLabel: string, projectName: string): Promise<ChunkAnalysis>;
  /** Synthesize chunk analyses into final docs — the "reduce" phase */
  synthesizeDocs(analyses: ChunkAnalysis[], projectName: string, config: LumikoConfig): Promise<GeneratedDocs>;
  /** Synthesize chunk analyses into the .context/ bundle */
  synthesizeContext(analyses: ChunkAnalysis[], files: ScannedFile[], projectName: string, config: LumikoConfig): Promise<ContextBundle>;
}
