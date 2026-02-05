import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputField({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Type your message...',
}: InputFieldProps) {
  return (
    <Box borderStyle="single" borderColor={disabled ? 'gray' : 'blue'} paddingX={1}>
      <Text color={disabled ? 'gray' : 'blue'} bold>You: </Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={disabled ? 'Type to queue...' : placeholder}
      />
    </Box>
  );
}
