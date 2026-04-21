import { describe, it, expect } from 'vitest';
import { parsePython } from '../../src/graph/parsers/python.js';

describe('parsePython — import statements', () => {
  it('captures `import foo`', () => {
    const out = parsePython(`import os`);
    expect(out).toEqual([expect.objectContaining({ source: 'os', style: 'default', symbols: [] })]);
  });

  it('captures `import foo, bar`', () => {
    const out = parsePython(`import os, sys`);
    expect(out.map((i) => i.source)).toEqual(['os', 'sys']);
  });

  it('captures `import foo as f` with the original name', () => {
    const out = parsePython(`import numpy as np`);
    expect(out[0].source).toBe('numpy');
  });

  it('captures dotted module names', () => {
    const out = parsePython(`import os.path`);
    expect(out[0].source).toBe('os.path');
  });
});

describe('parsePython — from...import statements', () => {
  it('captures `from foo import bar`', () => {
    const out = parsePython(`from os import path`);
    expect(out).toEqual([
      expect.objectContaining({ source: 'os', style: 'named', symbols: ['path'] }),
    ]);
  });

  it('captures multiple symbols', () => {
    const out = parsePython(`from os import path, sep, getcwd`);
    expect(out[0].symbols).toEqual(['path', 'sep', 'getcwd']);
  });

  it('unwraps `as` aliases', () => {
    const out = parsePython(`from numpy import array as arr, ndarray`);
    expect(out[0].symbols).toEqual(['array', 'ndarray']);
  });

  it('captures `from foo import *`', () => {
    const out = parsePython(`from math import *`);
    expect(out[0]).toMatchObject({
      source: 'math',
      style: 'namespace',
      symbols: ['*'],
    });
  });

  it('captures dot-relative imports', () => {
    const out = parsePython(`from . import utils`);
    expect(out[0].source).toBe('.');
  });

  it('captures nested relative imports', () => {
    const out = parsePython(`from ..foo.bar import baz`);
    expect(out[0].source).toBe('..foo.bar');
    expect(out[0].symbols).toEqual(['baz']);
  });
});

describe('parsePython — edge cases', () => {
  it('ignores imports in comments', () => {
    const out = parsePython(`# import os\nimport sys`);
    expect(out.map((i) => i.source)).toEqual(['sys']);
  });

  it('ignores imports in string literals', () => {
    const out = parsePython(`s = "import os"\nimport sys`);
    expect(out.map((i) => i.source)).toEqual(['sys']);
  });

  it('handles multiple import lines', () => {
    const src = `import os
from sys import argv
import json as j`;
    const out = parsePython(src);
    expect(out.map((i) => i.source)).toEqual(['os', 'sys', 'json']);
  });

  it('returns [] for files with no imports', () => {
    const out = parsePython(`def f():\n    return 42\n`);
    expect(out).toEqual([]);
  });

  it('captures 1-indexed line numbers', () => {
    const out = parsePython(`# comment\nimport os\n`);
    expect(out[0].line).toBe(2);
  });
});
