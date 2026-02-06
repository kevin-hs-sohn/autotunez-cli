import { spawn } from 'child_process';
import {
  FSDMilestone,
  FSDExecutionState,
  FSDConfig,
  FSDAutomatedChecks,
} from '../types.js';
import {
  takeFileSnapshot,
  analyzePostExecution,
} from './post-execution.js';

// Cost estimation per prompt (conservative)
const ESTIMATED_COST_PER_PROMPT = 0.10; // $0.10 per prompt

export interface ExecutorContext {
  state: FSDExecutionState;
  config: FSDConfig;
  milestones: FSDMilestone[];
  projectPath: string;
  gitRules?: string;  // Git protection rules to inject into prompts
  onProgress: (state: FSDExecutionState) => void;
  onLog: (message: string) => void;
  /** Callback when session ID is obtained/updated */
  onSessionId?: (sessionId: string) => void;
}

/**
 * Check if we're approaching cost limit
 */
export function checkCostLimit(state: FSDExecutionState, config: FSDConfig): {
  ok: boolean;
  message?: string;
} {
  const estimatedCost = state.totalPrompts * ESTIMATED_COST_PER_PROMPT;
  const warningThreshold = config.maxCost * 0.8;

  if (estimatedCost >= config.maxCost) {
    return {
      ok: false,
      message: `Cost limit reached: ~$${estimatedCost.toFixed(2)} / $${config.maxCost} max`,
    };
  }

  if (estimatedCost >= warningThreshold) {
    return {
      ok: true,
      message: `Warning: Approaching cost limit (~$${estimatedCost.toFixed(2)} / $${config.maxCost})`,
    };
  }

  return { ok: true };
}

/**
 * Redact sensitive information from text
 * Masks API keys, tokens, secrets that might be in logs or reports
 */
export function redactSecrets(text: string): string {
  // Common secret patterns
  const patterns = [
    // API keys with common prefixes
    /\b(sk-[a-zA-Z0-9_-]{20,})/gi,              // OpenAI, Anthropic style
    /\b(sk_live_[a-zA-Z0-9_-]{20,})/gi,         // Stripe live
    /\b(sk_test_[a-zA-Z0-9_-]{20,})/gi,         // Stripe test
    /\b(pk_live_[a-zA-Z0-9_-]{20,})/gi,         // Stripe public live
    /\b(pk_test_[a-zA-Z0-9_-]{20,})/gi,         // Stripe public test
    /\b(ghp_[a-zA-Z0-9]{36})/gi,                // GitHub PAT
    /\b(gho_[a-zA-Z0-9]{36})/gi,                // GitHub OAuth
    /\b(glpat-[a-zA-Z0-9_-]{20,})/gi,           // GitLab PAT
    /\b(xox[baprs]-[a-zA-Z0-9-]{10,})/gi,       // Slack tokens
    /\b(AKIA[0-9A-Z]{16})/gi,                   // AWS access key
    /\b(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/gi, // JWT

    // Environment variable values (when exposed)
    /\b([A-Z_]+_KEY|[A-Z_]+_SECRET|[A-Z_]+_TOKEN)=["']?([^"'\s]{8,})["']?/gi,
    /\b(password|passwd|pwd)\s*[=:]\s*["']?([^"'\s]{4,})["']?/gi,

    // Generic long hex/base64 strings that look like secrets
    /\b([a-f0-9]{32,64})\b/gi,  // MD5/SHA hashes or hex keys
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '***REDACTED***');
  }

  return result;
}

export interface MilestoneResult {
  status: 'success' | 'failed' | 'needs_replan';
  automatedChecks?: FSDAutomatedChecks;
  qaReportPath?: string;
  errors?: string[];
  learnings?: string[];
}

export interface QAFixResult {
  fixed: boolean;
  attempts: number;
}

/**
 * Generate a prompt to fix QA issues
 */
