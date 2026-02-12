import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTransformPrompt } = vi.hoisted(() => ({
  mockTransformPrompt: vi.fn(),
}));

vi.mock('../agent.js', () => ({
  transformPrompt: mockTransformPrompt,
  ApiKeyRequiredError: class extends Error {
    constructor(msg: string) { super(msg); this.name = 'ApiKeyRequiredError'; }
  },
}));

import { createInteractiveHandler } from './interactive-mode.js';

describe('interactive-mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createInteractiveHandler', () => {
    it('should return a handler object with processInput method', () => {
      const handler = createInteractiveHandler({
        cwd: '/test',
      });
      expect(handler).toBeDefined();
      expect(typeof handler.processInput).toBe('function');
    });

    it('should pass through slash commands without transformation', async () => {
      const handler = createInteractiveHandler({
        cwd: '/test',
        projectContext: '# CLAUDE.md',
      });

      const result = await handler.processInput('/help');
      expect(result).toEqual({ type: 'passthrough', content: '/help' });
      expect(mockTransformPrompt).not.toHaveBeenCalled();
    });

    it('should pass through single-char input', async () => {
      const handler = createInteractiveHandler({
        cwd: '/test',
        projectContext: '# CLAUDE.md',
      });

      const result = await handler.processInput('y');
      expect(result).toEqual({ type: 'passthrough', content: 'y' });
    });

    it('should transform longer input when context exists', async () => {
      mockTransformPrompt.mockResolvedValue({ type: 'prompt', content: 'refined prompt' });

      const handler = createInteractiveHandler({
        cwd: '/test',
        projectContext: '# CLAUDE.md',
      });

      const result = await handler.processInput('build a todo app with React');
      expect(result).toEqual({ type: 'prompt', content: 'refined prompt' });
      expect(mockTransformPrompt).toHaveBeenCalled();
    });

    it('should pass through input directly when no context', async () => {
      const handler = createInteractiveHandler({
        cwd: '/test',
      });

      const result = await handler.processInput('build a todo app');
      expect(result).toEqual({ type: 'passthrough', content: 'build a todo app' });
    });
  });
});
