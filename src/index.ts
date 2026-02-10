#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  validateApiKey,
  getAutotunezKey,
  getAutotunezKeySource,
  setAutotunezKey,
  clearAutotunezKey,
  validateAutotunezKey,
  hasSeenWelcome,
  markWelcomeSeen,
  getModelPreference,
  setModelPreference,
  validateModelPreference,
} from './config.js';
import { ApiClient } from './api-client.js';
import { transformPrompt, chatStructured, compactConversation, learnFromConversation, ApiKeyRequiredError } from './agent.js';
import {
  executeWithClaudeCode,
  spawnInteractiveClaude,
  checkClaudeCodeInstalled,
  checkClaudeCodeAuth,
  runClaudeLogin,
} from './executor.js';
import { needsSetup, getMissingFiles, runSetup } from './setup.js';
import { startInkSession, type StreamEvent } from './ui/session.js';
import { createFSDCommand, runFSDMode } from './fsd/command.js';
import { getVibesafuStatus, setupVibesafu } from './vibesafu.js';

const program = new Command();

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

program
  .name('autotunez')
  .description('CLI assistant for vibe coding with Claude')
  .version(packageJson.version);

// Config command
program
  .command('config')
  .description('Configure autotunez settings')
  .option('--set-key', 'Set your Anthropic API key')
  .option('--set-autotunez-key', 'Set your autotunez API key (for usage tracking)')
  .option('--show', 'Show current configuration')
  .option('--clear', 'Clear stored API key')
  .option('--clear-autotunez-key', 'Clear stored autotunez API key')
  .option('--model <tier>', 'Set model preference (auto|haiku|sonnet|opus)')
  .action(async (options) => {
    if (options.clear) {
      clearApiKey();
      console.log(chalk.green('✓ API key cleared'));
      return;
    }

    if (options.clearAutotunezKey) {
      clearAutotunezKey();
      console.log(chalk.green('✓ autotunez API key cleared'));
      return;
    }

    if (options.model) {
      const tier = options.model;
      if (!validateModelPreference(tier)) {
        console.log(chalk.red(`\n✗ Invalid model tier: "${tier}"`));
        console.log(chalk.gray('  Valid options: auto, haiku, sonnet, opus\n'));
        console.log(chalk.gray('  auto   — Automatically select based on task complexity'));
        console.log(chalk.gray('  haiku  — Fast and affordable'));
        console.log(chalk.gray('  sonnet — Balanced quality and cost'));
        console.log(chalk.gray('  opus   — Highest quality\n'));
        return;
      }
      setModelPreference(tier);

      const descriptions: Record<string, string> = {
        auto: 'Automatically select based on task complexity',
        haiku: 'Fast and affordable',
        sonnet: 'Balanced quality and cost',
        opus: 'Highest quality',
      };
      console.log(chalk.green(`\n✓ Model preference set to "${tier}"`));
      console.log(chalk.gray(`  ${descriptions[tier]}\n`));
      return;
    }

    if (options.show) {
      const apiKey = getApiKey();
      const autotunezKey = getAutotunezKey();

      console.log(chalk.bold('\nCurrent Configuration\n'));

      if (apiKey) {
        console.log(chalk.green('✓ Anthropic API key configured'));
        console.log(
          chalk.gray(`  Key: ${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`)
        );
      } else {
        console.log(chalk.yellow('✗ Anthropic API key not configured'));
        console.log(chalk.gray('  Run: autotunez config --set-key'));
      }

      console.log();

      if (autotunezKey) {
        console.log(chalk.green('✓ autotunez API key configured'));
        console.log(
          chalk.gray(`  Key: ${autotunezKey.slice(0, 8)}...${autotunezKey.slice(-4)}`)
        );
      } else {
        console.log(chalk.gray('○ autotunez API key not configured (optional)'));
        console.log(chalk.gray('  Get one at: https://autotunez.vercel.app/dashboard'));
      }

      console.log();

      const modelPref = getModelPreference();
      const modelDescriptions: Record<string, string> = {
        auto: 'Automatically select based on task complexity',
        haiku: 'Fast and affordable',
        sonnet: 'Balanced quality and cost',
        opus: 'Highest quality',
      };
      console.log(chalk.green(`✓ Model preference: ${modelPref}`));
      console.log(chalk.gray(`  ${modelDescriptions[modelPref]}`));
      console.log(chalk.gray('  Change with: autotunez config --model <auto|haiku|sonnet|opus>'));
      return;
    }

    if (options.setAutotunezKey) {
      console.log(chalk.bold('\nConfigure autotunez API Key\n'));
      console.log(chalk.gray('Get your autotunez API key at:'));
      console.log(chalk.cyan('  https://autotunez.vercel.app/dashboard\n'));
      console.log(chalk.gray('(autotunez key enables usage tracking with free monthly credits)\n'));

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const key = await new Promise<string>((resolve) => {
        rl.question('Enter autotunez API key: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!key) {
        console.log(chalk.yellow('\n✗ No key provided\n'));
        return;
      }

      if (!validateAutotunezKey(key)) {
        console.log(
          chalk.red(
            '\n✗ Invalid autotunez API key format. Keys start with "atk_"\n'
          )
        );
        return;
      }

      setAutotunezKey(key);
      console.log(chalk.green('\n✓ autotunez API key saved!\n'));
      return;
    }

    if (options.setKey) {
      console.log(chalk.bold('\nConfigure Anthropic API Key\n'));
      console.log(chalk.gray('Get your API key at:'));
      console.log(chalk.cyan('  https://console.anthropic.com\n'));

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const key = await new Promise<string>((resolve) => {
        rl.question('Enter API key: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!key) {
        console.log(chalk.yellow('\n✗ No key provided\n'));
        return;
      }

      if (!validateApiKey(key)) {
        console.log(
          chalk.red(
            '\n✗ Invalid API key format. Anthropic keys start with "sk-ant-"\n'
          )
        );
        return;
      }

      setApiKey(key);
      console.log(chalk.green('\n✓ API key saved!\n'));
      return;
    }

    // Default: show help
    console.log(chalk.bold('\nautotunez config\n'));
    console.log(chalk.gray('Options:'));
    console.log(chalk.gray('  --set-key              Set your Anthropic API key'));
    console.log(chalk.gray('  --set-autotunez-key    Set your autotunez API key (for usage tracking)'));
    console.log(chalk.gray('  --model <tier>         Set model preference (auto|haiku|sonnet|opus)'));
    console.log(chalk.gray('  --show                 Show current configuration'));
    console.log(chalk.gray('  --clear                Clear stored Anthropic API key'));
    console.log(chalk.gray('  --clear-autotunez-key  Clear stored autotunez API key\n'));
  });

// --- Main session ---

// FSD Mode command
program.addCommand(createFSDCommand());

program
  .command('start', { isDefault: true })
  .description('Start interactive autotunez session')
  .option(
    '-i, --interactive',
    'Run in interactive pass-through mode (keeps Claude Code session alive)'
  )
  .option(
    '--classic',
    'Use classic readline-based UI instead of modern ink UI'
  )
  .action(async (options: { interactive?: boolean; classic?: boolean }) => {
    // --- Check autotunez API key ---
    let autotunezKey = getAutotunezKey();
    const keySource = getAutotunezKeySource();

    if (!autotunezKey) {
      console.log(chalk.yellow('\n⚠ autotunez API key not found.\n'));
      console.log(chalk.gray('Get your free API key at:'));
      console.log(chalk.cyan('  https://autotunez.dev/dashboard\n'));
      console.log(chalk.gray('You can also set it via:'));
      console.log(chalk.gray('  - Environment variable: AUTOTUNEZ_API_KEY'));
      console.log(chalk.gray('  - .env file in your project\n'));

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const key = await new Promise<string>((resolve) => {
        rl.question('Enter autotunez API key: ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (!key) {
        console.log(chalk.red('\n✗ API key is required to use autotunez.\n'));
        process.exit(1);
      }

      if (!validateAutotunezKey(key)) {
        console.log(
          chalk.red('\n✗ Invalid API key format. Keys start with "atk_"')
        );
        console.log(chalk.gray('  Get your key at: https://autotunez.dev/dashboard\n'));
        process.exit(1);
      }

      setAutotunezKey(key);
      autotunezKey = key;
      console.log(chalk.green('✓ API key saved to ~/.autotunez/config.json\n'));
    }

    // Show key source
    if (keySource === 'env') {
      console.log(chalk.green('✓ API key loaded from environment'));
    } else {
      console.log(chalk.green('✓ API key configured'));
    }

    // --- Fetch and display credits ---
    const apiClient = new ApiClient({ autotunezKey });
    let initialCreditInfo: { balance: number; usedToday: number } | undefined;

    try {
      const usage = await apiClient.getUsage();
      const balance = (usage.totalCredits - usage.usedCredits) * 0.001;
      const usedToday = usage.usedCredits * 0.001;

      initialCreditInfo = { balance, usedToday };
      console.log(chalk.cyan(`  Balance: $${balance.toFixed(2)}`) + chalk.gray(` (used today: $${usedToday.toFixed(2)})`));
    } catch (error) {
      // Don't block on usage fetch failure
      if (error instanceof Error && error.message.includes('Invalid API key')) {
        console.log(chalk.red('✗ Invalid API key. Get a new one at: https://autotunez.dev/dashboard'));
        process.exit(1);
      }
      console.log(chalk.gray('  (Could not fetch usage data)'));
    }

    // Helper to refresh credit info
    const refreshCredits = async (): Promise<{ balance: number; usedToday: number } | null> => {
      try {
        const usage = await apiClient.getUsage();
        return {
          balance: (usage.totalCredits - usage.usedCredits) * 0.001,
          usedToday: usage.usedCredits * 0.001,
        };
      } catch {
        return null;
      }
    };

    // --- Check Claude Code prerequisites ---
    const installCheck = await checkClaudeCodeInstalled();
    if (!installCheck.installed) {
      console.log(chalk.red('✗ Claude Code CLI not found.'));
      console.log(chalk.gray('  Install it with: npm install -g @anthropic-ai/claude-code'));
      console.log(chalk.gray('  Or visit: https://claude.ai/claude-code\n'));
      process.exit(1);
    }
    console.log(chalk.green(`✓ Claude Code ${installCheck.version || ''} detected`));

    // --- Check vibesafu security ---
    const vibesafuStatus = getVibesafuStatus();
    if (vibesafuStatus.cliInstalled && vibesafuStatus.hookInstalled) {
      console.log(chalk.green(`✓ vibesafu ${vibesafuStatus.version || ''} active`));
    } else {
      console.log(chalk.yellow('⚠ vibesafu not installed (pre-execution security)'));

      const vibesafuRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const installVibesafu = await new Promise<boolean>((resolve) => {
        vibesafuRl.question(chalk.yellow('  Install vibesafu for security? (Y/n): '), (answer: string) => {
          vibesafuRl.close();
          const trimmed = answer.trim().toLowerCase();
          resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
        });
      });

      if (installVibesafu) {
        const spinner = ora('Installing vibesafu...').start();
        const result = setupVibesafu();
        if (result.success) {
          spinner.succeed('vibesafu installed and activated');
        } else {
          spinner.fail(`Failed to install vibesafu: ${result.error}`);
          console.log(chalk.gray('  You can install manually: npm i -g vibesafu && vibesafu install'));
        }
      } else {
        console.log(chalk.gray('  Skipping vibesafu. You can install later: npm i -g vibesafu && vibesafu install'));
      }
    }

    const authSpinner = ora('Checking Claude Code authentication...').start();
    let authCheck = await checkClaudeCodeAuth();
    authSpinner.stop();

    while (!authCheck.authenticated) {
      console.log(chalk.yellow('⚠ Claude Code is not authenticated.'));
      console.log(chalk.gray('  Starting Claude Code login...\n'));

      const loginResult = await runClaudeLogin();
      if (loginResult.success) {
        console.log(chalk.green('✓ Claude Code authenticated\n'));
        break;
      }

      console.log(chalk.red('✗ Claude Code login failed or was cancelled.'));
      console.log(chalk.gray('  Let\'s try again. Press Ctrl+C to exit if needed.\n'));
      authCheck = await checkClaudeCodeAuth();
    }

    if (authCheck.authenticated) {
      console.log(chalk.green('✓ Claude Code authenticated\n'));
    }

    // Check if project setup is needed
    const cwd = process.cwd();
    if (needsSetup(cwd)) {
      const missing = getMissingFiles(cwd);
      console.log(chalk.yellow(`⚠ 프로젝트 셋업이 필요합니다. 누락된 파일: ${missing.join(', ')}`));

      const setupRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const doSetup = await new Promise<boolean>((resolve) => {
        setupRl.question(chalk.yellow('  초기 셋업을 진행할까요? (Y/n): '), (answer: string) => {
          setupRl.close();
          const trimmed = answer.trim().toLowerCase();
          resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
        });
      });

      if (doSetup) {
        let setupSuccess = false;
        while (!setupSuccess) {
          setupSuccess = await runSetup('', cwd); // apiKey no longer needed
          if (!setupSuccess) {
            console.log(chalk.red('셋업이 완료되지 않았습니다.'));
            const retryRl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            const retry = await new Promise<boolean>((resolve) => {
              retryRl.question(chalk.yellow('  다시 시도할까요? (Y/n): '), (answer: string) => {
                retryRl.close();
                const trimmed = answer.trim().toLowerCase();
                resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
              });
            });
            if (!retry) {
              console.log(chalk.gray('셋업을 건너뜁니다. CLAUDE.md 없이 계속합니다.\n'));
              break;
            }
          }
        }
      } else {
        console.log(chalk.gray('셋업을 건너뜁니다. CLAUDE.md 없이 계속합니다.\n'));
      }
    }

    // Load project context files
    let projectContext: string | undefined;
    let scratchpadContent: string | undefined;
    let planContent: string | undefined;

    const claudeMdPath = path.join(cwd, 'CLAUDE.md');
    const scratchpadPath = path.join(cwd, 'SCRATCHPAD.md');
    const planPath = path.join(cwd, 'plan.md');

    if (fs.existsSync(claudeMdPath)) {
      projectContext = fs.readFileSync(claudeMdPath, 'utf-8');
      console.log(chalk.green('✓ Found CLAUDE.md'));
    }
    if (fs.existsSync(scratchpadPath)) {
      scratchpadContent = fs.readFileSync(scratchpadPath, 'utf-8');
      console.log(chalk.green('✓ Found SCRATCHPAD.md'));
    }
    if (fs.existsSync(planPath)) {
      planContent = fs.readFileSync(planPath, 'utf-8');
      console.log(chalk.green('✓ Found plan.md'));
    }
    console.log();

    // Interactive pass-through mode
    if (options.interactive) {
      console.log(chalk.bold('autotunez'));
      console.log(chalk.gray('Interactive mode. Press Ctrl+C to exit.\n'));

      const child = spawnInteractiveClaude({ cwd });

      // Handle Claude Code exit
      child.on('close', (code) => {
        console.log(chalk.gray(`\nClaude Code exited (code ${code})`));
        process.exit(code ?? 0);
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          console.log(chalk.red("✗ Claude Code CLI not found. Install it with 'npm install -g @anthropic-ai/claude-code'"));
        } else {
          console.log(chalk.red(`✗ Failed to start Claude Code: ${err.message}`));
        }
        process.exit(1);
      });

      // Intercept stdin, refine, and forward to Claude
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '',
      });

      rl.on('line', async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          return;
        }

        // Pass through slash commands and single-char confirmations directly
        const isPassThrough = trimmed.startsWith('/') || trimmed.length === 1;

        if (isPassThrough) {
          child.stdin?.write(trimmed + '\n');
          return;
        }

        // Process input
        if (projectContext) {
          const spinner = ora('Thinking...').start();
          try {
            const result = await transformPrompt('', trimmed, projectContext, {
              claudeMd: projectContext,
              scratchpad: scratchpadContent,
              plan: planContent,
            });
            spinner.stop();

            if (result.type === 'prompt') {
              child.stdin?.write(result.content + '\n');
            } else {
              // Clarification needed
              console.log(chalk.green('\nautotunez: ') + result.content + '\n');
            }
          } catch (error) {
            spinner.stop();
            if (error instanceof ApiKeyRequiredError) {
              console.log(chalk.red('\n✗ ' + error.message + '\n'));
              process.exit(1);
            }
            child.stdin?.write(trimmed + '\n');
          }
        } else {
          child.stdin?.write(trimmed + '\n');
        }
      });

      rl.on('close', () => {
        child.stdin?.end();
      });

      // Forward SIGINT to child
      process.on('SIGINT', () => {
        child.kill('SIGINT');
      });

      return; // Don't continue to regular mode
    }

    // Mark welcome as seen
    if (!hasSeenWelcome()) {
      markWelcomeSeen();
    }

    // --- INK UI MODE (default) ---
    if (!options.classic) {
      // Reset stdin state before starting Ink
      // (readline usage above can leave stdin in a bad state)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.resume();
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      let lastSessionId: string | undefined;

      const welcomeMessage = `Welcome to autotunez!

I help you get the most out of Claude Code by turning your ideas into well-structured prompts.

What I do:
- Set up your project with CLAUDE.md and best practices
- Understand vague requests and ask clarifying questions
- Structure prompts for optimal results
- Recommend relevant skills, MCPs, and tools
- Keep scope focused on MVP

Just describe what you want to build in plain language.`;

      await startInkSession({
        projectContext,
        welcomeMessage,
        initialCreditInfo,
        onRefreshCredits: refreshCredits,
        onSubmit: async (input: string, conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>, lastClaudeOutput?: string) => {
          // Always use conversation history for context-aware transformation
          // Include lastClaudeOutput so autotunez understands confirmation responses like "go ahead"
          const result = await transformPrompt('', input, projectContext, {
            claudeMd: projectContext,
            scratchpad: scratchpadContent,
            plan: planContent,
            conversationHistory,
            lastClaudeOutput,
          });

          messages.push({ role: 'user', content: input });
          messages.push({ role: 'assistant', content: result.content });
          return result;
        },
        onExecute: async (prompt: string, onStreamEvent: (event: StreamEvent) => void, signal?: AbortSignal) => {
          const execResult = await executeWithClaudeCode(prompt, {
            resumeSessionId: lastSessionId,
            onStreamEvent,
            abortSignal: signal,
          });
          lastSessionId = execResult.sessionId;

          if (!execResult.success && !signal?.aborted) {
            throw new Error(`Exited with code ${execResult.exitCode}`);
          }
        },
        onCompact: async (msgs) => {
          const result = await compactConversation(msgs);
          return {
            summary: result.summary,
            recentMessages: result.recentMessages,
          };
        },
        onLearn: async (msgs) => {
          return learnFromConversation(msgs, projectContext || '');
        },
        onApplyRule: async (rule: string, category: 'always' | 'ask_first' | 'never') => {
          // Append rule to CLAUDE.md Boundaries section
          const claudeMdPath = path.join(cwd, 'CLAUDE.md');
          if (!fs.existsSync(claudeMdPath)) {
            throw new Error('CLAUDE.md not found. Run setup first.');
          }

          let content = fs.readFileSync(claudeMdPath, 'utf-8');
          const categoryMap = {
            always: '### ✅ Always',
            ask_first: '### ⚠️ Ask first',
            never: '### 🚫 Never',
          };
          const sectionHeader = categoryMap[category];

          // Find the section and append the rule
          const sectionIndex = content.indexOf(sectionHeader);
          if (sectionIndex === -1) {
            // Section doesn't exist, append to Boundaries
            const boundariesIndex = content.indexOf('## Boundaries');
            if (boundariesIndex === -1) {
              // No Boundaries section, append at end
              content += `\n\n## Boundaries\n\n${sectionHeader}\n- ${rule}\n`;
            } else {
              // Find next section after Boundaries
              const nextSectionMatch = content.slice(boundariesIndex + 14).match(/\n## /);
              const insertPos = nextSectionMatch
                ? boundariesIndex + 14 + nextSectionMatch.index!
                : content.length;
              content =
                content.slice(0, insertPos) +
                `\n${sectionHeader}\n- ${rule}\n` +
                content.slice(insertPos);
            }
          } else {
            // Find end of section (next ### or ##)
            const sectionEnd = content.slice(sectionIndex + sectionHeader.length).search(/\n###? /);
            const insertPos = sectionEnd === -1
              ? content.length
              : sectionIndex + sectionHeader.length + sectionEnd;
            content =
              content.slice(0, insertPos) +
              `\n- ${rule}` +
              content.slice(insertPos);
          }

          fs.writeFileSync(claudeMdPath, content, 'utf-8');

          // Reload project context
          projectContext = content;
        },
        onFSD: async (goal: string) => {
          // Run FSD mode with the given goal
          await runFSDMode(goal, { maxCost: '10' });
        },
      });

      console.log(chalk.gray('\nGoodbye! Happy vibing!'));
      process.exit(0);
    }

    // --- CLASSIC READLINE MODE ---
    console.log(chalk.bold.cyan('\n  Welcome to autotunez!\n'));
    console.log(chalk.white('  autotunez helps you get the most out of Claude Code.'));
    console.log(chalk.white('  It turns your rough ideas into well-structured prompts that'));
    console.log(chalk.white('  follow Claude Code best practices.\n'));
    console.log(chalk.gray('  What it does:'));
    console.log(chalk.gray('  - Helps set up your project with CLAUDE.md and best practices'));
    console.log(chalk.gray('  - Understands vague requests and asks clarifying questions'));
    console.log(chalk.gray('  - Structures prompts for optimal Claude Code results'));
    console.log(chalk.gray('  - Recommends relevant skills, MCPs, and tools for your task'));
    console.log(chalk.gray('  - Keeps scope focused on MVP\n'));
    console.log(chalk.gray('  Just describe what you want to build in plain language.'));
    console.log(chalk.gray('  Type "exit" to quit, "clear" to reset context.\n'));

    console.log(chalk.bold('autotunez'));
    console.log(chalk.gray('What would you like to build?\n'));

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let lastSessionId: string | undefined;

    // Input history
    const history: string[] = [];
    let historyIndex = -1;
    let currentInput = '';

    // Question helper with history support
    const question = (promptText: string): Promise<string> => {
      return new Promise((resolve) => {
        process.stdout.write(promptText);

        let buffer = '';
        let cursorPos = 0;
        historyIndex = -1;
        currentInput = '';

        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        const clearLine = () => {
          process.stdout.write('\r' + promptText + ' '.repeat(buffer.length + 10));
          process.stdout.write('\r' + promptText);
        };

        const redraw = () => {
          clearLine();
          process.stdout.write(buffer);
          // Move cursor to correct position
          if (cursorPos < buffer.length) {
            process.stdout.write(`\x1b[${buffer.length - cursorPos}D`);
          }
        };

        const onData = (key: string) => {
          const code = key.charCodeAt(0);

          // Ctrl+C
          if (code === 3) {
            stdin.setRawMode(false);
            stdin.removeListener('data', onData);
            console.log();
            resolve('exit');
            return;
          }

          // Enter
          if (code === 13) {
            stdin.setRawMode(false);
            stdin.removeListener('data', onData);
            console.log();
            if (buffer.trim() && history[0] !== buffer.trim()) {
              history.unshift(buffer.trim());
              if (history.length > 100) history.pop();
            }
            resolve(buffer);
            return;
          }

          // Backspace
          if (code === 127) {
            if (cursorPos > 0) {
              buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
              cursorPos--;
              redraw();
            }
            return;
          }

          // Escape sequences (arrows, etc)
          if (key.startsWith('\x1b[')) {
            if (key === '\x1b[A') { // Up arrow
              if (historyIndex < history.length - 1) {
                if (historyIndex === -1) currentInput = buffer;
                historyIndex++;
                buffer = history[historyIndex];
                cursorPos = buffer.length;
                redraw();
              }
            } else if (key === '\x1b[B') { // Down arrow
              if (historyIndex > -1) {
                historyIndex--;
                buffer = historyIndex === -1 ? currentInput : history[historyIndex];
                cursorPos = buffer.length;
                redraw();
              }
            } else if (key === '\x1b[C') { // Right arrow
              if (cursorPos < buffer.length) {
                cursorPos++;
                process.stdout.write(key);
              }
            } else if (key === '\x1b[D') { // Left arrow
              if (cursorPos > 0) {
                cursorPos--;
                process.stdout.write(key);
              }
            }
            return;
          }

          // Regular character
          if (code >= 32) {
            buffer = buffer.slice(0, cursorPos) + key + buffer.slice(cursorPos);
            cursorPos += key.length;
            redraw();
          }
        };

        stdin.on('data', onData);
      });
    };

    // Main session loop
    while (true) {
      const input = await question(chalk.blue('You: '));
      const trimmed = input.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log(chalk.gray('\nGoodbye! Happy vibing!'));
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'clear') {
        messages.length = 0;
        lastSessionId = undefined;
        console.log(chalk.gray('Context cleared.\n'));
        continue;
      }

      messages.push({ role: 'user', content: trimmed });

      const spinner = ora('Thinking...').start();

      try {
        let result: { type: 'prompt' | 'clarification'; content: string };

        if (messages.length === 1 && projectContext) {
          // First message with context
          result = await transformPrompt('', trimmed, projectContext, {
            claudeMd: projectContext,
            scratchpad: scratchpadContent,
            plan: planContent,
          });
        } else {
          // Continuing conversation — structured response with prompt detection
          result = await chatStructured('', messages);
        }

        spinner.stop();

        messages.push({ role: 'assistant', content: result.content });

        if (result.type === 'prompt') {
          console.log(chalk.cyan('\nWorking on it...\n'));

          try {
            const execResult = await executeWithClaudeCode(result.content, {
              resumeSessionId: lastSessionId,
            });

            lastSessionId = execResult.sessionId;

            if (!execResult.success) {
              console.log(chalk.yellow(`\nExited with code ${execResult.exitCode}`));
            }
          } catch (error) {
            if (error instanceof Error) {
              console.log(chalk.red(`\n✗ ${error.message}`));
            }
          }

          console.log(chalk.gray('What else?\n'));
        } else {
          console.log(chalk.green('\nautotunez: ') + result.content + '\n');
        }
      } catch (error) {
        spinner.stop();
        if (error instanceof ApiKeyRequiredError) {
          console.log(chalk.red('\n✗ ' + error.message + '\n'));
          process.exit(1);
        } else if (error instanceof Error) {
          if (error.message.includes('401') || error.message.includes('authentication') || error.message.includes('Authentication')) {
            console.log(chalk.red('\n✗ Authentication failed. Run: autotunez login\n'));
          } else {
            console.log(chalk.red(`\n✗ Error: ${error.message}\n`));
          }
        } else {
          console.log(chalk.red('\n✗ Something went wrong\n'));
        }
        // Remove failed message from history
        messages.pop();
      }
    }
  });

program.parse();
