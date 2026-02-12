/**
 * Stream Adapter: converts SDK messages to unified StreamEvent format.
 *
 * This adapter sits between the Agent SDK's message types and the
 * UI layer (CLI Ink or Cloud WebSocket), providing a stable contract
 * that both interfaces consume.
 */

import type { StreamEvent } from './types.js';

/**
 * Format a tool use into a human-readable string.
 */
export function formatToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return `$ ${input.command}`;
    case 'Read':
      return `Reading ${input.file_path}...`;
    case 'Edit':
    case 'Write':
      return `Editing ${input.file_path}...`;
    case 'Glob':
    case 'Grep':
      return 'Searching...';
    default:
      return `Using ${name}...`;
  }
}

/**
 * Adapt an SDK message into zero or more StreamEvents.
 *
 * Only 'assistant' messages produce events (text + tool_use).
 * Other message types (system, result, user) are ignored here
 * and handled by the executor directly.
 */
export function adaptSDKMessage(message: Record<string, unknown>): StreamEvent[] {
  if (message.type !== 'assistant') return [];

  const msg = message.message as Record<string, unknown> | undefined;
  const content = msg?.content as Array<Record<string, unknown>> | undefined;
  if (!content) return [];

  const events: StreamEvent[] = [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      events.push({ type: 'text', content: block.text as string });
    } else if (block.type === 'tool_use') {
      const name = block.name as string;
      const input = block.input as Record<string, unknown>;
      events.push({ type: 'tool_use', content: formatToolUse(name, input) });
    }
  }

  return events;
}
