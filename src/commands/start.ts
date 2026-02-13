import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import {
  getAutotunezKey,
  getAutotunezKeySource,
  setAutotunezKey,
  validateAutotunezKey,
  hasSeenWelcome,
  markWelcomeSeen,
} from '../config.js';
import { transformPrompt, chatStructured, compactConversation, learnFromConversation, ApiKeyRequiredError } from '../agent.js';
import {
  executeWithClaudeCode,
  spawnInteractiveClaude,
} from '../executor.js';
import { needsSetup, getMissingFiles, runSetup } from '../setup.js';
import { startInkSession, type StreamEvent } from '../ui/session.js';
import { runFSDMode } from '../fsd/command.js';
import {
  fetchCreditInfo,
  refreshCredits,
  checkClaudeCodePrerequisites,
  checkVibesafuSecurity,
  installVibesafu,
  checkBYOK,
  ensureClaudeCodeAuth,
} from './startup-checks.js';
import { loadProjectContext } from './project-context.js';
import { createInteractiveHandler } from './interactive-mode.js';

// --- Readline prompt helpers ---

function askYesNo(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}

function askInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Preflight: API key, credits, Claude Code, vibesafu, BYOK ---

async function runPreflight(): Promise<{
  autotunezKey: string;
  initialCreditInfo?: { balance: number; usedToday: number };
}> {
  // 1. autotunez API key
  let autotunezKey = getAutotunezKey();
  const keySource = getAutotunezKeySource();

  if (!autotunezKey) {
    console.log(chalk.yellow('\n⚠ autotunez API key not found.\n'));
    console.log(chalk.gray('Get your free API key at:'));
    console.log(chalk.cyan('  https://autotunez.dev/dashboard\n'));
    console.log(chalk.gray('You can also set it via:'));
    console.log(chalk.gray('  - Environment variable: AUTOTUNEZ_API_KEY'));
    console.log(chalk.gray('  - .env file in your project\n'));

    const key = await askInput('Enter autotunez API key: ');
    if (!key) {
      console.log(chalk.red('\n✗ API key is required to use autotunez.\n'));
      process.exit(1);
    }
    if (!validateAutotunezKey(key)) {
      console.log(chalk.red('\n✗ Invalid API key format. Keys start with "atk_"'));
      console.log(chalk.gray('  Get your key at: https://autotunez.dev/dashboard\n'));
      process.exit(1);
    }
    setAutotunezKey(key);
    autotunezKey = key;
    console.log(chalk.green('✓ API key saved to ~/.autotunez/config.json\n'));
  }

  if (keySource === 'env') {
    console.log(chalk.green('✓ API key loaded from environment'));
  } else {
    console.log(chalk.green('✓ API key configured'));
  }

  // 2. Credits
  let initialCreditInfo: { balance: number; usedToday: number } | undefined;
  try {
    const info = await fetchCreditInfo(autotunezKey);
    if (info) {
      initialCreditInfo = info;
      console.log(chalk.cyan(`  Balance: $${info.balance.toFixed(2)}`) + chalk.gray(` (used today: $${info.usedToday.toFixed(2)})`));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid API key')) {
      console.log(chalk.red('✗ Invalid API key. Get a new one at: https://autotunez.dev/dashboard'));
      process.exit(1);
    }
    console.log(chalk.gray('  (Could not fetch usage data)'));
  }

  // 3. Claude Code
  const ccCheck = await checkClaudeCodePrerequisites();
  if (!ccCheck.installed) {
    console.log(chalk.red('✗ Claude Code CLI not found.'));
    console.log(chalk.gray('  Install it with: npm install -g @anthropic-ai/claude-code'));
    console.log(chalk.gray('  Or visit: https://claude.ai/claude-code\n'));
    process.exit(1);
  }
  console.log(chalk.green(`✓ Claude Code ${ccCheck.version || ''} detected`));

  // 4. Vibesafu
  const vbStatus = checkVibesafuSecurity();
  if (vbStatus.active) {
    console.log(chalk.green(`✓ vibesafu ${vbStatus.version || ''} active`));
  } else {
    console.log(chalk.yellow('⚠ vibesafu not installed (pre-execution security)'));
    const doInstall = await askYesNo(chalk.yellow('  Install vibesafu for security? (Y/n): '));
    if (doInstall) {
      const spinner = ora('Installing vibesafu...').start();
      const result = installVibesafu();
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

  // 5. BYOK / Auth
  const byok = checkBYOK();
  if (byok.mode === 'byok' && byok.anthropicKey) {
    if (!process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = byok.anthropicKey;
    }
    console.log(chalk.green('✓ Using your Anthropic API key (BYOK mode)'));
    console.log(chalk.gray('  Platform fee: 15% | You pay API costs directly\n'));
  } else {
    const authSpinner = ora('Checking Claude Code authentication...').start();
    authSpinner.stop();
    const authenticated = await ensureClaudeCodeAuth();
    if (authenticated) {
      console.log(chalk.green('✓ Claude Code authenticated\n'));
    }
  }

  return { autotunezKey, initialCreditInfo };
}

// --- Project setup check ---

async function runProjectSetup(cwd: string): Promise<void> {
  if (!needsSetup(cwd)) return;

  const missing = getMissingFiles(cwd);
  console.log(chalk.yellow(`⚠ Project setup required. Missing files: ${missing.join(', ')}`));
  const doSetup = await askYesNo(chalk.yellow('  Run initial setup? (Y/n): '));

  if (doSetup) {
    let setupSuccess = false;
    while (!setupSuccess) {
      setupSuccess = await runSetup(cwd);
      if (!setupSuccess) {
        console.log(chalk.red('Setup was not completed.'));
        const retry = await askYesNo(chalk.yellow('  Try again? (Y/n): '));
        if (!retry) {
          console.log(chalk.gray('Skipping setup. Continuing without CLAUDE.md.\n'));
          break;
        }
      }
    }
  } else {
    console.log(chalk.gray('Skipping setup. Continuing without CLAUDE.md.\n'));
  }
}

// --- Interactive pass-through mode ---

function runInteractiveMode(
  cwd: string,
  ctx: { claudeMd?: string; scratchpad?: string; plan?: string }
): void {
  console.log(chalk.bold('autotunez'));
  console.log(chalk.gray('Interactive mode. Press Ctrl+C to exit.\n'));

  const child = spawnInteractiveClaude({ cwd });
  const handler = createInteractiveHandler({
    cwd,
    projectContext: ctx.claudeMd,
    scratchpad: ctx.scratchpad,
    plan: ctx.plan,
  });

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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const result = await handler.processInput(trimmed);

    if (result.type === 'error') {
      console.log(chalk.red('\n✗ ' + result.content + '\n'));
      process.exit(1);
    }

    if (result.type === 'clarification') {
      console.log(chalk.green('\nautotunez: ') + result.content + '\n');
    } else {
      child.stdin?.write(result.content + '\n');
    }
  });

  rl.on('close', () => { child.stdin?.end(); });
  process.on('SIGINT', () => { child.kill('SIGINT'); });
}