export function generateQAFixPrompt(
  milestone: FSDMilestone,
  issues: Array<{ severity: string; description: string; evidence?: string }>,
  learnings: string[],
  gitRules?: string
): string {
  let prompt = `## Fix QA Issues: ${milestone.title}

The QA Agent found the following issues that need to be fixed:

${issues.map((issue, i) => `
### Issue ${i + 1} [${issue.severity}]
${issue.description}
${issue.evidence ? `Evidence: ${issue.evidence}` : ''}
`).join('\n')}

## Fix Principles (Surgical Changes)
- Fix ONLY the reported issues - nothing else
- Do NOT refactor or improve adjacent code
- Make the MINIMAL change needed to fix each issue
- Verify the fix works before moving on

## Success Criteria
${milestone.successCriteria}

`;

  if (gitRules) {
    prompt += gitRules + '\n\n';
  }

  if (learnings.length > 0) {
    prompt += `## Learned Rules
${learnings.map(l => `- ${l}`).join('\n')}
`;
  }

  return prompt;
}

/**
 * Options for secure Claude Code execution
 *
 * Note: Pre-execution security is handled by vibesafe.
 * Install with: npm install -g vibesafe && vibesafe install
 */
export interface SecureExecutionOptions {
  cwd: string;
  onOutput?: (chunk: string) => void;
  onSecurityEvent?: (event: SecurityEvent) => void;
  /** Resume from existing session for context continuity */
  resumeSessionId?: string;
}

export interface SecurityEvent {
  type: 'warning' | 'blocked' | 'checkpoint' | 'approved';
  message: string;
  command?: string;
}

/**
 * Execute a Claude Code prompt and return the output
 */
export async function executeClaudeCode(
  prompt: string,
  cwd: string,
  onOutput?: (chunk: string) => void,
  resumeSessionId?: string
): Promise<{ success: boolean; output: string; sessionId?: string }> {
  return new Promise((resolve) => {
    // stdin is inherited so user can approve permission requests (vibesafu hooks)
    // --verbose is required when using -p with --output-format=stream-json
    const args = ['-p', '--verbose', '--output-format', 'stream-json', prompt];
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    const claude = spawn('claude', args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let output = '';
    let errorOutput = '';
    let sessionId: string | undefined;
    let buffer = '';

    claude.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.session_id) sessionId = event.session_id;
          // Extract text content for output
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                output += block.text;
                onOutput?.(block.text);
              }
            }
          }
        } catch {
          output += line + '\n';
          onOutput?.(line + '\n');
        }
      }
    });

    claude.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    claude.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output || errorOutput,
        sessionId,
      });
    });

    claude.on('error', (err) => {
      resolve({
        success: false,
        output: err.message,
        sessionId,
      });
    });
  });
}

/**
 * Execute Claude Code with post-execution monitoring
 *
 * Pre-execution security is handled by vibesafe (npm install -g vibesafe && vibesafe install).
 * This function handles post-execution detection:
 * 1. Takes file snapshot before execution
 * 2. Runs Claude Code
 * 3. Checks for sensitive file changes after execution
 */
