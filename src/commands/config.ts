import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  validateApiKey,
  getAutotunezKey,
  setAutotunezKey,
  clearAutotunezKey,
  validateAutotunezKey,
  getModelPreference,
  setModelPreference,
  validateModelPreference,
  getBillingMode,
} from '../config.js';

export function createConfigCommand(): Command {
  return new Command('config')
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

        console.log();

        const billingMode = getBillingMode();
        if (billingMode === 'byok') {
          console.log(chalk.green('✓ Billing mode: BYOK (your API key)'));
          console.log(chalk.gray('  Platform fee: 15% | You pay API costs directly'));
        } else {
          console.log(chalk.gray('○ Billing mode: Managed (autotunez credits)'));
          console.log(chalk.gray('  Set your own key with: autotunez config --set-key'));
        }
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
}
