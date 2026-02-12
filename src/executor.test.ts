import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockExecute, mockSpawn, mockGetApiKey } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockSpawn: vi.fn(),
  mockGetApiKey: vi.fn(),
}));

vi.mock('./core/agent-executor.js', () => ({
  execute: mockExecute,
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('./config.js', () => ({
  getApiKey: mockGetApiKey,
}));

import {
  executeWithClaudeCode,
  spawnInteractiveClaude,
  checkClaudeCodeInstalled,
  checkClaudeCodeAuth,
  runClaudeLogin,
} from './executor';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    output: 'Task done.',
    sessionId: 'sess-abc',
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

function createMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as unknown as Record<string, unknown>).stdout = stdout;
  (child as unknown as Record<string, unknown>).stderr = stderr;
  (child as unknown as Record<string, unknown>).kill = vi.fn();
  return child;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeWithClaudeCode', () => {
    it('should call execute() with prompt and return success result', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());

      const result = await executeWithClaudeCode('build a todo app');

      expect(mockExecute).toHaveBeenCalledWith('build a todo app', expect.objectContaining({}));
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('Task done.');
      expect(result.sessionId).toBe('sess-abc');
    });

    it('should return exitCode=1 on failure', async () => {
      mockExecute.mockResolvedValue(makeFailureResult());

      const result = await executeWithClaudeCode('test');

      expect(result.exitCode).toBe(1);
      expect(result.success).toBe(false);
      expect(result.sessionId).toBe('sess-err');
    });

    it('should pass cwd to execute()', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeWithClaudeCode('prompt', { cwd: '/custom/path' });

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        cwd: '/custom/path',
      }));
    });

    it('should pass resumeSessionId to execute()', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeWithClaudeCode('prompt', { resumeSessionId: 'sess-old' });

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        resumeSessionId: 'sess-old',
      }));
    });

    it('should pass abortSignal to execute()', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());
      const ac = new AbortController();

      await executeWithClaudeCode('prompt', { abortSignal: ac.signal });

      expect(mockExecute).toHaveBeenCalledWith('prompt', expect.objectContaining({
        abortSignal: ac.signal,
      }));
    });

    it('should convert timeoutMs to abortSignal', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeWithClaudeCode('prompt', { timeoutMs: 5000 });

      const callArgs = mockExecute.mock.calls[0];
      expect(callArgs[1].abortSignal).toBeDefined();
    });

    it('should prefer explicit abortSignal over timeoutMs', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());
      const ac = new AbortController();

      await executeWithClaudeCode('prompt', { timeoutMs: 5000, abortSignal: ac.signal });

      const callArgs = mockExecute.mock.calls[0];
      expect(callArgs[1].abortSignal).toBe(ac.signal);
    });

    it('should forward onStreamEvent to execute()', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());
      const onStreamEvent = vi.fn();

      await executeWithClaudeCode('prompt', { onStreamEvent });

      const callArgs = mockExecute.mock.calls[0];
      expect(callArgs[1].onStreamEvent).toBeDefined();
      // Simulate a call to verify forwarding
      callArgs[1].onStreamEvent({ type: 'text', content: 'hello' });
      expect(onStreamEvent).toHaveBeenCalledWith({ type: 'text', content: 'hello' });
    });

    it('should handle execute() throwing an error', async () => {
      mockExecute.mockRejectedValue(new Error('SDK error'));

      const result = await executeWithClaudeCode('prompt');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('SDK error');
    });

    it('should return undefined sessionId when core returns empty string', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult({ sessionId: '' }));

      const result = await executeWithClaudeCode('prompt');

      expect(result.sessionId).toBeUndefined();
    });

    it('should inject BYOK API key as env when available', async () => {
      mockGetApiKey.mockReturnValue('sk-ant-byok-key-for-testing');
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeWithClaudeCode('test prompt');

      expect(mockExecute).toHaveBeenCalledWith('test prompt', expect.objectContaining({
        env: { ANTHROPIC_API_KEY: 'sk-ant-byok-key-for-testing' },
      }));
    });

    it('should not set env when no BYOK key is configured', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecute.mockResolvedValue(makeSuccessResult());

      await executeWithClaudeCode('test prompt');

      const callArgs = mockExecute.mock.calls[0][1];
      expect(callArgs.env).toBeUndefined();
    });
  });

  describe('spawnInteractiveClaude', () => {
    it('should spawn claude without -p flag (interactive mode)', () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      spawnInteractiveClaude();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({
          stdio: ['pipe', 'inherit', 'inherit'],
        }),
      );
    });

    it('should return child process with writable stdin', () => {
      const mockStdin = new EventEmitter();
      (mockStdin as unknown as Record<string, unknown>).write = vi.fn();
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = mockStdin;
      mockSpawn.mockReturnValue(mockChild);

      const child = spawnInteractiveClaude();

      expect(child.stdin).toBeDefined();
      expect(child.stdin?.write).toBeDefined();
    });

    it('should use custom cwd when provided', () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      spawnInteractiveClaude({ cwd: '/my/project' });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });

    it('should pass --resume when resumeSessionId is provided', () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      mockSpawn.mockReturnValue(mockChild);

      spawnInteractiveClaude({ resumeSessionId: 'abc-123' });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--resume', 'abc-123'],
        expect.anything(),
      );
    });

    it('should allow writing to stdin', () => {
      const mockStdin = new EventEmitter();
      const writeFn = vi.fn();
      (mockStdin as unknown as Record<string, unknown>).write = writeFn;
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = mockStdin;
      mockSpawn.mockReturnValue(mockChild);

      const child = spawnInteractiveClaude();
      child.stdin?.write('test input\n');

      expect(writeFn).toHaveBeenCalledWith('test input\n');
    });
  });

  describe('checkClaudeCodeInstalled', () => {
    it('should return installed=true (SDK is a dependency)', async () => {
      const result = await checkClaudeCodeInstalled();
      expect(result.installed).toBe(true);
    });
  });

  describe('checkClaudeCodeAuth', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return authenticated=true when ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-12345678';

      const result = await checkClaudeCodeAuth();
      expect(result.authenticated).toBe(true);
    });

    it('should return authenticated=false when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const result = await checkClaudeCodeAuth();
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return authenticated=false when ANTHROPIC_API_KEY has wrong format', async () => {
      process.env.ANTHROPIC_API_KEY = 'invalid-key';

      const result = await checkClaudeCodeAuth();
      expect(result.authenticated).toBe(false);
    });
  });

  describe('runClaudeLogin', () => {
    it('should spawn claude in interactive mode for login', () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      runClaudeLogin();

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      );
    });

    it('should resolve with success=true when login completes with exit 0', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = runClaudeLogin();
      process.nextTick(() => mockChild.emit('close', 0, null));

      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('should resolve with success=false when login fails', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = runClaudeLogin();
      process.nextTick(() => mockChild.emit('close', 1, null));

      const result = await promise;
      expect(result.success).toBe(false);
    });
  });
});
