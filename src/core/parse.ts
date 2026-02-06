import type { GeneratedDocs } from '../types/index.js';

/**
 * Parse Claude's response into structured doc sections.
 * Only handles markdown docs — context.json is generated separately.
 */
export function parseGeneratedResponse(content: string): GeneratedDocs {
  const docs: GeneratedDocs = {
    readme: '',
    architecture: '',
    api: '',
    context: {},
  };

  const sections: Array<{ regex: RegExp; key: 'readme' | 'architecture' | 'api' }> = [
    {
      regex: /---\s*README_START\s*---\s*([\s\S]*?)\s*---\s*README_END\s*---/,
      key: 'readme',
    },
    {
      regex: /---\s*ARCHITECTURE_START\s*---\s*([\s\S]*?)\s*---\s*ARCHITECTURE_END\s*---/,
      key: 'architecture',
    },
    {
      regex: /---\s*API_START\s*---\s*([\s\S]*?)\s*---\s*API_END\s*---/,
      key: 'api',
    },
  ];

  for (const { regex, key } of sections) {
    const match = content.match(regex);
    if (match) {
      docs[key] = match[1].trim();
    }
  }

  return docs;
}

/**
 * Check if parsed docs have any real content.
 */
export function isDocsEmpty(docs: GeneratedDocs): boolean {
  return !docs.readme && !docs.architecture && !docs.api;
}