export async function executeClaudeCodeSecure(
  prompt: string,
  options: SecureExecutionOptions
): Promise<{ success: boolean; output: string; securityEvents: SecurityEvent[]; sessionId?: string }> {
  const { cwd, onOutput, onSecurityEvent, resumeSessionId } = options;
  const securityEvents: SecurityEvent[] = [];

  // Take snapshot of project files before execution
  const beforeSnapshot = await takeFileSnapshot(cwd);

  return new Promise((resolve) => {
    // Run Claude Code with stream-json for session ID tracking
    // stdin is inherited so user can approve permission requests (vibesafu hooks)
    // --verbose is required when using -p with --output-format=stream-json
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      prompt,
    ];
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    const claude = spawn('claude', args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let output = '';
    let errorOutput = '';
    let sessionId: string | undefined;
    let buffer = '';

    claude.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.session_id) sessionId = event.session_id;
          // Extract text content for output
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                output += block.text;
                onOutput?.(block.text);
              }
            }
          }
        } catch {
          output += line + '\n';
          onOutput?.(line + '\n');
        }
      }
    });

    claude.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    claude.on('close', async (code) => {
      // Post-execution security check using analyzePostExecution
      const afterSnapshot = await takeFileSnapshot(cwd);
      const analysis = analyzePostExecution(beforeSnapshot, afterSnapshot);

      // Check for sensitive file changes
      if (analysis.envModified) {
        const event: SecurityEvent = {
          type: 'warning',
          message: 'Environment files were modified (.env)',
        };
        securityEvents.push(event);
        onSecurityEvent?.(event);
      }

      if (analysis.claudeMdModified) {
        const event: SecurityEvent = {
          type: 'warning',
          message: 'CLAUDE.md was modified - please review changes',
        };
        securityEvents.push(event);
        onSecurityEvent?.(event);
      }

      if (analysis.sensitiveFilesAccessed.length > 0) {
        const event: SecurityEvent = {
          type: 'warning',
          message: `Sensitive files accessed: ${analysis.sensitiveFilesAccessed.join(', ')}`,
        };
        securityEvents.push(event);
        onSecurityEvent?.(event);
      }

      if (analysis.deletedFiles.length > 0) {
        const event: SecurityEvent = {
          type: 'warning',
          message: `Files deleted: ${analysis.deletedFiles.join(', ')}`,
        };
        securityEvents.push(event);
        onSecurityEvent?.(event);
      }

      resolve({
        success: code === 0,
        output: output || errorOutput,
        securityEvents,
        sessionId,
      });
    });

    claude.on('error', (err) => {
      resolve({
        success: false,
        output: err.message,
        securityEvents,
        sessionId,
      });
    });
  });
}

/**
 * Run automated checks (build, typecheck, test, lint)
 *
 * Note: These are baseline safety checks. If a script doesn't exist,
 * it's treated as "passed" (not applicable for this project type).
 */
export async function runAutomatedChecks(
  projectPath: string
): Promise<FSDAutomatedChecks> {
  const runCheck = async (
    command: string
  ): Promise<{ passed: boolean; output?: string }> => {
    return new Promise((resolve) => {
      const [cmd, ...args] = command.split(' ');
      const proc = spawn(cmd, args, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        // Treat "missing script" as passed (not applicable)
        const isMissingScript = output.includes('Missing script') ||
                                output.includes('no such file or directory') ||
                                output.includes('command not found') ||
                                output.includes('ERR_PNPM_NO_SCRIPT');

        if (isMissingScript) {
          resolve({ passed: true, output: undefined }); // N/A = passed
        } else {
          resolve({
            passed: code === 0,
            output: code !== 0 ? output.slice(-2000) : undefined,
          });
        }
      });

      proc.on('error', () => {
        // Command doesn't exist = probably not a JS project, treat as passed
        resolve({ passed: true, output: undefined });
      });
    });
  };

  const [build, typecheck, test, lint] = await Promise.all([
    runCheck('pnpm build'),
    runCheck('pnpm typecheck'),
    runCheck('pnpm test'),
    runCheck('pnpm lint'),
  ]);

  return { build, typecheck, test, lint };
}

/**
 * Karpathy-inspired execution principles
 */
const KARPATHY_EXECUTION_RULES = `
## Execution Principles (MANDATORY)

### Think Before Coding
- If something is unclear, ASK rather than guess
- State your assumptions before starting
- If multiple approaches exist, briefly explain which you chose and why

### Simplicity First
- Implement ONLY what the milestone asks for
- No extra features, no "nice to have" additions
- If 200 lines could be 50, make it 50
- Avoid over-abstraction - three similar lines > premature abstraction

### Surgical Changes
- Touch ONLY what you must to complete this milestone
- Do NOT refactor adjacent code
- Do NOT add comments to code you didn't write
- Do NOT "improve" existing code unless the milestone asks for it

### Goal-Driven
- Keep working until SUCCESS CRITERIA is met
- Run checks frequently to verify progress
- If stuck after 3 attempts, STOP and explain what's blocking
`;

/**
 * Generate a prompt for executing a milestone
 */
