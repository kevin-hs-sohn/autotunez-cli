import React, { useState, useCallback } from 'react';
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
}

type SetupPhase = 'skill_select' | 'interview' | 'extracting' | 'generating' | 'done';

export function SetupApp({
  onInterview,
  onExtract,
  onComplete,
  onExit,
}: SetupAppProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<SetupPhase>('skill_select');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
      ? '안녕하세요! 앱을 만들고 싶어요.'
      : '프로젝트 셋업해줘.';

    const newHistory = [{ role: 'user' as const, content: initialMsg }];
    setConversationHistory(newHistory);

    setMessages([{
      id: '0',
      role: 'assistant',
      content: level === 'beginner'
        ? '입문자 모드로 시작합니다. 편하게 이야기해주세요!'
        : '숙련자 모드로 시작합니다. 빠르게 진행할게요!',
    }]);

    setIsLoading(true);
    const taskId = addTask('인터뷰 시작 중...', 'in_progress');

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
        content: error instanceof Error ? error.message : '오류가 발생했습니다',
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [onInterview, addTask, updateTask, removeTask]);

  const finishSetup = useCallback(async (history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    setPhase('extracting');
    const extractTaskId = addTask('프로젝트 정보 추출 중...', 'in_progress');

    try {
      const result = await onExtract(history);
      updateTask(extractTaskId, 'completed');

      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `프로젝트 추출 완료: ${result.name}`,
      }]);

      setPhase('generating');
      const genTaskId = addTask('파일 생성 중...', 'in_progress');

      await onComplete(history);
      updateTask(genTaskId, 'completed');

      setPhase('done');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '프로젝트 셋업 완료! 이제 개발을 시작하세요.',
      }]);

      // Auto exit after short delay
      setTimeout(() => handleExit(), 1500);
    } catch (error) {
      updateTask(extractTaskId, 'failed');
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: error instanceof Error ? error.message : '추출 중 오류가 발생했습니다',
      }]);
      setPhase('interview');
    }
  }, [onExtract, onComplete, addTask, updateTask, handleExit]);

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
    const taskId = addTask('생각 중...', 'in_progress');

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
        content: error instanceof Error ? error.message : '오류가 발생했습니다',
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
        <Text color="gray"> - 프로젝트 셋업</Text>
      </Box>

      {/* Skill Level Selection */}
      {phase === 'skill_select' && (
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold>어떤 모드로 진행할까요?</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color="cyan" bold>1)</Text>
              <Text> 입문자 — 처음부터 차근차근 (풀 인터뷰)</Text>
            </Text>
            <Text>
              <Text color="cyan" bold>2)</Text>
              <Text> 숙련자 — 핵심만 빠르게 (tech stack + MVP만)</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">숫자를 눌러 선택하세요 (1 또는 2)</Text>
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
          placeholder="프로젝트에 대해 설명해주세요..."
        />
      )}

      {/* Help hint */}
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          {phase === 'skill_select'
            ? '1 또는 2를 눌러 선택. Ctrl+C로 종료.'
            : 'exit으로 종료. Ctrl+C로 강제 종료.'}
        </Text>
      </Box>
    </Box>
  );
}
