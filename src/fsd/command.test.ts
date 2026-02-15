import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockApiClient,
  mockExecuteMilestone,
  mockExecuteClaudeCodeSecure,
  mockCreateInitialState,
  mockCreateDefaultConfig,
  mockRedactSecrets,
  mockGenerateQAFixPrompt,
  mockSpawnQAAgent,
  mockSaveQAReport,
  mockInitFSDGitProtection,
  mockCompleteFSDGitSession,
  mockGetFSDGitRules,
  mockGetCurrentBranch,
  mockSaveFSDState,
  mockLoadFSDState,
  mockClearFSDState,
  mockHasResumableSession,
  mockGetResumeInfo,
  mockGetVibesafuStatus,
  mockNeedsSetup,
  mockGetApiKey,
  mockGetAutotunezKey,
  mockGetModelPreference,
  mockExecuteWithClaudeCode,
  mockGetSafetyRules,
  mockFsdPauseController,
} = vi.hoisted(() => {
  return {
    mockApiClient: vi.fn(),
    mockExecuteMilestone: vi.fn(),
    mockExecuteClaudeCodeSecure: vi.fn(),
    mockCreateInitialState: vi.fn(() => ({
      mode: 'planning',
      currentMilestoneId: null,
      completedMilestones: [],
      failedAttempts: 0,
      totalCost: 0,
      totalPrompts: 0,
      learnings: [],
      startTime: Date.now(),
      claudeSessionId: undefined,
      interactiveHistory: [],
    })),
    mockCreateDefaultConfig: vi.fn((overrides?: Record<string, unknown>) => ({
      maxCost: 10,
      maxIterationsPerMilestone: 5,
      maxTotalPrompts: 100,
      checkpointInterval: 3,
      sensitiveApproval: true,
      autoResume: false,
      ...overrides,
    })),
    mockRedactSecrets: vi.fn((text: string) => text),
    mockGenerateQAFixPrompt: vi.fn(() => 'fix prompt'),
    mockSpawnQAAgent: vi.fn(),
    mockSaveQAReport: vi.fn(),
    mockInitFSDGitProtection: vi.fn(),
    mockCompleteFSDGitSession: vi.fn(),
    mockGetFSDGitRules: vi.fn(() => ''),
    mockGetCurrentBranch: vi.fn(() => 'fsd/test'),
    mockSaveFSDState: vi.fn(),
    mockLoadFSDState: vi.fn(),
    mockClearFSDState: vi.fn(),
    mockHasResumableSession: vi.fn(() => false),
    mockGetResumeInfo: vi.fn(),
    mockGetVibesafuStatus: vi.fn(() => ({ cliInstalled: false, hookInstalled: false })),
    mockNeedsSetup: vi.fn(() => false),
    mockGetApiKey: vi.fn(() => 'sk-ant-test-key'),
    mockGetAutotunezKey: vi.fn(() => 'atk_test_key'),
    mockGetModelPreference: vi.fn(() => 'auto'),
    mockExecuteWithClaudeCode: vi.fn(),
    mockGetSafetyRules: vi.fn(() => ''),
    mockFsdPauseController: {
      pause: vi.fn(),
      resume: vi.fn(),
      reset: vi.fn(),
      waitIfPaused: vi.fn(async () => {}),
      isPaused: false,
    },
  };
});

vi.mock('../api-client.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    generateFSDPlan: mockApiClient,
  })),
}));

vi.mock('./executor.js', () => ({
  executeMilestone: mockExecuteMilestone,
  executeClaudeCodeSecure: mockExecuteClaudeCodeSecure,
  createInitialState: mockCreateInitialState,
  createDefaultConfig: mockCreateDefaultConfig,
  redactSecrets: mockRedactSecrets,
  generateQAFixPrompt: mockGenerateQAFixPrompt,
}));

vi.mock('./qa-agent.js', () => ({
  spawnQAAgent: mockSpawnQAAgent,
  saveQAReport: mockSaveQAReport,
}));

vi.mock('./git-protection.js', () => ({
  initFSDGitProtection: mockInitFSDGitProtection,
  completeFSDGitSession: mockCompleteFSDGitSession,
  getFSDGitRules: mockGetFSDGitRules,
  getCurrentBranch: mockGetCurrentBranch,
}));

