import type {
  ContextArchitecture,
  ContextCommands,
  ContextModule,
  ContextOverview,
  DependencyGraph,
} from '../types/index.js';

/**
 * Shared markdown builders used across presets. Each returns a trimmed string
 * (no trailing newline) — presets join sections with `\n\n`.
 */

export function renderOverviewSection(overview: ContextOverview): string {
  const lines = [
    '## Overview',
    '',
    overview.summary,
  ];

  if (overview.purpose) {
    lines.push('', `**Purpose:** ${overview.purpose}`);
  }

  return lines.join('\n').trim();
}

export function renderStackSection(overview: ContextOverview): string {
  const { stack, entryPoints } = overview;
  const rows: string[] = [];

  rows.push(`- **Language:** ${stack.language}`);
  rows.push(`- **Runtime:** ${stack.runtime}`);
  if (stack.framework) rows.push(`- **Framework:** ${stack.framework}`);
  if (stack.buildTool) rows.push(`- **Build tool:** ${stack.buildTool}`);
  rows.push(`- **Package manager:** ${stack.packageManager}`);

  if (entryPoints && entryPoints.length > 0) {
    rows.push(`- **Entry points:** ${entryPoints.map((e) => '`' + e + '`').join(', ')}`);
  }

  return ['## Stack', '', ...rows].join('\n').trim();
}

export function renderCommandsSection(commands: ContextCommands): string {
  const lines = ['## Commands', ''];

  const standard: Array<[string, string | null]> = [
    ['Install', commands.install],
    ['Build', commands.build],
    ['Dev', commands.dev],
    ['Test', commands.test],
    ['Lint', commands.lint],
  ];

  for (const [label, cmd] of standard) {
    if (cmd) {
      lines.push(`- **${label}:** \`${cmd}\``);
    }
  }

  if (commands.custom && Object.keys(commands.custom).length > 0) {
    lines.push('', '### Custom scripts', '');
    for (const [name, cmd] of Object.entries(commands.custom)) {
      lines.push(`- \`${name}\` → \`${cmd}\``);
    }
  }

  if (commands.envVars && commands.envVars.length > 0) {
    lines.push('', '### Environment variables', '');
    for (const v of commands.envVars) {
      const req = v.required ? 'required' : 'optional';
      lines.push(`- \`${v.name}\` *(${req})* — ${v.purpose}`);
    }
  }

  return lines.join('\n').trim();
}

export function renderArchitectureSection(arch: ContextArchitecture): string {
  const lines = ['## Architecture', ''];

  lines.push(`**Pattern:** ${arch.pattern}`);

  if (arch.layers && arch.layers.length > 0) {
    lines.push('', '**Layers:** ' + arch.layers.map((l) => '`' + l + '`').join(' → '));
  }

  if (arch.dataFlow) {
    lines.push('', '**Data flow:**', '', arch.dataFlow);
  }

  if (arch.modules && arch.modules.length > 0) {
    lines.push('', '### Modules', '');
    for (const m of arch.modules) {
      lines.push(`- **${m.name}** (\`${m.path}\`) — ${m.purpose}`);
    }
  }

  if (arch.diagrams?.mermaid) {
    lines.push('', '### Diagram', '', '```mermaid', arch.diagrams.mermaid, '```');
  }

  return lines.join('\n').trim();
}

/**
 * A compact per-module file list — good for agent quick-reference without
 * dumping every function signature. Full details live in .context/modules/*.json.
 */
export function renderModulesCompact(modules: Map<string, ContextModule>): string {
  if (modules.size === 0) return '';

  const lines = ['## File Map', ''];

  // Sort modules by path for deterministic output
  const sorted = Array.from(modules.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [, mod] of sorted) {
    lines.push(`### \`${mod.path}\``);
    lines.push('');
    lines.push(mod.purpose);
    lines.push('');
    for (const file of mod.files) {
      lines.push(`- \`${file.path}\` — ${file.purpose}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Render a "Hotspots & Orphans" section from the dep graph. Useful warning
 * for agents: files with many importers are refactor danger zones; orphans
 * are either entry points or dead code.
 */
export function renderGraphSection(graph: DependencyGraph | null): string {
  if (!graph) return '';

  const lines: string[] = ['## Dependency Hotspots', ''];

  if (graph.stats.mostImported.length > 0) {
    lines.push('Files with the most incoming dependencies — change these with care:');
    lines.push('');
    for (const entry of graph.stats.mostImported.slice(0, 5)) {
      lines.push(`- \`${entry.path}\` — imported by ${entry.importers} file${entry.importers === 1 ? '' : 's'}`);
    }
    lines.push('');
  }

  if (graph.stats.orphans.length > 0) {
    lines.push(`**Orphans** (${graph.stats.orphans.length} file${graph.stats.orphans.length === 1 ? '' : 's'} with no importers — likely entry points or dead code):`);
    lines.push('');
    const preview = graph.stats.orphans.slice(0, 5);
    for (const p of preview) {
      lines.push(`- \`${p}\``);
    }
    if (graph.stats.orphans.length > 5) {
      lines.push(`- …and ${graph.stats.orphans.length - 5} more`);
    }
    lines.push('');
  }

  lines.push('Full graph available at `.context/graph.json`.');

  return lines.join('\n').trimEnd();
}

/**
 * Conventions section — takes the raw markdown and ensures it starts with
 * a level-2 heading. If the source already has a heading, it's preserved;
 * otherwise we prepend one.
 */
export function renderConventionsSection(conventions: string): string {
  const trimmed = conventions.trim();
  if (!trimmed) return '';

  // Does it already start with a heading?
  if (/^#{1,2}\s/m.test(trimmed.split('\n')[0])) {
    // Ensure level-2 minimum (promote #  to ##)
    return trimmed.replace(/^#\s/, '## ');
  }

  return ['## Conventions', '', trimmed].join('\n');
}

/** Join sections with blank lines, filter out empties. */
export function joinSections(sections: string[]): string {
  return sections.filter((s) => s && s.trim().length > 0).join('\n\n') + '\n';
}

/**
 * Generate a standard "Generated by Lumiko" footer.
 */
export function lumikoFooter(): string {
  return [
    '---',
    '',
    '_This file was generated by [Lumiko](https://github.com/mirako-dev/lumiko) from the `.context/` bundle._',
    '_Do not edit by hand — re-run `lumiko preset` to regenerate._',
  ].join('\n');
}
