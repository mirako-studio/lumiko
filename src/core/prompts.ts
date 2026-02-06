import type { LumikoConfig, ScannedFile } from '../types/index.js';
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
 * Short instruction for context.json generation (claude-code backend).
 */
export function buildContextInstruction(): string {
  return [
    'You are Lumiko. The codebase is provided via stdin.',
    'Analyze it and respond with ONLY a single valid JSON object — no markdown, no explanation, no code fences.',
    'Follow the exact schema shown in the stdin context.',
  ].join(' ');
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
 * Build the prompt for context.json generation (separate call).
 * The prompt asks for pure JSON output — no markdown, no delimiters.
 */
export function buildContextPrompt(
  files: ScannedFile[],
  projectName: string,
  config: LumikoConfig,
): string {
  const fileTree = buildFileTree(files);
  const fileContents = formatFileContents(files);

  const fileList = files.map(f => `  - ${f.path} (${f.lines} lines)`).join('\n');

  return `## PROJECT INFORMATION

**Project Name:** ${projectName}
**Description:** ${config.project.description || 'Not provided'}

## PROJECT STRUCTURE

\`\`\`
${fileTree}\`\`\`

## FILE LIST

${fileList}

## SOURCE FILES

${fileContents}

---

## YOUR TASK

Analyze this codebase and produce a single JSON object that gives an AI agent everything it needs to understand this project without reading the source files. This is meant to be consumed by LLMs and coding agents, NOT humans.

Respond with ONLY valid JSON — no markdown, no code fences, no explanation before or after.

Use this exact schema:

{
  "project": {
    "name": "${projectName}",
    "summary": "One paragraph describing what this project does and why",
    "language": "Primary programming language",
    "runtime": "Runtime/platform (e.g. Node.js 18+, Python 3.11+)",
    "framework": "Main framework if any, or null",
    "packageManager": "npm/yarn/pnpm/pip/etc"
  },
  "architecture": {
    "pattern": "Brief description of the architectural pattern (e.g. CLI pipeline, MVC, microservices)",
    "entryPoints": ["path/to/main/entry"],
    "keyModules": [
      {
        "path": "path/to/module",
        "purpose": "What this module does in one sentence",
        "exports": ["ExportedName1", "ExportedName2"]
      }
    ],
    "dataFlow": "Describe how data moves through the system in 1-2 sentences"
  },
  "files": [
    {
      "path": "path/to/file",
      "purpose": "What this file does",
      "exports": ["exported", "symbols"],
      "dependencies": ["./relative/imports", "external-packages"],
      "keyFunctions": [
        {
          "name": "functionName",
          "purpose": "What it does",
          "signature": "functionName(param: Type): ReturnType"
        }
      ]
    }
  ],
  "dependencies": {
    "production": {
      "package-name": "What it's used for in this project"
    },
    "development": {
      "package-name": "What it's used for"
    }
  },
  "conventions": {
    "config": "Where config files live and what format",
    "output": "Where output/artifacts go",
    "testing": "Test framework and patterns, or null",
    "buildTool": "Build tool used"
  },
  "quickReference": {
    "commands": {
      "build": "command to build",
      "dev": "command for dev mode",
      "test": "command to run tests"
    },
    "envVars": ["REQUIRED_ENV_VAR_1"],
    "importantPaths": {
      "config": "path/to/config",
      "types": "path/to/types",
      "entry": "path/to/entry"
    }
  }
}

Respond with ONLY the JSON. No other text.`;
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
