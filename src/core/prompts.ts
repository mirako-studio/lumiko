import type { LumikoConfig, ScannedFile, ChunkAnalysis } from '../types/index.js';
import { buildFileTree } from './scanner.js';

/**
 * The short instruction prompt passed as the -p argument to claude.
 * This tells Claude what to do with the codebase context piped via stdin.
 */
export function buildClaudeCodeInstruction(): string {
  return [
    'You are Lumiko, an expert documentation generator.',
    'The codebase context is provided via stdin above.',
    'Analyze the code and generate documentation using the EXACT delimiter format shown in the context.',
    'You MUST wrap each section with its delimiter markers (e.g. ---README_START--- and ---README_END---).',
    'Generate ALL requested sections now.',
  ].join(' ');
}

/**
 * Short instruction for .context/ bundle generation (claude-code backend).
 */
export function buildContextInstruction(): string {
  return [
    'You are Lumiko. The codebase is provided via stdin.',
    'Analyze it and generate a multi-file .context/ bundle using the EXACT ---FILE:<path>--- delimiters shown in the context.',
    'Each JSON file must be valid JSON. Each markdown file is raw markdown.',
    'No preamble, no explanation — just emit the files.',
  ].join(' ');
}

// ── Module grouping helper ──────────────────────────────────────────────

/**
 * Derive a module key from a file path. The key is used as the module's
 * filename inside the .context/modules/ directory.
 *
 * - "src/core/chunker.ts"     -> "src-core"
 * - "src/index.ts"            -> "src"
 * - "package.json"            -> "_root"
 */
export function getModuleKey(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  const dirParts = parts.slice(0, -1);
  if (dirParts.length === 0) return '_root';
  return dirParts.join('-');
}

/** Convert a module key back to a display path (e.g. "src-core" -> "src/core/"). */
export function getModuleDisplayPath(moduleKey: string): string {
  if (moduleKey === '_root') return '(root)';
  return moduleKey.replace(/-/g, '/') + '/';
}