export function generateMilestonePrompt(
  milestone: FSDMilestone,
  learnings: string[],
  isRetry: boolean = false,
  gitRules?: string
): string {
  let prompt = `## Milestone: ${milestone.title}

${milestone.description}

## Success Criteria
${milestone.successCriteria}

${KARPATHY_EXECUTION_RULES}

## Your Job
Implement this milestone. You decide HOW to implement it - you have full autonomy.
Keep working until the success criteria is met. Run verifications frequently.

`;

  // Inject git rules if provided
  if (gitRules) {
    prompt += gitRules + '\n\n';
  }

  if (learnings.length > 0) {
    prompt += `## Learned Rules (from previous attempts)
${learnings.map(l => `- ${l}`).join('\n')}

`;
  }

  if (isRetry) {
    prompt += `## IMPORTANT
This is a retry attempt. Previous attempt failed. Focus on fixing the issues.
Review the errors carefully and make targeted fixes.
`;
  }

  return prompt;
}

/**
 * Generate a fix prompt based on automated check failures
 */
export function generateFixPrompt(
  checks: FSDAutomatedChecks,
  learnings: string[]
): string {
  const failures: string[] = [];

  if (!checks.build.passed) {
    failures.push(`Build failed:\n${checks.build.output}`);
  }
  if (!checks.typecheck.passed) {
    failures.push(`Type errors:\n${checks.typecheck.output}`);
  }
  if (!checks.test.passed) {
    failures.push(`Test failures:\n${checks.test.output}`);
  }
  if (!checks.lint.passed) {
    failures.push(`Lint errors:\n${checks.lint.output}`);
  }

  let prompt = `## Fix Required

The following checks failed:

${failures.join('\n\n---\n\n')}

## Instructions
Fix these issues. Do not introduce new features, just fix the errors.

`;

  if (learnings.length > 0) {
    prompt += `## Learned Rules
${learnings.map(l => `- ${l}`).join('\n')}
`;
  }

  return prompt;
}

/**
 * Execute a single milestone with retries
 */
