import { transformPrompt, ApiKeyRequiredError } from '../agent.js';

export interface InteractiveHandlerOptions {
  cwd: string;
  projectContext?: string;
  scratchpad?: string;
  plan?: string;
}

export interface InputResult {
  type: 'passthrough' | 'prompt' | 'clarification' | 'error';
  content: string;
}

export function createInteractiveHandler(opts: InteractiveHandlerOptions) {
  const { projectContext, scratchpad, plan } = opts;

  async function processInput(input: string): Promise<InputResult> {
    const trimmed = input.trim();
    if (!trimmed) {
      return { type: 'passthrough', content: '' };
    }

    // Pass through slash commands and single-char confirmations
    const isPassThrough = trimmed.startsWith('/') || trimmed.length === 1;
    if (isPassThrough) {
      return { type: 'passthrough', content: trimmed };
    }

    // Without context, pass through directly
    if (!projectContext) {
      return { type: 'passthrough', content: trimmed };
    }

    // Transform with context
    try {
      const result = await transformPrompt(trimmed, projectContext, {
        claudeMd: projectContext,
        scratchpad,
        plan,
      });
      return { type: result.type === 'prompt' ? 'prompt' : 'clarification', content: result.content };
    } catch (error) {
      if (error instanceof ApiKeyRequiredError) {
        return { type: 'error', content: error.message };
      }
      // On transform failure, pass through raw input
      return { type: 'passthrough', content: trimmed };
    }
  }

  return { processInput };
}
