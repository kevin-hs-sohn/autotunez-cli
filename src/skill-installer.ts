import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const NPX_SKILLS = [
  'nextlevelbuilder/ui-ux-pro-max-skill',
  'vercel-labs/agent-skills',
  'supabase/agent-skills',
  'obra/superpowers',
  'expo/skills',
  'callstackincubator/agent-skills',
];

export const MANUAL_SKILLS = [
  {
    repo: 'https://github.com/affaan-m/everything-claude-code.git',
    skills: ['backend-patterns', 'security-review'],
  },
  {
    repo: 'https://github.com/sickn33/antigravity-awesome-skills.git',
    skills: ['ethical-hacking-methodology', 'pentest-checklist', 'aws-penetration-testing'],
  },
];

export interface InstallResult {
  name: string;
  success: boolean;
  error?: string;
}

export function installNpxSkill(cwd: string, repo: string): InstallResult {
  try {
    const result = spawnSync('npx', ['skills', 'add', repo, '-y'], {
      cwd,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: 'pipe',
    });

    if (result.error) {
      return { name: repo, success: false, error: result.error.message };
    }

    if (result.status !== 0) {
      return { name: repo, success: false, error: result.stderr || 'Installation failed' };
    }

    return { name: repo, success: true };
  } catch (err) {
    return {
      name: repo,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export function installManualSkills(
  cwd: string,
  repoUrl: string,
  skillNames: string[]
): InstallResult[] {
  const tmpDir = path.join(os.tmpdir(), `autotunez-skills-${Date.now()}`);

  // Clone repo
  const cloneResult = spawnSync('git', ['clone', '--depth', '1', repoUrl, tmpDir], {
    encoding: 'utf-8',
    timeout: 30_000,
    stdio: 'pipe',
  });

  if (cloneResult.error || (cloneResult.status !== null && cloneResult.status !== 0)) {
    return skillNames.map((name) => ({
      name,
      success: false,
      error: `Git clone failed: ${cloneResult.stderr || cloneResult.error?.message || 'unknown'}`,
    }));
  }

  // Ensure .claude/skills directory
  const skillsDir = path.join(cwd, '.claude', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const results: InstallResult[] = [];

  for (const skillName of skillNames) {
    const srcDir = path.join(tmpDir, 'skills', skillName);

    if (!fs.existsSync(srcDir)) {
      results.push({
        name: skillName,
        success: false,
        error: `Skill directory not found in cloned repo`,
      });
      continue;
    }

    try {
      const destDir = path.join(skillsDir, skillName);
      fs.cpSync(srcDir, destDir, { recursive: true });
      results.push({ name: skillName, success: true });
    } catch (err) {
      results.push({
        name: skillName,
        success: false,
        error: err instanceof Error ? err.message : 'Copy failed',
      });
    }
  }

  // Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  return results;
}

export async function installDefaultSkills(cwd: string): Promise<InstallResult[]> {
  const results: InstallResult[] = [];

  // Install npx skills
  for (const repo of NPX_SKILLS) {
    results.push(installNpxSkill(cwd, repo));
  }

  // Install manual skills
  for (const manual of MANUAL_SKILLS) {
    results.push(...installManualSkills(cwd, manual.repo, manual.skills));
  }

  return results;
}