vi.mock('./state.js', () => ({
  saveFSDState: mockSaveFSDState,
  loadFSDState: mockLoadFSDState,
  clearFSDState: mockClearFSDState,
  hasResumableSession: mockHasResumableSession,
  getResumeInfo: mockGetResumeInfo,
}));

vi.mock('../vibesafu.js', () => ({
  getVibesafuStatus: mockGetVibesafuStatus,
}));

vi.mock('../setup.js', () => ({
  needsSetup: mockNeedsSetup,
  getMissingFiles: vi.fn(() => []),
  runSetup: vi.fn(async () => true),
}));

vi.mock('../config.js', () => ({
  getApiKey: mockGetApiKey,
  getAutotunezKey: mockGetAutotunezKey,
  getModelPreference: mockGetModelPreference,
}));

vi.mock('../executor.js', () => ({
  executeWithClaudeCode: mockExecuteWithClaudeCode,
}));

vi.mock('./safety.js', () => ({
  getSafetyRules: mockGetSafetyRules,
}));

vi.mock('./pause-controller.js', () => ({
  fsdPauseController: mockFsdPauseController,
}));

vi.mock('./output-handler.js', () => {
  class MockConsoleOutputHandler {
    start = vi.fn();
    planningStart = vi.fn();
    planningComplete = vi.fn();
    showPlan = vi.fn();
    showBlockers = vi.fn();
    milestoneStart = vi.fn();
    milestoneComplete = vi.fn();
    milestoneSkipped = vi.fn();
    milestoneFailed = vi.fn();
    qaStart = vi.fn();
    qaComplete = vi.fn();
    qaIssue = vi.fn();
    progress = vi.fn();
    output = vi.fn();
    error = vi.fn();
    complete = vi.fn();
    confirm = vi.fn(async () => true);
    securityStatus = vi.fn();
    gitBranch = vi.fn();
    gitComplete = vi.fn();
  }
  return {
    ConsoleOutputHandler: MockConsoleOutputHandler,
  };
});

vi.mock('./ink-output-handler.js', () => ({
  InkOutputHandler: vi.fn(),
}));

import { createFSDCommand, setOutputHandler } from './command.js';
import type { FSDOutputHandler } from './output-handler.js';

describe('command.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createFSDCommand', () => {
    it('should create a commander Command with correct name and options', () => {
      const cmd = createFSDCommand();
      expect(cmd.name()).toBe('fsd');
      expect(cmd.description()).toContain('Full Self-Driving');
    });

    it('should have expected options', () => {
      const cmd = createFSDCommand();
      const optionNames = cmd.options.map(o => o.long);
      expect(optionNames).toContain('--max-cost');
      expect(optionNames).toContain('--checkpoint');
      expect(optionNames).toContain('--dry-run');
      expect(optionNames).toContain('--resume');
      expect(optionNames).toContain('--skip-qa');
      expect(optionNames).toContain('--clear');
      expect(optionNames).toContain('--no-ink');
    });

    it('should accept an optional goal argument', () => {
      const cmd = createFSDCommand();
      const args = cmd.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('goal');
      expect(args[0].required).toBe(false);
    });
  });

  describe('setOutputHandler', () => {
    it('should accept a custom output handler', () => {
      const mockHandler: FSDOutputHandler = {
        start: vi.fn(),
        planningStart: vi.fn(),
        planningComplete: vi.fn(),
        showPlan: vi.fn(),
        showBlockers: vi.fn(),
        milestoneStart: vi.fn(),
        milestoneComplete: vi.fn(),
        milestoneSkipped: vi.fn(),
        milestoneFailed: vi.fn(),
        qaStart: vi.fn(),
        qaComplete: vi.fn(),
        qaIssue: vi.fn(),
        progress: vi.fn(),
        output: vi.fn(),
        error: vi.fn(),
        complete: vi.fn(),
        confirm: vi.fn(async () => true),
        securityStatus: vi.fn(),
        gitBranch: vi.fn(),
        gitComplete: vi.fn(),
      };

      // Should not throw
      expect(() => setOutputHandler(mockHandler)).not.toThrow();
    });
  });
});
