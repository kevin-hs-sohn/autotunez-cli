import React from 'react';
import { Box, Text } from 'ink';
import { FSDPhase } from './FSDApp.js';

interface StatusBarProps {
  phase: FSDPhase;
  cost: number;
  maxCost: number;
  prompts: number;
  elapsed: string;
  vibesafuActive: boolean;
}

const phaseLabels: Record<FSDPhase, { label: string; color: string }> = {
  planning: { label: 'Planning...', color: 'yellow' },
  confirming: { label: 'Awaiting Confirmation', color: 'cyan' },
  executing: { label: 'Executing', color: 'green' },
  qa: { label: 'Running QA', color: 'magenta' },
  completed: { label: 'Completed', color: 'green' },
  error: { label: 'Error', color: 'red' },
};

export function StatusBar({ phase, cost, maxCost, prompts, elapsed, vibesafuActive }: StatusBarProps) {
  const { label, color } = phaseLabels[phase];
  const costPercent = Math.round((cost / maxCost) * 100);
  const costColor = costPercent >= 80 ? 'red' : costPercent >= 50 ? 'yellow' : 'green';

  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Box>
        <Text color={color} bold>{label}</Text>
      </Box>
      <Box>
        <Text color="gray">Cost: </Text>
        <Text color={costColor}>${cost.toFixed(2)}</Text>
        <Text color="gray">/${maxCost} </Text>
        <Text color="gray">| Prompts: </Text>
        <Text color="white">{prompts}</Text>
        <Text color="gray"> | Time: </Text>
        <Text color="white">{elapsed}</Text>
        <Text color="gray"> | </Text>
        {vibesafuActive ? (
          <Text color="green">vibesafu</Text>
        ) : (
          <Text color="yellow">no vibesafu</Text>
        )}
      </Box>
    </Box>
  );
}
