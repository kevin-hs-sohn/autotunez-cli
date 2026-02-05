import { spawn } from 'child_process';

/**
 * Git protection utilities for FSD mode
 *
 * - Creates dedicated FSD branch to isolate changes
 * - Blocks push (user must review and push manually)
 * - Blocks checkout to main/master
 */

export interface GitState {
  isRepo: boolean;
  originalBranch: string;
  fsdBranch: string;
}

/**
 * Run a git command and return output
 */
async function runGit(cwd: string, args: string[]): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim() || stderr.trim(),
      });
    });

    proc.on('error', () => {
      resolve({ success: false, output: 'Git command failed' });
    });
  });
}

/**
 * Check if directory is a git repository
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.success && result.output === 'true';
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.success ? result.output : 'unknown';
}

/**
 * Generate FSD branch name from goal
 */
export function generateFSDBranchName(goal: string): string {
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
  const sanitized = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30)
    .replace(/^-|-$/g, '');
  return `fsd/${sanitized}-${timestamp}`;
}

/**
 * Check if current branch is protected (main/master)
 */
export function isProtectedBranch(branchName: string): boolean {
  const protected_branches = ['main', 'master', 'develop', 'production', 'prod'];
  return protected_branches.includes(branchName.toLowerCase());
}

/**
 * Initialize FSD git protection
 * Creates a dedicated branch for FSD work
 */
export async function initFSDGitProtection(
  cwd: string,
  goal: string,
  onLog: (msg: string) => void
): Promise<GitState | null> {
  // Check if git repo
  if (!(await isGitRepo(cwd))) {
    onLog('Not a git repository - git protection disabled');
    return null;
  }

  const originalBranch = await getCurrentBranch(cwd);
  const fsdBranch = generateFSDBranchName(goal);

  onLog(`Current branch: ${originalBranch}`);
  onLog(`Creating FSD branch: ${fsdBranch}`);

  // Check for uncommitted changes
  const statusResult = await runGit(cwd, ['status', '--porcelain']);
  if (statusResult.success && statusResult.output) {
    onLog('Warning: You have uncommitted changes. Consider committing first.');
  }

  // Create and checkout FSD branch
  const createResult = await runGit(cwd, ['checkout', '-b', fsdBranch]);
  if (!createResult.success) {
    onLog(`Failed to create FSD branch: ${createResult.output}`);
    return null;
  }

  onLog(`Switched to FSD branch: ${fsdBranch}`);

  // Install pre-push hook to physically block pushes
  const hookInstalled = await installFSDPrePushHook(cwd);
  if (hookInstalled) {
    onLog('Pre-push hook installed (git push blocked during FSD)');
  } else {
    onLog('Warning: Could not install pre-push hook');
  }

  return {
    isRepo: true,
    originalBranch,
    fsdBranch,
  };
}

/**
 * Get diff summary for FSD branch
 */
export async function getFSDDiffSummary(
  cwd: string,
  originalBranch: string
): Promise<string> {
  // Get file change stats
  const diffStatResult = await runGit(cwd, ['diff', '--stat', originalBranch]);
  // Get commit count
  const commitCountResult = await runGit(cwd, ['rev-list', '--count', `${originalBranch}..HEAD`]);

  const commitCount = commitCountResult.success ? commitCountResult.output : '0';
  const diffStat = diffStatResult.success ? diffStatResult.output : 'No changes';

  return `
Commits: ${commitCount}

Changed files:
${diffStat}
`.trim();
}

/**
 * Block dangerous git operations during FSD
 * This is called in the prompt injected into Claude Code
 */
export function getFSDGitRules(fsdBranch: string): string {
  return `
## GIT RULES (MANDATORY)

You are working on FSD branch: ${fsdBranch}

BLOCKED OPERATIONS:
- git push (any form) - user must review and push manually
- git checkout main/master/develop/production/prod
- git merge into main/master
- git reset --hard on main/master
- Force push of any kind

ALLOWED OPERATIONS:
- git add
- git commit
- git status/log/diff
- git checkout <feature-branch>
- git stash

If you need to push, tell the user: "Changes are ready. Please review and push manually."
`;
}

/**
 * Complete FSD session and show summary
 */
