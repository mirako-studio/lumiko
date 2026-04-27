import Anthropic from '@anthropic-ai/sdk';
import type { LumikoConfig, ScannedFile, GeneratedDocs, DocGenerator, ChunkAnalysis, ContextBundle } from '../types/index.js';
import {
  buildApiPrompt,
  buildContextPrompt,
  buildChunkAnalysisPrompt,
  buildSynthesisPrompt,
  buildContextSynthesisPrompt,
} from './prompts.js';
import { parseGeneratedResponse, parseChunkAnalysis, parseContextBundle, isBundleEmpty } from './parse.js';

export class ClaudeApiClient implements DocGenerator {
  private client: Anthropic;
  private config: LumikoConfig;
  /** Running count of Anthropic API calls this session. */
  private apiCalls = 0;

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

  /** Number of Anthropic API calls made by this client so far. */
  getApiCalls(): number {
    return this.apiCalls;
  }

  private async callClaude(prompt: string): Promise<Anthropic.Message> {
    this.apiCalls++;
    return this.client.messages.create({
      model: this.config.claude.model,
      max_tokens: this.config.claude.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
  }

  async generateDocs(files: ScannedFile[], projectName: string): Promise<GeneratedDocs> {
    const prompt = buildApiPrompt(files, projectName, this.config);

    const response = await this.callClaude(prompt);

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

  async generateContext(files: ScannedFile[], projectName: string): Promise<ContextBundle> {
    const prompt = buildContextPrompt(files, projectName, this.config);

    const response = await this.callClaude(prompt);

    const content = this.extractText(response);
    const { bundle } = parseContextBundle(content);

    if (isBundleEmpty(bundle)) {
      throw new Error(
        'Failed to parse .context/ bundle — Claude did not return any ---FILE:<path>--- entries.',
      );
    }

    return bundle;
  }

  async analyzeChunk(
    files: ScannedFile[],
    chunkLabel: string,
    projectName: string,
  ): Promise<ChunkAnalysis> {
    const prompt = buildChunkAnalysisPrompt(files, chunkLabel, projectName);

    const response = await this.callClaude(prompt);

    const content = this.extractText(response);
    const filePaths = files.map(f => f.path);

    return parseChunkAnalysis(content, 0, chunkLabel, filePaths);
  }

  async synthesizeDocs(
    analyses: ChunkAnalysis[],
    projectName: string,
    config: LumikoConfig,
  ): Promise<GeneratedDocs> {
    const allFilePaths = analyses.flatMap(a => a.files);
    const placeholderFiles: ScannedFile[] = allFilePaths.map(p => ({
      path: p,
      content: '',
      size: 0,
      lines: 0,
      extension: p.includes('.') ? '.' + p.split('.').pop()! : '',
    }));

    const prompt = buildSynthesisPrompt(analyses, projectName, config, placeholderFiles);

    const response = await this.callClaude(prompt);

    const content = this.extractText(response);
    const docs = parseGeneratedResponse(content);

    return {
      ...docs,
      _usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    } as GeneratedDocs & { _usage: { inputTokens: number; outputTokens: number } };
  }

  async synthesizeContext(
    analyses: ChunkAnalysis[],
    files: ScannedFile[],
    projectName: string,
    config: LumikoConfig,
  ): Promise<ContextBundle> {
    const prompt = buildContextSynthesisPrompt(analyses, projectName, config, files);

    const response = await this.callClaude(prompt);

    const content = this.extractText(response);
    const { bundle } = parseContextBundle(content);

    if (isBundleEmpty(bundle)) {
      throw new Error(
        'Failed to parse synthesized .context/ bundle — Claude did not return any ---FILE:<path>--- entries.',
      );
    }

    return bundle;
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
}
