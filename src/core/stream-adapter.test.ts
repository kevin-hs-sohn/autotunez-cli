import { describe, it, expect } from 'vitest';
import { adaptSDKMessage, formatToolUse } from './stream-adapter';

describe('stream-adapter', () => {
  describe('formatToolUse', () => {
    it('should format Bash commands', () => {
      expect(formatToolUse('Bash', { command: 'npm install' })).toBe('$ npm install');
    });

    it('should format Read tool', () => {
      expect(formatToolUse('Read', { file_path: '/src/index.ts' })).toBe('Reading /src/index.ts...');
    });

    it('should format Edit tool', () => {
      expect(formatToolUse('Edit', { file_path: '/src/app.ts' })).toBe('Editing /src/app.ts...');
    });

    it('should format Write tool', () => {
      expect(formatToolUse('Write', { file_path: '/src/new.ts' })).toBe('Editing /src/new.ts...');
    });

    it('should format Glob tool', () => {
      expect(formatToolUse('Glob', { pattern: '**/*.ts' })).toBe('Searching...');
    });

    it('should format Grep tool', () => {
      expect(formatToolUse('Grep', { pattern: 'TODO' })).toBe('Searching...');
    });

    it('should format unknown tools', () => {
      expect(formatToolUse('WebSearch', { query: 'test' })).toBe('Using WebSearch...');
    });
  });

  describe('adaptSDKMessage', () => {
    it('should return empty array for non-assistant messages', () => {
      const events = adaptSDKMessage({ type: 'system', session_id: 'sess-1' });
      expect(events).toEqual([]);
    });

    it('should extract text from assistant messages', () => {
      const events = adaptSDKMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      });

      expect(events).toEqual([{ type: 'text', content: 'Hello world' }]);
    });

    it('should extract multiple text blocks', () => {
      const events = adaptSDKMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First' },
            { type: 'text', text: 'Second' },
          ],
        },
      });

      expect(events).toHaveLength(2);
      expect(events[0].content).toBe('First');
      expect(events[1].content).toBe('Second');
    });

    it('should extract tool_use events', () => {
      const events = adaptSDKMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
          ],
        },
      });

      expect(events).toEqual([{ type: 'tool_use', content: '$ ls -la' }]);
    });

    it('should handle mixed text and tool_use blocks', () => {
      const events = adaptSDKMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check...' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/package.json' } },
          ],
        },
      });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'text', content: 'Let me check...' });
      expect(events[1]).toEqual({ type: 'tool_use', content: 'Reading /package.json...' });
    });

    it('should return empty for assistant with no content', () => {
      const events = adaptSDKMessage({
        type: 'assistant',
        message: { role: 'assistant' },
      });

      expect(events).toEqual([]);
    });

    it('should return empty for result messages', () => {
      const events = adaptSDKMessage({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-1',
      });

      expect(events).toEqual([]);
    });
  });
});