/** Group scanned files by their immediate parent directory. */
export function groupFilesByModule(files: ScannedFile[]): Map<string, ScannedFile[]> {
  const groups = new Map<string, ScannedFile[]>();
  for (const file of files) {
    const key = getModuleKey(file.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(file);
  }
  return groups;
}

/** Group file paths (strings) by their immediate parent directory. */
export function groupPathsByModule(paths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const key = getModuleKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return groups;
}

/**
 * Build the codebase context for markdown doc generation.
 * For claude-code: piped via stdin.
 * For API: used as the user message.
 */
export function buildCodebaseContext(
  files: ScannedFile[],
  projectName: string,
  config: LumikoConfig,
): string {
  const fileTree = buildFileTree(files);
  const fileContents = formatFileContents(files);

  const sections: string[] = [];

  if (config.docs.readme) {
    sections.push(`### 1. README.md
Create a comprehensive README that includes:
- Project title and description
- Key features (bullet points)
- Installation instructions
- Quick start / usage examples
- Project structure overview
- Contributing guidelines placeholder
- License placeholder

Output format:
---README_START---
[Your README.md content here]
---README_END---`);
  }

  if (config.docs.architecture) {
    sections.push(`### 2. architecture.md
Create an architecture document that includes:
- System overview
- Component diagram (use Mermaid syntax)
- Key modules and their responsibilities
- Data flow explanation
- External dependencies
- Design decisions (if apparent from code)

Output format:
---ARCHITECTURE_START---
[Your architecture.md content here]
---ARCHITECTURE_END---`);
  }

  if (config.docs.api) {
    sections.push(`### 3. api.md
Create API documentation that includes:
- All exported functions/classes/modules
- Parameters and return types
- Usage examples for key functions
- Error handling patterns
- Type definitions

Output format:
---API_START---
[Your api.md content here]
---API_END---`);
  }

  return `## PROJECT INFORMATION

**Project Name:** ${projectName}
**Description:** ${config.project.description || 'Not provided'}

## PROJECT STRUCTURE

\`\`\`
${fileTree}\`\`\`

## SOURCE FILES

${fileContents}

---

## YOUR TASK

You are Lumiko, an expert documentation generator. Analyze this codebase and generate comprehensive, high-quality documentation.

Generate the following documentation files. You MUST use the EXACT delimiters shown below to wrap each section. This is critical — the output is machine-parsed.

${sections.join('\n\n')}

## GUIDELINES

1. **Be accurate** - Only document what's actually in the code
2. **Be concise** - Developers skim, so make it scannable
3. **Use examples** - Show, don't just tell
4. **Mermaid diagrams** - Use for architecture visualization
5. **Assume intelligence** - Write for experienced developers
6. **No fluff** - Skip generic placeholder content
7. **CRITICAL** - You MUST use the exact delimiters (e.g. ---README_START--- and ---README_END---) around each section

Generate the documentation now:`;
}

/**
 * Build the prompt for .context/ bundle generation (single-shot mode).
 *
 * Produces multiple files in one Claude call, separated by ---FILE:<path>--- markers.
 * Files: overview.json, architecture.json, conventions.md, commands.json,
 * and one modules/<key>.json per directory grouping.
 */
export function buildContextPrompt(
  files: ScannedFile[],
  projectName: string,
  config: LumikoConfig,
): string {
  const fileTree = buildFileTree(files);
  const fileContents = formatFileContents(files);
  const modules = groupFilesByModule(files);

  const moduleInstructions = Array.from(modules.entries())
    .map(([key, moduleFiles]) => {
      const display = getModuleDisplayPath(key);
      const fileLines = moduleFiles.map(f => `  - ${f.path}`).join('\n');
      return `  • \`modules/${key}.json\` — module at \`${display}\` containing:\n${fileLines}`;
    })
    .join('\n');

  return `## PROJECT INFORMATION

**Project Name:** ${projectName}
**Description:** ${config.project.description || 'Not provided'}

## PROJECT STRUCTURE

\`\`\`
${fileTree}\`\`\`

## SOURCE FILES

${fileContents}

---

## YOUR TASK

Analyze this codebase and produce a structured **.context/ bundle** — a collection
of files designed to be loaded by AI coding agents (Claude Code, Cursor, Copilot,
custom RAG pipelines) so they can work on this codebase without re-reading every
source file.

You will emit multiple files in a SINGLE response. Use the EXACT delimiter format:

\`\`\`
---FILE:<relative-path>---
<file content>
\`\`\`

DO NOT wrap file contents in markdown code fences. Emit raw JSON for .json files
and raw markdown for .md files. No preamble, no explanation, no text outside the
delimiters.

## FILES TO GENERATE

You must generate ALL of the following files:

### 1. \`overview.json\`
Project-level summary optimized for fast agent onboarding.
\`\`\`
{
  "name": "${projectName}",
  "summary": "One paragraph: what this project does and the problem it solves.",
  "purpose": "Who uses this and why — one sentence.",
  "stack": {
    "language": "Primary language (e.g. typescript, python, go)",
    "runtime": "e.g. node-18, python-3.11, bun, deno",
    "framework": "Main framework or null",
    "packageManager": "npm | pnpm | yarn | pip | cargo | ...",
    "buildTool": "e.g. tsup, vite, webpack, or null"
  },
  "entryPoints": ["path/to/entry.ts"]
}
\`\`\`

### 2. \`architecture.json\`
High-level system design.
\`\`\`
{
  "pattern": "CLI pipeline | MVC | event-driven | ... (one-liner)",
  "layers": ["CLI", "Core logic", "Backend clients", ...],
  "dataFlow": "One paragraph describing how data moves through the system.",
  "modules": [
    {
      "name": "src/core",
      "path": "src/core/",
      "purpose": "One-sentence description",
      "file": "modules/src-core.json"
    }
  ],
  "diagrams": {
    "mermaid": "graph TD\\n  A[CLI] --> B[Scanner]\\n  ..."
  }
}
\`\`\`

### 3. \`conventions.md\`
Coding conventions and patterns used in this project. Raw markdown.
Cover: code style, naming, module organization, error handling, testing approach,
how to add new features following existing patterns.

### 4. \`commands.json\`
All commands an agent needs to build, test, and run this project.
\`\`\`
{
  "install": "npm install",
  "build": "npm run build",
  "dev": "npm run dev",
  "test": "npm test",
  "lint": "npm run lint",
  "custom": { "name": "command" },
  "envVars": [
    { "name": "API_KEY", "required": true, "purpose": "..." }
  ]
}
\`\`\`
Use \`null\` for any command that doesn't apply.

### 5. Module files — one per directory
Generate one file per module listed below. Each file describes the files in
that module in detail so agents can load just what they need.

${moduleInstructions}

Schema for each module file:
\`\`\`
{
  "path": "src/core/",
  "purpose": "What this module does — 1-2 sentences.",
  "files": [
    {
      "path": "src/core/chunker.ts",
      "purpose": "What this file does.",
      "exports": ["buildChunkPlan", "Chunk"],
      "dependencies": ["./types", "external-package"],
      "keyFunctions": [
        {
          "name": "buildChunkPlan",
          "signature": "buildChunkPlan(files: ScannedFile[]): ChunkPlan",
          "purpose": "What it does in one sentence."
        }
      ]
    }
  ]
}
\`\`\`

## GUIDELINES

1. **Be accurate** — only describe what's actually in the code.
2. **Be concise** — this is for AI agents; dense information beats prose.
3. **Use real types and signatures** — copy them from the source.
4. **No placeholders** — skip fields that don't apply rather than inventing content.
5. **No prose in JSON** — use the schema exactly, don't add commentary fields.
6. **Emit raw content** — NO markdown code fences around JSON or markdown files.
7. **CRITICAL** — you MUST use \`---FILE:<path>---\` delimiters around EVERY file.

Generate the bundle now:`;
}

/**
 * Build a single combined prompt for the API backend (markdown docs).
 */
export function buildApiPrompt(
  files: ScannedFile[],
  projectName: string,
  config: LumikoConfig,
): string {
  return buildCodebaseContext(files, projectName, config);
}

// ── Chunking prompts ────────────────────────────────────────────────────

/**
 * Instruction for chunk analysis (claude-code backend).
 */
export function buildChunkAnalysisInstruction(): string {
  return [
    'You are Lumiko, an expert code analyst.',
    'A chunk of source files is provided via stdin.',
    'Analyze them and respond using the EXACT delimiter format shown in the context.',
    'This is one chunk of a larger codebase — be thorough but focused on what you see.',
  ].join(' ');
}

/**
 * Build the prompt for analyzing a single chunk of files.
 * Used in the "map" phase — each chunk is analyzed independently.
 */
export function buildChunkAnalysisPrompt(
  files: ScannedFile[],
  chunkLabel: string,
  projectName: string,
): string {
  const fileContents = formatFileContents(files);
  const fileList = files.map(f => `  - ${f.path} (${f.lines} lines)`).join('\n');

  return `## CHUNK ANALYSIS

**Project:** ${projectName}
**Chunk:** ${chunkLabel}
**Files in this chunk:** ${files.length}

## FILE LIST

${fileList}

## SOURCE FILES

${fileContents}

---

## YOUR TASK

Analyze this chunk of the codebase and produce a structured analysis. This will be combined with analyses of other chunks to generate final documentation.

You MUST use the EXACT delimiters shown below. This is machine-parsed.

### 1. Summary
A concise overview of what this chunk contains — its purpose, key responsibilities, and how it fits into a larger system.

---CHUNK_SUMMARY_START---
[Your summary here — 2-4 paragraphs]
---CHUNK_SUMMARY_END---

### 2. Exports
List all exported functions, classes, types, interfaces, and constants. One per line, with a brief description.

---CHUNK_EXPORTS_START---
[List of exports, e.g.:
- \`functionName(param: Type): ReturnType\` — Description
- \`ClassName\` — Description
- \`TypeName\` — Description]
---CHUNK_EXPORTS_END---

### 3. Architecture Notes
Describe the architectural patterns, design decisions, module relationships, and data flow visible in this chunk.

---CHUNK_ARCHITECTURE_START---
[Architecture notes — patterns, relationships, data flow]
---CHUNK_ARCHITECTURE_END---

### 4. API Signatures
Document all public API surfaces with full signatures, parameters, return types, and brief usage notes.

---CHUNK_API_START---
[Detailed API signatures and documentation]
---CHUNK_API_END---

Generate the analysis now:`;
}

/**
 * Instruction for synthesis (claude-code backend).
 */
export function buildSynthesisInstruction(): string {
  return [
    'You are Lumiko, an expert documentation generator.',
    'Chunk analyses of a codebase are provided via stdin.',
    'Synthesize them into final documentation using the EXACT delimiter format shown.',
    'You MUST wrap each section with its delimiter markers.',
  ].join(' ');
}

/**
 * Build the synthesis prompt — combines all chunk analyses into final documentation.
 * Used in the "reduce" phase.
 */
export function buildSynthesisPrompt(
  analyses: ChunkAnalysis[],
  projectName: string,
  config: LumikoConfig,
  allFiles: ScannedFile[],
): string {
  const fileTree = buildFileTree(allFiles);

  const analysisText = analyses
    .map((a) => {
      return `### Chunk ${a.index + 1}: ${a.label}
**Files:** ${a.files.join(', ')}

**Summary:**
${a.summary}

**Exports:**
${a.exports.join('\n')}

**Architecture Notes:**
${a.architectureNotes}

**API Signatures:**
${a.apiSignatures}`;
    })
    .join('\n\n---\n\n');

  const sections: string[] = [];

  if (config.docs.readme) {
    sections.push(`### 1. README.md
Create a comprehensive README that includes:
- Project title and description
- Key features (bullet points)
- Installation instructions
- Quick start / usage examples
- Project structure overview
- Contributing guidelines placeholder
- License placeholder

Output format:
---README_START---
[Your README.md content here]
---README_END---`);
  }

  if (config.docs.architecture) {
    sections.push(`### 2. architecture.md
Create an architecture document that includes:
- System overview
- Component diagram (use Mermaid syntax)
- Key modules and their responsibilities
- Data flow explanation
- External dependencies
- Design decisions (if apparent from the analyses)

Output format:
---ARCHITECTURE_START---
[Your architecture.md content here]
---ARCHITECTURE_END---`);
  }

  if (config.docs.api) {
    sections.push(`### 3. api.md
Create API documentation that includes:
- All exported functions/classes/modules (gathered from all chunks)
- Parameters and return types
- Usage examples for key functions
- Error handling patterns
- Type definitions

Output format:
---API_START---
[Your api.md content here]
---API_END---`);
  }

  return `## PROJECT INFORMATION

**Project Name:** ${projectName}
**Description:** ${config.project.description || 'Not provided'}
**Total chunks analyzed:** ${analyses.length}

## PROJECT STRUCTURE

\`\`\`
${fileTree}\`\`\`

## CHUNK ANALYSES

The following are individual analyses of different parts of the codebase. Use ALL of these to produce comprehensive, unified documentation.

${analysisText}

---

## YOUR TASK

You are Lumiko, an expert documentation generator. You have received analyses of ${analyses.length} chunks of this codebase. Now synthesize them into comprehensive, unified documentation.

Generate the following documentation files. You MUST use the EXACT delimiters shown below to wrap each section. This is critical — the output is machine-parsed.

${sections.join('\n\n')}

## GUIDELINES

1. **Be comprehensive** - Combine information from ALL chunks into a unified view
2. **Be accurate** - Only document what appeared in the chunk analyses
3. **Be concise** - Developers skim, so make it scannable
4. **Use examples** - Show, don't just tell
5. **Mermaid diagrams** - Use for architecture visualization
6. **Assume intelligence** - Write for experienced developers
7. **No fluff** - Skip generic placeholder content
8. **Unify** - Don't reference "chunks" — write as if you analyzed the whole codebase at once
9. **CRITICAL** - You MUST use the exact delimiters (e.g. ---README_START--- and ---README_END---) around each section

Generate the documentation now:`;
}

/**
 * Build the .context/ bundle synthesis prompt from chunk analyses.
 * Used in the "reduce" phase of chunked generation.
 *
 * Produces the same multi-file bundle as buildContextPrompt, but from pre-analyzed
 * chunks instead of raw source files. The module grouping is derived from the full
 * file list so modules are independent of chunk boundaries.
 */
export function buildContextSynthesisPrompt(
  analyses: ChunkAnalysis[],
  projectName: string,
  config: LumikoConfig,
  allFiles: ScannedFile[],
): string {
  const fileTree = buildFileTree(allFiles);
  const modules = groupPathsByModule(allFiles.map(f => f.path));

  const analysisText = analyses
    .map((a) => {
      return `### Chunk ${a.index + 1}: ${a.label}
**Files:** ${a.files.join(', ')}

**Summary:**
${a.summary}

**Exports:**
${a.exports.join('\n')}

**Architecture Notes:**
${a.architectureNotes}

**API Signatures:**
${a.apiSignatures}`;
    })
    .join('\n\n---\n\n');

  const moduleInstructions = Array.from(modules.entries())
    .map(([key, modulePaths]) => {
      const display = getModuleDisplayPath(key);
      const fileLines = modulePaths.map(p => `  - ${p}`).join('\n');
      return `  • \`modules/${key}.json\` — module at \`${display}\` containing:\n${fileLines}`;
    })
    .join('\n');

  return `## PROJECT INFORMATION

**Project Name:** ${projectName}
**Description:** ${config.project.description || 'Not provided'}
**Total chunks analyzed:** ${analyses.length}

## PROJECT STRUCTURE

\`\`\`
${fileTree}\`\`\`

## CHUNK ANALYSES

The following are independent analyses of different parts of the codebase. Use
ALL of these to produce a unified .context/ bundle.

${analysisText}

---

## YOUR TASK

Synthesize these chunk analyses into a structured **.context/ bundle** —
multiple files written using the EXACT delimiter format:

\`\`\`
---FILE:<relative-path>---
<file content>
\`\`\`

DO NOT wrap file contents in markdown code fences. Emit raw JSON for .json files
and raw markdown for .md files. No preamble, no text outside the delimiters.
Do NOT reference "chunks" in your output — write as if you analyzed the whole
codebase at once.

## FILES TO GENERATE

### 1. \`overview.json\`
\`\`\`
{
  "name": "${projectName}",
  "summary": "One paragraph: what this project does and the problem it solves.",
  "purpose": "Who uses this and why — one sentence.",
  "stack": {
    "language": "...",
    "runtime": "...",
    "framework": "... or null",
    "packageManager": "...",
    "buildTool": "... or null"
  },
  "entryPoints": ["path/to/entry"]
}
\`\`\`

### 2. \`architecture.json\`
\`\`\`
{
  "pattern": "e.g. CLI pipeline with map-reduce chunking",
  "layers": ["CLI", "Core logic", ...],
  "dataFlow": "One paragraph on how data moves through the system.",
  "modules": [
    { "name": "src/core", "path": "src/core/", "purpose": "...", "file": "modules/src-core.json" }
  ],
  "diagrams": { "mermaid": "graph TD\\n  ..." }
}
\`\`\`

### 3. \`conventions.md\`
Raw markdown. Cover: code style, naming, module organization, error handling,
testing approach, patterns for adding new features.

### 4. \`commands.json\`
\`\`\`
{
  "install": "npm install",
  "build": "npm run build",
  "dev": "npm run dev",
  "test": "npm test",
  "lint": "npm run lint",
  "custom": { "name": "command" },
  "envVars": [{ "name": "VAR", "required": true, "purpose": "..." }]
}
\`\`\`
Use \`null\` for commands that don't apply.

### 5. Module files — one per directory
Module grouping is by immediate parent directory, NOT by chunk. Produce one file
per module below:

${moduleInstructions}

Schema:
\`\`\`
{
  "path": "src/core/",
  "purpose": "What this module does — 1-2 sentences.",
  "files": [
    {
      "path": "src/core/chunker.ts",
      "purpose": "...",
      "exports": ["..."],
      "dependencies": ["..."],
      "keyFunctions": [
        { "name": "...", "signature": "...", "purpose": "..." }
      ]
    }
  ]
}
\`\`\`

## GUIDELINES

1. **Be accurate** — only include what appeared in the chunk analyses.
2. **Be concise** — dense information beats prose.
3. **Unify** — don't reference "chunks"; write as a coherent whole.
4. **No placeholders** — skip fields that don't apply.
5. **No prose in JSON** — stick to the schema.
6. **Emit raw content** — NO code fences around JSON or markdown files.
7. **CRITICAL** — use \`---FILE:<path>---\` delimiters around EVERY file.

Generate the bundle now:`;
}

/**
 * Instruction for .context/ bundle synthesis (claude-code backend).
 */
export function buildContextSynthesisInstruction(): string {
  return [
    'You are Lumiko. Chunk analyses of a codebase are provided via stdin.',
    'Synthesize them into a multi-file .context/ bundle using the EXACT ---FILE:<path>--- delimiters shown in the context.',
    'Each JSON file must be valid JSON. Each markdown file is raw markdown.',
    'No preamble, no explanation — just emit the files.',
  ].join(' ');
}

// ── Shared helpers ──────────────────────────────────────────────────────

function formatFileContents(files: ScannedFile[]): string {
  return files
    .map((file) => {
      const lang = getLanguageFromExtension(file.extension);
      return `### File: ${file.path}

\`\`\`${lang}
${file.content}
\`\`\``;
    })
    .join('\n\n');
}

function getLanguageFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.java': 'java',
    '.kt': 'kotlin',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.php': 'php',
    '.md': 'markdown',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.sql': 'sql',
    '.sh': 'bash',
    '.bash': 'bash',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.vue': 'vue',
    '.svelte': 'svelte',
  };
  return map[ext] || '';
}
