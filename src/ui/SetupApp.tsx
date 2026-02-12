import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { MessageArea } from './MessageArea.js';
import { InputField } from './InputField.js';
import { TaskList } from './TaskList.js';
import type { Message, Task } from './types.js';

export type SkillLevel = 'beginner' | 'expert';

interface SetupAppProps {
  onInterview: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    level: SkillLevel
  ) => Promise<{ message: string; readyToGenerate: boolean }>;
  onExtract: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<{ name: string }>;
  onComplete: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<void>;
  onExit?: () => void;
  /** Initial project description (e.g., from FSD goal). Skips skill selection if provided. */
  initialInput?: string;
}

type SetupPhase = 'skill_select' | 'interview' | 'extracting' | 'generating' | 'done';

export function SetupApp({
  onInterview,
  onExtract,
  onComplete,
  onExit,
  initialInput,
}: SetupAppProps) {
  const { exit } = useApp();
  // Skip skill selection if initialInput is provided
  const [phase, setPhase] = useState<SetupPhase>(initialInput ? 'interview' : 'skill_select');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | null>(initialInput ? 'expert' : null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [initialInputProcessed, setInitialInputProcessed] = useState(false);

  const handleExit = useCallback(() => {
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [exit, onExit]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      handleExit();
    }

    // Skill level selection
    if (phase === 'skill_select' && !isLoading) {
      if (inputChar === '1') {
        setSkillLevel('beginner');
        setPhase('interview');
        startInterview('beginner');
      } else if (inputChar === '2') {
        setSkillLevel('expert');
        setPhase('interview');
        startInterview('expert');
      }
    }
  });

  const addTask = useCallback((label: string, status: Task['status'] = 'pending'): string => {
    const id = Date.now().toString();
    setTasks((prev) => [...prev, { id, label, status }]);
    return id;
  }, []);

  const updateTask = useCallback((id: string, status: Task['status']) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startInterview = useCallback(async (level: SkillLevel) => {
    const initialMsg = level === 'beginner'
      ? 'Hi! I want to build an app.'
      : 'Set up my project.';

    const newHistory = [{ role: 'user' as const, content: initialMsg }];
    setConversationHistory(newHistory);

    setMessages([{
      id: '0',
      role: 'assistant',
      content: level === 'beginner'
        ? 'Starting beginner mode. Feel free to describe your project!'
        : 'Starting expert mode. Let\'s get this set up quickly!',
    }]);

    setIsLoading(true);
    const taskId = addTask('Starting interview...', 'in_progress');

    try {
      const response = await onInterview(newHistory, level);
      updateTask(taskId, 'completed');
      setTimeout(() => removeTask(taskId), 500);

      const updatedHistory = [...newHistory, { role: 'assistant' as const, content: response.message }];
      setConversationHistory(updatedHistory);

      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: response.message,
      }]);

      if (response.readyToGenerate) {
        await finishSetup(updatedHistory);
      }
    } catch (error) {
      updateTask(taskId, 'failed');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: error instanceof Error ? error.message : 'An error occurred',
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [onInterview, addTask, updateTask, removeTask]);

  const finishSetup = useCallback(async (history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    setPhase('extracting');
    const extractTaskId = addTask('Extracting project info...', 'in_progress');

    try {
      const result = await onExtract(history);
      updateTask(extractTaskId, 'completed');

      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Project extracted: ${result.name}`,
      }]);

      setPhase('generating');
      const genTaskId = addTask('Generating files...', 'in_progress');

      await onComplete(history);
      updateTask(genTaskId, 'completed');

      setPhase('done');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Project setup complete! Ready to start development.',
      }]);

      // Auto exit after short delay
      setTimeout(() => handleExit(), 1500);
    } catch (error) {
      updateTask(extractTaskId, 'failed');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: error instanceof Error ? error.message : 'Error during extraction',
      }]);
      setPhase('interview');
    }
  }, [onExtract, onComplete, addTask, updateTask, handleExit]);

  // Process initialInput when provided (skip skill selection, start expert interview)
  useEffect(() => {
    if (initialInput && !initialInputProcessed && phase === 'interview') {
      setInitialInputProcessed(true);
      processInitialInput(initialInput);
    }
  }, [initialInput, initialInputProcessed, phase]);

  const processInitialInput = useCallback(async (projectDescription: string) => {
    // Show the initial input as user message
    setMessages([{
      id: '0',
      role: 'user',
      content: projectDescription,
    }]);

    const newHistory = [{ role: 'user' as const, content: projectDescription }];
    setConversationHistory(newHistory);

    setIsLoading(true);
    const taskId = addTask('Analyzing project description...', 'in_progress');

    try {
      // Send to interview API - it will determine if info is sufficient
      const response = await onInterview(newHistory, 'expert');
      updateTask(taskId, 'completed');
      setTimeout(() => removeTask(taskId), 500);

      const updatedHistory = [...newHistory, { role: 'assistant' as const, content: response.message }];
      setConversationHistory(updatedHistory);

      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: response.message,
      }]);

      if (response.readyToGenerate) {
        // Initial input was sufficient - proceed to setup
        await finishSetup(updatedHistory);
      }
      // Otherwise, interview continues normally
    } catch (error) {
      updateTask(taskId, 'failed');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: error instanceof Error ? error.message : 'Error processing input',
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [onInterview, addTask, updateTask, removeTask, finishSetup]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || phase !== 'interview') return;

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      handleExit();
      return;
    }

    // Add user message
    setMessages((prev) => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
    }]);
    setInput('');

    const newHistory = [...conversationHistory, { role: 'user' as const, content: trimmed }];
    setConversationHistory(newHistory);

    setIsLoading(true);
    const taskId = addTask('Thinking...', 'in_progress');

    try {
      const response = await onInterview(newHistory, skillLevel!);
      updateTask(taskId, 'completed');
      setTimeout(() => removeTask(taskId), 500);

      const updatedHistory = [...newHistory, { role: 'assistant' as const, content: response.message }];
      setConversationHistory(updatedHistory);

      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: response.message,
      }]);

      if (response.readyToGenerate) {
        await finishSetup(updatedHistory);
      }
    } catch (error) {
      updateTask(taskId, 'failed');
      setTimeout(() => removeTask(taskId), 2000);
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: error instanceof Error ? error.message : 'An error occurred',
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, phase, conversationHistory, skillLevel, onInterview, addTask, updateTask, removeTask, finishSetup, handleExit]);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="cyan">autotunez</Text>
        <Text color="gray"> - Project Setup</Text>
      </Box>

      {/* Skill Level Selection */}
      {phase === 'skill_select' && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold>Choose your setup mode:</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color="cyan" bold>1)</Text>
              <Text> Beginner — Step-by-step guided interview</Text>
            </Text>
            <Text>
              <Text color="cyan" bold>2)</Text>
              <Text> Expert — Quick setup (tech stack + MVP only)</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">Press 1 or 2 to select</Text>
          </Box>
        </Box>
      )}

      {/* Messages Area */}
      {phase !== 'skill_select' && (
        <Box flexDirection="column">
          <MessageArea messages={messages} />
        </Box>
      )}

      {/* Task List */}
      {tasks.length > 0 && (
        <Box marginBottom={1}>
          <TaskList tasks={tasks} />
        </Box>
      )}

      {/* Input */}
      {phase === 'interview' && (
        <InputField
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={isLoading}
          placeholder="Describe your project..."
        />
      )}

      {/* Help hint */}
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          {phase === 'skill_select'
            ? 'Press 1 or 2 to select. Ctrl+C to exit.'
            : 'Type "exit" to quit. Ctrl+C to force exit.'}
        </Text>
      </Box>
    </Box>
  );
}
