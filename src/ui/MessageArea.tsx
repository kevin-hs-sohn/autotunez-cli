import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from './types.js';

interface MessageAreaProps {
  messages: Message[];
  maxHeight?: number;
}

function MessageItem({ message }: { message: Message }) {
  // Special rendering for transformed prompts
  if (message.role === 'prompt') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="cyan" bold>Prompt → Claude Code:</Text>
        </Box>
        <Box marginLeft={2} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text color="white" wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }

  // Special rendering for Claude Code output (real-time streaming)
  if (message.role === 'claude_output') {
    if (!message.content) {
      return null; // Don't render empty output
    }
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="magenta" bold>Claude Code:</Text>
        </Box>
        <Box marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="white" wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }

  const getPrefix = () => {
    switch (message.role) {
      case 'user':
        return <Text color="blue" bold>You: </Text>;
      case 'assistant':
        return <Text color="green" bold>autotunez: </Text>;
      case 'system':
        return <Text color="gray" bold>System: </Text>;
      default:
        return null;
    }
  };

  const getColor = () => {
    switch (message.role) {
      case 'user':
        return 'white';
      case 'assistant':
        return 'white';
      case 'system':
        return 'gray';
      default:
        return 'white';
    }
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {getPrefix()}
      </Box>
      <Box marginLeft={2}>
        <Text color={getColor()} wrap="wrap">{message.content}</Text>
      </Box>
    </Box>
  );
}

export function MessageArea({ messages, maxHeight = 15 }: MessageAreaProps) {
  // Show only the last N messages that fit
  const visibleMessages = messages.slice(-maxHeight);

  return (
    <Box flexDirection="column" paddingX={1}>
      {visibleMessages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </Box>
  );
}
