import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import type { LumikoConfig, ScannedFile } from '../types/index.js';

export interface ScanResult {
  files: ScannedFile[];
  totalSize: number;
  totalLines: number;
}

const MAX_FILE_SIZE = 100_000; // 100 KB per file

export async function scanProject(
  projectPath: string,
  config: LumikoConfig,
): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  let totalSize = 0;
  let totalLines = 0;

  const matchedPaths = await glob(config.include, {
    cwd: projectPath,
    ignore: config.exclude,
    nodir: true,
    absolute: false,
  });

  // Sort for deterministic output
  matchedPaths.sort();

  for (const relativePath of matchedPaths) {
    const fullPath = path.join(projectPath, relativePath);

    try {
      const stats = await fs.stat(fullPath);

      // Skip large files
      if (stats.size > MAX_FILE_SIZE) {
        continue;
      }

      const content = await fs.readFile(fullPath, 'utf-8');

      // Skip binary-looking files (contains null bytes)
      if (content.includes('\0')) {
        continue;
      }

      const lines = content.split('\n').length;

      files.push({
        path: relativePath,
        content,
        size: stats.size,
        lines,
        extension: path.extname(relativePath),
      });

      totalSize += stats.size;
      totalLines += lines;
    } catch {
      // Skip files that can't be read
    }
  }

  return { files, totalSize, totalLines };
}

export function buildFileTree(files: ScannedFile[]): string {
  const tree: Record<string, unknown> = {};

  for (const file of files) {
    const parts = file.path.split('/');
    let current = tree as Record<string, unknown>;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = null; // leaf = file
      } else {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }
    }
  }

  return formatTree(tree);
}

function formatTree(tree: Record<string, unknown>, prefix = ''): string {
  let result = '';
  const entries = Object.entries(tree);

  entries.forEach(([name, subtree], index) => {
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const extension = isLast ? '    ' : '│   ';

    result += prefix + connector + name + '\n';

    if (subtree !== null && typeof subtree === 'object') {
      result += formatTree(subtree as Record<string, unknown>, prefix + extension);
    }
  });

  return result;
}
