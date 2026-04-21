import { describe, it, expect } from 'vitest';
import {
  parseGeneratedResponse,
  isDocsEmpty,
  parseChunkAnalysis,
  isChunkAnalysisEmpty,
  parseContextBundle,
  isBundleEmpty,
} from '../../src/core/parse.js';

// ── parseContextBundle ──────────────────────────────────────────────────

describe('parseContextBundle', () => {
  it('returns empty bundle for empty input', () => {
    const { bundle, invalidEntries } = parseContextBundle('');
    expect(bundle.entries).toEqual([]);
    expect(invalidEntries).toEqual([]);
  });

  it('parses a single JSON entry', () => {
    const input = `---FILE:overview.json---
{"name": "lumiko", "version": 1}`;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0]).toEqual({
      path: 'overview.json',
      kind: 'json',
      content: { name: 'lumiko', version: 1 },
    });
  });

  it('parses a single markdown entry', () => {
    const input = `---FILE:conventions.md---
# Conventions

Use tabs.`;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0]).toEqual({
      path: 'conventions.md',
      kind: 'markdown',
      content: '# Conventions\n\nUse tabs.',
    });
  });

  it('parses multiple entries with different kinds', () => {
    const input = `---FILE:overview.json---
{"name": "x"}
---FILE:conventions.md---
Hello world
---FILE:modules/src-core.json---
{"path": "src/core/", "purpose": "core logic"}`;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries).toHaveLength(3);
    expect(bundle.entries[0].path).toBe('overview.json');
    expect(bundle.entries[1].path).toBe('conventions.md');
    expect(bundle.entries[2].path).toBe('modules/src-core.json');
  });

  it('strips wrapping ```json code fences around JSON', () => {
    const input = `---FILE:x.json---
\`\`\`json
{"a": 1}
\`\`\``;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries[0].content).toEqual({ a: 1 });
  });

  it('strips wrapping ```markdown code fences around markdown', () => {
    const input = `---FILE:x.md---
\`\`\`markdown
# Hello
\`\`\``;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries[0].content).toBe('# Hello');
  });

  it('records invalid JSON without throwing', () => {
    const input = `---FILE:bad.json---
{this is not valid json}
---FILE:good.json---
{"ok": true}`;
    const { bundle, invalidEntries } = parseContextBundle(input);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].path).toBe('good.json');
    expect(invalidEntries).toHaveLength(1);
    expect(invalidEntries[0].path).toBe('bad.json');
  });

  it('tolerates extra whitespace and dashes in delimiters', () => {
    const input = `---  FILE:  overview.json  ---
{"ok": true}`;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].content).toEqual({ ok: true });
  });

  it('handles nested paths with slashes', () => {
    const input = `---FILE:modules/a/b/c.json---
{"deep": true}`;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries[0].path).toBe('modules/a/b/c.json');
  });

  it('ignores stray content before first delimiter', () => {
    const input = `Some preamble text here
---FILE:x.json---
{"ok": true}`;
    const { bundle } = parseContextBundle(input);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0].content).toEqual({ ok: true });
  });
});

describe('isBundleEmpty', () => {
  it('returns true for empty bundle', () => {
    expect(isBundleEmpty({ entries: [] })).toBe(true);
  });

  it('returns false when entries exist', () => {
    expect(
      isBundleEmpty({
        entries: [{ path: 'x.json', kind: 'json', content: {} }],
      }),
    ).toBe(false);
  });
});

// ── parseGeneratedResponse ──────────────────────────────────────────────

describe('parseGeneratedResponse', () => {
  it('parses all three sections', () => {
    const input = `---README_START---
# Project

Overview.
---README_END---
---ARCHITECTURE_START---
Architecture notes.
---ARCHITECTURE_END---
---API_START---
API docs.
---API_END---`;
    const docs = parseGeneratedResponse(input);
    expect(docs.readme).toBe('# Project\n\nOverview.');
    expect(docs.architecture).toBe('Architecture notes.');
    expect(docs.api).toBe('API docs.');
  });

  it('extracts only present sections', () => {
    const input = `---README_START---
Only README.
---README_END---`;
    const docs = parseGeneratedResponse(input);
    expect(docs.readme).toBe('Only README.');
    expect(docs.architecture).toBe('');
    expect(docs.api).toBe('');
  });

  it('tolerates extra whitespace in delimiters', () => {
    const input = `---  README_START  ---
Hello
---  README_END  ---`;
    const docs = parseGeneratedResponse(input);
    expect(docs.readme).toBe('Hello');
  });

  it('returns empty docs when no delimiters are present', () => {
    const docs = parseGeneratedResponse('just some text with no markers');
    expect(isDocsEmpty(docs)).toBe(true);
  });
});

describe('isDocsEmpty', () => {
  it('is true for all-empty docs', () => {
    expect(isDocsEmpty({ readme: '', architecture: '', api: '', context: null })).toBe(true);
  });

  it('is false if any section has content', () => {
    expect(isDocsEmpty({ readme: 'x', architecture: '', api: '', context: null })).toBe(false);
  });
});

// ── parseChunkAnalysis ──────────────────────────────────────────────────

describe('parseChunkAnalysis', () => {
  it('parses all sections', () => {
    const input = `---CHUNK_SUMMARY_START---
Summary here.
---CHUNK_SUMMARY_END---
---CHUNK_EXPORTS_START---
- \`foo()\` — does X
- \`Bar\` — type
---CHUNK_EXPORTS_END---
---CHUNK_ARCHITECTURE_START---
Arch notes.
---CHUNK_ARCHITECTURE_END---
---CHUNK_API_START---
API sigs.
---CHUNK_API_END---`;
    const analysis = parseChunkAnalysis(input, 0, 'src/core', ['a.ts', 'b.ts']);
    expect(analysis.summary).toBe('Summary here.');
    expect(analysis.exports).toEqual(['- `foo()` — does X', '- `Bar` — type']);
    expect(analysis.architectureNotes).toBe('Arch notes.');
    expect(analysis.apiSignatures).toBe('API sigs.');
    expect(analysis.files).toEqual(['a.ts', 'b.ts']);
  });

  it('uses placeholder text for missing sections', () => {
    const input = `---CHUNK_SUMMARY_START---
Just a summary.
---CHUNK_SUMMARY_END---`;
    const analysis = parseChunkAnalysis(input, 0, 'src', []);
    expect(analysis.summary).toBe('Just a summary.');
    expect(analysis.exports).toEqual([]);
    expect(analysis.architectureNotes).toContain('No architecture');
    expect(analysis.apiSignatures).toContain('No API');
  });
});

describe('isChunkAnalysisEmpty', () => {
  it('is true when only placeholders exist', () => {
    expect(
      isChunkAnalysisEmpty({
        index: 0,
        label: 'x',
        files: [],
        summary: '(No summary extracted)',
        exports: [],
        architectureNotes: '(No architecture notes extracted)',
        apiSignatures: '(No API signatures extracted)',
      }),
    ).toBe(true);
  });

  it('is false when summary is real', () => {
    expect(
      isChunkAnalysisEmpty({
        index: 0,
        label: 'x',
        files: [],
        summary: 'real summary',
        exports: [],
        architectureNotes: '(No architecture notes extracted)',
        apiSignatures: '(No API signatures extracted)',
      }),
    ).toBe(false);
  });
});
