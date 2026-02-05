import React from 'react';
import { Box, Text } from 'ink';

interface OutputBoxProps {
  lines: string[];
  maxLines?: number;
}

export function OutputBox({ lines, maxLines = 10 }: OutputBoxProps) {
  const displayLines = lines.slice(-maxLines);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      minHeight={maxLines + 2}
    >
      <Text bold color="white">Output</Text>
      {displayLines.length === 0 ? (
        <Text color="gray">Waiting for output...</Text>
      ) : (
        displayLines.map((line, i) => (
          <Text key={i} color="white" wrap="truncate">
            {line.slice(0, 120)}
          </Text>
        ))
      )}
    </Box>
  );
}
