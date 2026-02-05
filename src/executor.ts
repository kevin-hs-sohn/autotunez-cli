import { spawn } from 'child_process';
import chalk from 'chalk';

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
   * When aborted, the child process is killed with SIGTERM.
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

export async function executeWithClaudeCode(
  prompt: string,
  options: ExecutorOptions = {}
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      prompt
    ];

    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    const child = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    // Handle abort signal
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => {
        child.kill('SIGTERM');
      });
    }

    let sessionId: string | undefined;
    let buffer = '';

    // Parse stream-json events
    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.session_id) sessionId = event.session_id;

          if (options.onStreamEvent) {
            // Send parsed events to callback
            const streamEvents = parseEventToStreamEvents(event);
            for (const streamEvent of streamEvents) {
              options.onStreamEvent(streamEvent);
            }
          } else {
            // Fallback to console display
            displayEvent(event);
          }
        } catch {
          // Not JSON, just print it or send as text
          if (options.onStreamEvent) {
            options.onStreamEvent({ type: 'text', content: line });
          } else {
            console.log(line);
          }
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (options.onStreamEvent) {
        options.onStreamEvent({ type: 'error', content: data.toString() });
      } else {
        process.stderr.write(data);
      }
    });

    // Swallow SIGINT during execution — child gets it via process group,
    // but we don't want Node to exit autotunez
    const sigintHandler = () => {};
    process.on('SIGINT', sigintHandler);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    // stdout and stderr are inherited, so output goes directly to terminal

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      process.removeListener('SIGINT', sigintHandler);

      if (err.code === 'ENOENT') {
        reject(new Error(
          "Claude Code CLI not found. Install it with 'npm install -g @anthropic-ai/claude-code' and make sure 'claude' is in your PATH."
        ));
      } else {
        reject(new Error(
          `Failed to start Claude Code: ${err.message}. Try running 'claude --version' to check your installation.`
        ));
      }
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      process.removeListener('SIGINT', sigintHandler);

      if (signal === 'SIGINT') {
        resolve({ exitCode: 130, success: false, output: '', sessionId });
      } else if (signal === 'SIGTERM') {
        resolve({ exitCode: 143, success: false, output: '', sessionId });
      } else {
        resolve({ exitCode: code ?? 1, success: code === 0, output: '', sessionId });
      }
    });
  });
}

// Parse stream-json event to StreamEvents
function parseEventToStreamEvents(event: Record<string, unknown>): StreamEvent[] {
  const events: StreamEvent[] = [];
  const type = event.type as string;

  if (type === 'assistant') {
    const message = event.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!content) return events;

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        events.push({ type: 'text', content: block.text as string });
      } else if (block.type === 'tool_use') {
        const name = block.name as string;
        const input = block.input as Record<string, unknown>;
        let toolText = '';
        if (name === 'Bash') {
          toolText = `$ ${input.command}`;
        } else if (name === 'Read') {
          toolText = `Reading ${input.file_path}...`;
        } else if (name === 'Edit' || name === 'Write') {
          toolText = `Editing ${input.file_path}...`;
        } else if (name === 'Glob' || name === 'Grep') {
          toolText = `Searching...`;
        } else {
          toolText = `Using ${name}...`;
        }
        events.push({ type: 'tool_use', content: toolText });
      }
    }
  } else if (type === 'user') {
    const toolResult = event.tool_use_result as Record<string, unknown> | undefined;
    if (toolResult?.stdout) {
      const stdout = toolResult.stdout as string;
      const lines = stdout.split('\n').slice(0, 5);
      if (lines.length > 0) {
        let resultText = lines.join('\n');
        if (stdout.split('\n').length > 5) {
          resultText += '\n...';
        }
        events.push({ type: 'tool_result', content: resultText });
      }
    }
  }

  return events;
}

// Display stream-json events in a user-friendly format
function displayEvent(event: Record<string, unknown>): void {
  const type = event.type as string;

  if (type === 'assistant') {
    const message = event.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!content) return;

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        console.log(chalk.white(block.text as string));
      } else if (block.type === 'tool_use') {
        const name = block.name as string;
        const input = block.input as Record<string, unknown>;
        if (name === 'Bash') {
          console.log(chalk.cyan(`$ ${input.command}`));
        } else if (name === 'Read') {
          console.log(chalk.gray(`Reading ${input.file_path}...`));
        } else if (name === 'Edit' || name === 'Write') {
          console.log(chalk.yellow(`Editing ${input.file_path}...`));
        } else if (name === 'Glob' || name === 'Grep') {
          console.log(chalk.gray(`Searching...`));
        } else {
          console.log(chalk.gray(`Using ${name}...`));
        }
      }
    }
  } else if (type === 'user') {
    // Tool results - show brief summary
    const toolResult = event.tool_use_result as Record<string, unknown> | undefined;
    if (toolResult?.stdout) {
      const stdout = toolResult.stdout as string;
      const lines = stdout.split('\n').slice(0, 5);
      if (lines.length > 0) {
        console.log(chalk.gray(lines.join('\n')));
        if (stdout.split('\n').length > 5) {
          console.log(chalk.gray('...'));
        }
      }
    }
  }
  // Ignore 'system' and 'result' events (handled by main loop)
}

/**
 * Spawn Claude Code in interactive mode.
 * Returns the child process so the caller can write to stdin and receive stdout/stderr directly.
 * stdin is piped (for sending refined prompts), stdout/stderr are inherited (direct to terminal).
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
 * Check if Claude Code CLI is installed.
 */
export async function checkClaudeCodeInstalled(): Promise<InstallCheckResult> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let version = '';

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        version += data.toString().trim();
      });
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({ installed: false });
      } else {
        resolve({ installed: false });
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, version: version || undefined });
      } else {
        resolve({ installed: false });
      }
    });
  });
}

/**
 * Check if Claude Code is authenticated (can make API calls).
 */
export async function checkClaudeCodeAuth(): Promise<AuthCheckResult> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', 'hi'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({ authenticated: false, error: 'Claude Code not installed' });
      } else {
        resolve({ authenticated: false, error: err.message });
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ authenticated: true });
      } else {
        resolve({ authenticated: false, error: stderr || 'Authentication failed' });
      }
    });
  });
}

/**
 * Run Claude Code in interactive mode to trigger OAuth login flow.
 * This will open a browser for the user to authenticate.
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
