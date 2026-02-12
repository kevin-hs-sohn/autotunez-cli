import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use vi.hoisted() to avoid reference error with vi.mock hoisting
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import {
  executeWithAgentSDK,
  type AgentSDKStreamEvent,
} from './agent-sdk-executor';

// Helper: create async generator from messages
async function* messagesGenerator(messages: Array<Record<string, unknown>>) {
  for (const msg of messages) {
    yield msg;
  }
}

// Helper: create a mock query that returns an async generator
function setupMockQuery(messages: Array<Record<string, unknown>>) {
  const generator = messagesGenerator(messages);
  mockQuery.mockReturnValue(generator);
}

describe('agent-sdk-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeWithAgentSDK', () => {
    it('should call query with correct prompt and default options', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: 'Done',
          total_cost_usd: 0.05,
          duration_ms: 1000,
          num_turns: 3,
          usage: { input_tokens: 100, output_tokens: 50 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('build a todo app');

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'build a todo app',
        options: expect.objectContaining({
          cwd: process.cwd(),
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      });
    });

    it('should return success result with cost and session info', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          uuid: 'uuid-1',
          session_id: 'sess-abc',
          result: 'All tasks completed',
          total_cost_usd: 0.12,
          duration_ms: 5000,
          duration_api_ms: 4500,
          num_turns: 5,
          is_error: false,
          usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
          modelUsage: {
            'claude-sonnet-4-20250514': {
              inputTokens: 500,
              outputTokens: 200,
              cacheReadInputTokens: 100,
              cacheCreationInputTokens: 0,
              webSearchRequests: 0,
              costUSD: 0.12,
              contextWindow: 200000,
            },
          },
          permission_denials: [],
        },
      ]);

      const result = await executeWithAgentSDK('test prompt');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('sess-abc');
      expect(result.cost.totalCostUsd).toBe(0.12);
      expect(result.cost.inputTokens).toBe(500);
      expect(result.cost.outputTokens).toBe(200);
      expect(result.numTurns).toBe(5);
      expect(result.durationMs).toBe(5000);
      expect(result.output).toBe('All tasks completed');
    });

    it('should pass cwd option to query', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', { cwd: '/my/project' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          cwd: '/my/project',
        }),
      });
    });

    it('should pass resume session ID to query', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-existing',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('continue work', { resumeSessionId: 'sess-existing' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'continue work',
        options: expect.objectContaining({
          resume: 'sess-existing',
        }),
      });
    });

    it('should pass maxBudgetUsd to query', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', { maxBudgetUsd: 5.0 });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          maxBudgetUsd: 5.0,
        }),
      });
    });

    it('should pass model to query', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', { model: 'claude-sonnet-4-20250514' });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
        }),
      });
    });

    it('should pass env variables to query (for BYOK)', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        env: { ANTHROPIC_API_KEY: 'sk-ant-user-key' },
      });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          env: expect.objectContaining({
            ANTHROPIC_API_KEY: 'sk-ant-user-key',
          }),
        }),
      });
    });

    it('should emit stream events for assistant text messages', async () => {
      const events: AgentSDKStreamEvent[] = [];

      setupMockQuery([
        {
          type: 'assistant',
          uuid: 'uuid-1',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'I will help you build this.' }],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: 'Done',
          total_cost_usd: 0.01,
          duration_ms: 500,
          num_turns: 1,
          usage: { input_tokens: 10, output_tokens: 20 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        onStreamEvent: (event) => events.push(event),
      });

      expect(events).toContainEqual({
        type: 'text',
        content: 'I will help you build this.',
      });
    });

    it('should emit stream events for tool_use messages', async () => {
      const events: AgentSDKStreamEvent[] = [];

      setupMockQuery([
        {
          type: 'assistant',
          uuid: 'uuid-1',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'npm install' } },
            ],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0.01,
          duration_ms: 500,
          num_turns: 1,
          usage: { input_tokens: 10, output_tokens: 20 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        onStreamEvent: (event) => events.push(event),
      });

      expect(events).toContainEqual({
        type: 'tool_use',
        content: '$ npm install',
      });
    });

    it('should emit stream events for Read tool', async () => {
      const events: AgentSDKStreamEvent[] = [];

      setupMockQuery([
        {
          type: 'assistant',
          uuid: 'uuid-1',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/src/index.ts' } },
            ],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        onStreamEvent: (event) => events.push(event),
      });

      expect(events).toContainEqual({
        type: 'tool_use',
        content: 'Reading /src/index.ts...',
      });
    });

    it('should emit stream events for Edit/Write tools', async () => {
      const events: AgentSDKStreamEvent[] = [];

      setupMockQuery([
        {
          type: 'assistant',
          uuid: 'uuid-1',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' } },
            ],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        onStreamEvent: (event) => events.push(event),
      });

      expect(events).toContainEqual({
        type: 'tool_use',
        content: 'Editing /src/app.ts...',
      });
    });

    it('should handle error result (error_during_execution)', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'error_during_execution',
          uuid: 'uuid-1',
          session_id: 'sess-err',
          total_cost_usd: 0.03,
          duration_ms: 2000,
          duration_api_ms: 1500,
          num_turns: 2,
          is_error: true,
          usage: { input_tokens: 100, output_tokens: 50 },
          modelUsage: {},
          permission_denials: [],
          errors: ['Something went wrong'],
        },
      ]);

      const result = await executeWithAgentSDK('prompt');

      expect(result.success).toBe(false);
      expect(result.sessionId).toBe('sess-err');
      expect(result.cost.totalCostUsd).toBe(0.03);
      expect(result.errors).toContain('Something went wrong');
    });

    it('should handle error_max_budget_usd result', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'error_max_budget_usd',
          uuid: 'uuid-1',
          session_id: 'sess-budget',
          total_cost_usd: 5.0,
          duration_ms: 30000,
          duration_api_ms: 28000,
          num_turns: 20,
          is_error: true,
          usage: { input_tokens: 5000, output_tokens: 3000 },
          modelUsage: {},
          permission_denials: [],
          errors: ['Budget exceeded'],
        },
      ]);

      const result = await executeWithAgentSDK('prompt', { maxBudgetUsd: 5.0 });

      expect(result.success).toBe(false);
      expect(result.cost.totalCostUsd).toBe(5.0);
      expect(result.errors).toContain('Budget exceeded');
    });

    it('should handle abort signal', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      const controller = new AbortController();
      await executeWithAgentSDK('prompt', { abortSignal: controller.signal });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          abortController: expect.any(AbortController),
        }),
      });
    });

    it('should pass systemPrompt to query', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        systemPrompt: 'You are a senior engineer.',
      });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          systemPrompt: 'You are a senior engineer.',
        }),
      });
    });

    it('should return modelUsage breakdown from result', async () => {
      const modelUsageData = {
        'claude-sonnet-4-20250514': {
          inputTokens: 300,
          outputTokens: 150,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.08,
          contextWindow: 200000,
        },
        'claude-haiku-3-5-20241022': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 0.01,
          contextWindow: 200000,
        },
      };

      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: 'Done',
          total_cost_usd: 0.09,
          duration_ms: 3000,
          num_turns: 4,
          usage: { input_tokens: 400, output_tokens: 200 },
          modelUsage: modelUsageData,
        },
      ]);

      const result = await executeWithAgentSDK('prompt');

      expect(result.cost.modelUsage).toEqual(modelUsageData);
    });

    it('should load project settings when settingSources is specified', async () => {
      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', { loadProjectSettings: true });

      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'prompt',
        options: expect.objectContaining({
          settingSources: ['project'],
        }),
      });
    });

    it('should emit cost update events', async () => {
      const costUpdates: Array<{ totalCostUsd: number }> = [];

      setupMockQuery([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-1',
          result: 'Done',
          total_cost_usd: 0.15,
          duration_ms: 2000,
          num_turns: 3,
          usage: { input_tokens: 200, output_tokens: 100 },
          modelUsage: {},
        },
      ]);

      await executeWithAgentSDK('prompt', {
        onCostUpdate: (cost) => costUpdates.push(cost),
      });

      // Cost update from result message
      expect(costUpdates.length).toBeGreaterThanOrEqual(1);
      expect(costUpdates[costUpdates.length - 1].totalCostUsd).toBe(0.15);
    });
  });
});
