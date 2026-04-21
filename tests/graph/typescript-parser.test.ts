import { describe, it, expect } from 'vitest';
import { parseTypescript } from '../../src/graph/parsers/typescript.js';

describe('parseTypescript — default imports', () => {
  it('captures `import foo from "x"`', () => {
    const out = parseTypescript(`import foo from 'x';`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'default',
      symbols: ['foo'],
    });
  });
});

describe('parseTypescript — named imports', () => {
  it('captures `import { a, b } from "x"`', () => {
    const out = parseTypescript(`import { a, b } from 'x';`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'named',
      symbols: ['a', 'b'],
    });
  });

  it('unwraps `as` aliases to the original name', () => {
    const out = parseTypescript(`import { foo as f, bar } from 'x';`);
    expect(out[0].symbols).toEqual(['foo', 'bar']);
  });

  it('handles multi-line named imports', () => {
    const src = `import {
  a,
  b,
  c,
} from 'x';`;
    const out = parseTypescript(src);
    expect(out[0].symbols).toEqual(['a', 'b', 'c']);
  });

  it('strips leading `type` keyword from named imports', () => {
    const out = parseTypescript(`import { type T, U } from 'x';`);
    expect(out[0].symbols).toEqual(['T', 'U']);
  });
});

describe('parseTypescript — namespace imports', () => {
  it('captures `import * as foo from "x"`', () => {
    const out = parseTypescript(`import * as foo from 'x';`);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'namespace',
      symbols: ['*'],
    });
  });
});

describe('parseTypescript — side-effect imports', () => {
  it('captures `import "x"`', () => {
    const out = parseTypescript(`import 'polyfill';`);
    expect(out.some((i) => i.source === 'polyfill' && i.style === 'side-effect')).toBe(true);
  });
});

describe('parseTypescript — mixed imports', () => {
  it('captures default + named', () => {
    const out = parseTypescript(`import foo, { a, b } from 'x';`);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'named',
      symbols: ['foo', 'a', 'b'],
    });
  });

  it('captures default + namespace', () => {
    const out = parseTypescript(`import foo, * as ns from 'x';`);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'namespace',
      symbols: ['foo', '*'],
    });
  });
});

describe('parseTypescript — type-only imports', () => {
  it('captures `import type { T } from "x"`', () => {
    const out = parseTypescript(`import type { T, U } from 'x';`);
    expect(out[0].source).toBe('x');
    expect(out[0].symbols).toEqual(['T', 'U']);
  });
});

describe('parseTypescript — re-exports', () => {
  it('captures named re-exports', () => {
    const out = parseTypescript(`export { a, b } from 'x';`);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'named',
      symbols: ['a', 'b'],
    });
  });

  it('captures namespace re-exports', () => {
    const out = parseTypescript(`export * from 'x';`);
    expect(out[0]).toMatchObject({
      source: 'x',
      style: 'namespace',
      symbols: ['*'],
    });
  });
});

describe('parseTypescript — dynamic imports', () => {
  it('captures `await import("x")`', () => {
    const out = parseTypescript(`const x = await import('lazy');`);
    expect(out.some((i) => i.source === 'lazy')).toBe(true);
  });
});

describe('parseTypescript — CommonJS require', () => {
  it('captures `require("x")`', () => {
    const out = parseTypescript(`const fs = require('fs');`);
    expect(out.some((i) => i.source === 'fs')).toBe(true);
  });
});

describe('parseTypescript — edge cases', () => {
  it('ignores imports inside line comments', () => {
    const out = parseTypescript(`// import foo from 'comment';\nimport real from 'real';`);
    expect(out.map((i) => i.source)).toEqual(['real']);
  });

  it('ignores imports inside block comments', () => {
    const out = parseTypescript(`/* import foo from 'comment'; */\nimport real from 'real';`);
    expect(out.map((i) => i.source)).toEqual(['real']);
  });

  it('ignores imports inside string literals', () => {
    const out = parseTypescript(`const s = "import foo from 'fake';";\nimport real from 'real';`);
    expect(out.map((i) => i.source)).toEqual(['real']);
  });

  it('preserves separate import statements on different lines', () => {
    // Two identical import statements on different lines are still two
    // statements. Logical deduplication happens at the graph level in
    // dedupeInternal/dedupeExternal, not in the parser.
    const out = parseTypescript(`import a from 'x';\nimport a from 'x';`);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.line)).toEqual([1, 2]);
  });

  it('captures multiple imports in order', () => {
    const src = `import a from './a.js';
import { b } from './b.js';
import * as c from './c.js';`;
    const out = parseTypescript(src);
    expect(out.map((i) => i.source)).toEqual(['./a.js', './b.js', './c.js']);
  });

  it('reports 1-indexed line numbers', () => {
    const src = `// line 1\nimport a from 'x';`;
    const out = parseTypescript(src);
    expect(out[0].line).toBe(2);
  });

  it('returns empty array for files with no imports', () => {
    const out = parseTypescript(`const x = 1; function f() { return x; }`);
    expect(out).toEqual([]);
  });
});
