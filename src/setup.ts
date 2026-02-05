// CLI initial setup — Phase 1 via CLI
// Detects missing project files and runs interactive interview + scaffolding

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  generateClaudeMd,
  generateScratchpad,
  generatePlanMd,
} from './templates.js';
import type { ProjectConfig } from './types.js';
import { ApiClient } from './api-client.js';
import { getApiKey, getAutotunezKey, getServerUrl } from './config.js';
import { startSetupSession } from './ui/setup-session.js';

const REQUIRED_FILES = ['CLAUDE.md', 'SCRATCHPAD.md', 'plan.md'];

// Tech debt skill template
const TECHDEBT_SKILL = `# Tech Debt Finder

Find and report technical debt in this codebase.

## What to Look For

1. **Duplicated code** — Functions, components, or logic that appears in multiple places
2. **TODO/FIXME comments** — Unfinished work or known issues
3. **Unused exports** — Functions, types, or constants that are exported but never imported
4. **Missing tests** — Critical paths without test coverage
5. **Deprecated dependencies** — Packages that need upgrading
6. **Dead code** — Unreachable code, commented-out blocks
7. **Type safety gaps** — Any casts, implicit anys, or @ts-ignore

## Output Format

Return a prioritized list with file:line references:

\`\`\`
## High Priority
- [file.ts:42] Duplicated validation logic — also in other-file.ts:15

## Medium Priority
- [service.ts:100] TODO: Handle edge case for empty input

## Low Priority
- [utils.ts] Unused export: formatDate
\`\`\`

## How to Run

\`\`\`
/techdebt
\`\`\`

Or with focus:
\`\`\`
/techdebt src/components
\`\`\`
`;

/**
 * Check if the current directory needs initial setup.
 * Returns true if any required file is missing.
 */
export function needsSetup(cwd: string): boolean {
  return REQUIRED_FILES.some((file) => !fs.existsSync(path.join(cwd, file)));
}

/**
 * Get list of missing files for diagnostic display.
 */
export function getMissingFiles(cwd: string): string[] {
  return REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(cwd, file)));
}

/**
 * Run the full setup flow using Ink UI:
 * 1. Ask skill level (skipped if initialInput provided)
 * 2. Interview to gather project info
 * 3. Extract ProjectConfig
 * 4. Generate and write files
 *
 * @param initialInput - Optional project description (e.g., from FSD goal). Skips skill selection if provided.
 */
export async function runSetup(_apiKey: string, cwd: string, initialInput?: string): Promise<boolean> {
  // Check API keys
  const anthropicKey = getApiKey();
  const autotunezKey = getAutotunezKey();

  if (!autotunezKey) {
    console.log(
      chalk.red('✗ autotunez API key not configured. Get one at: https://autotunez.dev/dashboard')
    );
    return false;
  }

  if (!anthropicKey) {
    console.log(
      chalk.red('✗ Anthropic API key not configured. Run: autotunez config --set-key')
    );
    return false;
  }

  const apiClient = new ApiClient({
    autotunezKey,
    anthropicKey,
    serverUrl: getServerUrl(),
  });

  let extractedConfig: ProjectConfig | null = null;

  try {
    const success = await startSetupSession({
      initialInput,
      onInterview: async (messages, level) => {
        const response = await apiClient.interview(messages, level);
        return {
          message: response.message,
          readyToGenerate: response.readyToGenerate,
        };
      },
      onExtract: async (messages) => {
        const result = await apiClient.extract(messages);
        extractedConfig = result.config;
        return { name: result.config.name };
      },
      onComplete: async () => {
        if (!extractedConfig) {
          throw new Error('프로젝트 정보를 추출하지 못했습니다.');
        }

        const files: Array<{ name: string; content: string }> = [
          { name: 'CLAUDE.md', content: generateClaudeMd(extractedConfig) },
          { name: 'SCRATCHPAD.md', content: generateScratchpad(extractedConfig) },
          { name: 'plan.md', content: generatePlanMd(extractedConfig) },
        ];

        for (const file of files) {
          fs.writeFileSync(path.join(cwd, file.name), file.content, 'utf-8');
        }

        // Create .claude/commands directory and techdebt skill
        const claudeDir = path.join(cwd, '.claude', 'commands');
        if (!fs.existsSync(claudeDir)) {
          fs.mkdirSync(claudeDir, { recursive: true });
        }
        fs.writeFileSync(
          path.join(claudeDir, 'techdebt.md'),
          TECHDEBT_SKILL,
          'utf-8'
        );
      },
    });

    if (success) {
      console.log('');
      console.log(chalk.green('  ✓ CLAUDE.md'));
      console.log(chalk.green('  ✓ SCRATCHPAD.md'));
      console.log(chalk.green('  ✓ plan.md'));
      console.log(chalk.green('  ✓ .claude/commands/techdebt.md'));
      console.log('');
      console.log(chalk.gray('  Tip: Run /techdebt in Claude Code to find technical debt'));
      console.log('');
    }

    return success;
  } catch (error) {
    if (error instanceof Error) {
      console.log(chalk.red(`\n✗ 셋업 실패: ${error.message}`));
    }
    return false;
  }
}
