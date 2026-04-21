import { describe, it, expect } from 'vitest';
import {
  getModuleKey,
  getModuleDisplayPath,
  groupFilesByModule,
  groupPathsByModule,
} from '../../src/core/prompts.js';
import type { ScannedFile } from '../../src/types/index.js';

function file(path: string): ScannedFile {
  return { path, content: '', size: 0, lines: 0, extension: '' };
}

describe('getModuleKey', () => {
  it('converts nested paths to dash-joined keys', () => {
    expect(getModuleKey('src/core/chunker.ts')).toBe('src-core');
  });

  it('uses single segment for top-level dirs', () => {
    expect(getModuleKey('src/index.ts')).toBe('src');
  });

  it('returns _root for root-level files', () => {
    expect(getModuleKey('package.json')).toBe('_root');
    expect(getModuleKey('tsup.config.ts')).toBe('_root');
  });

  it('handles backslash path separators', () => {
    expect(getModuleKey('src\\core\\foo.ts')).toBe('src-core');
  });
});

describe('getModuleDisplayPath', () => {
  it('converts module key back to directory path', () => {
    expect(getModuleDisplayPath('src-core')).toBe('src/core/');
  });

  it('renders _root as "(root)"', () => {
    expect(getModuleDisplayPath('_root')).toBe('(root)');
  });

  it('handles single-segment keys', () => {
    expect(getModuleDisplayPath('src')).toBe('src/');
  });
});

describe('groupFilesByModule', () => {
  it('groups files by their immediate parent directory', () => {
    const files = [
      file('src/core/a.ts'),
      file('src/core/b.ts'),
      file('src/commands/c.ts'),
      file('src/index.ts'),
    ];
    const groups = groupFilesByModule(files);

    expect(groups.get('src-core')).toHaveLength(2);
    expect(groups.get('src-commands')).toHaveLength(1);
    expect(groups.get('src')).toHaveLength(1);
  });

  it('groups root files under _root', () => {
    const files = [file('tsup.config.ts'), file('package.json')];
    const groups = groupFilesByModule(files);
    expect(groups.get('_root')).toHaveLength(2);
  });
});

describe('groupPathsByModule', () => {
  it('groups string paths the same way as groupFilesByModule', () => {
    const groups = groupPathsByModule(['src/a.ts', 'src/core/b.ts', 'src/core/c.ts']);
    expect(groups.get('src')).toEqual(['src/a.ts']);
    expect(groups.get('src-core')).toEqual(['src/core/b.ts', 'src/core/c.ts']);
  });
});
