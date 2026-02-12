/**
 * Agent Executor: wraps the Claude Agent SDK query() function.
 *
 * This is the core execution layer shared between CLI and Cloud.
 * It accepts an ExecutionEnvironment and returns an ExecutionResult,
 * streaming events through callbacks.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  ExecutionEnvironment,
  AgentExecutorOptions,
  ExecutionResult,
  CostSnapshot,
  ModelUsageEntry,
} from './types.js';
import { adaptSDKMessage } from './stream-adapter.js';

/**
 * Simplified options for direct use (without ExecutionEnvironment wrapper).
 * This is a convenience interface for CLI callers.
 */
export interface SimpleExecutorOptions {
  cwd?: string;
  resumeSessionId?: string;
  maxBudgetUsd?: number;
  model?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  loadProjectSettings?: boolean;
  onStreamEvent?: (event: { type: string; content: string }) => void;
  onCostUpdate?: (cost: CostSnapshot) => void;
}

/**
 * Execute a prompt using the Agent SDK.
 *
 * This is the primary entry point for agent execution.
 * Can be called with either full AgentExecutorOptions or SimpleExecutorOptions.
 */
export async function execute(
  prompt: string,
  options: AgentExecutorOptions | SimpleExecutorOptions,
): Promise<ExecutionResult> {
  // Normalize options
  const env = isFullOptions(options)
    ? options.environment
    : toEnvironment(options);

  const sdkOpts = isFullOptions(options)
    ? buildSDKOptions(options)
    : buildSDKOptionsFromSimple(options);

  // Execute query
  const stream = query({ prompt, options: sdkOpts });

  // Default result
  let result: ExecutionResult = {
    success: false,
    output: '',
    sessionId: '',
    cost: { totalCostUsd: 0, inputTokens: 0, outputTokens: 0, modelUsage: {} },
    numTurns: 0,
    durationMs: 0,
  };

  for await (const message of stream) {
    const msg = message as Record<string, unknown>;

    if (msg.type === 'assistant') {
      const events = adaptSDKMessage(msg);
      for (const event of events) {
        env.onStreamEvent(event);
      }
    } else if (msg.type === 'result') {
      const usage = msg.usage as Record<string, number> | undefined;
      const cost: CostSnapshot = {
        totalCostUsd: (msg.total_cost_usd as number) || 0,
        inputTokens: usage?.input_tokens || 0,
        outputTokens: usage?.output_tokens || 0,
        modelUsage: (msg.modelUsage as Record<string, ModelUsageEntry>) || {},
      };

      if (env.onCostUpdate) {
        env.onCostUpdate(cost);
      }

      const subtype = msg.subtype as string;
      const isSuccess = subtype === 'success';

      result = {
        success: isSuccess,
        output: isSuccess ? (msg.result as string) || '' : '',
        sessionId: (msg.session_id as string) || '',
        cost,
        numTurns: (msg.num_turns as number) || 0,
        durationMs: (msg.duration_ms as number) || 0,
      };

      if (!isSuccess && msg.errors) {
        result.errors = msg.errors as string[];
      }
    }
  }

  return result;
}

// ── Internal helpers ───────────────────────────────────────────────────────

function isFullOptions(
  options: AgentExecutorOptions | SimpleExecutorOptions,
): options is AgentExecutorOptions {
  return 'environment' in options;
}

function toEnvironment(options: SimpleExecutorOptions): ExecutionEnvironment {
  return {
    cwd: options.cwd || process.cwd(),
    env: options.env ? { ...process.env as Record<string, string>, ...options.env } : process.env as Record<string, string>,
    onStreamEvent: options.onStreamEvent || (() => {}),
    onCostUpdate: options.onCostUpdate,
    abortSignal: options.abortSignal,
  };
}

function buildSDKOptions(options: AgentExecutorOptions): Record<string, unknown> {
  const env = options.environment;
  const abortController = new AbortController();
  if (env.abortSignal) {
    env.abortSignal.addEventListener('abort', () => abortController.abort());
  }

  const sdkOpts: Record<string, unknown> = {
    cwd: env.cwd,
    env: env.env,
    permissionMode: options.permissionMode || 'bypassPermissions',
    allowDangerouslySkipPermissions: (options.permissionMode || 'bypassPermissions') === 'bypassPermissions',
    abortController,
  };

  if (options.resumeSessionId) sdkOpts.resume = options.resumeSessionId;
  if (options.maxBudgetUsd !== undefined) sdkOpts.maxBudgetUsd = options.maxBudgetUsd;
  if (options.model) sdkOpts.model = options.model;
  if (options.systemPrompt) sdkOpts.systemPrompt = options.systemPrompt;
  if (options.allowedTools) sdkOpts.allowedTools = options.allowedTools;
  if (options.loadProjectSettings) sdkOpts.settingSources = ['project'];

  return sdkOpts;
}

function buildSDKOptionsFromSimple(options: SimpleExecutorOptions): Record<string, unknown> {
  const abortController = new AbortController();
  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', () => abortController.abort());
  }

  const sdkOpts: Record<string, unknown> = {
    cwd: options.cwd || process.cwd(),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    abortController,
  };

  if (options.resumeSessionId) sdkOpts.resume = options.resumeSessionId;
  if (options.maxBudgetUsd !== undefined) sdkOpts.maxBudgetUsd = options.maxBudgetUsd;
  if (options.model) sdkOpts.model = options.model;
  if (options.systemPrompt) sdkOpts.systemPrompt = options.systemPrompt;
  if (options.loadProjectSettings) sdkOpts.settingSources = ['project'];

  if (options.env) {
    sdkOpts.env = { ...process.env, ...options.env };
  }

  return sdkOpts;
}
