/**
 * Core package barrel export.
 *
 * Re-exports all public types, functions, and constants
 * for use by CLI and Cloud consumers.
 */

// Types
export type {
  ExecutionEnvironment,
  AgentExecutorOptions,
  StreamEvent,
  CostSnapshot,
  ModelUsageEntry,
  BillingMode,
  BillingContext,
  BillingConfig,
  ChargeResult,
  ExecutionResult,
} from './types.js';

// Agent executor
export { execute } from './agent-executor.js';
export type { SimpleExecutorOptions } from './agent-executor.js';

// Stream adapter
export { adaptSDKMessage, formatToolUse } from './stream-adapter.js';

// Cost tracker
export { calculateCharge, MARKUP_RATES } from './cost-tracker.js';
