import type { Preset } from './index.js';
import {
  joinSections,
  lumikoFooter,
  renderArchitectureSection,
  renderCommandsSection,
  renderConventionsSection,
  renderGraphSection,
  renderModulesCompact,
  renderOverviewSection,
  renderStackSection,
} from './shared.js';

/**
 * Generates AGENTS.md — the emerging cross-vendor standard for agent
 * instructions (OpenAI, Cursor, Aider, and others all read it).
 *
 * Docs: https://agents.md
 */
export const agentsPreset: Preset = {
  name: 'agents',
  description: 'AGENTS.md — cross-vendor standard for coding agents',
  outputPaths: ['AGENTS.md'],
  generate({ bundle, projectName }) {
    const title = `# ${projectName}`;

    const intro = [
      'Instructions for AI coding agents working in this repository.',
      'This file follows the [AGENTS.md](https://agents.md) standard.',
    ].join(' ');

    const body = joinSections([
      title,
      intro,
      renderOverviewSection(bundle.overview),
      renderStackSection(bundle.overview),
      renderCommandsSection(bundle.commands),
      renderArchitectureSection(bundle.architecture),
      renderConventionsSection(bundle.conventions),
      renderGraphSection(bundle.graph),
      renderModulesCompact(bundle.modules),
      lumikoFooter(),
    ]);

    return {
      files: [{ path: 'AGENTS.md', content: body }],
    };
  },
};
