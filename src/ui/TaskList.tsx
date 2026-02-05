import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Task } from './types.js';

interface TaskListProps {
  tasks: Task[];
}

// Custom spinner with slower interval to prevent scroll jump
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 120; // ms - slower than default 80ms

function CustomSpinner() {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{SPINNER_FRAMES[frameIndex]}</Text>;
}

function TaskItem({ task }: { task: Task }) {
  const getIcon = () => {
    switch (task.status) {
      case 'completed':
        return <Text color="green">✓</Text>;
      case 'in_progress':
        return <CustomSpinner />;
      case 'failed':
        return <Text color="red">✗</Text>;
      default:
        return <Text color="gray">○</Text>;
    }
  };

  const getColor = () => {
    switch (task.status) {
      case 'completed':
        return 'green';
      case 'in_progress':
        return 'cyan';
      case 'failed':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <Box>
      {getIcon()}
      <Text color={getColor()}> {task.label}</Text>
    </Box>
  );
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </Box>
  );
}
