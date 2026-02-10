import { ApiClient } from './api-client.js';
import { getApiKey, getAutotunezKey, getServerUrl, getModelPreference } from './config.js';

export interface AgentResponse {
  type: 'clarification' | 'prompt';
  content: string;
}

export class ApiKeyRequiredError extends Error {
  constructor(type: 'anthropic' | 'autotunez' = 'anthropic') {
    if (type === 'autotunez') {
      super(
        'autotunez API key not configured.\n\n' +
          'Get your free API key at: https://autotunez.dev/dashboard'
      );
    } else {
      super(
        'Anthropic API key not configured.\n\n' +
          'To use autotunez, you need an Anthropic API key:\n' +
          '1. Get your key at: https://console.anthropic.com\n' +
          '2. Run: autotunez config --set-key'
      );
    }
    this.name = 'ApiKeyRequiredError';
  }
}

function getApiClient(): ApiClient {
  const anthropicKey = getApiKey();
  const autotunezKey = getAutotunezKey();

  if (!autotunezKey) {
    throw new ApiKeyRequiredError('autotunez');
  }
  if (!anthropicKey) {
    throw new ApiKeyRequiredError('anthropic');
  }

  const modelPreference = getModelPreference();
  return new ApiClient({
    autotunezKey,
    anthropicKey,
    serverUrl: getServerUrl(),
    modelPreference: modelPreference !== 'auto' ? modelPreference : undefined,
  });
}

export interface TransformOptions {
  claudeMd?: string;
  scratchpad?: string;
  plan?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastClaudeOutput?: string; // Last output from Claude Code for context
}

export async function transformPrompt(
  _apiKey: string, // Kept for backward compatibility
  userInput: string,
  context?: string,
  conversationHistoryOrOptions?: Array<{ role: 'user' | 'assistant'; content: string }> | TransformOptions
): Promise<AgentResponse> {
  const apiClient = getApiClient();

  // Handle both old and new call signatures
  if (Array.isArray(conversationHistoryOrOptions)) {
    // Old signature: transformPrompt(apiKey, input, claudeMd, conversationHistory)
    return apiClient.transform(userInput, context || '', undefined, undefined, conversationHistoryOrOptions);
  } else if (conversationHistoryOrOptions) {
    // New signature: transformPrompt(apiKey, input, claudeMd, options)
    const opts = conversationHistoryOrOptions;
    return apiClient.transform(
      userInput,
      opts.claudeMd || context || '',
      opts.scratchpad,
      opts.plan,
      opts.conversationHistory,
      opts.lastClaudeOutput
    );
  } else {
    return apiClient.transform(userInput, context || '', undefined, undefined, undefined);
  }
}

export async function chatStructured(
  _apiKey: string, // Kept for backward compatibility
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<AgentResponse> {
  const apiClient = getApiClient();
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const history = messages.slice(0, -1);
  return apiClient.transform(
    lastUserMsg?.content || '',
    '',
    undefined,
    undefined,
    history
  );
}

export interface CompactResult {
  summary: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  originalCount: number;
  summarizedCount: number;
}

export async function compactConversation(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  keepRecent: number = 4
): Promise<CompactResult> {
  const apiClient = getApiClient();
  return apiClient.compact(messages, keepRecent);
}

export interface LearnResult {
  rule: string;
  category: 'always' | 'ask_first' | 'never';
  explanation: string;
}

export async function learnFromConversation(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  claudeMd: string
): Promise<LearnResult> {
  const apiClient = getApiClient();
  return apiClient.learn(messages, claudeMd);
}
