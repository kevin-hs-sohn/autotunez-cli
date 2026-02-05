import React from 'react';
import { Box, Text } from 'ink';

interface ConfirmPromptProps {
  question: string;
}

export function ConfirmPrompt({ question }: ConfirmPromptProps) {
  return (
    <Box marginY={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Text color="cyan" bold>{question}</Text>
      <Text color="gray"> (Y/n)</Text>
    </Box>
  );
}
