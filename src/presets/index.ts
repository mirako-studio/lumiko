import type { LumikoConfig, PresetName } from '../types/index.js';
import type { LoadedContextBundle } from './bundle-loader.js';
import { claudeCodePreset } from './claude-code.js';
import { cursorPreset } from './cursor.js';
import { copilotPreset } from './copilot.js';
import { windsurfPreset } from './windsurf.js';
import { agentsPreset } from './agents.js';

export type { LoadedContextBundle } from './bundle-loader.js';
export { loadContextBundle, BundleNotFoundError, BundleIncompleteError } from './bundle-loader.js';

export interface PresetContext {
  bundle: LoadedContextBundle;
  projectPath: string;
  projectName: string;
  config: LumikoConfig;
}

export interface PresetOutputFile {
  /** Path relative to projectPath (e.g. "CLAUDE.md", ".cursor/rules/project.mdc"). */
  path: string;
  content: string;
}

export interface PresetOutput {
  files: PresetOutputFile[];
}

export interface Preset {
  name: PresetName;
  description: string;
  /** Files this preset writes — used for dry-run and help output. */
  outputPaths: string[];
  generate(ctx: PresetContext): PresetOutput;
}

/** Registry of all built-in presets. Order here controls help/list ordering. */
export const PRESETS: Record<PresetName, Preset> = {
  'claude-code': claudeCodePreset,
  cursor: cursorPreset,
  copilot: copilotPreset,
  windsurf: windsurfPreset,
  agents: agentsPreset,
};

export const PRESET_NAMES: PresetName[] = Object.keys(PRESETS) as PresetName[];

export function isPresetName(name: string): name is PresetName {
  return (PRESET_NAMES as string[]).includes(name);
}

export function getPreset(name: PresetName): Preset {
  return PRESETS[name];
}
