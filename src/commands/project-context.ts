import * as fs from 'fs';
import * as path from 'path';

export interface ProjectContext {
  claudeMd?: string;
  scratchpad?: string;
  plan?: string;
  foundFiles: string[];
}

export function loadProjectContext(cwd: string): ProjectContext {
  const foundFiles: string[] = [];
  let claudeMd: string | undefined;
  let scratchpad: string | undefined;
  let plan: string | undefined;

  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const scratchpadPath = path.join(cwd, 'SCRATCHPAD.md');
  const planPath = path.join(cwd, 'plan.md');

  if (fs.existsSync(claudeMdPath)) {
    claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
    foundFiles.push('CLAUDE.md');
  }
  if (fs.existsSync(scratchpadPath)) {
    scratchpad = fs.readFileSync(scratchpadPath, 'utf-8');
    foundFiles.push('SCRATCHPAD.md');
  }
  if (fs.existsSync(planPath)) {
    plan = fs.readFileSync(planPath, 'utf-8');
    foundFiles.push('plan.md');
  }

  return { claudeMd, scratchpad, plan, foundFiles };
}
