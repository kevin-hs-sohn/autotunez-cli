import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { executeWithClaudeCode, spawnInteractiveClaude } from './executor';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock output-parser
vi.mock('./output-parser.js', () => ({
  parseStreamLine: vi.fn((line: string) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }),
  extractSessionId: vi.fn(() => undefined),
}));

function createMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as ReturnType<typeof spawn>;
  (child as unknown as Record<string, unknown>).stdout = stdout;
  (child as unknown as Record<string, unknown>).stderr = stderr;
  (child as unknown as Record<string, unknown>).kill = vi.fn();
  return child;
}

describe('executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeWithClaudeCode', () => {
    it('should resolve with success when exit code is 0', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('test prompt');

      process.nextTick(() => mockChild.emit('close', 0, null));

      const result = await promise;
      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });

    it('should resolve with failure when exit code is non-zero', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('test prompt');

      process.nextTick(() => mockChild.emit('close', 1, null));

      const result = await promise;
      expect(result.exitCode).toBe(1);
      expect(result.success).toBe(false);
    });

    it('should handle SIGINT signal', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('test prompt');

      process.nextTick(() => mockChild.emit('close', null, 'SIGINT'));

      const result = await promise;
      expect(result.exitCode).toBe(130);
      expect(result.success).toBe(false);
    });

    it('should handle SIGTERM signal', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('test prompt');

      process.nextTick(() => mockChild.emit('close', null, 'SIGTERM'));

      const result = await promise;
      expect(result.exitCode).toBe(143);
      expect(result.success).toBe(false);
    });

    it('should reject with ENOENT error when claude is not found', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('test prompt');

      const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      process.nextTick(() => mockChild.emit('error', error));

      await expect(promise).rejects.toThrow('Claude Code CLI not found');
    });

    it('should reject with descriptive error for other spawn errors', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('test prompt');

      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      process.nextTick(() => mockChild.emit('error', error));

      await expect(promise).rejects.toThrow('Failed to start Claude Code');
    });

    it('should spawn claude with correct default arguments (verbose, stream-json, skip-permissions)', () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      executeWithClaudeCode('my prompt here');

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', 'my prompt here'],
        expect.objectContaining({
          cwd: process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    });

    it('should pass --resume when resumeSessionId is provided', () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      executeWithClaudeCode('prompt', { resumeSessionId: 'session-123' });

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', 'prompt', '--resume', 'session-123'],
        expect.anything(),
      );
    });

    it('should use custom cwd when provided', () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      executeWithClaudeCode('prompt', { cwd: '/custom/path' });

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.anything(),
        expect.objectContaining({ cwd: '/custom/path' }),
      );
    });

    it('should handle stdout data (stream-json events)', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('prompt');

      process.nextTick(() => {
        const stdout = (mockChild as unknown as Record<string, EventEmitter>).stdout;
        // Simulate stream-json event
        stdout.emit('data', Buffer.from('{"type":"system","session_id":"test-123"}\n'));
        mockChild.emit('close', 0, null);
      });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('test-123');
    });

    it('should handle stderr output', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executeWithClaudeCode('prompt');

      process.nextTick(() => {
        const stderr = (mockChild as unknown as Record<string, EventEmitter>).stderr;
        stderr.emit('data', Buffer.from('error info'));
        mockChild.emit('close', 1, null);
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('spawnInteractiveClaude', () => {
    it('should spawn claude without -p flag (interactive mode)', () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      spawnInteractiveClaude();

      expect(spawn).toHaveBeenCalledWith(
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
      vi.mocked(spawn).mockReturnValue(mockChild);

      const child = spawnInteractiveClaude();

      expect(child.stdin).toBeDefined();
      expect(child.stdin?.write).toBeDefined();
    });

    it('should use custom cwd when provided', () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      spawnInteractiveClaude({ cwd: '/my/project' });

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });

    it('should pass --resume when resumeSessionId is provided', () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      spawnInteractiveClaude({ resumeSessionId: 'abc-123' });

      expect(spawn).toHaveBeenCalledWith(
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
      vi.mocked(spawn).mockReturnValue(mockChild);

      const child = spawnInteractiveClaude();
      child.stdin?.write('test input\n');

      expect(writeFn).toHaveBeenCalledWith('test input\n');
    });
  });

  describe('checkClaudeCodeInstalled', () => {
    it('should return true when claude command exists', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { checkClaudeCodeInstalled } = await import('./executor');
      const promise = checkClaudeCodeInstalled();

      process.nextTick(() => {
        const stdout = (mockChild as unknown as Record<string, EventEmitter>).stdout;
        stdout.emit('data', Buffer.from('1.0.0'));
        mockChild.emit('close', 0, null);
      });

      const result = await promise;
      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.0.0');
    });

    it('should return false when claude command not found (ENOENT)', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { checkClaudeCodeInstalled } = await import('./executor');
      const promise = checkClaudeCodeInstalled();

      const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      process.nextTick(() => mockChild.emit('error', error));

      const result = await promise;
      expect(result.installed).toBe(false);
      expect(result.version).toBeUndefined();
    });

    it('should return false when claude exits with non-zero code', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { checkClaudeCodeInstalled } = await import('./executor');
      const promise = checkClaudeCodeInstalled();

      process.nextTick(() => mockChild.emit('close', 1, null));

      const result = await promise;
      expect(result.installed).toBe(false);
    });
  });

  describe('checkClaudeCodeAuth', () => {
    it('should return authenticated=true when test command succeeds', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { checkClaudeCodeAuth } = await import('./executor');
      const promise = checkClaudeCodeAuth();

      process.nextTick(() => {
        const stdout = (mockChild as unknown as Record<string, EventEmitter>).stdout;
        stdout.emit('data', Buffer.from('Hello'));
        mockChild.emit('close', 0, null);
      });

      const result = await promise;
      expect(result.authenticated).toBe(true);
    });

    it('should return authenticated=false when test command fails', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { checkClaudeCodeAuth } = await import('./executor');
      const promise = checkClaudeCodeAuth();

      process.nextTick(() => {
        const stderr = (mockChild as unknown as Record<string, EventEmitter>).stderr;
        stderr.emit('data', Buffer.from('Not authenticated'));
        mockChild.emit('close', 1, null);
      });

      const result = await promise;
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Not authenticated');
    });

    it('should return authenticated=false on ENOENT (claude not installed)', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { checkClaudeCodeAuth } = await import('./executor');
      const promise = checkClaudeCodeAuth();

      const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      process.nextTick(() => mockChild.emit('error', error));

      const result = await promise;
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('not installed');
    });
  });

  describe('runClaudeLogin', () => {
    it('should spawn claude in interactive mode for login', async () => {
      const mockChild = createMockChild();
      (mockChild as unknown as Record<string, unknown>).stdin = new EventEmitter();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { runClaudeLogin } = await import('./executor');
      runClaudeLogin();

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      );
    });

    it('should resolve with success=true when login completes with exit 0', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { runClaudeLogin } = await import('./executor');
      const promise = runClaudeLogin();

      process.nextTick(() => mockChild.emit('close', 0, null));

      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('should resolve with success=false when login fails', async () => {
      const mockChild = createMockChild();
      vi.mocked(spawn).mockReturnValue(mockChild);

      const { runClaudeLogin } = await import('./executor');
      const promise = runClaudeLogin();

      process.nextTick(() => mockChild.emit('close', 1, null));

      const result = await promise;
      expect(result.success).toBe(false);
    });
  });
});
