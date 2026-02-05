import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { Task, Message } from './types.js';

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error';
  content: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompactResult {
  summary: string;
  recentMessages: ConversationMessage[];
}

export interface LearnResult {
  rule: string;
  category: 'always' | 'ask_first' | 'never';
  explanation: string;
}

export interface CreditInfo {
  balance: number;      // in dollars
  usedToday: number;    // in dollars
}

interface SessionOptions {
  projectContext?: string;
  welcomeMessage?: string;
  initialTasks?: Task[];
  initialCreditInfo?: CreditInfo;
  /** Pre-populate conversation with initial messages (e.g., from FSD setup flow) */
  initialMessages?: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
  onSubmit: (input: string, conversationHistory: ConversationMessage[], lastClaudeOutput?: string) => Promise<{ type: 'prompt' | 'clarification'; content: string }>;
  onExecute: (prompt: string, onStreamEvent: (event: StreamEvent) => void) => Promise<void>;
  onCompact?: (messages: ConversationMessage[]) => Promise<CompactResult>;
  onLearn?: (messages: ConversationMessage[]) => Promise<LearnResult>;
  onApplyRule?: (rule: string, category: 'always' | 'ask_first' | 'never') => Promise<void>;
  onFSD?: (goal: string) => Promise<void>;
  onRefreshCredits?: () => Promise<CreditInfo | null>;
}

export async function startInkSession(options: SessionOptions): Promise<void> {
  // Shared state between Ink renders
  let messages: Message[] = [];
  if (options.initialMessages && options.initialMessages.length > 0) {
    // Use provided initial messages (e.g., from FSD setup flow)
    messages = options.initialMessages;
  } else if (options.welcomeMessage) {
    messages = [{
      id: '0',
      role: 'assistant' as const,
      content: options.welcomeMessage,
    }];
  }

  // Extract conversation history from messages (user and assistant only)
  const getConversationHistory = (): ConversationMessage[] => {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
  };

  const instance = render(
    <App
      onSubmit={async (input: string, lastClaudeOutput?: string) => {
        // Pass conversation history and last Claude output to the actual onSubmit
        return options.onSubmit(input, getConversationHistory(), lastClaudeOutput);
      }}
      onExecute={async (prompt: string, onStreamEvent: (event: StreamEvent) => void) => {
        await options.onExecute(prompt, onStreamEvent);
      }}
      onCompact={options.onCompact ? async (msgs) => {
        return options.onCompact!(msgs);
      } : undefined}
      onLearn={options.onLearn ? async (msgs) => {
        return options.onLearn!(msgs);
      } : undefined}
      onApplyRule={options.onApplyRule ? async (rule, category) => {
        return options.onApplyRule!(rule, category);
      } : undefined}
      onFSD={options.onFSD ? async (goal) => {
        return options.onFSD!(goal);
      } : undefined}
      initialTasks={options.initialTasks}
      welcomeMessage={options.welcomeMessage}
      projectContext={options.projectContext}
      initialMessages={messages}
      initialCreditInfo={options.initialCreditInfo}
      onRefreshCredits={options.onRefreshCredits}
      onMessagesChange={(newMessages) => {
        messages = newMessages;
      }}
      onExit={() => {
        instance.unmount();
      }}
    />
  );

  // Use Ink's built-in waitUntilExit for reliable exit handling
  await instance.waitUntilExit();
}
