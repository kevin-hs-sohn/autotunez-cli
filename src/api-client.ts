// Server API client for autotunez CLI
// BYOK (Bring Your Own Key) - uses user's Anthropic API key

import type {
  InterviewRequest,
  InterviewResponse,
  ExtractRequest,
  ExtractResponse,
  ScaffoldRequest,
  ScaffoldResponse,
  TransformRequest,
  TransformResponse,
  FixRequest,
  FixResponse,
  CompactRequest,
  CompactResponse,
  LearnRequest,
  LearnResponse,
  ApiError,
  ModelTier,
} from './api-types.js';
import type {
  ProjectConfig,
  FSDPlanRequest,
  FSDPlanResponse,
} from './types.js';

const DEFAULT_SERVER_URL = process.env.AUTOTUNEZ_SERVER_URL || 'https://autotunez.vercel.app';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;

export class ApiClient {
  private baseUrl: string;
  private autotunezKey: string | undefined;
  private anthropicKey: string | undefined;
  private modelPreference: ModelTier | undefined;
  private complexityHint: string | undefined;

  constructor(options: {
    serverUrl?: string;
    apiKey?: string;  // Legacy: will be used as autotunezKey
    autotunezKey?: string;
    anthropicKey?: string;
    modelPreference?: ModelTier;
  } = {}) {
    this.baseUrl = (options.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, '');
    this.autotunezKey = options.autotunezKey || options.apiKey;
    this.anthropicKey = options.anthropicKey;
    this.modelPreference = options.modelPreference;
  }

  setApiKey(key: string): void {
    // Legacy method - sets autotunez key
    this.autotunezKey = key;
  }

  setAutotunezKey(key: string): void {
    this.autotunezKey = key;
  }

  setAnthropicKey(key: string): void {
    this.anthropicKey = key;
  }

  setComplexityHint(hint: string): void {
    this.complexityHint = hint;
  }

  private async request<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
    if (!this.autotunezKey) {
      throw new Error(
        'autotunez API key not configured. Get one at: https://autotunez.dev/dashboard'
      );
    }

    if (!this.anthropicKey) {
      throw new Error(
        'Anthropic API key not configured. Run: autotunez config --set-key'
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Autotunez-Key': this.autotunezKey,
      'X-API-Key': this.anthropicKey,
    };

    if (this.modelPreference) {
      headers['X-Model-Preference'] = this.modelPreference;
    }

    if (this.complexityHint) {
      headers['X-Complexity-Hint'] = this.complexityHint;
    }

    return this.fetchWithRetry<TRes>(
      `${this.baseUrl}${path}`,
      { method: 'POST', headers, body: JSON.stringify(body) }
    );
  }

  private async fetchWithRetry<TRes>(
    url: string,
    init: RequestInit,
    retries: number = MAX_RETRIES
  ): Promise<TRes> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timer);

        if (response.ok) {
          return response.json() as Promise<TRes>;
        }

        const error = (await response.json().catch(() => ({
          code: 'NETWORK_ERROR',
          message: `Server returned ${response.status}: ${response.statusText}`,
        }))) as ApiError;

        // Non-retryable client errors (4xx except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          if (response.status === 401) {
            throw new Error(
              `API key error: ${error.message}\n` +
              'Get a valid key at: https://console.anthropic.com'
            );
          }
          throw new Error(`API error (${error.code}): ${error.message}`);
        }

        // 429: respect Retry-After header
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // 5xx: exponential backoff
        lastError = new Error(`API error (${error.code}): ${error.message}`);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          lastError = new Error('Request timed out. Check your network connection and try again.');
        } else if (err instanceof Error && (err.message.startsWith('API key error') || err.message.startsWith('API error'))) {
          throw err; // Non-retryable errors
        } else {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // Exponential backoff before retry (skip on last attempt)
      if (attempt < retries - 1) {
        await this.sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- API endpoints ---

  async interview(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    mode: 'beginner' | 'expert'
  ): Promise<InterviewResponse> {
    return this.request<InterviewRequest, InterviewResponse>(
      '/api/v1/interview',
      { messages, mode }
    );
  }

  async extract(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<ExtractResponse> {
    return this.request<ExtractRequest, ExtractResponse>(
      '/api/v1/extract',
      { messages }
    );
  }

  async scaffold(config: ProjectConfig): Promise<ScaffoldResponse> {
    return this.request<ScaffoldRequest, ScaffoldResponse>(
      '/api/v1/scaffold',
      { config }
    );
  }

  async transform(
    input: string,
    claudeMd: string,
    scratchpad?: string,
    plan?: string,
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>,
    lastClaudeOutput?: string
  ): Promise<TransformResponse> {
    return this.request<TransformRequest, TransformResponse>(
      '/api/v1/transform',
      { input, claudeMd, scratchpad, plan, conversationHistory, lastClaudeOutput }
    );
  }

  async fix(
    error: string,
    errorType: 'typecheck' | 'build' | 'test' | 'lint',
    claudeMd: string
  ): Promise<FixResponse> {
    return this.request<FixRequest, FixResponse>('/api/v1/fix', {
      error,
      errorType,
      claudeMd,
    });
  }

  async compact(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    keepRecent: number = 4
  ): Promise<CompactResponse> {
    return this.request<CompactRequest, CompactResponse>('/api/v1/compact', {
      messages,
      keepRecent,
    });
  }

  async learn(
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    claudeMd: string
  ): Promise<LearnResponse> {
    return this.request<LearnRequest, LearnResponse>('/api/v1/learn', {
      conversationHistory,
      claudeMd,
    });
  }

  // --- FSD Mode ---

  async generateFSDPlan(params: {
    goal: string;
    claudeMd?: string;
    scratchpad?: string;
    codebaseContext?: string;
  }): Promise<FSDPlanResponse> {
    return this.request<FSDPlanRequest, FSDPlanResponse>('/api/v1/fsd/plan', params);
  }

  // --- Usage/Credits ---

  async getUsage(): Promise<{
    totalCredits: number;
    usedCredits: number;
    freeCreditsRemaining: number;
  }> {
    if (!this.autotunezKey) {
      throw new Error('autotunez API key not configured');
    }

    return this.fetchWithRetry<{
      totalCredits: number;
      usedCredits: number;
      freeCreditsRemaining: number;
    }>(
      `${this.baseUrl}/api/v1/usage`,
      {
        method: 'GET',
        headers: { 'X-Autotunez-Key': this.autotunezKey },
      }
    );
  }
}