export async function completeFSDGitSession(
  cwd: string,
  gitState: GitState,
  onLog: (msg: string) => void
): Promise<void> {
  // Remove FSD pre-push hook
  await removeFSDPrePushHook(cwd);

  onLog('\n--- Git Summary ---');
  onLog(`FSD Branch: ${gitState.fsdBranch}`);
  onLog(`Original Branch: ${gitState.originalBranch}`);

  const diffSummary = await getFSDDiffSummary(cwd, gitState.originalBranch);
  onLog(diffSummary);

  onLog('\nNext steps:');
  onLog(`  1. Review changes: git diff ${gitState.originalBranch}`);
  onLog(`  2. If satisfied, merge: git checkout ${gitState.originalBranch} && git merge ${gitState.fsdBranch}`);
  onLog(`  3. Push: git push origin ${gitState.originalBranch}`);
  onLog(`  4. Clean up: git branch -d ${gitState.fsdBranch}`);
}

// ============================================================================
// Git Pre-Push Hook (Physical Block)
// ============================================================================

const FSD_PREPUSH_HOOK = `#!/bin/bash
# FSD Mode Pre-Push Hook - Blocks pushes during autonomous execution
# This hook is automatically installed by autotunez FSD mode
# and removed when FSD mode completes.

echo ""
echo "🚫 GIT PUSH BLOCKED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "FSD mode is active. Push is blocked for safety."
echo ""
echo "You can push manually after FSD mode completes and"
echo "you have reviewed the changes."
echo ""
echo "To bypass (NOT RECOMMENDED during FSD):"
echo "  git push --no-verify"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
exit 1
`;

const FSD_HOOK_MARKER = '# FSD Mode Pre-Push Hook';

/**
 * Install FSD pre-push hook to physically block pushes
 */
export async function installFSDPrePushHook(cwd: string): Promise<boolean> {
  const hooksDir = await getGitHooksDir(cwd);
  if (!hooksDir) return false;

  const prePushPath = `${hooksDir}/pre-push`;

  try {
    // Check if there's an existing pre-push hook
    let existingHook = '';
    try {
      existingHook = (await import('fs')).readFileSync(prePushPath, 'utf-8');
    } catch {
      // No existing hook
    }

    // Don't install if already installed
    if (existingHook.includes(FSD_HOOK_MARKER)) {
      return true;
    }

    // Backup existing hook if any
    if (existingHook && !existingHook.includes(FSD_HOOK_MARKER)) {
      const fs = await import('fs');
      fs.writeFileSync(`${prePushPath}.fsd-backup`, existingHook, 'utf-8');
    }

    // Install FSD hook
    const fs = await import('fs');
    fs.writeFileSync(prePushPath, FSD_PREPUSH_HOOK, { mode: 0o755 });

    return true;
  } catch (error) {
    console.error('Failed to install pre-push hook:', error);
    return false;
  }
}

/**
 * Remove FSD pre-push hook and restore original if any
 */
export async function removeFSDPrePushHook(cwd: string): Promise<boolean> {
  const hooksDir = await getGitHooksDir(cwd);
  if (!hooksDir) return false;

  const prePushPath = `${hooksDir}/pre-push`;
  const backupPath = `${prePushPath}.fsd-backup`;

  try {
    const fs = await import('fs');

    // Check if current hook is our FSD hook
    let currentHook = '';
    try {
      currentHook = fs.readFileSync(prePushPath, 'utf-8');
    } catch {
      return true; // No hook to remove
    }

    if (!currentHook.includes(FSD_HOOK_MARKER)) {
      return true; // Not our hook
    }

    // Check for backup
    let hasBackup = false;
    try {
      fs.accessSync(backupPath);
      hasBackup = true;
    } catch {
      // No backup
    }

    if (hasBackup) {
      // Restore original hook
      const backup = fs.readFileSync(backupPath, 'utf-8');
      fs.writeFileSync(prePushPath, backup, { mode: 0o755 });
      fs.unlinkSync(backupPath);
    } else {
      // Just remove our hook
      fs.unlinkSync(prePushPath);
    }

    return true;
  } catch (error) {
    console.error('Failed to remove pre-push hook:', error);
    return false;
  }
}

/**
 * Get the git hooks directory
 */
async function getGitHooksDir(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ['rev-parse', '--git-dir']);
  if (!result.success) return null;

  const gitDir = result.output.trim();
  const hooksDir = gitDir.startsWith('/') ? `${gitDir}/hooks` : `${cwd}/${gitDir}/hooks`;

  // Ensure hooks directory exists
  try {
    const fs = await import('fs');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    return hooksDir;
  } catch {
    return null;
  }
}
