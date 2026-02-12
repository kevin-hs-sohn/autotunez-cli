import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput, Static } from 'ink';
import { TaskList } from './TaskList.js';
import { InputField } from './InputField.js';
import type { Task, Message } from './types.js';

// Render a single message for Static output
function StaticMessage({ message }: { message: Message }) {
  if (message.role === 'prompt') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>Prompt → Claude Code:</Text>
        <Box marginLeft={2} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="white" wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }

  if (message.role === 'claude_output') {
    if (!message.content) return null;
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="magenta" bold>Claude Code:</Text>
        <Box marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="white" wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }

  const prefix = {
    user: <Text color="blue" bold>You: </Text>,
    assistant: <Text color="green" bold>autotunez: </Text>,
    system: <Text color="gray" bold>System: </Text>,
  }[message.role] || null;

  const color = message.role === 'system' ? 'gray' : 'white';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>{prefix}</Box>
      <Box marginLeft={2}>
        <Text color={color} wrap="wrap">{message.content}</Text>
      </Box>
    </Box>
  );
}

interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error';
  content: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CompactResult {
  summary: string;
  recentMessages: ConversationMessage[];
}

interface LearnResult {
  rule: string;
  category: 'always' | 'ask_first' | 'never';
  explanation: string;
}

interface CreditInfo {
  balance: number;      // in dollars
  usedToday: number;    // in dollars
}

// Threshold for triggering compaction (in characters)
const COMPACTION_THRESHOLD = 8000;
const KEEP_RECENT_MESSAGES = 4;

interface AppProps {
  onSubmit: (input: string, lastClaudeOutput?: string, signal?: AbortSignal) => Promise<{ type: 'prompt' | 'clarification'; content: string }>;
  onExecute: (prompt: string, onStreamEvent: (event: StreamEvent) => void, signal?: AbortSignal) => Promise<void>;
  onCompact?: (messages: ConversationMessage[]) => Promise<CompactResult>;
  onLearn?: (messages: ConversationMessage[]) => Promise<LearnResult>;
  onApplyRule?: (rule: string, category: 'always' | 'ask_first' | 'never') => Promise<void>;
  onFSD?: (goal: string) => Promise<void>;
  initialTasks?: Task[];
  welcomeMessage?: string;
  projectContext?: string;
  initialMessages?: Message[];
  initialCreditInfo?: CreditInfo;
  onRefreshCredits?: () => Promise<CreditInfo | null>;
  onMessagesChange?: (messages: Message[]) => void;
  onExit?: () => void;
}

