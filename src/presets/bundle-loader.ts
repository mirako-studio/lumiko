import fs from 'fs/promises';
import path from 'path';
import type {
  ContextArchitecture,
  ContextCommands,
  ContextManifest,
  ContextModule,
  ContextOverview,
  DependencyGraph,
  LumikoConfig,
} from '../types/index.js';

/**
 * The .context/ bundle loaded from disk into typed form.
 * Presets consume this as their single source of truth.
 */
export interface LoadedContextBundle {
  manifest: ContextManifest;
  overview: ContextOverview;
  architecture: ContextArchitecture;
  conventions: string;
  commands: ContextCommands;
  /** Module key → ContextModule (e.g. "src-core" → {path, purpose, files}). */
  modules: Map<string, ContextModule>;
  /** Dependency graph if it exists in the bundle, otherwise null. */
  graph: DependencyGraph | null;
}

export class BundleNotFoundError extends Error {
  constructor(bundlePath: string) {
    super(
      `No .context/ bundle found at "${bundlePath}".\n\n` +
        'Run `lumiko generate` first to create the bundle.',
    );
    this.name = 'BundleNotFoundError';
  }
}

export class BundleIncompleteError extends Error {
  constructor(missing: string[]) {
    super(
      `.context/ bundle is missing required files: ${missing.join(', ')}\n\n` +
        'Run `lumiko generate` to regenerate the bundle.',
    );
    this.name = 'BundleIncompleteError';
  }
}

/**
 * Load a .context/ bundle from disk. Validates that the core files exist
 * and parses them into typed form. Module files are loaded lazily per-call.
 */
export async function loadContextBundle(
  projectPath: string,
  config: LumikoConfig,
): Promise<LoadedContextBundle> {
  const bundleDir = path.join(projectPath, config.output.contextDirectory);

  try {
    await fs.access(bundleDir);
  } catch {
    throw new BundleNotFoundError(bundleDir);
  }

  // Core files required for any preset to work.
  const required = ['manifest.json', 'overview.json', 'architecture.json', 'conventions.md', 'commands.json'];
  const missing: string[] = [];

  for (const file of required) {
    try {
      await fs.access(path.join(bundleDir, file));
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new BundleIncompleteError(missing);
  }

  const [manifest, overview, architecture, conventions, commands] = await Promise.all([
    readJson<ContextManifest>(path.join(bundleDir, 'manifest.json')),
    readJson<ContextOverview>(path.join(bundleDir, 'overview.json')),
    readJson<ContextArchitecture>(path.join(bundleDir, 'architecture.json')),
    fs.readFile(path.join(bundleDir, 'conventions.md'), 'utf-8'),
    readJson<ContextCommands>(path.join(bundleDir, 'commands.json')),
  ]);

  // Load all module files. Missing or unparseable module files are skipped,
  // not fatal — a preset can still produce useful output with partial data.
  const modules = new Map<string, ContextModule>();
  const modulesDir = path.join(bundleDir, 'modules');

  try {
    const entries = await fs.readdir(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const key = entry.name.replace(/\.json$/, '');
      try {
        const mod = await readJson<ContextModule>(path.join(modulesDir, entry.name));
        modules.set(key, mod);
      } catch {
        // Skip invalid module file
      }
    }
  } catch {
    // No modules/ directory — still usable, just no per-module details
  }

  // Optional: load the dep graph if one was written. Not required — older
  // bundles predate this file, and `lumiko graph` can regenerate it later.
  let graph: DependencyGraph | null = null;
  try {
    graph = await readJson<DependencyGraph>(path.join(bundleDir, 'graph.json'));
  } catch {
    // No graph.json or unreadable — presets just won't see graph data.
  }

  return {
    manifest,
    overview,
    architecture,
    conventions: conventions.trim(),
    commands,
    modules,
    graph,
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}