// --- Ink UI mode ---

async function runInkMode(
  cwd: string,
  ctx: { claudeMd?: string; scratchpad?: string; plan?: string },
  opts: { autotunezKey: string; initialCreditInfo?: { balance: number; usedToday: number } }
): Promise<void> {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.resume();

  let projectContext = ctx.claudeMd;
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
    initialCreditInfo: opts.initialCreditInfo,
    onRefreshCredits: () => refreshCredits(opts.autotunezKey),
    onSubmit: async (input: string, conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>, lastClaudeOutput?: string) => {
      const result = await transformPrompt(input, projectContext, {
        claudeMd: projectContext,
        scratchpad: ctx.scratchpad,
        plan: ctx.plan,
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
      return { summary: result.summary, recentMessages: result.recentMessages };
    },
    onLearn: async (msgs) => {
      return learnFromConversation(msgs, projectContext || '');
    },
    onApplyRule: async (rule: string, category: 'always' | 'ask_first' | 'never') => {
      const ruleClaudeMdPath = path.join(cwd, 'CLAUDE.md');
      if (!fs.existsSync(ruleClaudeMdPath)) {
        throw new Error('CLAUDE.md not found. Run setup first.');
      }
      let content = fs.readFileSync(ruleClaudeMdPath, 'utf-8');
      const categoryMap = {
        always: '### ✅ Always',
        ask_first: '### ⚠️ Ask first',
        never: '### 🚫 Never',
      };
      const sectionHeader = categoryMap[category];
      const sectionIndex = content.indexOf(sectionHeader);
      if (sectionIndex === -1) {
        const boundariesIndex = content.indexOf('## Boundaries');
        if (boundariesIndex === -1) {
          content += `\n\n## Boundaries\n\n${sectionHeader}\n- ${rule}\n`;
        } else {
          const nextSectionMatch = content.slice(boundariesIndex + 14).match(/\n## /);
          const insertPos = nextSectionMatch ? boundariesIndex + 14 + nextSectionMatch.index! : content.length;
          content = content.slice(0, insertPos) + `\n${sectionHeader}\n- ${rule}\n` + content.slice(insertPos);
        }
      } else {
        const sectionEnd = content.slice(sectionIndex + sectionHeader.length).search(/\n###? /);
        const insertPos = sectionEnd === -1 ? content.length : sectionIndex + sectionHeader.length + sectionEnd;
        content = content.slice(0, insertPos) + `\n- ${rule}` + content.slice(insertPos);
      }
      fs.writeFileSync(ruleClaudeMdPath, content, 'utf-8');
      projectContext = content;
    },
    onFSD: async (goal: string) => {
      await runFSDMode(goal, { maxCost: '10' });
    },
  });

  console.log(chalk.gray('\nGoodbye! Happy vibing!'));
  process.exit(0);
}

// --- Classic readline mode ---

async function runClassicMode(
  _cwd: string,
  ctx: { claudeMd?: string; scratchpad?: string; plan?: string }
): Promise<void> {
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
  const history: string[] = [];
  let historyIndex = -1;
  let currentInput = '';

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
        if (cursorPos < buffer.length) {
          process.stdout.write(`\x1b[${buffer.length - cursorPos}D`);
        }
      };

      const CHAR_CTRL_C = 3;
      const CHAR_ENTER = 13;
      const CHAR_BACKSPACE = 127;
      const MAX_INPUT_HISTORY = 100;

      const onData = (key: string) => {
        const code = key.charCodeAt(0);
        if (code === CHAR_CTRL_C) { stdin.setRawMode(false); stdin.removeListener('data', onData); console.log(); resolve('exit'); return; }
        if (code === CHAR_ENTER) {
          stdin.setRawMode(false); stdin.removeListener('data', onData); console.log();
          if (buffer.trim() && history[0] !== buffer.trim()) { history.unshift(buffer.trim()); if (history.length > MAX_INPUT_HISTORY) history.pop(); }
          resolve(buffer); return;
        }
        if (code === CHAR_BACKSPACE) { if (cursorPos > 0) { buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos); cursorPos--; redraw(); } return; }
        if (key.startsWith('\x1b[')) {
          if (key === '\x1b[A' && historyIndex < history.length - 1) { if (historyIndex === -1) currentInput = buffer; historyIndex++; buffer = history[historyIndex]; cursorPos = buffer.length; redraw(); }
          else if (key === '\x1b[B' && historyIndex > -1) { historyIndex--; buffer = historyIndex === -1 ? currentInput : history[historyIndex]; cursorPos = buffer.length; redraw(); }
          else if (key === '\x1b[C' && cursorPos < buffer.length) { cursorPos++; process.stdout.write(key); }
          else if (key === '\x1b[D' && cursorPos > 0) { cursorPos--; process.stdout.write(key); }
          return;
        }
        if (code >= 32) { buffer = buffer.slice(0, cursorPos) + key + buffer.slice(cursorPos); cursorPos += key.length; redraw(); }
      };
      stdin.on('data', onData);
    });
  };

  while (true) {
    const input = await question(chalk.blue('You: '));
    const trimmed = input.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') { console.log(chalk.gray('\nGoodbye! Happy vibing!')); process.exit(0); }
    if (trimmed.toLowerCase() === 'clear') { messages.length = 0; lastSessionId = undefined; console.log(chalk.gray('Context cleared.\n')); continue; }

    messages.push({ role: 'user', content: trimmed });
    const spinner = ora('Thinking...').start();

    try {
      let result: { type: 'prompt' | 'clarification'; content: string };
      if (messages.length === 1 && ctx.claudeMd) {
        result = await transformPrompt(trimmed, ctx.claudeMd, { claudeMd: ctx.claudeMd, scratchpad: ctx.scratchpad, plan: ctx.plan });
      } else {
        result = await chatStructured(messages);
      }
      spinner.stop();
      messages.push({ role: 'assistant', content: result.content });

      if (result.type === 'prompt') {
        console.log(chalk.cyan('\nWorking on it...\n'));
        try {
          const execResult = await executeWithClaudeCode(result.content, { resumeSessionId: lastSessionId });
          lastSessionId = execResult.sessionId;
          if (!execResult.success) console.log(chalk.yellow(`\nExited with code ${execResult.exitCode}`));
        } catch (error) {
          if (error instanceof Error) console.log(chalk.red(`\n✗ ${error.message}`));
        }
        console.log(chalk.gray('What else?\n'));
      } else {
        console.log(chalk.green('\nautotunez: ') + result.content + '\n');
      }
    } catch (error) {
      spinner.stop();
      if (error instanceof ApiKeyRequiredError) { console.log(chalk.red('\n✗ ' + error.message + '\n')); process.exit(1); }
      else if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('authentication') || error.message.includes('Authentication')) {
          console.log(chalk.red('\n✗ Authentication failed. Run: autotunez login\n'));
        } else { console.log(chalk.red(`\n✗ Error: ${error.message}\n`)); }
      } else { console.log(chalk.red('\n✗ Something went wrong\n')); }
      messages.pop();
    }
  }
}

// --- Command definition ---

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start interactive autotunez session')
    .option('-i, --interactive', 'Run in interactive pass-through mode (keeps Claude Code session alive)')
    .option('--classic', 'Use classic readline-based UI instead of modern ink UI')
    .action(async (options: { interactive?: boolean; classic?: boolean }) => {
      const { autotunezKey, initialCreditInfo } = await runPreflight();
      const cwd = process.cwd();

      await runProjectSetup(cwd);

      const projectCtx = loadProjectContext(cwd);
      for (const f of projectCtx.foundFiles) {
        console.log(chalk.green(`✓ Found ${f}`));
      }
      if (projectCtx.foundFiles.length > 0) console.log();

      if (options.interactive) {
        runInteractiveMode(cwd, projectCtx);
        return;
      }

      if (!hasSeenWelcome()) markWelcomeSeen();

      if (!options.classic) {
        await runInkMode(cwd, projectCtx, { autotunezKey, initialCreditInfo });
      } else {
        await runClassicMode(cwd, projectCtx);
      }
    });
}
