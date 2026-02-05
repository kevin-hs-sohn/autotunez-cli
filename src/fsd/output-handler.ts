/**
 * Output handler interface for FSD mode
 * Allows switching between console and Ink UI
 */

export interface FSDOutputHandler {
  // Lifecycle
  start(goal: string): void;
  complete(stats: { milestones: number; total: number; prompts: number; cost: number; minutes: number; failedAttempts: number }): void;
  error(message: string): void;

  // Planning
  planningStart(): void;
  planningComplete(): void;
  showPlan(plan: { milestones: Array<{ id: string; title: string; size: string; dependsOn: string[] }>; estimatedCost: number; estimatedTimeMinutes: number; risks: string[] }): void;

  // Execution
  milestoneStart(id: string, title: string): void;
  milestoneComplete(id: string, title: string): void;
  milestoneFailed(id: string, title: string, errors?: string[]): void;
  milestoneSkipped(id: string, reason: string): void;

  // QA
  qaStart(milestoneId: string): void;
  qaComplete(passed: boolean): void;
  qaIssue(severity: string, description: string): void;

  // Output streaming
  output(text: string): void;
  progress(cost: number, maxCost: number, prompts: number): void;

  // User interaction
  confirm(question: string): Promise<boolean>;

  // Security status
  securityStatus(vibesafuActive: boolean): void;

  // Git
  gitBranch(branch: string): void;
  gitComplete(summary: string): void;

  // Blockers
  showBlockers(blockers: Array<{ description: string; checkInstruction: string }>): void;
}

/**
 * Console-based output handler (original behavior)
 */
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import * as readline from 'readline';

export class ConsoleOutputHandler implements FSDOutputHandler {
  private spinner: Ora | null = null;

  start(goal: string): void {
    console.log(chalk.bold.cyan('FSD Mode - Planning\n'));
    console.log(chalk.white('Goal: ' + goal + '\n'));
  }

  complete(stats: { milestones: number; total: number; prompts: number; cost: number; minutes: number; failedAttempts: number }): void {
    console.log(chalk.bold.green('\nFSD Mode Complete!\n'));
    console.log(chalk.white('  Milestones: ' + stats.milestones + '/' + stats.total));
    console.log(chalk.white('  Prompts: ' + stats.prompts));
    console.log(chalk.white('  Estimated cost: ~$' + stats.cost.toFixed(2)));
    console.log(chalk.white('  Time: ' + stats.minutes + ' minutes'));
    console.log(chalk.white('  Failed attempts: ' + stats.failedAttempts));
  }

  error(message: string): void {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    } else {
      console.log(chalk.red('Error: ' + message));
    }
  }

  planningStart(): void {
    this.spinner = ora('Generating plan...').start();
  }

  planningComplete(): void {
    if (this.spinner) {
      this.spinner.succeed('Plan generated');
      this.spinner = null;
    }
  }

  showPlan(plan: { milestones: Array<{ id: string; title: string; size: string; dependsOn: string[] }>; estimatedCost: number; estimatedTimeMinutes: number; risks: string[] }): void {
    console.log();
    console.log(chalk.bold('Milestones'));
    console.log();

    for (const m of plan.milestones) {
      console.log(chalk.white('  ' + m.id + '. ' + m.title + ' [' + m.size + ']'));
      if (m.dependsOn.length > 0) {
        console.log(chalk.gray('     Depends on: ' + m.dependsOn.join(', ')));
      }
    }

    console.log();
    console.log(chalk.bold('Estimates'));
    console.log(chalk.white('  Cost: ~$' + plan.estimatedCost.toFixed(2)));
    console.log(chalk.white('  Time: ~' + plan.estimatedTimeMinutes + ' minutes'));

    if (plan.risks.length > 0) {
      console.log();
      console.log(chalk.bold('Risks'));
      for (const risk of plan.risks) {
        console.log(chalk.gray('  - ' + risk));
      }
    }
    console.log();
  }

  milestoneStart(id: string, title: string): void {
    console.log(chalk.bold('\n> ' + id + ': ' + title + '\n'));
  }

  milestoneComplete(id: string, title: string): void {
    console.log(chalk.green('Done: ' + title));
  }

  milestoneFailed(id: string, title: string, errors?: string[]): void {
    console.log(chalk.red('Failed: ' + title));
    if (errors) {
      for (const err of errors) {
        console.log(chalk.red('  ' + err));
      }
    }
  }

  milestoneSkipped(id: string, reason: string): void {
    console.log(chalk.gray('Skipping ' + id + ' (' + reason + ')'));
  }

  qaStart(milestoneId: string): void {
    console.log(chalk.gray('Running QA for ' + milestoneId + '...'));
  }

  qaComplete(passed: boolean): void {
    if (passed) {
      console.log(chalk.green('QA passed'));
    } else {
      console.log(chalk.yellow('QA found issues'));
    }
  }

  qaIssue(severity: string, description: string): void {
    console.log(chalk.yellow('  - [' + severity + '] ' + description));
  }

  output(text: string): void {
    process.stdout.write(text);
  }

  progress(cost: number, maxCost: number, prompts: number): void {
    console.log(chalk.gray(`  [Cost: ~$${cost.toFixed(2)}/${maxCost} | Prompts: ${prompts}]`));
  }

  async confirm(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(chalk.cyan(question + ' (Y/n): '), (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
      });
    });
  }

  securityStatus(vibesafuActive: boolean): void {
    if (vibesafuActive) {
      console.log(chalk.green('✓ vibesafu active (pre-execution security)'));
    } else {
      console.log(chalk.yellow('⚠ vibesafu not installed (pre-execution security)'));
      console.log(chalk.gray('  Install with: npm install -g vibesafu && vibesafu install'));
    }
    console.log(chalk.green('✓ Post-execution detection active'));
  }

  gitBranch(branch: string): void {
    console.log(chalk.green('Git protection enabled. Working on branch: ' + branch));
    console.log(chalk.gray('Git push is blocked. You must review and push manually after completion.'));
  }

  gitComplete(summary: string): void {
    console.log(chalk.white(summary));
  }

  showBlockers(blockers: Array<{ description: string; checkInstruction: string }>): void {
    console.log(chalk.yellow('\nPlease complete these tasks first:\n'));
    for (const b of blockers) {
      console.log(chalk.yellow('  - ' + b.description));
      console.log(chalk.gray('    Check: ' + b.checkInstruction));
    }
    console.log();
  }
}
