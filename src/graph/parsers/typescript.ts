import type { ImportStyle } from '../../types/index.js';
import type { RawImport } from './index.js';

/**
 * Regex-based extractor for ES module imports and CommonJS require() calls.
 *
 * Handles:
 *   - Default:        import foo from 'x'
 *   - Named:          import { a, b as c } from 'x'
 *   - Namespace:      import * as foo from 'x'
 *   - Side-effect:    import 'x'
 *   - Mixed:          import foo, { a } from 'x'
 *   - Mixed ns:       import foo, * as ns from 'x'
 *   - Type-only:      import type { T } from 'x'
 *   - Re-export:      export { a } from 'x'
 *   - Namespace re-export: export * from 'x'
 *   - Dynamic import: import('x')        (symbols treated as unknown)
 *   - CommonJS:       const x = require('x'); require('x')
 *
 * Multi-line imports are supported. String comments inside imports are not
 * (but are extremely rare in practice).
 */
export function parseTypescript(content: string): RawImport[] {
  const stripped = stripCommentsAndStrings(content);
  const imports: RawImport[] = [];
  const seen = new Set<string>();

  for (const imp of extractImports(stripped)) {
    const key = `${imp.source}|${imp.line}|${imp.style}|${imp.symbols.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push(imp);
  }

  return imports;
}

function extractImports(src: string): RawImport[] {
  const out: RawImport[] = [];

  // Static import/export: capture the whole statement from `import`/`export`
  // up to the `from '...'` clause. The [\s\S]*? lets it cross newlines.
  const staticRe =
    /(?:^|[\s;{])(import|export)(?:\s+type)?\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(src)) !== null) {
    const kind = m[1];
    const clause = m[2].trim();
    const source = m[3];
    // The regex may consume a leading whitespace/semicolon; locate the real
    // start of the keyword so line numbers line up with the keyword, not
    // with the char before it.
    const keywordStart = m.index + m[0].indexOf(kind);
    const line = lineNumberAt(src, keywordStart);
    const parsed = parseImportClause(clause);

    // An `export ... from` with no clause (e.g. `export * from 'x'`) is a
    // namespace re-export. Detect it by the `*`.
    if (kind === 'export' && clause === '*') {
      out.push({ source, symbols: ['*'], style: 'namespace', line });
      continue;
    }

    out.push({ source, ...parsed, line });
  }

  // Side-effect import:  import 'x'   (no `from`, no symbols)
  const sideRe = /(?:^|[\s;{])import\s+['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(src)) !== null) {
    const source = m[1];
    // Skip if this is actually part of a `import X from 'x'` already matched.
    // The trick: side-effect has no word between `import` and the quote.
    const beforeQuote = src.slice(m.index, m.index + m[0].length);
    if (!/import\s+['"]/.test(beforeQuote)) continue;
    const keywordStart = m.index + m[0].indexOf('import');
    out.push({ source, symbols: [], style: 'side-effect', line: lineNumberAt(src, keywordStart) });
  }

  // Dynamic import:  import('x')
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = dynamicRe.exec(src)) !== null) {
    out.push({
      source: m[1],
      symbols: [],
      style: 'unknown',
      line: lineNumberAt(src, m.index),
    });
  }

  // CommonJS require:  require('x')
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(src)) !== null) {
    out.push({
      source: m[1],
      symbols: [],
      style: 'unknown',
      line: lineNumberAt(src, m.index),
    });
  }

  return out;
}

/**
 * Parse the clause between `import` and `from`. Returns symbols + style.
 *
 * Examples:
 *   "foo"                      → default, symbols=[foo]
 *   "{ a, b as c }"            → named, symbols=[a, b]
 *   "* as foo"                 → namespace, symbols=[*]
 *   "foo, { a }"               → mixed default+named (treat as named+default)
 *   "foo, * as ns"             → mixed default+namespace
 */
function parseImportClause(clause: string): { symbols: string[]; style: ImportStyle } {
  // Namespace-only: "* as foo"
  if (/^\*\s+as\s+\w+$/.test(clause)) {
    return { symbols: ['*'], style: 'namespace' };
  }

  // Default + namespace: "foo, * as ns"
  const defaultNamespace = clause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\*\s+as\s+\w+$/);
  if (defaultNamespace) {
    return { symbols: [defaultNamespace[1], '*'], style: 'namespace' };
  }

  // Default + named: "foo, { a, b }"
  const defaultNamed = clause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\{([\s\S]+)\}$/);
  if (defaultNamed) {
    const named = parseNamedList(defaultNamed[2]);
    return { symbols: [defaultNamed[1], ...named], style: 'named' };
  }

  // Named-only: "{ a, b as c }"
  if (clause.startsWith('{') && clause.endsWith('}')) {
    return { symbols: parseNamedList(clause.slice(1, -1)), style: 'named' };
  }

  // Default-only: "foo"
  if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
    return { symbols: [clause], style: 'default' };
  }

  // Unknown shape — probably something exotic. Capture source but not symbols.
  return { symbols: [], style: 'unknown' };
}

/** Parse a named-import list like "a, b as c, default as d" into ["a","b","default"]. */
function parseNamedList(list: string): string[] {
  return list
    .split(',')
    .map((item) => {
      const trimmed = item.trim();
      if (!trimmed) return null;
      // "a as b" → take the original name
      const asMatch = trimmed.match(/^(\w+)\s+as\s+\w+$/);
      if (asMatch) return asMatch[1];
      return trimmed.replace(/^type\s+/, '');
    })
    .filter((s): s is string => s !== null && s.length > 0);
}

/**
 * Strip line comments, block comments, and string literals (replacing them
 * with spaces) so the import regexes don't match them. Preserves newlines so
 * line numbers stay accurate.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // Line comment
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    // Block comment
    if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    // String literal — preserve the quotes and content since the import
    // regex needs the inside. But skip template literals (they can contain
    // anything) and regex literals.
    if (c === '"' || c === "'") {
      // Copy the full string including quotes.
      out += c;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === '\n') break; // unterminated, bail
        out += src[i];
        i++;
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      continue;
    }

    // Template literal — replace with spaces but preserve newlines.
    if (c === '`') {
      out += ' ';
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\' && i + 1 < n) {
          out += '  ';
          i += 2;
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += ' ';
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function lineNumberAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}
