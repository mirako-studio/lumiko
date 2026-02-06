import fs from 'fs/promises';
import path from 'path';
import type { GeneratedDocs, LumikoConfig } from '../types/index.js';

export async function writeOutput(
  docs: GeneratedDocs,
  projectPath: string,
  config: LumikoConfig,
): Promise<void> {
  const outputDir = path.join(projectPath, config.output.directory);

  await fs.mkdir(outputDir, { recursive: true });

  const writes: Promise<void>[] = [];

  if (config.docs.readme && docs.readme) {
    writes.push(fs.writeFile(path.join(outputDir, 'README.md'), docs.readme + '\n'));
  }

  if (config.docs.architecture && docs.architecture) {
    writes.push(fs.writeFile(path.join(outputDir, 'architecture.md'), docs.architecture + '\n'));
  }

  if (config.docs.api && docs.api) {
    writes.push(fs.writeFile(path.join(outputDir, 'api.md'), docs.api + '\n'));
  }

  if (config.output.formats.includes('context') && docs.context) {
    writes.push(
      fs.writeFile(path.join(outputDir, 'context.json'), JSON.stringify(docs.context, null, 2) + '\n'),
    );
  }

  await Promise.all(writes);
}

export interface FileStat {
  name: string;
  size: string;
}

export async function getOutputStats(
  projectPath: string,
  config: LumikoConfig,
): Promise<FileStat[]> {
  const stats: FileStat[] = [];
  const outputDir = path.join(projectPath, config.output.directory);

  const candidates = [
    'README.md',
    'architecture.md',
    'api.md',
    'context.json',
  ];

  for (const name of candidates) {
    const filePath = path.join(outputDir, name);
    try {
      const stat = await fs.stat(filePath);
      stats.push({ name, size: formatBytes(stat.size) });
    } catch {
      // File doesn't exist, skip
    }
  }

  return stats;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
