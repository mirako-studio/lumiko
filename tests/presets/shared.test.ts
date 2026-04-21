import { describe, it, expect } from 'vitest';
import {
  renderOverviewSection,
  renderStackSection,
  renderCommandsSection,
  renderArchitectureSection,
  renderConventionsSection,
  renderModulesCompact,
  renderGraphSection,
  joinSections,
  lumikoFooter,
} from '../../src/presets/shared.js';
import type {
  ContextArchitecture,
  ContextCommands,
  ContextModule,
  ContextOverview,
  DependencyGraph,
} from '../../src/types/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────

const overview: ContextOverview = {
  name: 'lumiko',
  summary: 'A documentation tool.',
  purpose: 'Helps devs avoid writing docs.',
  stack: {
    language: 'typescript',
    runtime: 'node-18',
    framework: null,
    packageManager: 'npm',
    buildTool: 'tsup',
  },
  entryPoints: ['src/index.ts'],
};

const commands: ContextCommands = {
  install: 'npm install',
  build: 'npm run build',
  dev: null,
  test: 'npm test',
  lint: null,
  custom: { generate: 'lumiko generate' },
  envVars: [
    { name: 'API_KEY', required: true, purpose: 'Used for auth.' },
  ],
};

const architecture: ContextArchitecture = {
  pattern: 'CLI pipeline',
  layers: ['CLI', 'Core'],
  dataFlow: 'Files flow through the scanner into Claude.',
  modules: [
    { name: 'src/core', path: 'src/core/', purpose: 'Core logic', file: 'modules/src-core.json' },
  ],
  diagrams: { mermaid: 'graph TD\n  A --> B' },
};

// ── Tests ───────────────────────────────────────────────────────────────

describe('renderOverviewSection', () => {
  it('includes the summary and purpose', () => {
    const md = renderOverviewSection(overview);
    expect(md).toContain('## Overview');
    expect(md).toContain('A documentation tool.');
    expect(md).toContain('Purpose:');
    expect(md).toContain('Helps devs');
  });

  it('omits purpose line when purpose is empty', () => {
    const md = renderOverviewSection({ ...overview, purpose: '' });
    expect(md).not.toContain('Purpose:');
  });
});

describe('renderStackSection', () => {
  it('includes language, runtime, package manager', () => {
    const md = renderStackSection(overview);
    expect(md).toContain('**Language:** typescript');
    expect(md).toContain('**Runtime:** node-18');
    expect(md).toContain('**Package manager:** npm');
  });

  it('omits framework when null', () => {
    const md = renderStackSection(overview);
    expect(md).not.toContain('Framework');
  });

  it('includes framework when set', () => {
    const md = renderStackSection({
      ...overview,
      stack: { ...overview.stack, framework: 'React' },
    });
    expect(md).toContain('**Framework:** React');
  });

  it('includes entry points as code spans', () => {
    const md = renderStackSection(overview);
    expect(md).toContain('`src/index.ts`');
  });
});

describe('renderCommandsSection', () => {
  it('includes only non-null standard commands', () => {
    const md = renderCommandsSection(commands);
    expect(md).toContain('**Install:** `npm install`');
    expect(md).toContain('**Build:** `npm run build`');
    expect(md).toContain('**Test:** `npm test`');
    expect(md).not.toContain('**Dev:');
    expect(md).not.toContain('**Lint:');
  });

  it('renders custom scripts when present', () => {
    const md = renderCommandsSection(commands);
    expect(md).toContain('### Custom scripts');
    expect(md).toContain('`generate`');
  });

  it('renders env vars with required flag', () => {
    const md = renderCommandsSection(commands);
    expect(md).toContain('### Environment variables');
    expect(md).toContain('`API_KEY`');
    expect(md).toContain('*(required)*');
  });

  it('marks optional env vars correctly', () => {
    const md = renderCommandsSection({
      ...commands,
      envVars: [{ name: 'X', required: false, purpose: 'optional config' }],
    });
    expect(md).toContain('*(optional)*');
  });
});

