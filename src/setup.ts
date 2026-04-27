/**
 * Early-stage process setup for the CLI. Imported FIRST in src/index.ts so
 * it runs before any other module evaluates.
 *
 * Right now the only job is suppressing DEP0040 (Node's `punycode` module
 * deprecation). Some transitive dependency still calls `require('punycode')`
 * against Node's built-in shim; we don't own that code path and can't fix it
 * upstream. Every other warning is re-emitted in Node's default format so
 * real issues still surface.
 */

// Node's default warning handler is a registered listener — removing it lets
// us fully control which warnings get printed.
process.removeAllListeners('warning');

process.on('warning', (warning) => {
  const w = warning as Error & { code?: string; detail?: string };
  if (w.code === 'DEP0040') return; // swallow the punycode noise

  const codePart = w.code ? ` [${w.code}]` : '';
  const header = `(node:${process.pid})${codePart} ${w.name ?? 'Warning'}: ${w.message}`;
  process.stderr.write(header + '\n');
  if (w.detail) process.stderr.write(w.detail + '\n');
});
