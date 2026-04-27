import chalk from 'chalk';
import type { ScannedFile } from '../types/index.js';

/**
 * Centralized, typography-driven CLI output for lumiko. All commands route
 * through this module so styling stays consistent and future redesigns only
 * touch one file.
 *
 * Design language:
 *   ◆  brand mark (pink)
 *   ▶  phase header (pink)
 *   ✓  scan / success row (green)
 *   +  newly written file (green)
 *   ~  updated file (yellow)
 *   !  warning (yellow)
 *   ✗  failure (red)
 *   ·  spinner / separator (dim or pink)
 */

// ── Color palette ───────────────────────────────────────────────────────

/** Soft pink accent — brand mark, phase headers, spinner. */
const ACCENT = chalk.hex('#e36091');
const BRAND = ACCENT.bold;

// ── Module state (per-process) ──────────────────────────────────────────

let startTime = 0;
let activeSpinner: Spinner | null = null;

/**
 * Reset internal state. Mostly for tests and any consumer that wants a
 * clean timer after multiple commands in the same process.
 */
export function resetReporter(): void {
  startTime = 0;
  if (activeSpinner) {
    activeSpinner.stop();
    activeSpinner = null;
  }
}

// ── Header ──────────────────────────────────────────────────────────────

export interface HeaderOpts {
  version: string;
  backend: string;
  model?: string;
  /** Optional subcommand label shown after version — e.g. "graph", "preset". */
  subcommand?: string;
}

export function printHeader(opts: HeaderOpts): void {
  startTime = Date.now();

  const title = opts.subcommand
    ? `${chalk.bold(`Lumiko v${opts.version}`)} ${chalk.dim('·')} ${chalk.bold(opts.subcommand)}`
    : `${chalk.bold(`Lumiko v${opts.version}`)} ${chalk.dim('· powered by Claude')}`;
  console.log();
  console.log(`${BRAND('◆')} ${title}`);

  const meta: string[] = [chalk.dim('provider:') + ' ' + chalk.gray(opts.backend)];
  if (opts.model) meta.push(chalk.dim('model:') + ' ' + chalk.gray(opts.model));
  console.log('  ' + meta.join(chalk.dim(' · ')));
  console.log();
}

// ── Phase markers ───────────────────────────────────────────────────────

/** Print a new section header. `▶ label` at column 0. */
export function startPhase(label: string): void {
  console.log(`${ACCENT('▶')} ${chalk.bold(label)}`);
}

/** Same as startPhase but with trailing "..." — for in-progress phases. */
export function startPhaseInProgress(label: string): void {
  console.log(`${ACCENT('▶')} ${chalk.bold(label)} ${chalk.dim('…')}`);
}

/** Blank line — visual break between phases. */
export function blank(): void {
  console.log();
}

// ── Row helpers ─────────────────────────────────────────────────────────

export interface FileRowInput {
  path: string;
  loc?: number;
  /** Short descriptor like "core logic" or "4 providers". */
  annotation?: string;
  /** File count for collapsed groups (null for individual files). */
  fileCount?: number | null;
}

/**
 * Print a list of scanned files with aligned annotation columns.
 * Skips alignment if no rows have annotations.
 */
export function scanList(rows: FileRowInput[]): void {
  if (rows.length === 0) return;
  const maxPath = Math.max(...rows.map((r) => r.path.length));
  const hasAnnotations = rows.some((r) => r.annotation || r.loc !== undefined);

  for (const row of rows) {
    const padded = hasAnnotations ? row.path.padEnd(maxPath + 4) : row.path;
    const extras = buildExtras(row);
    console.log(`  ${chalk.green('✓')} ${chalk.gray(padded)}${extras}`);
  }
}

function buildExtras(row: FileRowInput): string {
  const parts: string[] = [];
  if (row.annotation) parts.push(row.annotation);
  if (row.loc !== undefined) parts.push(`${row.loc.toLocaleString()} loc`);
  if (parts.length === 0) return '';
  return chalk.dim(parts.join(' · '));
}

/** Single created-file row. Used by write phases. */
export function outputRow(path: string, size: string, kind: 'created' | 'updated' | 'warning' = 'created'): void {
  const glyph =
    kind === 'created' ? chalk.green('+') : kind === 'updated' ? chalk.yellow('~') : chalk.yellow('!');
  console.log(`  ${glyph} ${chalk.gray(path)}  ${chalk.dim(size)}`);
}

/**
 * Print multiple output rows with aligned size column.
 */
export function outputList(
  rows: Array<{ path: string; size: string; kind?: 'created' | 'updated' | 'warning' }>,
): void {
  if (rows.length === 0) return;
  const maxPath = Math.max(...rows.map((r) => r.path.length));
  for (const row of rows) {
    const glyph =
      row.kind === 'updated'
        ? chalk.yellow('~')
        : row.kind === 'warning'
          ? chalk.yellow('!')
          : chalk.green('+');
    const padded = row.path.padEnd(maxPath + 2);
    console.log(`  ${glyph} ${chalk.gray(padded)}${chalk.dim(row.size)}`);
  }
}

// ── Plain lines ─────────────────────────────────────────────────────────

export function info(message: string): void {
  console.log(`  ${chalk.dim(message)}`);
}

export function success(message: string): void {
  console.log(`  ${chalk.green('✓')} ${message}`);
}

