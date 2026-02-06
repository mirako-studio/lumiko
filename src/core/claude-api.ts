import Anthropic from '@anthropic-ai/sdk';
import type { LumikoConfig, ScannedFile, GeneratedDocs, DocGenerator } from '../types/index.js';
import { buildApiPrompt, buildContextPrompt } from './prompts.js';
import { parseGeneratedResponse } from './parse.js';

export class ClaudeApiClient implements DocGenerator {
  private client: Anthropic;
  private config: LumikoConfig;

  constructor(config: LumikoConfig) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY not found.\n\n' +
          'Set it in your environment:\n' +
          '  export ANTHROPIC_API_KEY=sk-ant-xxxxx\n\n' +
          'Or switch to Claude Code mode (uses your subscription):\n' +
          '  claude:\n' +
          '    backend: claude-code',
      );
    }

    this.client = new Anthropic({ apiKey });
    this.config = config;
  }

  async generateDocs(files: ScannedFile[], projectName: string): Promise<GeneratedDocs> {
    const prompt = buildApiPrompt(files, projectName, this.config);

    const response = await this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: this.config.claude.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const docs = parseGeneratedResponse(content);

    return {
      ...docs,
      _usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    } as GeneratedDocs & { _usage: { inputTokens: number; outputTokens: number } };
  }

  async generateContext(files: ScannedFile[], projectName: string): Promise<Record<string, unknown>> {
    const prompt = buildContextPrompt(files, projectName, this.config);

    const response = await this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: this.config.claude.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    // Strip markdown code fences if present
    let jsonStr = content;
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    return JSON.parse(jsonStr);
  }
}
