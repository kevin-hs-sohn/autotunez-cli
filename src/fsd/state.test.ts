import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  saveFSDState,
  loadFSDState,
  clearFSDState,
  hasResumableSession,
  getResumeInfo,
  getStateFilePath,
} from './state.js';
import type { FSDExecutionState, FSDConfig, FSDPlanResponse } from '../types.js';

// Use a temp directory for tests
const TEST_DIR = path.join(process.cwd(), '.test-fsd-state');
const STATE_DIR = path.join(TEST_DIR, '.claude');
const STATE_FILE = path.join(STATE_DIR, 'fsd-state.json');

function createMockPlan(): FSDPlanResponse {
  return {
    milestones: [
      {
        id: 'm1',
        title: 'Setup',
        description: 'Initial setup',
        successCriteria: 'Project runs',
        size: 'small',
        dependsOn: [],
        qaGoal: 'Verify setup',
        status: 'pending',
      },
      {
        id: 'm2',
        title: 'Feature',
        description: 'Build feature',
        successCriteria: 'Feature works',
        size: 'medium',
        dependsOn: ['m1'],
        qaGoal: 'Verify feature',
        status: 'pending',
      },
    ],
    userBlockers: [],
    estimatedCost: 2.0,
    estimatedTimeMinutes: 15,
    risks: [],
  };
}

function createMockState(overrides?: Partial<FSDExecutionState>): FSDExecutionState {
  return {
    mode: 'executing',
    currentMilestoneId: 'm1',
    completedMilestones: [],
    failedAttempts: 0,
    totalCost: 0.5,
    totalPrompts: 3,
    learnings: [],
    startTime: Date.now() - 60000,
    claudeSessionId: 'session-123',
    interactiveHistory: [],
    ...overrides,
  };
}

function createMockConfig(): FSDConfig {
  return {
    maxCost: 10,
    maxIterationsPerMilestone: 5,
    maxTotalPrompts: 100,
    checkpointInterval: 3,
    sensitiveApproval: true,
    autoResume: false,
  };
}

describe('state.ts', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('getStateFilePath', () => {
    it('should return correct path', () => {
      const result = getStateFilePath('/my/project');
      expect(result).toBe(path.join('/my/project', '.claude', 'fsd-state.json'));
    });
  });

  describe('saveFSDState', () => {
    it('should save state to disk', async () => {
      const plan = createMockPlan();
      const state = createMockState();
      const config = createMockConfig();

      const savedPath = await saveFSDState(TEST_DIR, 'Build an app', plan, state, config, null);

      expect(fs.existsSync(savedPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
      expect(content.version).toBe(1);
      expect(content.goal).toBe('Build an app');
      expect(content.plan.milestones).toHaveLength(2);
      expect(content.executionState.totalCost).toBe(0.5);
    });

    it('should create .claude directory if missing', async () => {
      expect(fs.existsSync(STATE_DIR)).toBe(false);

      await saveFSDState(TEST_DIR, 'Test', createMockPlan(), createMockState(), createMockConfig(), null);

      expect(fs.existsSync(STATE_DIR)).toBe(true);
    });

    it('should save git state when provided', async () => {
      const gitState = { isRepo: true, originalBranch: 'main', fsdBranch: 'fsd/test' };
      await saveFSDState(TEST_DIR, 'Test', createMockPlan(), createMockState(), createMockConfig(), gitState);

      const content = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      expect(content.gitState).toEqual(gitState);
    });

    it('should perform atomic write (no .tmp leftover)', async () => {
      await saveFSDState(TEST_DIR, 'Test', createMockPlan(), createMockState(), createMockConfig(), null);

      const tmpPath = STATE_FILE + '.tmp';
      expect(fs.existsSync(tmpPath)).toBe(false);
      expect(fs.existsSync(STATE_FILE)).toBe(true);
    });
  });

  describe('loadFSDState', () => {
    it('should return null when no state file exists', () => {
      const result = loadFSDState(TEST_DIR);
      expect(result).toBeNull();
    });

    it('should load saved state', async () => {
      await saveFSDState(TEST_DIR, 'My goal', createMockPlan(), createMockState(), createMockConfig(), null);

      const loaded = loadFSDState(TEST_DIR);
      expect(loaded).not.toBeNull();
      expect(loaded!.goal).toBe('My goal');
      expect(loaded!.version).toBe(1);
      expect(loaded!.plan.milestones).toHaveLength(2);
    });

    it('should return null for invalid JSON', () => {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, 'not valid json', 'utf-8');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = loadFSDState(TEST_DIR);
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return null for wrong version', () => {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ version: 99 }), 'utf-8');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = loadFSDState(TEST_DIR);
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('clearFSDState', () => {
    it('should delete state file', async () => {
      await saveFSDState(TEST_DIR, 'Test', createMockPlan(), createMockState(), createMockConfig(), null);
      expect(fs.existsSync(STATE_FILE)).toBe(true);

      clearFSDState(TEST_DIR);
      expect(fs.existsSync(STATE_FILE)).toBe(false);
    });

    it('should not throw when no state file exists', () => {
      expect(() => clearFSDState(TEST_DIR)).not.toThrow();
    });
  });

  describe('hasResumableSession', () => {
    it('should return false when no state exists', () => {
      expect(hasResumableSession(TEST_DIR)).toBe(false);
    });

    it('should return true for recent incomplete session', async () => {
      const state = createMockState({ completedMilestones: [] });
      await saveFSDState(TEST_DIR, 'Test', createMockPlan(), state, createMockConfig(), null);

      expect(hasResumableSession(TEST_DIR)).toBe(true);
    });

    it('should return false when all milestones are complete', async () => {
      const plan = createMockPlan();
      plan.milestones[0].status = 'completed';
      plan.milestones[1].status = 'completed';
      const state = createMockState({ completedMilestones: ['m1', 'm2'] });
      await saveFSDState(TEST_DIR, 'Test', plan, state, createMockConfig(), null);

      expect(hasResumableSession(TEST_DIR)).toBe(false);
    });

    it('should return false for sessions older than 24 hours', async () => {
      const state = createMockState();
      await saveFSDState(TEST_DIR, 'Test', createMockPlan(), state, createMockConfig(), null);

      // Manually backdate savedAt
      const content = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      content.savedAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      fs.writeFileSync(STATE_FILE, JSON.stringify(content), 'utf-8');

      expect(hasResumableSession(TEST_DIR)).toBe(false);
    });
  });

  describe('getResumeInfo', () => {
    it('should return null when no state exists', () => {
      expect(getResumeInfo(TEST_DIR)).toBeNull();
    });

    it('should return correct progress info', async () => {
      const state = createMockState({ completedMilestones: ['m1'] });
      await saveFSDState(TEST_DIR, 'Build something', createMockPlan(), state, createMockConfig(), null);

      const info = getResumeInfo(TEST_DIR);
      expect(info).not.toBeNull();
      expect(info!.goal).toBe('Build something');
      expect(info!.completed).toBe(1);
      expect(info!.total).toBe(2);
      expect(info!.savedAt).toBeTruthy();
    });
  });
});