export function warn(message: string): void {
  console.log(`  ${chalk.yellow('!')} ${message}`);
}

export function error(message: string): void {
  console.log(`  ${chalk.red('✗')} ${message}`);
}

// ── Summary ─────────────────────────────────────────────────────────────

export interface SummaryOpts {
  apiCalls?: number;
  /** Optional extra badges appended to the summary line. */
  extras?: string[];
}

export function summary(opts: SummaryOpts = {}): void {
  const elapsedMs = Date.now() - (startTime || Date.now());
  const elapsed = formatElapsed(elapsedMs);
  const parts: string[] = [chalk.bold('done'), elapsed];

  if (opts.apiCalls !== undefined && opts.apiCalls > 0) {
    parts.push(`${opts.apiCalls} API call${opts.apiCalls === 1 ? '' : 's'}`);
  }

  if (opts.extras) parts.push(...opts.extras);

  console.log();
  console.log(chalk.dim(parts.join(chalk.dim(' · '))));
  console.log();
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Spinner (custom, minimalistic) ──────────────────────────────────────

/**
 * A small cycling-dot spinner that replaces ora. Prints at column 2 (to
 * sit under a phase header). Uses `\r` + line clear to avoid stacking.
 */
export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = '';
  private readonly frames = ['·   ', ' ·  ', '  · ', '   ·', '  · ', ' ·  '];

  start(label: string): Spinner {
    this.label = label;
    this.frame = 0;
    if (activeSpinner && activeSpinner !== this) activeSpinner.stop();
    activeSpinner = this;

    // Guard: if stdout isn't a TTY (piped, CI log), just print the label once.
    if (!process.stdout.isTTY) {
      console.log(`  ${chalk.dim(label)}`);
      return this;
    }

    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % this.frames.length;
      this.render();
    }, 120);
    return this;
  }

  update(label: string): void {
    this.label = label;
    if (this.timer) this.render();
  }

  /** Stop the animation and clear the line. No glyph written. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (activeSpinner === this) activeSpinner = null;
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1B[K');
    }
  }

  /** Stop with a green check + label. */
  succeed(label?: string): void {
    const msg = label ?? this.label;
    this.stop();
    console.log(`  ${chalk.green('✓')} ${msg}`);
  }

  /** Stop with a yellow bang + label. */
  warn(label?: string): void {
    const msg = label ?? this.label;
    this.stop();
    console.log(`  ${chalk.yellow('!')} ${msg}`);
  }

  /** Stop with a red cross + label. */
  fail(label?: string): void {
    const msg = label ?? this.label;
    this.stop();
    console.log(`  ${chalk.red('✗')} ${msg}`);
  }

  private render(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write(`\r  ${ACCENT(this.frames[this.frame])} ${chalk.dim(this.label)}\x1B[K`);
  }
}

/** Factory for a new spinner. */
export function spinner(): Spinner {
  return new Spinner();
}

// ── Glob collapse ───────────────────────────────────────────────────────

/**
 * Collapse a scanned-file list into mixed rows: directories with `minGroup`+
 * files of the same extension become a single `path/*.ext` row; others are
 * listed individually. Output is sorted alphabetically by path.
 */
export function collapseScannedFiles(
  files: ScannedFile[],
  minGroup = 3,
): FileRowInput[] {
  const byDir = new Map<string, ScannedFile[]>();
  for (const f of files) {
    const normalized = f.path.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    const dir = slash === -1 ? '.' : normalized.slice(0, slash);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }

  const rows: FileRowInput[] = [];

  for (const dir of Array.from(byDir.keys()).sort()) {
    const filesInDir = byDir.get(dir)!;

    // Group by extension within the directory
    const byExt = new Map<string, ScannedFile[]>();
    for (const f of filesInDir) {
      const ext = f.extension || '(none)';
      if (!byExt.has(ext)) byExt.set(ext, []);
      byExt.get(ext)!.push(f);
    }

    for (const [ext, extFiles] of byExt) {
      if (extFiles.length >= minGroup && ext !== '(none)') {
        const pattern = dir === '.' ? `*${ext}` : `${dir}/*${ext}`;
        const loc = extFiles.reduce((sum, f) => sum + f.lines, 0);
        rows.push({
          path: pattern,
          loc,
          annotation: labelForGroup(dir, extFiles.length),
          fileCount: extFiles.length,
        });
      } else {
        for (const f of extFiles) {
          rows.push({
            path: f.path.replace(/\\/g, '/'),
            loc: f.lines,
            fileCount: null,
          });
        }
      }
    }
  }

  return rows;
}

/**
 * Produce a human-readable label for a collapsed group.
 *   tests/ with 12 files  →  "12 specs"
 *   src/providers/ with 4 →  "4 providers"
 *   src/core/ with 3      →  "3 files"
 *
 * We keep this intentionally simple — just pull the directory basename and
 * append a count. Irregular pluralization isn't worth the complexity.
 */
function labelForGroup(dir: string, count: number): string {
  if (/\b(tests?|__tests__|spec|specs)\b/i.test(dir)) return `${count} specs`;
  const base = dir.split('/').pop() || dir;
  if (!base || base === '.') return `${count} files`;
  // If already plural-looking, use as-is. Otherwise leave the noun alone —
  // "4 providers" reads fine; "3 core" does not, so fall back to "files".
  return base.endsWith('s') ? `${count} ${base}` : `${count} files`;
}
