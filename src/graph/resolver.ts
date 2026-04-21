import path from 'path';

/**
 * Resolve an import source string (like "./foo.js" or "commander") to either:
 *   - A project-local file path (for internal imports) — normalized with "/"
 *   - null (for external packages or unresolvable imports)
 *
 * `fromFile` is the file doing the import; we resolve relative paths from its
 * directory. `fileSet` is all project files (normalized with forward slashes).
 *
 * Import style handling:
 *   - ESM TypeScript often writes `./foo.js` that maps to `./foo.ts`
 *   - Directory imports resolve to `index.ts`/`index.js`/`__init__.py`
 *   - Python dot imports: `.foo` → relative to file's package directory
 */
export function resolveImport(
  source: string,
  fromFile: string,
  fileSet: Set<string>,
): string | null {
  const normalizedFrom = normalize(fromFile);

  // Python dot-style relative imports
  if (/^\.+/.test(source) && !source.includes('/') && !source.includes('\\')) {
    const resolved = resolvePythonRelative(source, normalizedFrom, fileSet);
    if (resolved) return resolved;
  }

  // Relative path (TS/JS/ESM)
  if (source.startsWith('./') || source.startsWith('../')) {
    return resolveRelativePath(source, normalizedFrom, fileSet);
  }

  // Absolute path from project root (unusual but supported)
  if (source.startsWith('/')) {
    const trimmed = source.replace(/^\/+/, '');
    const tried = tryCandidates(trimmed, fileSet);
    if (tried) return tried;
  }

  // Everything else is external — or an unresolvable bare specifier.
  return null;
}

/**
 * Extract the package name from a bare specifier.
 *   "commander"                → "commander"
 *   "@anthropic-ai/sdk"        → "@anthropic-ai/sdk"
 *   "@anthropic-ai/sdk/index"  → "@anthropic-ai/sdk"
 *   "lodash/fp"                → "lodash"
 *   "node:fs"                  → "node:fs"
 *   "fs/promises"              → "fs"
 */
export function extractPackageName(source: string): string {
  // Node.js builtin prefix
  if (source.startsWith('node:')) return source;

  const parts = source.split('/');
  if (source.startsWith('@')) {
    // Scoped: "@scope/name[/sub/path]"
    return parts.slice(0, 2).join('/');
  }
  return parts[0];
}

// ── Internal helpers ────────────────────────────────────────────────────

function resolveRelativePath(
  source: string,
  fromFile: string,
  fileSet: Set<string>,
): string | null {
  const fromDir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(fromDir, source));
  return tryCandidates(joined, fileSet);
}

function resolvePythonRelative(
  source: string,
  fromFile: string,
  fileSet: Set<string>,
): string | null {
  const dots = source.match(/^\.+/)?.[0] ?? '';
  const levels = dots.length;
  const rest = source.slice(levels);

  // Walk up (levels - 1) directories from the file's dir
  const fromDir = path.posix.dirname(fromFile);
  const parts = fromDir.split('/');
  const up = parts.slice(0, Math.max(0, parts.length - (levels - 1)));
  const moduleRelPath = rest.replace(/\./g, '/');
  const base = [...up, moduleRelPath].filter(Boolean).join('/');
  return tryCandidates(base, fileSet);
}

/**
 * Given a base path with no extension, try all reasonable candidates
 * (with extensions, with index, with .js→.ts mapping) and return the first
 * that exists in fileSet.
 */
function tryCandidates(base: string, fileSet: Set<string>): string | null {
  if (!base) return null;

  const candidates: string[] = [];

  // Exact match first
  candidates.push(base);

  // ESM quirk: ./foo.js often means ./foo.ts after compile
  if (base.endsWith('.js')) {
    candidates.push(base.replace(/\.js$/, '.ts'));
    candidates.push(base.replace(/\.js$/, '.tsx'));
    candidates.push(base.replace(/\.js$/, '.mts'));
  }

  // Bare extensions
  const exts = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py'];
  for (const ext of exts) {
    candidates.push(base + ext);
  }

  // index / __init__
  const indexes = [
    '/index.ts', '/index.tsx', '/index.mts', '/index.cts',
    '/index.js', '/index.jsx', '/index.mjs', '/index.cjs',
    '/__init__.py',
  ];
  for (const idx of indexes) {
    candidates.push(base + idx);
  }

  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }

  return null;
}

/** Normalize backslashes to forward slashes for cross-platform consistency. */
export function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}
