import type { Preset } from './index.js';
import {
  joinSections,
  renderArchitectureSection,
  renderCommandsSection,
  renderConventionsSection,
  renderModulesCompact,
  renderOverviewSection,
  renderStackSection,
} from './shared.js';

/**
 * Generates .cursor/rules/project.mdc — Cursor's modern project rules file.
 * Uses frontmatter to declare the rule applies to all files in the workspace.
 *
 * Docs: https://docs.cursor.com/context/rules
 *
 * The older .cursorrules file is still supported but deprecated; we write
 * a compact version of it too for projects using older Cursor versions.
 */
export const cursorPreset: Preset = {
  name: 'cursor',
  description: 'Cursor rules — .cursor/rules/project.mdc (+ legacy .cursorrules)',
  outputPaths: ['.cursor/rules/project.mdc', '.cursorrules'],
  generate({ bundle, projectName }) {
    const body = joinSections([
      `# ${projectName}`,
      renderOverviewSection(bundle.overview),
      renderStackSection(bundle.overview),
      renderCommandsSection(bundle.commands),
      renderArchitectureSection(bundle.architecture),
      renderConventionsSection(bundle.conventions),
      renderModulesCompact(bundle.modules),
    ]);

    // Modern format — .mdc with frontmatter.
    // `alwaysApply: true` means this rule is included in every chat.
    const mdc = [
      '---',
      `description: Project context for ${projectName}`,
      'alwaysApply: true',
      '---',
      '',
      body,
    ].join('\n');

    return {
      files: [
        { path: '.cursor/rules/project.mdc', content: mdc },
        { path: '.cursorrules', content: body },
      ],
    };
  },
};
