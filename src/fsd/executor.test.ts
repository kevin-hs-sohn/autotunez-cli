import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FSDMilestone,
  FSDAutomatedChecks,
} from '../types.js';

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockExecute, mockTakeFileSnapshot, mockAnalyzePostExecution, mockSpawn, mockGetApiKey } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTakeFileSnapshot: vi.fn(),
  mockAnalyzePostExecution: vi.fn(),
  mockSpawn: vi.fn(),
  mockGetApiKey: vi.fn(),
}));

vi.mock('../core/agent-executor.js', () => ({
  execute: mockExecute,
}));

vi.mock('./post-execution.js', () => ({
  takeFileSnapshot: mockTakeFileSnapshot,
  analyzePostExecution: mockAnalyzePostExecution,
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('../config.js', () => ({
  getApiKey: mockGetApiKey,
}));

import {
  generateMilestonePrompt,
  generateFixPrompt,
  generateQAFixPrompt,
  createInitialState,
  createDefaultConfig,
  checkCostLimit,
  redactSecrets,
  executeClaudeCode,
  executeClaudeCodeSecure,
} from './executor';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    output: 'Task completed.',
    sessionId: 'sess-123',
    cost: { totalCostUsd: 0.05, inputTokens: 500, outputTokens: 250, modelUsage: {} },
    numTurns: 3,
    durationMs: 1200,
    ...overrides,
  };
}

function makeFailureResult(overrides: Record<string, unknown> = {}) {
  return {
    success: false,
    output: '',
    sessionId: 'sess-err',
    cost: { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50, modelUsage: {} },
    numTurns: 1,
    durationMs: 500,
    errors: ['Execution failed'],
    ...overrides,
  };
}

function cleanAnalysis() {
  return {
    envModified: false,
    claudeMdModified: false,
    sensitiveFilesAccessed: [] as string[],
    deletedFiles: [] as string[],
    newFiles: [],
    modifiedFiles: [],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('FSD Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Pure function tests (existing) ──────────────────────────────────────

  describe('generateMilestonePrompt', () => {
    it('should generate basic milestone prompt', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Setup Project',
        description: 'Initialize the project with dependencies',
        estimatedPrompts: 3,
        dependencies: [],
        qaGoal: 'Verify project runs',
        status: 'pending',
      };

      const prompt = generateMilestonePrompt(milestone, [], false);

      expect(prompt).toContain('Setup Project');
      expect(prompt).toContain('Initialize the project');
      expect(prompt).not.toContain('retry');
    });

    it('should include learnings in prompt', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Test',
        description: 'Test milestone',
        estimatedPrompts: 2,
        dependencies: [],
        qaGoal: 'Test QA',
        status: 'pending',
      };

      const learnings = ['Always mock external APIs', 'Check types before assignment'];
      const prompt = generateMilestonePrompt(milestone, learnings, false);

      expect(prompt).toContain('Learned Rules');
      expect(prompt).toContain('Always mock external APIs');
      expect(prompt).toContain('Check types before assignment');
    });

    it('should indicate retry attempt', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Test',
        description: 'Test',
        estimatedPrompts: 2,
        dependencies: [],
        qaGoal: 'Test',
        status: 'pending',
      };

      const prompt = generateMilestonePrompt(milestone, [], true);

      expect(prompt).toContain('retry');
      expect(prompt).toContain('Previous attempt failed');
    });
  });

  describe('generateFixPrompt', () => {
    it('should generate fix prompt for typecheck failure', () => {
      const checks: FSDAutomatedChecks = {
        build: { passed: true },
        typecheck: { passed: false, output: 'Cannot find module "foo"' },
        test: { passed: true },
        lint: { passed: true },
      };

      const prompt = generateFixPrompt(checks, []);

      expect(prompt).toContain('Fix Required');
      expect(prompt).toContain('Type errors');
      expect(prompt).toContain('Cannot find module "foo"');
    });

    it('should include multiple failures', () => {
      const checks: FSDAutomatedChecks = {
        build: { passed: false, output: 'Build error' },
        typecheck: { passed: false, output: 'Type error' },
        test: { passed: true },
        lint: { passed: false, output: 'Lint error' },
      };

      const prompt = generateFixPrompt(checks, []);

      expect(prompt).toContain('Build failed');
      expect(prompt).toContain('Type errors');
      expect(prompt).toContain('Lint errors');
    });

    it('should include learnings in fix prompt', () => {
      const checks: FSDAutomatedChecks = {
        build: { passed: false, output: 'Error' },
        typecheck: { passed: true },
        test: { passed: true },
        lint: { passed: true },
      };

      const learnings = ['Always verify imports'];
      const prompt = generateFixPrompt(checks, learnings);

      expect(prompt).toContain('Learned Rules');
      expect(prompt).toContain('Always verify imports');
    });
  });

  describe('createInitialState', () => {
    it('should create initial state with correct defaults', () => {
      const state = createInitialState();

      expect(state.mode).toBe('planning');
      expect(state.currentMilestoneId).toBeNull();
      expect(state.completedMilestones).toEqual([]);
      expect(state.failedAttempts).toBe(0);
      expect(state.totalCost).toBe(0);
      expect(state.totalPrompts).toBe(0);
      expect(state.learnings).toEqual([]);
      expect(state.startTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config with defaults', () => {
      const config = createDefaultConfig();

      expect(config.maxCost).toBe(10);
      expect(config.maxIterationsPerMilestone).toBe(5);
      expect(config.maxTotalPrompts).toBe(100);
      expect(config.checkpointInterval).toBe(3);
      expect(config.sensitiveApproval).toBe(true);
      expect(config.autoResume).toBe(false);
    });

    it('should allow overrides', () => {
      const config = createDefaultConfig({
        maxCost: 20,
        autoResume: true,
      });

      expect(config.maxCost).toBe(20);
      expect(config.autoResume).toBe(true);
      expect(config.maxIterationsPerMilestone).toBe(5); // Default preserved
    });
  });

  // ── checkCostLimit (now uses state.totalCost directly) ──────────────────

  describe('checkCostLimit', () => {
    it('should return ok=true when below warning threshold', () => {
      const state = { ...createInitialState(), totalCost: 5.0 };
      const config = createDefaultConfig({ maxCost: 10 });

      const result = checkCostLimit(state, config);

      expect(result.ok).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('should warn when approaching cost limit (>= 80%)', () => {
      const state = { ...createInitialState(), totalCost: 8.5 };
      const config = createDefaultConfig({ maxCost: 10 });

      const result = checkCostLimit(state, config);

      expect(result.ok).toBe(true);
      expect(result.message).toContain('Warning');
      expect(result.message).toContain('$8.50');
    });

    it('should block when cost limit reached', () => {
      const state = { ...createInitialState(), totalCost: 10.5 };
      const config = createDefaultConfig({ maxCost: 10 });

      const result = checkCostLimit(state, config);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Cost limit reached');
    });
  });

  // ── executeClaudeCode (SDK delegation) ──────────────────────────────────

  describe('executeClaudeCode', () => {
    it('should call execute() with prompt and cwd', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());

      const result = await executeClaudeCode('build something', '/my/project');

      expect(mockExecute).toHaveBeenCalledWith('build something', expect.objectContaining({
        cwd: '/my/project',
      }));
      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed.');
      expect(result.sessionId).toBe('sess-123');
    });

    it('should pass resumeSessionId to execute()', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCode('prompt', '/cwd', undefined, 'sess-old');

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        resumeSessionId: 'sess-old',
      }));
    });

    it('should forward onOutput for text events', async () => {
      mockExecute.mockImplementation(async (_prompt: string, opts: { onStreamEvent?: (e: { type: string; content: string }) => void }) => {
        opts.onStreamEvent?.({ type: 'text', content: 'hello' });
        opts.onStreamEvent?.({ type: 'tool_use', content: '$ ls' }); // should not forward
        return makeSuccessResult();
      });

      const onOutput = vi.fn();
      await executeClaudeCode('prompt', '/cwd', onOutput);

      expect(onOutput).toHaveBeenCalledWith('hello');
      expect(onOutput).toHaveBeenCalledTimes(1); // only text events
    });

    it('should return costUsd from execute() result', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult({ cost: { totalCostUsd: 0.15, inputTokens: 1000, outputTokens: 500, modelUsage: {} } }));

      const result = await executeClaudeCode('prompt', '/cwd');

      expect(result.costUsd).toBe(0.15);
    });

    it('should return undefined sessionId when core returns empty string', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult({ sessionId: '' }));

      const result = await executeClaudeCode('prompt', '/cwd');

      expect(result.sessionId).toBeUndefined();
    });

    it('should handle execute() failure', async () => {
      mockExecute.mockResolvedValue(makeFailureResult());

      const result = await executeClaudeCode('prompt', '/cwd');

      expect(result.success).toBe(false);
    });

    it('should inject BYOK API key as env when available', async () => {
      mockGetApiKey.mockReturnValue('sk-ant-byok-fsd-key');
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCode('prompt', '/cwd');

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        env: { ANTHROPIC_API_KEY: 'sk-ant-byok-fsd-key' },
      }));
    });

    it('should not set env when no BYOK key', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCode('prompt', '/cwd');

      const callArgs = mockExecute.mock.calls[0][1];
      expect(callArgs.env).toBeUndefined();
    });
  });

  // ── executeClaudeCodeSecure (snapshot + SDK + post-analysis) ────────────

  describe('executeClaudeCodeSecure', () => {
    it('should take snapshots before and after execution', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue(cleanAnalysis());
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(mockTakeFileSnapshot).toHaveBeenCalledTimes(2);
      expect(mockTakeFileSnapshot).toHaveBeenCalledWith('/project');
      expect(mockAnalyzePostExecution).toHaveBeenCalledTimes(1);
    });

    it('should call execute() with correct options', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue(cleanAnalysis());
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCodeSecure('prompt', {
        cwd: '/project',
        resumeSessionId: 'sess-prev',
      });

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        cwd: '/project',
        resumeSessionId: 'sess-prev',
      }));
    });

    it('should emit security events for env modifications', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue({
        ...cleanAnalysis(),
        envModified: true,
      });
      mockExecute.mockResolvedValue(makeSuccessResult());
      const onSecurityEvent = vi.fn();

      const result = await executeClaudeCodeSecure('prompt', {
        cwd: '/project',
        onSecurityEvent,
      });

      expect(result.securityEvents).toHaveLength(1);
      expect(result.securityEvents[0].type).toBe('warning');
      expect(result.securityEvents[0].message).toContain('.env');
      expect(onSecurityEvent).toHaveBeenCalledTimes(1);
    });

    it('should emit security events for CLAUDE.md modifications', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue({
        ...cleanAnalysis(),
        claudeMdModified: true,
      });
      mockExecute.mockResolvedValue(makeSuccessResult());

      const result = await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(result.securityEvents).toHaveLength(1);
      expect(result.securityEvents[0].message).toContain('CLAUDE.md');
    });

    it('should emit security events for sensitive file access', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue({
        ...cleanAnalysis(),
        sensitiveFilesAccessed: ['.env.local', 'credentials.json'],
      });
      mockExecute.mockResolvedValue(makeSuccessResult());

      const result = await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(result.securityEvents).toHaveLength(1);
      expect(result.securityEvents[0].message).toContain('.env.local');
    });

    it('should emit security events for deleted files', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue({
        ...cleanAnalysis(),
        deletedFiles: ['src/index.ts'],
      });
      mockExecute.mockResolvedValue(makeSuccessResult());

      const result = await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(result.securityEvents).toHaveLength(1);
      expect(result.securityEvents[0].message).toContain('deleted');
    });

    it('should return costUsd from execute() result', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue(cleanAnalysis());
      mockExecute.mockResolvedValue(makeSuccessResult({ cost: { totalCostUsd: 0.25, inputTokens: 2000, outputTokens: 1000, modelUsage: {} } }));

      const result = await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(result.costUsd).toBe(0.25);
    });

    it('should handle multiple security events', async () => {
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue({
        envModified: true,
        claudeMdModified: true,
        sensitiveFilesAccessed: ['secrets.json'],
        deletedFiles: ['important.ts'],
        newFiles: [],
        modifiedFiles: [],
      });
      mockExecute.mockResolvedValue(makeSuccessResult());

      const result = await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(result.securityEvents).toHaveLength(4);
    });

    it('should inject BYOK API key as env when available', async () => {
      mockGetApiKey.mockReturnValue('sk-ant-byok-secure-key');
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue(cleanAnalysis());
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        env: { ANTHROPIC_API_KEY: 'sk-ant-byok-secure-key' },
      }));
    });

    it('should not set env when no BYOK key', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockTakeFileSnapshot.mockResolvedValue({ files: {} });
      mockAnalyzePostExecution.mockReturnValue(cleanAnalysis());
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeClaudeCodeSecure('prompt', { cwd: '/project' });

      const callArgs = mockExecute.mock.calls[0][1];
      expect(callArgs.env).toBeUndefined();
    });
  });

  // ── redactSecrets ───────────────────────────────────────────────────────

  describe('redactSecrets', () => {
    it('should redact Anthropic-style API keys', () => {
      expect(redactSecrets('key: sk-ant-api03-abcdefghijklmnop12345678'))
        .toContain('***REDACTED***');
    });

    it('should redact GitHub PATs', () => {
      expect(redactSecrets('token: ghp_abcdefghijklmnopqrstuvwxyz1234567890'))
        .toContain('***REDACTED***');
    });

    it('should leave clean text unchanged', () => {
      expect(redactSecrets('Hello world')).toBe('Hello world');
    });
  });

  // ── generateQAFixPrompt ────────────────────────────────────────────────

  describe('generateQAFixPrompt', () => {
    it('should generate fix prompt with issues', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Test',
        description: 'Test',
        estimatedPrompts: 2,
        dependencies: [],
        qaGoal: 'Test',
        status: 'pending',
        successCriteria: 'All tests pass',
      };

      const issues = [
        { severity: 'high', description: 'Missing error handling' },
      ];

      const prompt = generateQAFixPrompt(milestone, issues, []);

      expect(prompt).toContain('Fix QA Issues');
      expect(prompt).toContain('Missing error handling');
      expect(prompt).toContain('high');
    });
  });
});
