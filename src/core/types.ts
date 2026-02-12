/**
 * Core types shared between CLI and Cloud interfaces.
 *
 * These types define the contract for the autotunez execution layer,
 * abstracting over the underlying Agent SDK.
 */

// ── Execution Environment ──────────────────────────────────────────────────

/**
 * Defines the execution environment for an agent.
 * CLI: cwd = process.cwd(), env = process.env
 * Cloud: cwd = /sandbox/<project-id>, env = sandbox env
 */
export interface ExecutionEnvironment {
  /** Working directory for the agent */
  cwd: string;
  /** Environment variables (includes API key for BYOK) */
  env: Record<string, string>;
  /** Callback for real-time stream events */
  onStreamEvent: (event: StreamEvent) => void;
  /** Callback for cost updates */
  onCostUpdate?: (cost: CostSnapshot) => void;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

// ── Agent Executor Options ─────────────────────────────────────────────────

export interface AgentExecutorOptions {
  /** Execution environment */
  environment: ExecutionEnvironment;
  /** Claude model to use */
  model?: string;
  /** Maximum budget in USD */
  maxBudgetUsd?: number;
  /** Permission mode */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  /** System prompt */
  systemPrompt?: string;
  /** Allowed tools */
  allowedTools?: string[];
  /** Session ID to resume */
  resumeSessionId?: string;
  /** Load CLAUDE.md and project settings */
  loadProjectSettings?: boolean;
}

// ── Stream Events ──────────────────────────────────────────────────────────

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'cost' | 'session';
  content: string;
  metadata?: Record<string, unknown>;
}

// ── Cost Tracking ──────────────────────────────────────────────────────────

export interface CostSnapshot {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelUsage: Record<string, ModelUsageEntry>;
}

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

// ── Billing ────────────────────────────────────────────────────────────────

export type BillingMode = 'byok' | 'managed';
export type BillingContext = 'cli' | 'cloud';

export interface BillingConfig {
  mode: BillingMode;
  context: BillingContext;
}

export interface ChargeResult {
  /** Credits to charge the user */
  chargedCredits: number;
  /** Markup rate applied */
  markupRate: number;
  /** Original cost in USD (from SDK) */
  actualCostUsd: number;
  /** Final cost in USD (after markup) */
  finalCostUsd: number;
}

// ── Execution Result ───────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  output: string;
  sessionId: string;
  cost: CostSnapshot;
  numTurns: number;
  durationMs: number;
  errors?: string[];
}
