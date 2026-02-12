/**
 * Legacy agent-sdk-executor module.
 *
 * This file re-exports from src/core/ for backward compatibility.
 * New code should import from './core/index.js' directly.
 *
 * @deprecated Use imports from './core/index.js' instead.
 */

import { execute } from './core/agent-executor.js';
import type { SimpleExecutorOptions } from './core/agent-executor.js';
import type {
  CostSnapshot,
  ModelUsageEntry,
  ExecutionResult,
  StreamEvent,
} from './core/types.js';

// ── Legacy type aliases ─────────────────────────────────────────────────────

export type AgentSDKStreamEvent = StreamEvent;
export type AgentSDKExecutionResult = ExecutionResult;
export type AgentSDKExecutorOptions = SimpleExecutorOptions;
export type { CostSnapshot, ModelUsageEntry };

// ── Legacy function wrapper ─────────────────────────────────────────────────

export async function executeWithAgentSDK(
  prompt: string,
  options: AgentSDKExecutorOptions = {},
): Promise<AgentSDKExecutionResult> {
  return execute(prompt, options);
}
