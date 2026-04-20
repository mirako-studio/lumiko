import type { Preset } from './index.js';
import {
  joinSections,
  lumikoFooter,
  renderArchitectureSection,
  renderCommandsSection,
  renderConventionsSection,
  renderModulesCompact,
  renderOverviewSection,
  renderStackSection,
} from './shared.js';

/**
 * Generates CLAUDE.md — the project primer that Anthropic Claude Code
 * automatically loads into the context of every session.
 *
 * Docs: https://docs.claude.com/en/docs/claude-code/memory
 */
export const claudeCodePreset: Preset = {
  name: 'claude-code',
  description: 'CLAUDE.md — auto-loaded context for Claude Code sessions',
  outputPaths: ['CLAUDE.md'],
  generate({ bundle, projectName }) {
    const title = `# ${projectName}`;

    const intro = [
      'This file is read by Claude Code at the start of every session.',
      'It mirrors the `.context/` bundle — the source of truth for project context.',
      'For per-file details, load `.context/modules/<module>.json`.',
    ].join(' ');

    const body = joinSections([
      title,
      intro,
      renderOverviewSection(bundle.overview),
      renderStackSection(bundle.overview),
      renderCommandsSection(bundle.commands),
      renderArchitectureSection(bundle.architecture),
      renderConventionsSection(bundle.conventions),
      renderModulesCompact(bundle.modules),
      lumikoFooter(),
    ]);

    return {
      files: [{ path: 'CLAUDE.md', content: body }],
    };
  },
};
