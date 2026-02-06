export type Backend = 'claude-code' | 'api';

export interface LumikoConfig {
  version: number;
  project: {
    name: string;
    description: string;
  };
  include: string[];
  exclude: string[];
  output: {
    directory: string;
    formats: ('markdown' | 'context')[];
  };
  docs: {
    readme: boolean;
    architecture: boolean;
    api: boolean;
    dataFlow?: boolean;
    diagrams: boolean;
  };
  claude: {
    backend: Backend;
    model: string;
    maxTokens: number;
  };
}

export interface ScannedFile {
  path: string;
  content: string;
  size: number;
  lines: number;
  extension: string;
}

export interface GeneratedDocs {
  readme: string;
  architecture: string;
  api: string;
  context: Record<string, unknown>;
}

/** Common interface for both backends */
export interface DocGenerator {
  generateDocs(files: ScannedFile[], projectName: string): Promise<GeneratedDocs>;
  generateContext(files: ScannedFile[], projectName: string): Promise<Record<string, unknown>>;
}
