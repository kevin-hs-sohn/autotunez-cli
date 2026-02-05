import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { ApiClient } from '../api-client.js';
import { getApiKey, getAutotunezKey } from '../config.js';
import {
  FSDPlanResponse,
  FSDQAResult,
  FSDMilestone,
} from '../types.js';
import {
  executeMilestone,
  executeClaudeCodeSecure,
  createInitialState,
  createDefaultConfig,
  redactSecrets,
  generateQAFixPrompt,
  type ExecutorContext,
} from './executor.js';
import { spawnQAAgent, saveQAReport } from './qa-agent.js';
import {
  initFSDGitProtection,
  completeFSDGitSession,
  getFSDGitRules,
  getCurrentBranch,
  type GitState,
} from './git-protection.js';
import { getSafetyRules } from './safety.js';
import {
  saveFSDState,
  loadFSDState,
  clearFSDState,
  hasResumableSession,
  getResumeInfo,
} from './state.js';
import { getVibesafuStatus } from '../vibesafu.js';
import { needsSetup, getMissingFiles } from '../setup.js';
import { executeWithClaudeCode } from '../executor.js';
import { startInkSession, type StreamEvent } from '../ui/session.js';
import { transformPrompt } from '../agent.js';
import { ConsoleOutputHandler, type FSDOutputHandler } from './output-handler.js';
import { InkOutputHandler } from './ink-output-handler.js';

const MAX_QA_FIX_ATTEMPTS = 3;

// Global output handler - can be swapped for different UI modes
let output: FSDOutputHandler = new ConsoleOutputHandler();

export function setOutputHandler(handler: FSDOutputHandler): void {
  output = handler;
}

export function createFSDCommand(): Command {
  const fsd = new Command('fsd')
    .description('Full Self-Driving mode - autonomous coding with milestones')
    .argument('[goal]', 'What you want to build')
    .option('--max-cost <dollars>', 'Maximum cost limit in dollars', '10')
    .option('--checkpoint', 'Require approval after each milestone')
    .option('--dry-run', 'Show plan only, do not execute')
    .option('--resume', 'Resume from previous state')
    .option('--skip-qa', 'Skip QA testing (faster but less safe)')
    .option('--clear', 'Clear saved state and start fresh')
    .option('--no-ink', 'Disable Ink UI (use plain console output)')
    .action(async (goal: string | undefined, options) => {
      await runFSDMode(goal, options);
    });

  return fsd;
}

export interface FSDOptions {
  maxCost?: string;
  checkpoint?: boolean;
  dryRun?: boolean;
  resume?: boolean;
  skipQa?: boolean;
  clear?: boolean;
  ink?: boolean;
  abortSignal?: AbortSignal;
}

// Module-level state for interactive mode during pause
let currentSessionId: string | undefined;
let currentExecutionState: import('../types.js').FSDExecutionState | undefined;
let currentPlan: FSDPlanResponse | undefined;
let currentGoal: string | undefined;

