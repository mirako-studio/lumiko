import type { Preset } from './index.js';
import {
  joinSections,
  renderArchitectureSection,
  renderCommandsSection,
  renderConventionsSection,
  renderGraphSection,
  renderModulesCompact,
  renderOverviewSection,
  renderStackSection,
} from './shared.js';

/**
 * Generates .windsurfrules — Codeium Windsurf's workspace rules file.
 * Windsurf reads this at session start to anchor Cascade's understanding
 * of the project.
 *
 * Docs: https://docs.windsurf.com/windsurf/cascade/memories#rules
 */
export const windsurfPreset: Preset = {
  name: 'windsurf',
  description: 'Windsurf — .windsurfrules',
  outputPaths: ['.windsurfrules'],
  generate({ bundle, projectName }) {
    const body = joinSections([
      `# ${projectName}`,
      renderOverviewSection(bundle.overview),
      renderStackSection(bundle.overview),
      renderCommandsSection(bundle.commands),
      renderArchitectureSection(bundle.architecture),
      renderConventionsSection(bundle.conventions),
      renderGraphSection(bundle.graph),
      renderModulesCompact(bundle.modules),
    ]);

    return {
      files: [{ path: '.windsurfrules', content: body }],
    };
  },
};
