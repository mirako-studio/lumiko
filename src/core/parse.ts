import type { GeneratedDocs, ChunkAnalysis, ContextBundle, ContextBundleEntry } from '../types/index.js';

/**
 * Parse Claude's response into structured doc sections.
 * Only handles markdown docs — the .context/ bundle is generated separately.
 */
export function parseGeneratedResponse(content: string): GeneratedDocs {
  const docs: GeneratedDocs = {
    readme: '',
    architecture: '',
    api: '',
    context: null,
  };

  const sections: Array<{ regex: RegExp; key: 'readme' | 'architecture' | 'api' }> = [
    {
      regex: /---\s*README_START\s*---\s*([\s\S]*?)\s*---\s*README_END\s*---/,
      key: 'readme',
    },
    {
      regex: /---\s*ARCHITECTURE_START\s*---\s*([\s\S]*?)\s*---\s*ARCHITECTURE_END\s*---/,
      key: 'architecture',
    },
    {
      regex: /---\s*API_START\s*---\s*([\s\S]*?)\s*---\s*API_END\s*---/,
      key: 'api',
    },
  ];

  for (const { regex, key } of sections) {
    const match = content.match(regex);
    if (match) {
      docs[key] = match[1].trim();
    }
  }

  return docs;
}

/**
 * Check if parsed docs have any real content.
 */
export function isDocsEmpty(docs: GeneratedDocs): boolean {
  return !docs.readme && !docs.architecture && !docs.api;
}

/**
 * Parse Claude's chunk analysis response into a structured ChunkAnalysis.
 */
export function parseChunkAnalysis(
  content: string,
  chunkIndex: number,
  chunkLabel: string,
  filePaths: string[],
): ChunkAnalysis {
  const extract = (startTag: string, endTag: string): string => {
    const regex = new RegExp(`---\\s*${startTag}\\s*---\\s*([\\s\\S]*?)\\s*---\\s*${endTag}\\s*---`);
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  };

  const summary = extract('CHUNK_SUMMARY_START', 'CHUNK_SUMMARY_END');
  const exportsRaw = extract('CHUNK_EXPORTS_START', 'CHUNK_EXPORTS_END');
  const architectureNotes = extract('CHUNK_ARCHITECTURE_START', 'CHUNK_ARCHITECTURE_END');
  const apiSignatures = extract('CHUNK_API_START', 'CHUNK_API_END');

  // Parse exports into an array of lines
  const exports = exportsRaw
    ? exportsRaw.split('\n').map(line => line.trim()).filter(Boolean)
    : [];

  return {
    index: chunkIndex,
    label: chunkLabel,
    files: filePaths,
    summary: summary || '(No summary extracted)',
    exports,
    architectureNotes: architectureNotes || '(No architecture notes extracted)',
    apiSignatures: apiSignatures || '(No API signatures extracted)',
  };
}

/**
 * Check if a chunk analysis has meaningful content.
 */
export function isChunkAnalysisEmpty(analysis: ChunkAnalysis): boolean {
  return (
    analysis.summary === '(No summary extracted)' &&
    analysis.exports.length === 0 &&
    analysis.architectureNotes === '(No architecture notes extracted)' &&
    analysis.apiSignatures === '(No API signatures extracted)'
  );
}

// ── .context/ bundle parser ─────────────────────────────────────────────

/**
 * Parse a Claude response containing multiple files separated by
 * `---FILE:<path>---` delimiters into a structured ContextBundle.
 *
 * Handles common model quirks:
 *   - Stray markdown code fences wrapping JSON/markdown content
 *   - Leading/trailing whitespace
 *   - Invalid JSON (entry is skipped and path is recorded in invalidEntries)
 *   - Delimiter variants with extra spaces/dashes
 */
export function parseContextBundle(content: string): {
  bundle: ContextBundle;
  invalidEntries: Array<{ path: string; error: string }>;
} {
  const entries: ContextBundleEntry[] = [];
  const invalidEntries: Array<{ path: string; error: string }> = [];

  // Match each ---FILE:<path>--- header and everything up to the next header (or EOF).
  // The path can contain /, -, _, ., letters, digits.
  const headerRe = /---\s*FILE\s*:\s*([A-Za-z0-9_\-./\\]+)\s*---/g;

  const headers: Array<{ path: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(content)) !== null) {
    headers.push({
      path: m[1].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const contentStart = header.end;
    const contentEnd = i + 1 < headers.length ? headers[i + 1].start : content.length;

    let raw = content.slice(contentStart, contentEnd).trim();

    // Strip surrounding code fences if the model added them anyway.
    // e.g., ```json\n{...}\n``` → {...}
    const fenceMatch = raw.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/);
    if (fenceMatch) {
      raw = fenceMatch[1].trim();
    }

    const filePath = header.path;
    const isJson = filePath.toLowerCase().endsWith('.json');

    if (isJson) {
      try {
        entries.push({
          path: filePath,
          kind: 'json',
          content: JSON.parse(raw) as Record<string, unknown>,
        });
      } catch (err) {
        invalidEntries.push({
          path: filePath,
          error: (err as Error).message,
        });
      }
    } else {
      entries.push({
        path: filePath,
        kind: 'markdown',
        content: raw,
      });
    }
  }

  return { bundle: { entries }, invalidEntries };
}

/**
 * Check if a bundle has any entries.
 */
export function isBundleEmpty(bundle: ContextBundle): boolean {
  return bundle.entries.length === 0;
}
