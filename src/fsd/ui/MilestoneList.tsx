import React from 'react';
import { Box, Text } from 'ink';
import { FSDMilestone } from '../../types.js';

interface MilestoneListProps {
  milestones: FSDMilestone[];
  currentId: string | null;
  completedIds: string[];
}

export function MilestoneList({ milestones, currentId, completedIds }: MilestoneListProps) {
  return (
    <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold color="white">Milestones</Text>
      {milestones.map((m) => {
        const isCompleted = completedIds.includes(m.id);
        const isCurrent = m.id === currentId;

        let icon = '  ';
        let color: string = 'gray';

        if (isCompleted) {
          icon = '✓ ';
          color = 'green';
        } else if (isCurrent) {
          icon = '▶ ';
          color = 'cyan';
        } else {
          icon = '○ ';
          color = 'gray';
        }

        return (
          <Box key={m.id}>
            <Text color={color}>
              {icon}{m.id}. {m.title}
              <Text color="gray"> [{m.size}]</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
