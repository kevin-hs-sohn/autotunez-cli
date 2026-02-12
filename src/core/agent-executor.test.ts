import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionEnvironment, AgentExecutorOptions, SimpleExecutorOptions } from './types';

// ── Mock setup ──────────────────────────────────────────────────────────────

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import { execute } from './agent-executor';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockStream(messages: Record<string, unknown>[]) {
  return (async function* () {
    for (const msg of messages) {
      yield msg;
    }
  })();
}

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    result: 'Task completed.',
    session_id: 'sess-abc',
    total_cost_usd: 0.05,
    usage: { input_tokens: 500, output_tokens: 250 },
    modelUsage: {},
    num_turns: 3,
    duration_ms: 1200,
    ...overrides,
  };
}

function makeAssistantMessage(content: Array<Record<string, unknown>>) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content },
  };
}

function makeEnvironment(overrides: Partial<ExecutionEnvironment> = {}): ExecutionEnvironment {
  return {
    cwd: '/test/project',
    env: { HOME: '/home/test' },
    onStreamEvent: vi.fn(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('core/agent-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute() with SimpleExecutorOptions', () => {
    it('should call query with prompt and default options', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('build something', {});

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'build something',
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      });
    });

    it('should return success result', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const result = await execute('build something', {});

      expect(result.success).toBe(true);
      expect(result.output).toBe('Task completed.');
      expect(result.sessionId).toBe('sess-abc');
      expect(result.numTurns).toBe(3);
      expect(result.durationMs).toBe(1200);
    });

    it('should pass cwd option', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { cwd: '/my/project' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ cwd: '/my/project' }),
      });
    });

    it('should pass resume session ID', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { resumeSessionId: 'sess-old' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ resume: 'sess-old' }),
      });
    });

    it('should pass maxBudgetUsd', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { maxBudgetUsd: 5.0 });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ maxBudgetUsd: 5.0 }),
      });
    });

    it('should pass model', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { model: 'claude-sonnet-4-20250514' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ model: 'claude-sonnet-4-20250514' }),
      });
    });

    it('should merge env with process.env', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { env: { ANTHROPIC_API_KEY: 'sk-test' } });

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.options.env).toMatchObject({ ANTHROPIC_API_KEY: 'sk-test' });
    });

    it('should pass systemPrompt', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { systemPrompt: 'You are a helper.' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ systemPrompt: 'You are a helper.' }),
      });
    });

    it('should pass loadProjectSettings as settingSources', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { loadProjectSettings: true });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ settingSources: ['project'] }),
      });
    });

    it('should call onStreamEvent for text content', async () => {
      const onStreamEvent = vi.fn();
      mockQuery.mockReturnValue(createMockStream([
        makeAssistantMessage([{ type: 'text', text: 'Hello!' }]),
        makeSuccessResult(),
      ]));

      await execute('test', { onStreamEvent } as SimpleExecutorOptions);

      expect(onStreamEvent).toHaveBeenCalledWith({ type: 'text', content: 'Hello!' });
    });

    it('should call onStreamEvent for tool_use', async () => {
      const onStreamEvent = vi.fn();
      mockQuery.mockReturnValue(createMockStream([
        makeAssistantMessage([{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }]),
        makeSuccessResult(),
      ]));

      await execute('test', { onStreamEvent } as SimpleExecutorOptions);

      expect(onStreamEvent).toHaveBeenCalledWith({ type: 'tool_use', content: '$ npm test' });
    });

    it('should call onCostUpdate with cost snapshot', async () => {
      const onCostUpdate = vi.fn();
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      await execute('test', { onCostUpdate } as SimpleExecutorOptions);

      expect(onCostUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCostUsd: 0.05,
          inputTokens: 500,
          outputTokens: 250,
        }),
      );
    });

    it('should return error result with errors array', async () => {
      mockQuery.mockReturnValue(createMockStream([{
        type: 'result',
        subtype: 'error_tool',
        session_id: 'sess-err',
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        modelUsage: {},
        num_turns: 1,
        duration_ms: 500,
        errors: ['Tool execution failed'],
      }]));

      const result = await execute('test', {});

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.errors).toEqual(['Tool execution failed']);
    });
  });

  describe('execute() with AgentExecutorOptions', () => {
    it('should use environment cwd and env', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const env = makeEnvironment({ cwd: '/sandbox/proj-1' });
      const options: AgentExecutorOptions = { environment: env };

      await execute('test', options);

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({
          cwd: '/sandbox/proj-1',
          env: { HOME: '/home/test' },
        }),
      });
    });

    it('should pass permissionMode', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const options: AgentExecutorOptions = {
        environment: makeEnvironment(),
        permissionMode: 'acceptEdits',
      };

      await execute('test', options);

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({
          permissionMode: 'acceptEdits',
          allowDangerouslySkipPermissions: false,
        }),
      });
    });

    it('should pass allowedTools', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const options: AgentExecutorOptions = {
        environment: makeEnvironment(),
        allowedTools: ['Bash', 'Read'],
      };

      await execute('test', options);

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({ allowedTools: ['Bash', 'Read'] }),
      });
    });

    it('should route stream events through environment.onStreamEvent', async () => {
      const onStreamEvent = vi.fn();
      mockQuery.mockReturnValue(createMockStream([
        makeAssistantMessage([{ type: 'text', text: 'Working...' }]),
        makeSuccessResult(),
      ]));

      const options: AgentExecutorOptions = {
        environment: makeEnvironment({ onStreamEvent }),
      };

      await execute('test', options);

      expect(onStreamEvent).toHaveBeenCalledWith({ type: 'text', content: 'Working...' });
    });

    it('should route cost updates through environment.onCostUpdate', async () => {
      const onCostUpdate = vi.fn();
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const options: AgentExecutorOptions = {
        environment: makeEnvironment({ onCostUpdate }),
      };

      await execute('test', options);

      expect(onCostUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ totalCostUsd: 0.05 }),
      );
    });

    it('should forward abortSignal from environment', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const ac = new AbortController();
      const options: AgentExecutorOptions = {
        environment: makeEnvironment({ abortSignal: ac.signal }),
      };

      await execute('test', options);

      const callArgs = mockQuery.mock.calls[0][0];
      expect(callArgs.options.abortController).toBeDefined();
    });

    it('should default to bypassPermissions when permissionMode not set', async () => {
      mockQuery.mockReturnValue(createMockStream([makeSuccessResult()]));

      const options: AgentExecutorOptions = {
        environment: makeEnvironment(),
      };

      await execute('test', options);

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'test',
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      });
    });

    it('should return default failed result when stream yields nothing', async () => {
      mockQuery.mockReturnValue(createMockStream([]));

      const result = await execute('test', { environment: makeEnvironment() });

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.cost.totalCostUsd).toBe(0);
    });
  });
});
