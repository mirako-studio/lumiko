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
 * Generates .github/copilot-instructions.md — custom instructions for
 * GitHub Copilot Chat in VS Code, Visual Studio, and github.com.
 *
 * Docs: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions
 */
export const copilotPreset: Preset = {
  name: 'copilot',
  description: 'GitHub Copilot — .github/copilot-instructions.md',
  outputPaths: ['.github/copilot-instructions.md'],
  generate({ bundle, projectName }) {
    const title = `# ${projectName}`;

    const intro = [
      'Custom instructions for GitHub Copilot Chat.',
      'Loaded automatically for every chat request in this repository.',
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
      files: [{ path: '.github/copilot-instructions.md', content: body }],
    };
  },
};
