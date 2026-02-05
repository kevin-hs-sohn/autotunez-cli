// Extraction utilities for converting conversation → ProjectConfig
// Pure functions only — no LLM SDK dependency

import { ProjectConfig, VibeError } from './types.js';

export const EXTRACTION_PROMPT = `You are a project architect. Given a conversation about creating an app, extract a complete project design that another AI can use to build it.

Return a JSON object with these fields:

{
  "name": "project-name-in-kebab-case",
  "description": "Clear 1-2 sentence description",
  "problem": "What problem does this solve? Who is it for?",
  "techStack": {
    "platform": "web | mobile | desktop | cli",
    "framework": "Recommended framework (e.g., Next.js, React Native, Node.js)",
    "styling": "Recommended styling (e.g., Tailwind CSS, CSS Modules)",
    "database": "none | localStorage | Supabase | Firebase | PostgreSQL",
    "auth": "none | simple | oauth",
    "reasoning": "Brief explanation of why this stack"
  },
  "dataModel": [
    {
      "name": "EntityName",
      "fields": ["id: string", "name: string", "createdAt: Date"],
      "description": "What this entity represents"
    }
  ],
  "features": {
    "mvp": ["Core feature 1", "Core feature 2", "Core feature 3"],
    "future": ["Nice-to-have 1", "Nice-to-have 2"]
  },
  "implementation": {
    "coreComponents": ["Component1 - what it does", "Component2 - what it does"],
    "steps": [
      "1. First implement X because...",
      "2. Then implement Y...",
      "3. Finally add Z..."
    ],
    "firstStep": "Specific instruction for what to build first"
  }
}

Rules:
- Make sensible technical decisions based on the conversation
- If something wasn't discussed, infer the simplest reasonable choice
- For non-technical users, prefer simpler stacks (localStorage over DB, no auth if not needed)
- Be specific in implementation steps - this will guide actual development
- dataModel should reflect the core entities the app needs

Return ONLY valid JSON, no markdown or explanation.`;

/**
 * Format conversation messages into a text block for LLM extraction.
 */
export function formatConversation(
  messages: Array<{ role: string; content: string }>
): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
}

const DEFAULT_TECH_STACK = {
  platform: 'web',
  framework: 'Next.js',
  styling: 'Tailwind CSS',
  database: 'localStorage',
  auth: 'none',
  reasoning: 'Simple web app with local storage for MVP',
};

const DEFAULT_IMPLEMENTATION = {
  coreComponents: [],
  steps: [],
  firstStep: 'Set up the project and create the basic UI structure',
};

/**
 * Remove trailing commas from JSON string (common LLM mistake).
 */
function removeTrailingCommas(json: string): string {
  // Remove trailing commas before ] or }
  return json.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Parse raw LLM text output into a validated ProjectConfig.
 * Throws VibeError if JSON parsing fails or required fields are missing.
 */
export function parseProjectConfig(text: string): ProjectConfig {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new VibeError(
      'PARSE_ERROR',
      'Failed to parse project info from LLM response. Expected JSON object.'
    );
  }

  let raw: Record<string, unknown>;
  const jsonString = removeTrailingCommas(jsonMatch[0]);
  try {
    raw = JSON.parse(jsonString);
  } catch {
    throw new VibeError(
      'PARSE_ERROR',
      'Failed to parse JSON from LLM response. The response was not valid JSON.'
    );
  }

  if (!raw.name || !raw.description) {
    throw new VibeError(
      'INVALID_DATA',
      'Missing required project info: name and description are required.'
    );
  }

  return {
    name: raw.name as string,
    description: raw.description as string,
    problem: (raw.problem as string) || (raw.description as string),
    techStack: (raw.techStack as ProjectConfig['techStack']) || DEFAULT_TECH_STACK,
    dataModel: (raw.dataModel as ProjectConfig['dataModel']) || [],
    features: (raw.features as ProjectConfig['features']) || { mvp: [], future: [] },
    implementation:
      (raw.implementation as ProjectConfig['implementation']) || DEFAULT_IMPLEMENTATION,
  };
}
