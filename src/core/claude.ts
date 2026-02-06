import type { LumikoConfig, DocGenerator, Backend } from '../types/index.js';
import { ClaudeCodeClient } from './claude-code.js';
import { ClaudeApiClient } from './claude-api.js';

export interface CreateClientOptions {
  backendOverride?: Backend;
  verbose?: boolean;
}

/**
 * Create the right doc generator based on config backend.
 * Validates prerequisites (CLI installed / API key present) before returning.
 */
export async function createClient(
  config: LumikoConfig,
  options: CreateClientOptions = {},
): Promise<DocGenerator> {
  const backend = options.backendOverride ?? config.claude.backend;

  if (backend === 'api') {
    return new ClaudeApiClient(config);
  }

  // Default: claude-code
  await ClaudeCodeClient.check();
  return new ClaudeCodeClient(config, options.verbose);
}