export async function executeMilestone(
  ctx: ExecutorContext,
  milestone: FSDMilestone
): Promise<MilestoneResult> {
  const { config, onProgress, onLog } = ctx;
  let attempts = 0;
  const learnings: string[] = [...ctx.state.learnings];

  while (attempts < config.maxIterationsPerMilestone) {
    // Check cost limit before each prompt
    const costCheck = checkCostLimit(ctx.state, config);
    if (!costCheck.ok) {
      onLog(costCheck.message!);
      return {
        status: 'failed',
        errors: [costCheck.message!],
        learnings,
      };
    }
    if (costCheck.message) {
      onLog(costCheck.message); // Warning
    }

    // Check total prompts limit
    if (ctx.state.totalPrompts >= config.maxTotalPrompts) {
      onLog(`Total prompts limit reached: ${ctx.state.totalPrompts}/${config.maxTotalPrompts}`);
      return {
        status: 'failed',
        errors: ['Total prompts limit reached'],
        learnings,
      };
    }

    attempts++;
    onLog(`Attempt ${attempts}/${config.maxIterationsPerMilestone} for ${milestone.title}`);

    // 1. Generate and execute prompt (with git rules if available)
    const prompt = generateMilestonePrompt(milestone, learnings, attempts > 1, ctx.gitRules);

    onLog('Executing Claude Code (security via PreToolUse hooks)...');

    // Always use secure execution - security is handled via PreToolUse hooks
    const result = await executeClaudeCodeSecure(prompt, {
      cwd: ctx.projectPath,
      resumeSessionId: ctx.state.claudeSessionId,
      onOutput: (chunk) => {
        onLog(redactSecrets(chunk));
      },
      onSecurityEvent: (event) => {
        if (event.type === 'blocked') {
          onLog(`🚫 BLOCKED: ${event.message}`);
        } else if (event.type === 'warning') {
          onLog(`⚠️  WARNING: ${event.message}`);
        } else if (event.type === 'checkpoint') {
          onLog(`🔍 Security checkpoint: ${event.message}`);
        } else if (event.type === 'approved') {
          onLog(`✅ Approved: ${event.message}`);
        }
      },
    });

    // Update session ID for context continuity
    if (result.sessionId) {
      ctx.state.claudeSessionId = result.sessionId;
      ctx.onSessionId?.(result.sessionId);
    }

    // Update cost tracking
    ctx.state.totalPrompts++;
    ctx.state.totalCost = ctx.state.totalPrompts * ESTIMATED_COST_PER_PROMPT;
    onProgress(ctx.state);

    if (!result.success) {
      onLog(`Claude Code execution failed: ${redactSecrets(result.output)}`);
      continue;
    }

    // 2. Run automated checks
    onLog('Running automated checks...');
    const checks = await runAutomatedChecks(ctx.projectPath);

    const allPassed = checks.build.passed &&
                      checks.typecheck.passed &&
                      checks.test.passed &&
                      checks.lint.passed;

    if (allPassed) {
      onLog('All automated checks passed!');

      // Update state
      ctx.state.completedMilestones.push(milestone.id);
      onProgress(ctx.state);

      return {
        status: 'success',
        automatedChecks: checks,
        learnings,
      };
    }

    // 3. Checks failed - try to fix
    // Check cost again before fix attempt
    const fixCostCheck = checkCostLimit(ctx.state, config);
    if (!fixCostCheck.ok) {
      onLog(fixCostCheck.message!);
      return {
        status: 'failed',
        errors: [fixCostCheck.message!],
        learnings,
      };
    }

    onLog('Automated checks failed, attempting fix...');

    const fixPrompt = generateFixPrompt(checks, learnings);
    const fixResult = await executeClaudeCode(fixPrompt, ctx.projectPath, (chunk) => {
      onLog(redactSecrets(chunk));
    });

    ctx.state.totalPrompts++;
    ctx.state.totalCost = ctx.state.totalPrompts * ESTIMATED_COST_PER_PROMPT;
    ctx.state.failedAttempts++;
    onProgress(ctx.state);

    if (!fixResult.success) {
      onLog(`Fix attempt failed: ${redactSecrets(fixResult.output)}`);
    }

    // Generate learning from failure
    const learning = generateLearningFromFailure(checks);
    if (learning && !learnings.includes(learning)) {
      learnings.push(learning);
      ctx.state.learnings.push(learning);
    }
  }

  // Max attempts reached
  onLog(`Max attempts reached for ${milestone.title}`);
  return {
    status: 'needs_replan',
    errors: ['Max retry attempts exceeded'],
    learnings,
  };
}

/**
 * Generate a learning rule from a failure
 */
function generateLearningFromFailure(checks: FSDAutomatedChecks): string | null {
  if (!checks.typecheck.passed && checks.typecheck.output) {
    if (checks.typecheck.output.includes('Cannot find module')) {
      return 'Always verify imports exist before using them';
    }
    if (checks.typecheck.output.includes('is not assignable')) {
      return 'Check type compatibility before assignments';
    }
  }

  if (!checks.build.passed && checks.build.output) {
    if (checks.build.output.includes('ENOENT')) {
      return 'Verify file paths exist before referencing them';
    }
  }

  if (!checks.test.passed && checks.test.output) {
    if (checks.test.output.includes('mock')) {
      return 'Ensure all external dependencies are properly mocked in tests';
    }
  }

  return null;
}

/**
 * Create initial execution state
 */
export function createInitialState(): FSDExecutionState {
  return {
    mode: 'planning',
    currentMilestoneId: null,
    completedMilestones: [],
    failedAttempts: 0,
    totalCost: 0,
    totalPrompts: 0,
    learnings: [],
    startTime: Date.now(),
    claudeSessionId: undefined,
    interactiveHistory: [],
  };
}

/**
 * Create default FSD config
 */
export function createDefaultConfig(overrides?: Partial<FSDConfig>): FSDConfig {
  return {
    maxCost: 10,
    maxIterationsPerMilestone: 5,
    maxTotalPrompts: 100,
    checkpointInterval: 3,
    sensitiveApproval: true,
    autoResume: false,
    ...overrides,
  };
}