describe('renderArchitectureSection', () => {
  it('includes pattern and data flow', () => {
    const md = renderArchitectureSection(architecture);
    expect(md).toContain('**Pattern:** CLI pipeline');
    expect(md).toContain('Files flow through');
  });

  it('renders layers joined with arrows', () => {
    const md = renderArchitectureSection(architecture);
    expect(md).toContain('`CLI` → `Core`');
  });

  it('includes the mermaid diagram in a code block', () => {
    const md = renderArchitectureSection(architecture);
    expect(md).toContain('```mermaid');
    expect(md).toContain('graph TD');
  });
});

describe('renderConventionsSection', () => {
  it('returns empty string for empty input', () => {
    expect(renderConventionsSection('')).toBe('');
  });

  it('adds a heading when conventions have none', () => {
    const md = renderConventionsSection('We use tabs.');
    expect(md).toBe('## Conventions\n\nWe use tabs.');
  });

  it('promotes level-1 headings to level-2', () => {
    const md = renderConventionsSection('# Style Guide\n\nTabs.');
    expect(md.startsWith('## Style Guide')).toBe(true);
  });

  it('preserves existing level-2 headings', () => {
    const md = renderConventionsSection('## Code Style\n\nTabs.');
    expect(md.startsWith('## Code Style')).toBe(true);
  });
});

describe('renderModulesCompact', () => {
  it('returns empty string for empty map', () => {
    expect(renderModulesCompact(new Map())).toBe('');
  });

  it('renders each module with its files', () => {
    const modules = new Map<string, ContextModule>();
    modules.set('src-core', {
      path: 'src/core/',
      purpose: 'Core logic.',
      files: [
        { path: 'src/core/a.ts', purpose: 'Does A.', exports: [], dependencies: [], keyFunctions: [] },
      ],
    });
    const md = renderModulesCompact(modules);
    expect(md).toContain('## File Map');
    expect(md).toContain('`src/core/`');
    expect(md).toContain('Core logic.');
    expect(md).toContain('`src/core/a.ts` — Does A.');
  });

  it('sorts modules alphabetically', () => {
    const modules = new Map<string, ContextModule>();
    modules.set('src-z', { path: 'src/z/', purpose: 'Z', files: [] });
    modules.set('src-a', { path: 'src/a/', purpose: 'A', files: [] });
    const md = renderModulesCompact(modules);
    const aIdx = md.indexOf('src/a/');
    const zIdx = md.indexOf('src/z/');
    expect(aIdx).toBeLessThan(zIdx);
  });
});

describe('renderGraphSection', () => {
  it('returns empty string when graph is null', () => {
    expect(renderGraphSection(null)).toBe('');
  });

  it('lists hotspots and orphans', () => {
    const graph: DependencyGraph = {
      generatedAt: '2026-01-01T00:00:00Z',
      schemaVersion: 1,
      languages: ['typescript'],
      stats: {
        totalFiles: 3,
        totalInternalEdges: 2,
        totalExternalPackages: 0,
        orphans: ['src/index.ts'],
        mostImported: [{ path: 'src/types.ts', importers: 2 }],
        mostImporting: [],
      },
      nodes: {},
      externalPackages: {},
    };
    const md = renderGraphSection(graph);
    expect(md).toContain('## Dependency Hotspots');
    expect(md).toContain('src/types.ts');
    expect(md).toContain('imported by 2 files');
    expect(md).toContain('**Orphans**');
    expect(md).toContain('src/index.ts');
    expect(md).toContain('.context/graph.json');
  });
});

describe('joinSections', () => {
  it('filters out empty sections', () => {
    expect(joinSections(['a', '', 'b'])).toBe('a\n\nb\n');
  });

  it('trims-only content is treated as empty', () => {
    expect(joinSections(['   ', 'x'])).toBe('x\n');
  });

  it('always ends with a newline', () => {
    expect(joinSections(['a']).endsWith('\n')).toBe(true);
  });
});

describe('lumikoFooter', () => {
  it('includes a Lumiko attribution', () => {
    const f = lumikoFooter();
    expect(f).toContain('Lumiko');
    expect(f).toContain('github.com/mirako-dev/lumiko');
  });
});
