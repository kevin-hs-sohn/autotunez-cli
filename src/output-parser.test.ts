import { describe, it, expect } from 'vitest';
import { parseStreamLine, extractSessionId, extractTextContent } from './output-parser';

describe('output-parser', () => {
  describe('parseStreamLine', () => {
    it('should parse valid JSON line', () => {
      const event = parseStreamLine('{"type":"init","session_id":"abc123"}');
      expect(event).toEqual({ type: 'init', session_id: 'abc123' });
    });

    it('should return null for invalid JSON', () => {
      expect(parseStreamLine('not json')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseStreamLine('')).toBeNull();
    });

    it('should parse message events with content', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      });
      const event = parseStreamLine(line);
      expect(event?.type).toBe('message');
      expect(event?.message?.content[0]).toEqual({ type: 'text', text: 'Hello world' });
    });
  });

  describe('extractSessionId', () => {
    it('should extract session_id from result event', () => {
      const events = [
        { type: 'init' },
        { type: 'message', message: { role: 'assistant', content: [] } },
        { type: 'result', session_id: 'session-xyz-789' },
      ];
      expect(extractSessionId(events)).toBe('session-xyz-789');
    });

    it('should extract session_id from init event', () => {
      const events = [
        { type: 'init', session_id: 'session-abc-123' },
        { type: 'message', message: { role: 'assistant', content: [] } },
      ];
      expect(extractSessionId(events)).toBe('session-abc-123');
    });

    it('should return undefined when no session_id found', () => {
      const events = [
        { type: 'message', message: { role: 'assistant', content: [] } },
      ];
      expect(extractSessionId(events)).toBeUndefined();
    });

    it('should prefer result event session_id over init', () => {
      const events = [
        { type: 'init', session_id: 'init-id' },
        { type: 'result', session_id: 'result-id' },
      ];
      expect(extractSessionId(events)).toBe('result-id');
    });
  });

  describe('extractTextContent', () => {
    it('should concatenate text content from message events', () => {
      const events = [
        { type: 'init' },
        {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello ' }],
          },
        },
        {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'world' }],
          },
        },
      ];
      expect(extractTextContent(events)).toBe('Hello world');
    });

    it('should skip non-text content blocks', () => {
      const events = [
        {
          type: 'message',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Code: ' },
              { type: 'tool_use', name: 'write_file' },
              { type: 'text', text: 'done' },
            ],
          },
        },
      ];
      expect(extractTextContent(events)).toBe('Code: done');
    });

    it('should return empty string when no text content', () => {
      const events = [{ type: 'init' }, { type: 'result' }];
      expect(extractTextContent(events)).toBe('');
    });

    it('should skip user messages', () => {
      const events = [
        {
          type: 'message',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'user input' }],
          },
        },
        {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'assistant output' }],
          },
        },
      ];
      expect(extractTextContent(events)).toBe('assistant output');
    });
  });
});
