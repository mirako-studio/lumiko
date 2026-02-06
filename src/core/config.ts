import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import type { LumikoConfig } from '../types/index.js';

const DEFAULT_CONFIG: LumikoConfig = {
  version: 1,
  project: {
    name: '',
    description: '',
  },
  include: ['src/**/*', 'lib/**/*', '*.ts', '*.js', '*.py'],
  exclude: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '*.lock', '*.log'],
  output: {
    directory: 'docs',
    formats: ['markdown', 'context'],
  },
  docs: {
    readme: true,
    architecture: true,
    api: true,
    diagrams: true,
  },
  claude: {
    backend: 'claude-code',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
  },
};

export async function loadConfig(projectPath: string): Promise<LumikoConfig> {
  const configPath = path.join(projectPath, '.lumiko', 'config.yaml');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const userConfig = yaml.load(content) as Partial<LumikoConfig>;

    // Deep merge with defaults
    return deepMerge(DEFAULT_CONFIG, userConfig) as LumikoConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('No config found. Run "lumiko init" first.');
    }
    throw error;
  }
}

export async function createConfig(projectPath: string): Promise<void> {
  const configDir = path.join(projectPath, '.lumiko');
  const configPath = path.join(configDir, 'config.yaml');

  await fs.mkdir(configDir, { recursive: true });

  const projectName = await detectProjectName(projectPath);

  const config = {
    ...DEFAULT_CONFIG,
    project: { name: projectName, description: '' },
  };

  const yamlContent = `# Lumiko Configuration
# Docs: https://github.com/mirako-dev/lumiko

${yaml.dump(config, { lineWidth: 80, noRefs: true })}`;

  await fs.writeFile(configPath, yamlContent);
}

async function detectProjectName(projectPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    return pkg.name || path.basename(projectPath);
  } catch {
    // Try pyproject.toml, go.mod, etc. in the future
    return path.basename(projectPath);
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}
