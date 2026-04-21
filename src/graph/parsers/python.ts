import type { RawImport } from './index.js';

/**
 * Regex-based extractor for Python imports.
 *
 * Handles:
 *   - import foo
 *   - import foo, bar
 *   - import foo as f
 *   - from foo import bar
 *   - from foo import bar, baz
 *   - from foo import bar as b
 *   - from foo import *
 *   - from . import foo               → source = "."
 *   - from .foo import bar            → source = ".foo"
 *   - from ..foo.bar import baz       → source = "..foo.bar"
 *
 * Does NOT parse conditional / runtime imports inside try/except blocks —
 * they still show up in the graph because we don't need to know if they
 * execute, just that the file references the module.
 */
export function parsePython(content: string): RawImport[] {
  const out: RawImport[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const stripped = stripCommentsAndStrings(line);

    // `from X import Y, Z`  (possibly with `as` aliases)
    const fromMatch = stripped.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
    if (fromMatch) {
      const source = fromMatch[1];
      const rest = fromMatch[2].trim();

      if (rest === '*') {
        out.push({ source, symbols: ['*'], style: 'namespace', line: lineNum });
      } else {
        const symbols = parseSymbolList(rest);
        out.push({
          source,
          symbols,
          style: symbols.length > 0 ? 'named' : 'unknown',
          line: lineNum,
        });
      }
      continue;
    }

    // `import X, Y as Y2, Z`
    const importMatch = stripped.match(/^\s*import\s+(.+)$/);
    if (importMatch) {
      const rest = importMatch[1].trim();
      // Each module is a separate import
      for (const part of rest.split(',')) {
        const p = part.trim();
        if (!p) continue;
        const asMatch = p.match(/^([.\w]+)(?:\s+as\s+\w+)?$/);
        if (!asMatch) continue;
        out.push({
          source: asMatch[1],
          symbols: [],
          style: 'default',
          line: lineNum,
        });
      }
    }
  }

  return out;
}

/**
 * Parse the symbol list from a `from X import ...` statement.
 * Handles parenthesized lists (including multi-line if collapsed already).
 */
function parseSymbolList(rest: string): string[] {
  // Strip trailing parens, backslash continuations, and inline comments.
  let cleaned = rest.replace(/[()\\]/g, '').replace(/#.*$/, '').trim();

  return cleaned
    .split(',')
    .map((s) => {
      const item = s.trim();
      if (!item) return null;
      const asMatch = item.match(/^(\w+)\s+as\s+\w+$/);
      if (asMatch) return asMatch[1];
      return item;
    })
    .filter((s): s is string => s !== null && /^[A-Za-z_]\w*$/.test(s));
}

/**
 * Drop comments and quoted strings from a single line. Preserves length
 * so column positions stay accurate (not that we use them yet).
 */
function stripCommentsAndStrings(line: string): string {
  let out = '';
  let i = 0;
  let inString: '"' | "'" | null = null;

  while (i < line.length) {
    const c = line[i];

    if (inString) {
      if (c === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === inString) {
        inString = null;
      }
      out += ' ';
      i++;
      continue;
    }

    if (c === '#') {
      out += ' '.repeat(line.length - i);
      break;
    }

    if (c === '"' || c === "'") {
      // Triple-quoted strings would need more logic; for a single line
      // this is fine — the full docstring is unlikely to contain `import`.
      inString = c;
      out += ' ';
      i++;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}