export async function runFSDMode(goal: string | undefined, options: FSDOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const maxCost = parseFloat(options.maxCost || '10');
  currentGoal = goal || undefined;

  // Check project setup BEFORE Ink initialization (to avoid stdin conflicts)
  if (needsSetup(cwd)) {
    const missing = getMissingFiles(cwd);
    console.log(chalk.yellow(`\n⚠ Project setup required.`));
    console.log(chalk.gray(`  Missing: ${missing.join(', ')}\n`));
    console.log(chalk.white(`Starting interactive mode for setup...`));
    console.log(chalk.gray(`After setup, use /fsd <goal> to start FSD mode.\n`));

    // Build initial messages - if goal provided, treat it as project description
    const initialMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string }> = [];

    if (goal) {
      // User already provided project description via FSD command
      initialMessages.push({
        id: '1',
        role: 'user',
        content: goal,
      });
      initialMessages.push({
        id: '2',
        role: 'assistant',
        content: `Got it! "${goal}" - let me help you set up this project.\n\nTo create CLAUDE.md, I need a bit more context:\n- What's the main tech stack? (e.g., React, Node.js, Python)\n- Any specific requirements or constraints?\n- What's the MVP scope?`,
      });
    }

    // Auto-launch interactive mode for setup
    await startInkSession({
      welcomeMessage: goal ? undefined : `Project setup required. Tell me about your project to create CLAUDE.md.\n\nAfter setup, use /fsd <goal> to start FSD mode.`,
      initialMessages: goal ? initialMessages : undefined,
      onSubmit: async (input: string, conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>, lastClaudeOutput?: string) => {
        // Check if CLAUDE.md was created during conversation
        const claudeMdPath = path.join(cwd, 'CLAUDE.md');
        if (fs.existsSync(claudeMdPath)) {
          // Setup complete! Now use transformPrompt with context
          const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
          return transformPrompt('', input, claudeMd, {
            claudeMd,
            conversationHistory,
            lastClaudeOutput,
          });
        }

        // Still in setup mode - always return clarification to continue interview
        // Build interview response based on conversation progress
        const msgCount = conversationHistory.length;

        if (msgCount <= 2) {
          // First response - ask for tech stack and requirements
          return {
            type: 'clarification' as const,
            content: `Thanks for the project description!\n\nTo create CLAUDE.md, I need a few more details:\n\n1. **Tech Stack**: What languages/frameworks will you use? (e.g., Python, TypeScript, React, Node.js)\n2. **Key Requirements**: Any specific APIs, databases, or integrations needed?\n3. **MVP Scope**: What's the minimum viable feature set for the first version?`,
          };
        } else if (msgCount <= 4) {
          // Second response - confirm and suggest creating CLAUDE.md
          return {
            type: 'clarification' as const,
            content: `Got it! I have enough information to set up the project.\n\nI'll create CLAUDE.md with:\n- Project overview and goals\n- Tech stack configuration\n- Development guidelines\n- MVP scope\n\nShould I create CLAUDE.md now? (Type "yes" or "go ahead" to proceed)`,
          };
        } else {
          // After confirmation - execute setup
          const lowerInput = input.toLowerCase();
          if (lowerInput.includes('yes') || lowerInput.includes('go') || lowerInput.includes('proceed') || lowerInput.includes('create') || lowerInput.includes('ok')) {
            // Generate setup prompt for Claude Code
            const projectInfo = conversationHistory
              .filter(m => m.role === 'user')
              .map(m => m.content)
              .join('\n\n');

            return {
              type: 'prompt' as const,
              content: `Create CLAUDE.md for this project based on the following requirements:\n\n${projectInfo}\n\nThe CLAUDE.md should include:\n1. Project overview\n2. Tech stack\n3. Code style guidelines\n4. Key commands (build, test, lint)\n5. Boundaries (always/ask first/never rules)\n\nAfter creating CLAUDE.md, also create a basic project structure if it doesn't exist.`,
            };
          }
          // User asking more questions
          return {
            type: 'clarification' as const,
            content: `Sure, what else would you like to clarify before I create the project setup?\n\n(Type "yes" or "go ahead" when ready to create CLAUDE.md)`,
          };
        }
      },
      onExecute: async (prompt: string, onStreamEvent: (event: StreamEvent) => void) => {
        const result = await executeWithClaudeCode(prompt, {
          cwd,
          onStreamEvent,
        });
        if (!result.success) {
          throw new Error(`Exited with code ${result.exitCode}`);
        }
      },
      onFSD: async (fsdGoal: string) => {
        // Re-check setup after interactive session
        if (needsSetup(cwd)) {
          console.log(chalk.yellow('\nCLAUDE.md not found yet. Please complete setup first.\n'));
          return;
        }
        // Run FSD mode
        await runFSDMode(fsdGoal, options);
      },
    });
    return; // Exit after interactive session ends
  }

  // Initialize Ink UI by default (disable with --no-ink)
  let inkHandler: InkOutputHandler | null = null;

  // Handler for user input during pause - spawns interactive Claude session
  const handleUserInput = async (input: string) => {
    if (!input.trim()) return;

    output.output(`\n[Interactive Mode] Processing: ${input}\n`);

    try {
      // Execute with Claude Code in the current session context
      const result = await executeWithClaudeCode(input, {
        cwd,
        resumeSessionId: currentSessionId,
        onStreamEvent: (event) => {
          if (event.type === 'text') {
            output.output(event.content);
          } else if (event.type === 'tool_use') {
            output.output(chalk.gray(`  ${event.content}\n`));
          }
        },
      });

      // Update session ID for continuity
      if (result.sessionId) {
        currentSessionId = result.sessionId;
        if (currentExecutionState) {
          currentExecutionState.claudeSessionId = result.sessionId;
          // Save interaction to history
          if (!currentExecutionState.interactiveHistory) {
            currentExecutionState.interactiveHistory = [];
          }
          currentExecutionState.interactiveHistory.push({
            role: 'user',
            content: input,
            timestamp: Date.now(),
          });
          // Save state after interactive session
          if (currentPlan && currentGoal) {
            await saveFSDState(cwd, currentGoal, currentPlan, currentExecutionState, createDefaultConfig({ maxCost }), null);
          }
        }
      }

      output.output('\n[Interactive Mode] Done. Press Enter to resume FSD or type another command.\n');
    } catch (error) {
      output.error(`Interactive execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (options.ink !== false && goal) {
    inkHandler = new InkOutputHandler();
    await inkHandler.initialize(goal, maxCost, {
      onPause: () => {
        output.output('\n⏸ FSD Paused. You can now interact with Claude Code directly.\n');
        output.output('  Type a command and press Enter, or just press Enter to resume FSD.\n');
      },
      onResume: () => {
        output.output('\n▶ Resuming FSD...\n');
      },
      onUserInput: handleUserInput,
    });
    setOutputHandler(inkHandler);
  }

  // Handle --clear option
  if (options.clear) {
    clearFSDState(cwd);
    console.log(chalk.green('Cleared saved FSD state.'));
    if (!goal) {
      process.exit(0);
    }
  }

  // Handle --resume option
  if (options.resume || (!goal && hasResumableSession(cwd))) {
    const savedState = loadFSDState(cwd);
    if (savedState) {
      const info = getResumeInfo(cwd);
      console.log(chalk.bold.cyan('Resuming FSD Session\n'));
      console.log(chalk.white('Goal: ' + savedState.goal));
      console.log(chalk.white('Progress: ' + info?.completed + '/' + info?.total + ' milestones'));
      console.log(chalk.white('Last saved: ' + info?.savedAt));
      console.log();

      const resume = await output.confirm('Resume this session?');
      if (resume) {
        await resumeFSDSession(cwd, savedState, options);
        return;
      }
    } else if (options.resume) {
      console.log(chalk.yellow('No saved session found to resume.'));
      process.exit(1);
    }
  }

  // Goal is required for new sessions
  if (!goal) {
    output.error('goal is required for new FSD sessions.');
    console.log(chalk.gray('Usage: autotunez fsd "your goal here"'));
    console.log(chalk.gray('       autotunez fsd --resume'));
    process.exit(1);
  }

  // Check API keys
  const autotunezKey = getAutotunezKey();
  const anthropicKey = getApiKey();

  if (!autotunezKey) {
    output.error('autotunez API key required.');
    console.log(chalk.gray('  Run: autotunez config --set-autotunez-key'));
    process.exit(1);
  }

  if (!anthropicKey) {
    output.error('Anthropic API key required.');
    console.log(chalk.gray('  Run: autotunez config --set-key'));
    process.exit(1);
  }

  // Check vibesafu for pre-execution security
  const vibesafuStatus = getVibesafuStatus();
  const vibesafuActive = vibesafuStatus.cliInstalled && vibesafuStatus.hookInstalled;
  output.securityStatus(vibesafuActive);

  // Load project context
  let claudeMd: string | undefined;
  let scratchpad: string | undefined;

  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const scratchpadPath = path.join(cwd, 'SCRATCHPAD.md');

  if (fs.existsSync(claudeMdPath)) {
    claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
    console.log(chalk.green('Found CLAUDE.md'));
  }
  if (fs.existsSync(scratchpadPath)) {
    scratchpad = fs.readFileSync(scratchpadPath, 'utf-8');
    console.log(chalk.green('Found SCRATCHPAD.md'));
  }

  console.log();

  // --- PLANNING PHASE ---
  output.start(goal);
  output.planningStart();

  const apiClient = new ApiClient({ autotunezKey, anthropicKey });

  let plan: FSDPlanResponse;
  try {
    plan = await apiClient.generateFSDPlan({
      goal,
      claudeMd,
      scratchpad,
    });
    output.planningComplete();
  } catch (error) {
    output.error('Failed to generate plan' + (error instanceof Error ? ': ' + error.message : ''));
    process.exit(1);
  }

  // Display plan
  output.showPlan({
    milestones: plan.milestones.map(m => ({
      id: m.id,
      title: m.title,
      size: m.size,
      dependsOn: m.dependsOn,
    })),
    estimatedCost: plan.estimatedCost,
    estimatedTimeMinutes: plan.estimatedTimeMinutes,
    risks: plan.risks,
  });

  // Show blockers if any
  const unblockedBlockers = plan.userBlockers.filter(b => !b.completed);
  if (unblockedBlockers.length > 0) {
    output.showBlockers(unblockedBlockers.map(b => ({
      description: b.description,
      checkInstruction: b.checkInstruction,
    })));
  }

  // Dry run - exit here
  if (options.dryRun) {
    console.log(chalk.gray('Dry run mode - exiting without execution.'));
    process.exit(0);
  }

  // Confirm execution
  const proceed = await output.confirm('Proceed with execution?');
  if (!proceed) {
    console.log(chalk.gray('Aborted.'));
    process.exit(0);
  }

  // Check blockers before starting
  if (unblockedBlockers.length > 0) {
    const continueAnyway = await output.confirm('Continue anyway?');
    if (!continueAnyway) {
      console.log(chalk.gray('Complete the blockers and run again.'));
      process.exit(0);
    }
  }

  // Execute the plan
  await executePlan(cwd, goal, plan, options);
}

/**
 * Resume a saved FSD session
 */
async function resumeFSDSession(
  cwd: string,
  savedState: Awaited<ReturnType<typeof loadFSDState>>,
  options: FSDOptions
): Promise<void> {
  if (!savedState) return;

  const { goal, plan, executionState, config, gitState } = savedState;

  // Restore git branch if needed
  if (gitState) {
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch !== gitState.fsdBranch) {
      console.log(chalk.yellow(`Switching to FSD branch: ${gitState.fsdBranch}`));
    }
  }

  // Continue execution from saved state
  await executePlan(cwd, goal, plan, options, executionState, gitState, config);
}

/**
 * Execute the FSD plan
 */
async function executePlan(
  cwd: string,
  goal: string,
  plan: FSDPlanResponse,
  options: FSDOptions,
  existingState?: ReturnType<typeof createInitialState>,
  existingGitState?: GitState | null,
  existingConfig?: ReturnType<typeof createDefaultConfig>
): Promise<void> {
  const maxCost = parseFloat(options.maxCost || '10');

  // --- GIT PROTECTION ---
  let gitState: GitState | null = existingGitState ?? null;
  if (!gitState) {
    gitState = await initFSDGitProtection(cwd, goal, (msg) => output.output(msg + '\n'));
  }

  if (gitState) {
    output.gitBranch(gitState.fsdBranch);
  }

  // --- EXECUTION PHASE ---
  console.log(chalk.bold.cyan('\nFSD Mode - Executing\n'));

  const config = existingConfig ?? createDefaultConfig({
    maxCost,
    sensitiveApproval: options.checkpoint ?? false,
  });

  const state = existingState ?? createInitialState();
  state.mode = 'executing';

  // Update module-level state for interactive mode access
  currentExecutionState = state;
  currentPlan = plan;
  currentGoal = goal;
  currentSessionId = state.claudeSessionId;

  // Combine git rules and safety rules
  const gitRules = gitState ? getFSDGitRules(gitState.fsdBranch) : '';
  const safetyRules = getSafetyRules(cwd);
  const combinedRules = gitRules + '\n' + safetyRules;

  const ctx: ExecutorContext = {
    state,
    config,
    milestones: plan.milestones,
    projectPath: cwd,
    gitRules: combinedRules,
    onProgress: () => {
      output.progress(state.totalCost, config.maxCost, state.totalPrompts);
    },
    onLog: (msg) => {
      output.output(redactSecrets(msg) + '\n');
    },
    onSessionId: (sessionId) => {
      currentSessionId = sessionId;
      state.claudeSessionId = sessionId;
    },
  };

  // Execute milestones
  for (const milestone of plan.milestones) {
    // Check abort signal
    if (options.abortSignal?.aborted) {
      console.log(chalk.yellow('\nFSD interrupted by user.'));
      break;
    }

    // Skip already completed milestones (for resume)
    if (state.completedMilestones.includes(milestone.id)) {
      output.milestoneSkipped(milestone.id, 'already completed');
      continue;
    }

    // Check dependencies
    const depsComplete = milestone.dependsOn.every(
      (d) => state.completedMilestones.includes(d)
    );
    if (!depsComplete) {
      output.milestoneSkipped(milestone.id, 'dependencies not met');
      continue;
    }

    output.milestoneStart(milestone.id, milestone.title);
    state.currentMilestoneId = milestone.id;
    state.mode = 'executing';
    milestone.status = 'in_progress';

    // Save state before execution
    await saveFSDState(cwd, goal, plan, state, config, gitState);

    // Execute milestone
    const result = await executeMilestone(ctx, milestone);

    if (result.status === 'success') {
      output.milestoneComplete(milestone.id, milestone.title);
      milestone.status = 'completed';
      state.completedMilestones.push(milestone.id);

      // Run QA if not skipped
      if (!options.skipQa) {
        output.qaStart(milestone.id);
        const qaResult = await runQAWithFixLoop(ctx, milestone, cwd, combinedRules);

        if (qaResult.status === 'FAIL' && qaResult.issues.some(i => i.severity === 'critical')) {
          output.qaComplete(false);
          const cont = await output.confirm('Continue to next milestone anyway?');
          if (!cont) {
            await saveFSDState(cwd, goal, plan, state, config, gitState);
            console.log(chalk.gray('State saved. Run with --resume to continue.'));
            process.exit(0);
          }
        } else {
          output.qaComplete(true);
        }
      }

      // Save state after successful completion
      await saveFSDState(cwd, goal, plan, state, config, gitState);

      // Checkpoint if enabled
      if (options.checkpoint) {
        const cont = await output.confirm('Continue to next milestone?');
        if (!cont) {
          console.log(chalk.gray('State saved. Run with --resume to continue.'));
          process.exit(0);
        }
      }
    } else if (result.status === 'failed') {
      output.milestoneFailed(milestone.id, milestone.title, result.errors);
      milestone.status = 'failed';
      await saveFSDState(cwd, goal, plan, state, config, gitState);

      const cont = await output.confirm('Continue to next milestone?');
      if (!cont) {
        console.log(chalk.gray('State saved. Run with --resume to continue.'));
        process.exit(0);
      }
    } else if (result.status === 'needs_replan') {
      output.milestoneFailed(milestone.id, milestone.title + ' (max retries)');
      console.log(chalk.gray('Consider re-planning or manual intervention.'));
      milestone.status = 'failed';
      await saveFSDState(cwd, goal, plan, state, config, gitState);

      const cont = await output.confirm('Continue anyway?');
      if (!cont) {
        break;
      }
    }
  }

  // --- COMPLETION ---
  const elapsed = Math.floor((Date.now() - state.startTime) / 60000);
  output.complete({
    milestones: state.completedMilestones.length,
    total: plan.milestones.length,
    prompts: state.totalPrompts,
    cost: state.totalCost,
    minutes: elapsed,
    failedAttempts: state.failedAttempts,
  });

  if (state.learnings.length > 0) {
    console.log(chalk.bold('\nLearned Rules:'));
    for (const learning of state.learnings) {
      console.log(chalk.gray('  - ' + learning));
    }
  }

  // Show git summary
  if (gitState) {
    await completeFSDGitSession(cwd, gitState, (msg) => output.gitComplete(msg));
  }

  // Clear saved state on successful completion
  if (state.completedMilestones.length === plan.milestones.length) {
    clearFSDState(cwd);
  }
}

/**
 * Run QA with fix loop
 */
async function runQAWithFixLoop(
  ctx: ExecutorContext,
  milestone: FSDMilestone,
  cwd: string,
  rules: string
): Promise<FSDQAResult> {
  let attempts = 0;
  let lastQAResult: FSDQAResult | null = null;

  while (attempts < MAX_QA_FIX_ATTEMPTS) {
    attempts++;
    console.log(chalk.gray(`Running QA (attempt ${attempts}/${MAX_QA_FIX_ATTEMPTS})...`));
    ctx.state.mode = 'reviewing';

    const qaResult = await spawnQAAgent(
      milestone,
      cwd,
      (msg) => output.output(redactSecrets(msg))
    );

    const reportPath = await saveQAReport(qaResult, milestone, cwd);
    console.log(chalk.gray('QA report saved: ' + reportPath));

    lastQAResult = qaResult;

    if (qaResult.status === 'PASS') {
      return qaResult;
    }

    // Show issues
    console.log(chalk.yellow('QA found issues:'));
    for (const issue of qaResult.issues) {
      output.qaIssue(issue.severity, issue.description);
    }

    // Check if there are critical issues worth fixing
    const criticalIssues = qaResult.issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length === 0) {
      console.log(chalk.gray('No critical issues - continuing.'));
      return qaResult;
    }

    // Don't fix on last attempt
    if (attempts >= MAX_QA_FIX_ATTEMPTS) {
      console.log(chalk.red('Max QA fix attempts reached.'));
      break;
    }

    // Ask user if they want to attempt fix
    const fixIt = await output.confirm(`Attempt to fix ${criticalIssues.length} critical issue(s)?`);
    if (!fixIt) {
      return qaResult;
    }

    // Generate and execute fix prompt with security monitoring
    console.log(chalk.gray('Attempting to fix QA issues...'));
    const fixPrompt = generateQAFixPrompt(
      milestone,
      qaResult.issues,
      ctx.state.learnings,
      rules
    );

    const fixResult = await executeClaudeCodeSecure(fixPrompt, {
      cwd,
      onOutput: (chunk) => {
        output.output(redactSecrets(chunk));
      },
      onSecurityEvent: (event) => {
        if (event.type === 'blocked') {
          console.log(chalk.red(`\n🚫 ${event.message}`));
        } else if (event.type === 'warning') {
          console.log(chalk.yellow(`\n⚠️  ${event.message}`));
        } else if (event.type === 'checkpoint') {
          console.log(chalk.cyan(`\n🔍 ${event.message}`));
        }
      },
    });

    ctx.state.totalPrompts++;
    ctx.state.totalCost = ctx.state.totalPrompts * 0.10;

    if (!fixResult.success) {
      console.log(chalk.red('Fix attempt failed.'));
      if (fixResult.securityEvents.some(e => e.type === 'blocked')) {
        console.log(chalk.red('Blocked by security guard.'));
      }
    }
  }

  return lastQAResult!;
}
