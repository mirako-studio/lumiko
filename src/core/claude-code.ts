import { execFile, spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { LumikoConfig, ScannedFile, GeneratedDocs, DocGenerator } from '../types/index.js';
import {
  buildCodebaseContext,
  buildClaudeCodeInstruction,
  buildContextPrompt,
  buildContextInstruction,
} from './prompts.js';
import { parseGeneratedResponse, isDocsEmpty } from './parse.js';

export class ClaudeCodeClient implements DocGenerator {
  private config: LumikoConfig;
  private verbose: boolean;

  constructor(config: LumikoConfig, verbose = false) {
    this.config = config;
    this.verbose = verbose;
  }

  /**
   * Check that the `claude` CLI is installed and accessible.
   */
  static async check(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('claude', ['--version'], (error) => {
        if (error) {
          reject(
            new Error(
              'Claude Code CLI not found.\n\n' +
                'Install it first:\n' +
                '  npm install -g @anthropic-ai/claude-code\n\n' +
                'Or switch to API mode in .lumiko/config.yaml:\n' +
                '  claude:\n' +
                '    backend: api',
            ),
          );
        } else {
          resolve();
        }
      });
    });
  }

  async generateDocs(files: ScannedFile[], projectName: string): Promise<GeneratedDocs> {
    const context = buildCodebaseContext(files, projectName, this.config);
    const instruction = buildClaudeCodeInstruction();

    if (this.verbose) {
      console.log(`\n[verbose] Docs instruction (${instruction.length} chars)`);
      console.log(`[verbose] Docs context size: ${formatBytes(context.length)}`);
    }

    const rawOutput = await this.runClaude(instruction, context);
    const cleaned = stripAnsi(rawOutput);

    if (this.verbose) {
      console.log('\n--- RAW DOCS OUTPUT ---');
      console.log(cleaned.slice(0, 3000));
      if (cleaned.length > 3000) {
        console.log(`... (${cleaned.length - 3000} more chars)`);
      }
      console.log('--- END RAW OUTPUT ---\n');
    }

    const docs = parseGeneratedResponse(cleaned);

    if (isDocsEmpty(docs)) {
      const debugDir = path.join(process.cwd(), '.lumiko');
      await fs.mkdir(debugDir, { recursive: true });
      await fs.writeFile(path.join(debugDir, 'last-response.txt'), cleaned || '(empty response)');

      throw new Error(
        'Claude responded, but the output could not be parsed.\n\n' +
          `Raw response saved to: .lumiko/last-response.txt (${formatBytes(cleaned.length)})\n\n` +
          'This usually means Claude did not use the expected delimiter format.\n' +
          'Try running again, or use: lumiko generate --verbose',
      );
    }

    return docs;
  }

  async generateContext(files: ScannedFile[], projectName: string): Promise<Record<string, unknown>> {
    const contextPrompt = buildContextPrompt(files, projectName, this.config);
    const instruction = buildContextInstruction();

    if (this.verbose) {
      console.log(`\n[verbose] Context instruction (${instruction.length} chars)`);
      console.log(`[verbose] Context prompt size: ${formatBytes(contextPrompt.length)}`);
    }

    const rawOutput = await this.runClaude(instruction, contextPrompt);
    const cleaned = stripAnsi(rawOutput).trim();

    if (this.verbose) {
      console.log('\n--- RAW CONTEXT OUTPUT ---');
      console.log(cleaned.slice(0, 2000));
      if (cleaned.length > 2000) {
        console.log(`... (${cleaned.length - 2000} more chars)`);
      }
      console.log('--- END RAW OUTPUT ---\n');
    }

    // Strip markdown code fences if Claude wrapped the JSON anyway
    let jsonStr = cleaned;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      // Save the raw output for debugging
      const debugDir = path.join(process.cwd(), '.lumiko');
      await fs.mkdir(debugDir, { recursive: true });
      await fs.writeFile(path.join(debugDir, 'last-context-response.txt'), cleaned);

      throw new Error(
        'Failed to parse context.json — Claude did not return valid JSON.\n\n' +
          `Raw response saved to: .lumiko/last-context-response.txt (${formatBytes(cleaned.length)})\n` +
          'Try running again, or use: lumiko generate --verbose',
      );
    }
  }

  /**
   * Spawn `claude` directly (no shell), pipe data via stdin.
   *
   * --print is a boolean flag (non-interactive mode).
   * The instruction is the positional prompt argument.
   * stdin data is read by Claude as additional context.
   */
  private runClaude(instruction: string, stdinData: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '--print',
        '--output-format', 'text',
        instruction,
      ];

      // NOTE: We intentionally do NOT pass --model to Claude Code.
      // The --model flag causes empty responses when combined with large
      // stdin data. Claude Code uses the user's subscription model.

      if (this.verbose) {
        console.log(`[verbose] spawn: claude ${args.map(a => a.length > 60 ? `"${a.slice(0, 60)}..."` : `"${a}"`).join(' ')}`);
      }

      const proc = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600_000,
        cwd: os.tmpdir(),
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start Claude Code: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          const msg = stderr.trim() || stdout.trim() || `Claude Code exited with code ${code}`;
          reject(new Error(`Claude Code error: ${msg}`));
        }
      });

      proc.stdin.write(stdinData);
      proc.stdin.end();
    });
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
