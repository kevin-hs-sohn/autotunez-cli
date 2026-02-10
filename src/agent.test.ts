import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
const mockGetApiKey = vi.fn<() => string | undefined>(() => undefined);
const mockGetAutotunezKey = vi.fn<() => string | undefined>(() => undefined);
const mockGetServerUrl = vi.fn<() => string | undefined>(() => undefined);

vi.mock('./config.js', () => ({
  getApiKey: () => mockGetApiKey(),
  getAutotunezKey: () => mockGetAutotunezKey(),
  getServerUrl: () => mockGetServerUrl(),
  getModelPreference: () => 'auto',
}));

// Mock ApiClient
const mockTransform = vi.fn();

vi.mock('./api-client.js', () => ({
  ApiClient: class MockApiClient {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts: unknown) {}
    transform = mockTransform;
  },
}));

import { transformPrompt, chatStructured, ApiKeyRequiredError } from './agent';

describe('agent', () => {
  const testAutotunezKey = 'atk_' + '0'.repeat(64);
  const testAnthropicKey = 'sk-ant-test-key-12345678901234567890';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no API keys
    mockGetApiKey.mockReturnValue(undefined);
    mockGetAutotunezKey.mockReturnValue(undefined);
    mockGetServerUrl.mockReturnValue(undefined);
  });

  describe('ApiKeyRequiredError', () => {
    it('should have correct error name and message', () => {
      const error = new ApiKeyRequiredError();
      expect(error.name).toBe('ApiKeyRequiredError');
      expect(error.message).toContain('API key not configured');
      expect(error.message).toContain('autotunez config --set-key');
    });
  });

  describe('transformPrompt', () => {
    it('should throw ApiKeyRequiredError when autotunez key not configured', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(undefined);

      await expect(
        transformPrompt('unused', 'add login')
      ).rejects.toThrow(ApiKeyRequiredError);
    });

    it('should throw ApiKeyRequiredError when Anthropic key not configured', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);

      await expect(
        transformPrompt('unused', 'add login')
      ).rejects.toThrow(ApiKeyRequiredError);
    });

    it('should use ApiClient when both keys are configured', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'prompt',
        content: 'Refined prompt from server',
      });

      const result = await transformPrompt('unused', 'add login');

      expect(result.type).toBe('prompt');
      expect(result.content).toBe('Refined prompt from server');
      expect(mockTransform).toHaveBeenCalledWith('add login', '', undefined, undefined, undefined);
    });

    it('should pass context to ApiClient transform', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'clarification',
        content: 'What kind of login?',
      });

      const result = await transformPrompt(
        'unused',
        'add login',
        '# CLAUDE.md context'
      );

      expect(result.type).toBe('clarification');
      expect(mockTransform).toHaveBeenCalledWith(
        'add login',
        '# CLAUDE.md context',
        undefined,
        undefined,
        undefined
      );
    });

    it('should handle empty context', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'prompt',
        content: 'Clean prompt',
      });

      await transformPrompt('unused', 'add feature');

      expect(mockTransform).toHaveBeenCalledWith('add feature', '', undefined, undefined, undefined);
    });

    it('should pass conversation history to ApiClient transform', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'prompt',
        content: 'Context-aware prompt',
      });

      const history = [
        { role: 'user' as const, content: 'previous message' },
        { role: 'assistant' as const, content: 'previous response' },
      ];

      const result = await transformPrompt(
        'unused',
        'do the thing',
        '# Project context',
        history
      );

      expect(result.type).toBe('prompt');
      expect(mockTransform).toHaveBeenCalledWith(
        'do the thing',
        '# Project context',
        undefined,
        undefined,
        history
      );
    });
  });

  describe('chatStructured', () => {
    it('should throw ApiKeyRequiredError when keys not configured', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockGetAutotunezKey.mockReturnValue(undefined);

      await expect(
        chatStructured('unused', [{ role: 'user', content: 'hi' }])
      ).rejects.toThrow(ApiKeyRequiredError);
    });

    it('should use ApiClient when both keys are configured', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'prompt',
        content: 'Server-refined prompt',
      });

      const result = await chatStructured('unused', [
        { role: 'user', content: 'I want a todo app' },
        { role: 'assistant', content: 'What features?' },
        { role: 'user', content: 'Just basic CRUD' },
      ]);

      expect(result.type).toBe('prompt');
      expect(result.content).toBe('Server-refined prompt');
      expect(mockTransform).toHaveBeenCalledWith('Just basic CRUD', '', undefined, undefined, [
        { role: 'user', content: 'I want a todo app' },
        { role: 'assistant', content: 'What features?' },
      ]);
    });

    it('should handle empty messages gracefully', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'clarification',
        content: 'What do you want?',
      });

      const result = await chatStructured('unused', []);

      expect(result.type).toBe('clarification');
      expect(mockTransform).toHaveBeenCalledWith('', '', undefined, undefined, []);
    });

    it('should return clarification type from server', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'clarification',
        content: 'Can you be more specific?',
      });

      const result = await chatStructured('unused', [
        { role: 'user', content: 'make it better' },
      ]);

      expect(result.type).toBe('clarification');
      expect(result.content).toBe('Can you be more specific?');
    });

    it('should extract last user message correctly', async () => {
      mockGetApiKey.mockReturnValue(testAnthropicKey);
      mockGetAutotunezKey.mockReturnValue(testAutotunezKey);
      mockGetServerUrl.mockReturnValue('http://localhost:3000');
      mockTransform.mockResolvedValue({
        type: 'prompt',
        content: 'Done',
      });

      await chatStructured('unused', [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'second message' },
        { role: 'assistant', content: 'another response' },
        { role: 'user', content: 'last message' },
      ]);

      expect(mockTransform).toHaveBeenCalledWith('last message', '', undefined, undefined, [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'second message' },
        { role: 'assistant', content: 'another response' },
      ]);
    });
  });
});
