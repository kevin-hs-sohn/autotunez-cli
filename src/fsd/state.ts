import * as fs from 'fs';
import * as path from 'path';
import {
  FSDExecutionState,
  FSDConfig,
  FSDPlanResponse,
} from '../types.js';
import { GitState } from './git-protection.js';

/**
 * FSD State Management
 *
 * Saves and restores FSD execution state for resume functionality
 */

export interface FSDSavedState {
  version: 1;
  savedAt: number;
  goal: string;
  plan: FSDPlanResponse;
  executionState: FSDExecutionState;
  config: FSDConfig;
  gitState: GitState | null;
}

const STATE_DIR = '.claude';
const STATE_FILE = 'fsd-state.json';

/**
 * Get the state file path for a project
 */
export function getStateFilePath(projectPath: string): string {
  return path.join(projectPath, STATE_DIR, STATE_FILE);
}

/**
 * Save FSD state to disk
 */
export async function saveFSDState(
  projectPath: string,
  goal: string,
  plan: FSDPlanResponse,
  executionState: FSDExecutionState,
  config: FSDConfig,
  gitState: GitState | null
): Promise<string> {
  const stateDir = path.join(projectPath, STATE_DIR);

  // Ensure directory exists
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const state: FSDSavedState = {
    version: 1,
    savedAt: Date.now(),
    goal,
    plan,
    executionState,
    config,
    gitState,
  };

  const statePath = getStateFilePath(projectPath);
  const tmpPath = statePath + '.tmp';

  // Atomic write: write to temp file first, then rename
  // (rename is atomic on the same filesystem)
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);

  return statePath;
}

/**
 * Load FSD state from disk
 */
export function loadFSDState(projectPath: string): FSDSavedState | null {
  const statePath = getStateFilePath(projectPath);

  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content) as FSDSavedState;

    // Validate version
    if (state.version !== 1) {
      console.warn('FSD state version mismatch, ignoring saved state');
      return null;
    }

    return state;
  } catch (error) {
    console.warn('Failed to load FSD state:', error);
    return null;
  }
}

/**
 * Clear saved FSD state
 */
export function clearFSDState(projectPath: string): void {
  const statePath = getStateFilePath(projectPath);

  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

/**
 * Check if there's a resumable FSD session
 */
export function hasResumableSession(projectPath: string): boolean {
  const state = loadFSDState(projectPath);
  if (!state) return false;

  // Check if the session is still valid (less than 24 hours old)
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  if (Date.now() - state.savedAt > MAX_AGE) {
    return false;
  }

  // Check if there are incomplete milestones
  const completed = state.executionState.completedMilestones;
  const incomplete = state.plan.milestones.filter(
    (m) => !completed.includes(m.id) && m.status !== 'completed'
  );

  return incomplete.length > 0;
}

/**
 * Get resumable session info for display
 */
export function getResumeInfo(projectPath: string): {
  goal: string;
  completed: number;
  total: number;
  elapsed: string;
  savedAt: string;
} | null {
  const state = loadFSDState(projectPath);
  if (!state) return null;

  const completed = state.executionState.completedMilestones.length;
  const total = state.plan.milestones.length;
  const elapsed = Math.floor((state.savedAt - state.executionState.startTime) / 60000);
  const savedAt = new Date(state.savedAt).toLocaleString();

  return {
    goal: state.goal,
    completed,
    total,
    elapsed: `${elapsed} minutes`,
    savedAt,
  };
}

