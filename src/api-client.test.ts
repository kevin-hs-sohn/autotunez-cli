import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from './api-client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  };
}

describe('ApiClient', () => {
  let client: ApiClient;
  const testAutotunezKey = 'atk_' + '0'.repeat(64);
  const testAnthropicKey = 'sk-ant-test-key-12345678901234567890';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ApiClient({
      serverUrl: 'http://localhost:3000',
      autotunezKey: testAutotunezKey,
      anthropicKey: testAnthropicKey,
    });
  });

  it('should construct with default server URL', () => {
    const defaultClient = new ApiClient({
      autotunezKey: testAutotunezKey,
      anthropicKey: testAnthropicKey,
    });
    expect(defaultClient).toBeDefined();
  });

  it('should add both API key headers for requests', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ message: 'hello', readyToGenerate: false })
    );

    await client.interview([{ role: 'user', content: 'hi' }], 'beginner');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/interview',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Autotunez-Key': testAutotunezKey,
          'X-API-Key': testAnthropicKey,
        }),
      })
    );
  });

  it('should throw when autotunez API key missing', async () => {
    const noKeyClient = new ApiClient({
      serverUrl: 'http://localhost:3000',
      anthropicKey: testAnthropicKey,
    });

    await expect(
      noKeyClient.interview([{ role: 'user', content: 'hi' }], 'beginner')
    ).rejects.toThrow('autotunez API key not configured');
  });

  it('should throw when Anthropic API key missing', async () => {
    const noKeyClient = new ApiClient({
      serverUrl: 'http://localhost:3000',
      autotunezKey: testAutotunezKey,
    });

    await expect(
      noKeyClient.interview([{ role: 'user', content: 'hi' }], 'beginner')
    ).rejects.toThrow('Anthropic API key not configured');
  });

  it('should call correct path for interview', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ message: 'Tell me more', readyToGenerate: false })
    );

    const result = await client.interview(
      [{ role: 'user', content: 'I want an app' }],
      'expert'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/interview',
      expect.any(Object)
    );
    expect(result.message).toBe('Tell me more');
    expect(result.readyToGenerate).toBe(false);
  });

  it('should call correct path for transform', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ type: 'prompt', content: 'refined prompt' })
    );

    const result = await client.transform(
      'make it pretty',
      '# CLAUDE.md content',
      '# SCRATCHPAD content'
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/transform',
      expect.any(Object)
    );

    // Verify body includes claudeMd and scratchpad
    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.claudeMd).toBe('# CLAUDE.md content');
    expect(body.scratchpad).toBe('# SCRATCHPAD content');
    expect(result.type).toBe('prompt');
  });

  it('should handle 401 with helpful error message', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        { code: 'INVALID_API_KEY', message: 'Invalid API key' },
        401
      )
    );

    await expect(
      client.interview([{ role: 'user', content: 'hi' }], 'beginner')
    ).rejects.toThrow('console.anthropic.com');
  });

  it('should handle 500 with API error code', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse(
        { code: 'INTERVIEW_FAILED', message: 'Something went wrong' },
        500
      )
    );

    await expect(
      client.interview([{ role: 'user', content: 'hi' }], 'beginner')
    ).rejects.toThrow('INTERVIEW_FAILED');
  });

  it('should handle network failure gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      client.interview([{ role: 'user', content: 'hi' }], 'beginner')
    ).rejects.toThrow('Network error');
  });

  it('should call correct path for compact', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        summary: 'User wanted a todo app',
        recentMessages: [{ role: 'user', content: 'start it' }],
        originalCount: 6,
        summarizedCount: 4,
      })
    );

    const result = await client.compact(
      [
        { role: 'user', content: 'I want a todo app' },
        { role: 'assistant', content: 'What framework?' },
        { role: 'user', content: 'React' },
        { role: 'assistant', content: 'Got it' },
        { role: 'user', content: 'start it' },
        { role: 'assistant', content: 'Working...' },
      ],
      2
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/compact',
      expect.any(Object)
    );

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.messages).toHaveLength(6);
    expect(body.keepRecent).toBe(2);
    expect(result.summary).toBe('User wanted a todo app');
    expect(result.recentMessages).toHaveLength(1);
  });
});
