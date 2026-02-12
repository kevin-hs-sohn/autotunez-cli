import { spawn } from 'child_process';
import { execute } from './core/agent-executor.js';
import type { SimpleExecutorOptions } from './core/agent-executor.js';
import { getApiKey } from './config.js';

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error';
  content: string;
}

export interface ExecutorOptions {
  cwd?: string;
  resumeSessionId?: string;
  timeoutMs?: number;
  /**
   * Callback for real-time stream events.
   * If provided, events are sent here instead of console.log.
   */
  onStreamEvent?: (event: StreamEvent) => void;
  /**
   * AbortSignal for canceling the execution.
   */
  abortSignal?: AbortSignal;
}

export interface InteractiveOptions {
  cwd?: string;
  resumeSessionId?: string;
}

export interface InstallCheckResult {
  installed: boolean;
  version?: string;
}

export interface AuthCheckResult {
  authenticated: boolean;
  error?: string;
}

export interface LoginResult {
  success: boolean;
}

export interface ExecutionResult {
  exitCode: number;
  success: boolean;
  output: string;
  sessionId?: string;
}

/**
 * Execute a prompt using the Agent SDK.
 *
 * This is a thin adapter over core/agent-executor.execute() that preserves
 * the old ExecutionResult interface (with exitCode) for backward compatibility.
 */
export async function executeWithClaudeCode(
  prompt: string,
  options: ExecutorOptions = {}
): Promise<ExecutionResult> {
  // Convert timeoutMs to AbortSignal if no explicit signal provided
  let abortSignal = options.abortSignal;
  if (options.timeoutMs && !abortSignal) {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), options.timeoutMs);
    abortSignal = ac.signal;
  }

  const coreOpts: SimpleExecutorOptions = {
    cwd: options.cwd,
    resumeSessionId: options.resumeSessionId,
    abortSignal,
    onStreamEvent: options.onStreamEvent
      ? (event) => options.onStreamEvent!(event as StreamEvent)
      : undefined,
  };

  // BYOK: inject user's API key into execution environment
  const byokKey = getApiKey();
  if (byokKey) {
    coreOpts.env = { ANTHROPIC_API_KEY: byokKey };
  }

  try {
    const result = await execute(prompt, coreOpts);
    return {
      exitCode: result.success ? 0 : 1,
      success: result.success,
      output: result.output,
      sessionId: result.sessionId || undefined,
    };
  } catch (err) {
    return {
      exitCode: 1,
      success: false,
      output: err instanceof Error ? err.message : String(err),
      sessionId: undefined,
    };
  }
}

/**
 * Spawn Claude Code in interactive mode.
 * Returns the child process so the caller can write to stdin and receive stdout/stderr directly.
 * stdin is piped (for sending refined prompts), stdout/stderr are inherited (direct to terminal).
 *
 * Note: Interactive mode still uses spawn because the SDK query() API is one-shot,
 * not suitable for persistent stdin piping.
 */
export function spawnInteractiveClaude(
  options: InteractiveOptions = {}
): ReturnType<typeof spawn> {
  const args: string[] = [];

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  const child = spawn('claude', args, {
    cwd: options.cwd || process.cwd(),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: process.env,
  });

  return child;
}

/**
 * Check if the Agent SDK is available (it's a direct dependency).
 */
export async function checkClaudeCodeInstalled(): Promise<InstallCheckResult> {
  try {
    await import('@anthropic-ai/claude-agent-sdk');
    return { installed: true, version: 'sdk' };
  } catch {
    return { installed: false };
  }
}

/**
 * Check if an API key is configured for Claude.
 * Checks ANTHROPIC_API_KEY environment variable.
 */
export async function checkClaudeCodeAuth(): Promise<AuthCheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey.startsWith('sk-')) {
    return { authenticated: true };
  }
  return {
    authenticated: false,
    error: 'ANTHROPIC_API_KEY not set or invalid. Set it with: export ANTHROPIC_API_KEY=sk-...',
  };
}

/**
 * Run Claude Code in interactive mode to trigger OAuth login flow.
 * This will open a browser for the user to authenticate.
 *
 * Note: Login still uses spawn because it requires the CLI binary for OAuth flow.
 */
export async function runClaudeLogin(): Promise<LoginResult> {
  return new Promise((resolve) => {
    const child = spawn('claude', [], {
      stdio: 'inherit',
    });

    child.on('error', () => {
      resolve({ success: false });
    });

    child.on('close', (code) => {
      resolve({ success: code === 0 });
    });
  });
}
