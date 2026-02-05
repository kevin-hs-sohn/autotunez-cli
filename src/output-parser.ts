export interface StreamEvent {
  type: string;
  session_id?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; name?: string }>;
  };
}

export function parseStreamLine(line: string): StreamEvent | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
}

export function extractSessionId(events: StreamEvent[]): string | undefined {
  // Prefer result event session_id (final) over init event
  const resultEvent = events.find(e => e.type === 'result' && e.session_id);
  if (resultEvent?.session_id) return resultEvent.session_id;

  const initEvent = events.find(e => e.type === 'init' && e.session_id);
  return initEvent?.session_id;
}

export function extractTextContent(events: StreamEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type !== 'message' || event.message?.role !== 'assistant') continue;
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        text += block.text;
      }
    }
  }
  return text;
}
