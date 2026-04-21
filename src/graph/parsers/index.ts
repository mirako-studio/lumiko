import type { ImportStyle } from '../../types/index.js';
import { parseTypescript } from './typescript.js';
import { parsePython } from './python.js';

/**
 * A raw import extracted from source, before resolution.
 * `source` is the literal string (e.g. "./foo.js", "commander").
 */
export interface RawImport {
  source: string;
  symbols: string[];
  style: ImportStyle;
  line: number;
}

export interface Parser {
  language: string;
  extensions: string[];
  parse(content: string): RawImport[];
}

const PARSERS: Parser[] = [
  {
    language: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    parse: parseTypescript,
  },
  {
    language: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    parse: parseTypescript, // Same grammar for ESM + CommonJS
  },
  {
    language: 'python',
    extensions: ['.py'],
    parse: parsePython,
  },
];

/** Find the parser that handles a file extension. Returns null if unsupported. */
export function getParser(extension: string): Parser | null {
  const ext = extension.toLowerCase();
  return PARSERS.find((p) => p.extensions.includes(ext)) ?? null;
}

/** Language of a file, or null if unknown. */
export function getLanguage(extension: string): string | null {
  return getParser(extension)?.language ?? null;
}