export function App({
  onSubmit,
  onExecute,
  onCompact,
  onLearn,
  onApplyRule,
  onFSD,
  initialTasks = [],
  welcomeMessage,
  projectContext,
  initialMessages,
  initialCreditInfo,
  onRefreshCredits,
  onMessagesChange,
  onExit,
}: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => {
    if (initialMessages && initialMessages.length > 0) {
      return initialMessages;
    }
    if (welcomeMessage) {
      return [{
        id: '0',
        role: 'assistant' as const,
        content: welcomeMessage,
      }];
    }
    return [];
  });
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [isLoading, setIsLoading] = useState(false);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | undefined>(initialCreditInfo);

  // Input queue for pending inputs during loading
  const [inputQueue, setInputQueue] = useState<string[]>([]);

  // Input history for up/down arrow navigation
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');

  // Last Claude Code output for context passing
  const lastClaudeOutputRef = useRef<string>('');

  // Refresh credits after API operations
  const refreshCredits = useCallback(async () => {
    if (onRefreshCredits) {
      try {
        const newInfo = await onRefreshCredits();
        if (newInfo) {
          setCreditInfo(newInfo);
        }
      } catch {
        // Silently fail - don't block user operations
      }
    }
  }, [onRefreshCredits]);

  // AbortController for canceling current operation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Pending rule for learn feature confirmation
  const pendingRuleRef = useRef<LearnResult | null>(null);

  // Sync messages to parent
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages);
    }
  }, [messages, onMessagesChange]);

  // Handle exit
  const handleExit = useCallback(() => {
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [exit, onExit]);

  // Handle exit shortcuts, ESC interrupt, and input history navigation
  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      handleExit();
    }
    // ESC to interrupt current operation
    if (key.escape && isLoading) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'Operation interrupted by user (ESC)',
        }]);
      }
    }
    // Up arrow - navigate to previous input in history
    if (key.upArrow && !isLoading && inputHistory.length > 0) {
      if (historyIndex === -1) {
        // Save current input before navigating
        setSavedInput(input);
      }
      const newIndex = Math.min(historyIndex + 1, inputHistory.length - 1);
      setHistoryIndex(newIndex);
      setInput(inputHistory[newIndex]);
    }
    // Down arrow - navigate to next input in history
    if (key.downArrow && !isLoading && historyIndex >= 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      if (newIndex === -1) {
        setInput(savedInput);
      } else {
        setInput(inputHistory[newIndex]);
      }
    }
  });

  const updateTask = useCallback((id: string, status: Task['status']) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
  }, []);

  const addTask = useCallback((label: string): string => {
    const id = Date.now().toString();
    setTasks((prev) => [...prev, { id, label, status: 'pending' }]);
    return id;
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Get conversation messages for compaction
  const getConversationMessages = useCallback((msgs: Message[]): ConversationMessage[] => {
    return msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }, []);

  // Perform compaction if needed
  const maybeCompact = useCallback(async (): Promise<boolean> => {
    if (!onCompact) return false;

    const conversationMsgs = getConversationMessages(messages);
    const size = conversationMsgs.reduce((sum, m) => sum + m.content.length, 0);

    // Only compact if we have enough messages and exceed threshold
    if (size < COMPACTION_THRESHOLD || conversationMsgs.length < KEEP_RECENT_MESSAGES + 2) {
      return false;
    }

    const compactTaskId = addTask('Compacting conversation...');
    updateTask(compactTaskId, 'in_progress');

    try {
      const result = await onCompact(conversationMsgs);

      // Create new message array with summary replacing old messages
      const newMessages: Message[] = [
        {
          id: `summary-${Date.now()}`,
          role: 'system' as const,
          content: `[Previous conversation summary]\n${result.summary}`,
        },
        ...result.recentMessages.map((m, i) => ({
          id: `recent-${Date.now()}-${i}`,
          role: m.role,
          content: m.content,
        })),
      ];

      setMessages(newMessages);
      updateTask(compactTaskId, 'completed');
      setTimeout(() => removeTask(compactTaskId), 1000);
      return true;
    } catch {
      updateTask(compactTaskId, 'failed');
      setTimeout(() => removeTask(compactTaskId), 2000);
      return false;
    }
  }, [messages, onCompact, addTask, updateTask, removeTask, getConversationMessages]);

  // Process queue when loading finishes and queue has items
  useEffect(() => {
    if (!isLoading && inputQueue.length > 0) {
      const [nextInput, ...rest] = inputQueue;
      setInputQueue(rest);
      // Process after a small delay to avoid state conflicts
      const timer = setTimeout(() => {
        processInputRef.current?.(nextInput);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isLoading, inputQueue]);

  // Use ref to avoid circular dependency
  const processInputRef = useRef<((value: string) => Promise<void>) | null>(null);

  // Main input processing logic
  const processInput = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Handle special commands
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      handleExit();
      return;
    }

    if (trimmed.toLowerCase() === 'clear') {
      setMessages([]);
      setInput('');
      setInputQueue([]);
      return;
    }

    // Handle /fsd command
    if (trimmed.toLowerCase().startsWith('/fsd ') || trimmed.toLowerCase().startsWith('fsd ')) {
      const goal = trimmed.replace(/^\/?fsd\s+/i, '').trim();
      if (!goal) {
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'Usage: /fsd <goal>  (e.g., /fsd add login feature)',
        }]);
        return;
      }

      if (!onFSD) {
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'FSD mode is not available.',
        }]);
        return;
      }

      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: `🚗 Entering FSD mode: "${goal}"\n   Press ESC to interrupt, Ctrl+C to exit completely.`,
      }]);

      setIsLoading(true);
      const fsdTaskId = addTask('FSD mode running...');
      updateTask(fsdTaskId, 'in_progress');

      try {
        await onFSD(goal);
        updateTask(fsdTaskId, 'completed');
        setTimeout(() => removeTask(fsdTaskId), 1000);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: '✅ FSD mode completed. Back to normal mode.',
        }]);
      } catch (error) {
        updateTask(fsdTaskId, 'failed');
        setTimeout(() => removeTask(fsdTaskId), 2000);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: error instanceof Error ? `FSD error: ${error.message}` : 'FSD mode failed.',
        }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Handle learn command
    if (trimmed.toLowerCase() === 'learn' || trimmed === '배워') {
      if (!onLearn || !onApplyRule) {
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'Learn feature is not available.',
        }]);
        return;
      }

      const conversationMsgs = getConversationMessages(messages);
      if (conversationMsgs.length < 2) {
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'Not enough conversation history to learn from. Have a few exchanges first.',
        }]);
        return;
      }

      setIsLoading(true);
      const learnTaskId = addTask('Analyzing conversation...');
      updateTask(learnTaskId, 'in_progress');

      try {
        const result = await onLearn(conversationMsgs);
        updateTask(learnTaskId, 'completed');
        setTimeout(() => removeTask(learnTaskId), 500);

        // Show the generated rule
        const categoryEmoji = {
          always: '✅',
          ask_first: '⚠️',
          never: '🚫',
        }[result.category];

        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `📝 Generated rule:\n\n${categoryEmoji} ${result.rule}\n\nReason: ${result.explanation}\n\nAdd this to CLAUDE.md? (yes/no)`,
        }]);

        // Store pending rule for confirmation
        pendingRuleRef.current = result;
      } catch (error) {
        updateTask(learnTaskId, 'failed');
        setTimeout(() => removeTask(learnTaskId), 2000);
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: error instanceof Error ? error.message : 'Failed to generate learning rule.',
        }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Handle rule confirmation
    if (pendingRuleRef.current) {
      const answer = trimmed.toLowerCase();
      if (answer === 'yes' || answer === 'y' || answer === '예' || answer === '네') {
        setIsLoading(true);
        const applyTaskId = addTask('Updating CLAUDE.md...');
        updateTask(applyTaskId, 'in_progress');

        try {
          await onApplyRule!(pendingRuleRef.current.rule, pendingRuleRef.current.category);
          updateTask(applyTaskId, 'completed');
          setTimeout(() => removeTask(applyTaskId), 500);
          setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            content: '✅ Rule added to CLAUDE.md',
          }]);
        } catch (error) {
          updateTask(applyTaskId, 'failed');
          setTimeout(() => removeTask(applyTaskId), 2000);
          setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            content: error instanceof Error ? error.message : 'Failed to update CLAUDE.md.',
          }]);
        } finally {
          setIsLoading(false);
          pendingRuleRef.current = null;
        }
        return;
      } else if (answer === 'no' || answer === 'n' || answer === '아니오' || answer === '아니') {
        setMessages((prev) => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'Rule discarded.',
        }]);
        pendingRuleRef.current = null;
        return;
      }
      // If not yes/no, clear pending rule and continue with normal processing
      pendingRuleRef.current = null;
    }

    // Create AbortController for this operation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Add user message
    const userMsgId = Date.now().toString();
    setMessages((prev) => [...prev, {
      id: userMsgId,
      role: 'user',
      content: trimmed,
    }]);
    setInput('');
    setIsLoading(true);

    // Check if compaction is needed before processing
    await maybeCompact();

    // Add thinking task
    const thinkingTaskId = addTask('Thinking...');
    updateTask(thinkingTaskId, 'in_progress');

    try {
      // Pass last Claude Code output for context (helps with "go ahead" type responses)
      const result = await onSubmit(trimmed, lastClaudeOutputRef.current || undefined, abortController.signal);

      // Check if aborted
      if (abortController.signal.aborted) {
        updateTask(thinkingTaskId, 'failed');
        setTimeout(() => removeTask(thinkingTaskId), 1000);
        return;
      }

      // Update thinking task
      updateTask(thinkingTaskId, 'completed');

      // Short delay then remove
      setTimeout(() => removeTask(thinkingTaskId), 500);

      if (result.type === 'prompt') {
        // Show transformed prompt with special styling
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'prompt',
          content: result.content,
        }]);

        // Add executing task
        const execTaskId = addTask('Executing with Claude Code...');
        updateTask(execTaskId, 'in_progress');

        // Reset and capture Claude Code output for context
        let capturedOutput = '';

        // Stream Claude Code output directly to console (not through Ink)
        // This prevents scroll jump issues during streaming
        try {
          await onExecute(result.content, (event: StreamEvent) => {
            // Check if aborted
            if (abortController.signal.aborted) return;

            // Capture text output for context passing to next autotunez call
            if (event.type === 'text') {
              capturedOutput += event.content + '\n';
            }

            // Output directly to console - this naturally appends to scrollback
            if (event.type === 'text') {
              console.log(event.content);
            } else if (event.type === 'tool_use') {
              console.log(`> ${event.content}`);
            } else if (event.type === 'tool_result') {
              console.log(event.content);
            } else if (event.type === 'error') {
              console.error(`Error: ${event.content}`);
            }
          }, abortController.signal);

          // Store last ~1000 chars of Claude output for context
          lastClaudeOutputRef.current = capturedOutput.slice(-1000).trim();

          if (!abortController.signal.aborted) {
            updateTask(execTaskId, 'completed');
            setTimeout(() => removeTask(execTaskId), 1000);
          } else {
            updateTask(execTaskId, 'failed');
            setTimeout(() => removeTask(execTaskId), 1000);
          }
        } catch {
          updateTask(execTaskId, 'failed');
          setTimeout(() => removeTask(execTaskId), 2000);
        }
      } else {
        // Clarification - show as assistant message
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.content,
        }]);
      }
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        updateTask(thinkingTaskId, 'failed');
        setTimeout(() => removeTask(thinkingTaskId), 1000);
        return;
      }

      updateTask(thinkingTaskId, 'failed');
      setTimeout(() => removeTask(thinkingTaskId), 2000);

      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: error instanceof Error ? error.message : 'Something went wrong',
      }]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      // Refresh credits after API operation
      refreshCredits();
      // Queue processing is handled by useEffect
    }
  }, [onSubmit, onExecute, addTask, updateTask, removeTask, handleExit, maybeCompact, refreshCredits]);

  // Keep processInputRef in sync with processInput
  useEffect(() => {
    processInputRef.current = processInput;
  }, [processInput]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Save to history (avoid duplicates at the top)
    if (inputHistory[0] !== trimmed) {
      setInputHistory((prev) => [trimmed, ...prev].slice(0, 100));
    }
    setHistoryIndex(-1);
    setSavedInput('');

    // If loading, queue the input
    if (isLoading) {
      setInputQueue((prev) => [...prev, trimmed]);
      setInput('');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: `Queued: "${trimmed.slice(0, 30)}${trimmed.length > 30 ? '...' : ''}"`,
      }]);
      return;
    }

    await processInput(trimmed);
  }, [isLoading, processInput, inputHistory]);

  // All messages go to Static (streaming output goes directly to console)

  return (
    <Box flexDirection="column">
      {/* Header - only show once at start */}
      {messages.length === 0 && (
        <Box paddingX={1} marginBottom={1}>
          <Text bold color="cyan">autotunez</Text>
          <Text color="gray"> - vibe coding assistant</Text>
          {projectContext && <Text color="green"> (CLAUDE.md loaded)</Text>}
        </Box>
      )}

      {/* Static Messages - these are fixed in scrollback */}
      <Static items={messages}>
        {(message, index) => (
          <Box key={message.id || index} paddingX={1}>
            <StaticMessage message={message} />
          </Box>
        )}
      </Static>

      {/* Task List (dynamic) */}
      {tasks.length > 0 && (
        <Box marginBottom={1}>
          <TaskList tasks={tasks} />
        </Box>
      )}

      {/* Credit Status Bar */}
      {creditInfo && (
        <Box paddingX={1} marginBottom={0}>
          <Text color="cyan">Balance: ${creditInfo.balance.toFixed(2)}</Text>
          <Text color="gray"> | </Text>
          <Text color="gray">Today: ${creditInfo.usedToday.toFixed(2)}</Text>
        </Box>
      )}

      {/* Input (dynamic) */}
      <InputField
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isLoading}
        placeholder="What would you like to build?"
      />

      {/* Queue indicator */}
      {inputQueue.length > 0 && (
        <Box paddingX={1}>
          <Text color="yellow">{inputQueue.length} pending input(s) queued</Text>
        </Box>
      )}

      {/* Help hint */}
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          {isLoading
            ? 'Press ESC to interrupt. Type to queue more inputs.'
            : 'exit | clear | learn | '}
        </Text>
        {!isLoading && (
          <Text color="cyan" dimColor>/fsd &lt;goal&gt;</Text>
        )}
        {!isLoading && (
          <Text color="gray" dimColor> for autonomous mode</Text>
        )}
      </Box>
    </Box>
  );
}
