import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { FSDOutputHandler } from './output-handler.js';

type Phase = 'planning' | 'confirming' | 'executing' | 'qa' | 'completed' | 'error' | 'paused';

interface Milestone {
  id: string;
  title: string;
  size: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
}

interface AppState {
  phase: Phase;
  goal: string;
  milestones: Milestone[];
  currentMilestoneId: string | null;
  completedMilestones: string[];
  cost: number;
  maxCost: number;
  prompts: number;
  startTime: number;
  output: string[];
  error: string | null;
  vibesafuActive: boolean;
  confirmQuestion: string | null;
  gitBranch: string | null;
  inputValue: string;
  previousPhase: Phase | null;
}

// Global state setter reference for external access
let globalSetState: React.Dispatch<React.SetStateAction<AppState>> | null = null;

interface InkFSDAppProps {
  goal: string;
  maxCost: number;
  onConfirmResponse: (answer: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onUserInput: (input: string) => void;
}

function InkFSDApp({ goal, maxCost, onConfirmResponse, onPause, onResume, onUserInput }: InkFSDAppProps) {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    phase: 'planning',
    goal,
    milestones: [],
    currentMilestoneId: null,
    completedMilestones: [],
    cost: 0,
    maxCost,
    prompts: 0,
    startTime: Date.now(),
    output: [],
    error: null,
    vibesafuActive: false,
    confirmQuestion: null,
    gitBranch: null,
    inputValue: '',
    previousPhase: null,
  });

  // Store the state setter globally for external access
  useEffect(() => {
    globalSetState = setState;
    return () => { globalSetState = null; };
  }, []);

  // Handle keyboard input (disabled when paused to let TextInput work)
  useInput((input, key) => {
    // Handle confirm prompts first
    if (state.confirmQuestion) {
      if (input.toLowerCase() === 'y' || key.return) {
        onConfirmResponse(true);
        setState(prev => ({ ...prev, confirmQuestion: null }));
        return;
      } else if (input.toLowerCase() === 'n') {
        onConfirmResponse(false);
        setState(prev => ({ ...prev, confirmQuestion: null }));
        return;
      }
      return;
    }

    // ESC to pause (not when already paused - TextInput handles that)
    if (key.escape && state.phase !== 'completed' && state.phase !== 'error') {
      onPause();
      setState(prev => ({
        ...prev,
        previousPhase: prev.phase,
        phase: 'paused',
      }));
    }
  }, { isActive: state.phase !== 'paused' });

  // Handle ESC when paused (to resume)
  useInput((input, key) => {
    if (key.escape) {
      onResume();
      setState(prev => ({
        ...prev,
        phase: prev.previousPhase || 'executing',
        previousPhase: null,
        inputValue: '',
      }));
    }
  }, { isActive: state.phase === 'paused' });

  // Handle text input submission
  const handleInputSubmit = (value: string) => {
    if (value.trim() === '') {
      // Empty input = resume FSD
      onResume();
      setState(prev => ({
        ...prev,
        phase: prev.previousPhase || 'executing',
        previousPhase: null,
        inputValue: '',
      }));
    } else {
      // Send user input
      onUserInput(value);
      setState(prev => ({ ...prev, inputValue: '' }));
    }
  };

  // Auto-refresh timer for elapsed time
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const costPercent = Math.round((state.cost / state.maxCost) * 100);
  const costColor = costPercent >= 80 ? 'red' : costPercent >= 50 ? 'yellow' : 'green';

  const phaseLabels: Record<Phase, { label: string; color: string }> = {
    planning: { label: 'Planning...', color: 'yellow' },
    confirming: { label: 'Awaiting Confirmation', color: 'cyan' },
    executing: { label: 'Executing', color: 'green' },
    qa: { label: 'Running QA', color: 'magenta' },
    completed: { label: 'Completed', color: 'green' },
    error: { label: 'Error', color: 'red' },
    paused: { label: 'Paused', color: 'yellow' },
  };

  const { label: phaseLabel, color: phaseColor } = phaseLabels[state.phase];

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">FSD Mode</Text>
        <Text color="gray"> - {state.goal.slice(0, 50)}{state.goal.length > 50 ? '...' : ''}</Text>
      </Box>

      {/* Status Bar */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text color={phaseColor} bold>{phaseLabel}</Text>
        </Box>
        <Box>
          <Text color="gray">Cost: </Text>
          <Text color={costColor}>${state.cost.toFixed(2)}</Text>
          <Text color="gray">/${state.maxCost} </Text>
          <Text color="gray">| Prompts: </Text>
          <Text color="white">{state.prompts}</Text>
          <Text color="gray"> | Time: </Text>
          <Text color="white">{minutes}m {seconds}s</Text>
          <Text color="gray"> | </Text>
          {state.vibesafuActive ? (
            <Text color="green">✓ vibesafu</Text>
          ) : (
            <Text color="yellow">⚠ no vibesafu</Text>
          )}
        </Box>
      </Box>

      {/* Git Branch */}
      {state.gitBranch && (
        <Box marginBottom={1}>
          <Text color="green">Branch: </Text>
          <Text color="white">{state.gitBranch}</Text>
        </Box>
      )}

      {/* Milestones */}
      {state.milestones.length > 0 && (
        <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold color="white">Milestones</Text>
          {state.milestones.map((m) => {
            let icon = '○ ';
            let color = 'gray';

            if (m.status === 'completed') {
              icon = '✓ ';
              color = 'green';
            } else if (m.status === 'in_progress') {
              icon = '▶ ';
              color = 'cyan';
            } else if (m.status === 'failed') {
              icon = '✗ ';
              color = 'red';
            } else if (m.status === 'skipped') {
              icon = '- ';
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
      )}

      {/* Output */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        minHeight={12}
      >
        <Text bold color="white">Output</Text>
        {state.output.slice(-10).map((line, i) => (
          <Text key={i} color="white" wrap="truncate">
            {line.slice(0, 120)}
          </Text>
        ))}
        {state.output.length === 0 && (
          <Text color="gray">Waiting for output...</Text>
        )}
      </Box>

      {/* Confirm Prompt */}
      {state.confirmQuestion && (
        <Box marginY={1} borderStyle="double" borderColor="yellow" paddingX={2} paddingY={1}>
          <Text color="yellow" bold>⚠ {state.confirmQuestion}</Text>
          <Text color="white" bold> [Y/n] </Text>
        </Box>
      )}

      {/* Paused - Text Input */}
      {state.phase === 'paused' && (
        <Box marginY={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="yellow" bold>⏸ Paused</Text>
            <Text color="gray"> - Type a command or press Enter to resume FSD</Text>
          </Box>
          <Box borderStyle="single" borderColor="blue" paddingX={1}>
            <Text color="blue" bold>{'> '}</Text>
            <TextInput
              value={state.inputValue}
              onChange={(value) => setState(prev => ({ ...prev, inputValue: value }))}
              onSubmit={handleInputSubmit}
              placeholder="Type command or Enter to resume..."
            />
          </Box>
        </Box>
      )}

      {/* Error */}
      {state.error && (
        <Box marginTop={1}>
          <Text color="red">Error: {state.error}</Text>
        </Box>
      )}

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color="gray">
          {state.confirmQuestion
            ? 'Press Y to confirm, N to cancel'
            : state.phase === 'paused'
            ? 'Type command + Enter, or just Enter to resume FSD'
            : 'Press ESC to pause'}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Ink-based output handler
 */
export class InkOutputHandler implements FSDOutputHandler {
  private confirmResolve: ((answer: boolean) => void) | null = null;
  private instance: ReturnType<typeof render> | null = null;
  private pauseCallback: (() => void) | null = null;
  private resumeCallback: (() => void) | null = null;
  private userInputCallback: ((input: string) => void) | null = null;

  async initialize(
    goal: string,
    maxCost: number,
    callbacks: {
      onPause: () => void;
      onResume: () => void;
      onUserInput: (input: string) => void;
    }
  ): Promise<void> {
    this.pauseCallback = callbacks.onPause;
    this.resumeCallback = callbacks.onResume;
    this.userInputCallback = callbacks.onUserInput;

    return new Promise((resolve) => {
      this.instance = render(
        <InkFSDApp
          goal={goal}
          maxCost={maxCost}
          onConfirmResponse={(answer) => {
            if (this.confirmResolve) {
              this.confirmResolve(answer);
              this.confirmResolve = null;
            }
          }}
          onPause={() => {
            if (this.pauseCallback) {
              this.pauseCallback();
            }
          }}
          onResume={() => {
            if (this.resumeCallback) {
              this.resumeCallback();
            }
          }}
          onUserInput={(input) => {
            if (this.userInputCallback) {
              this.userInputCallback(input);
            }
          }}
        />
      );

      // Give Ink a moment to render and setup globalSetState
      setTimeout(resolve, 200);
    });
  }

  private update(updater: (prev: AppState) => AppState): void {
    if (globalSetState) {
      globalSetState(updater);
    }
  }

  cleanup(): void {
    if (this.instance) {
      this.instance.unmount();
      this.instance = null;
    }
    globalSetState = null;
  }

  start(goal: string): void {
    // Already initialized via initialize()
  }

  complete(stats: { milestones: number; total: number; prompts: number; cost: number; minutes: number; failedAttempts: number }): void {
    this.update(prev => ({ ...prev, phase: 'completed' }));
    // Also unmount and show final stats
    this.cleanup();
    console.log('\n');
    console.log('\x1b[1m\x1b[32mFSD Mode Complete!\x1b[0m\n');
    console.log(`  Milestones: ${stats.milestones}/${stats.total}`);
    console.log(`  Prompts: ${stats.prompts}`);
    console.log(`  Estimated cost: ~$${stats.cost.toFixed(2)}`);
    console.log(`  Time: ${stats.minutes} minutes`);
    console.log(`  Failed attempts: ${stats.failedAttempts}`);
  }

  error(message: string): void {
    this.update(prev => ({ ...prev, phase: 'error', error: message }));
  }

  planningStart(): void {
    this.update(prev => ({ ...prev, phase: 'planning' }));
  }

  planningComplete(): void {
    this.update(prev => ({ ...prev, phase: 'confirming' }));
  }

  showPlan(plan: { milestones: Array<{ id: string; title: string; size: string; dependsOn: string[] }>; estimatedCost: number; estimatedTimeMinutes: number; risks: string[] }): void {
    this.update(prev => ({
      ...prev,
      milestones: plan.milestones.map(m => ({
        id: m.id,
        title: m.title,
        size: m.size,
        status: 'pending' as const,
      })),
    }));
  }

  milestoneStart(id: string, title: string): void {
    this.update(prev => ({
      ...prev,
      phase: 'executing',
      currentMilestoneId: id,
      milestones: prev.milestones.map(m =>
        m.id === id ? { ...m, status: 'in_progress' as const } : m
      ),
    }));
  }

  milestoneComplete(id: string, title: string): void {
    this.update(prev => ({
      ...prev,
      completedMilestones: [...prev.completedMilestones, id],
      milestones: prev.milestones.map(m =>
        m.id === id ? { ...m, status: 'completed' as const } : m
      ),
    }));
  }

  milestoneFailed(id: string, title: string, errors?: string[]): void {
    this.update(prev => ({
      ...prev,
      milestones: prev.milestones.map(m =>
        m.id === id ? { ...m, status: 'failed' as const } : m
      ),
    }));
    if (errors) {
      for (const err of errors) {
        this.output(`  Error: ${err}\n`);
      }
    }
  }

  milestoneSkipped(id: string, reason: string): void {
    this.update(prev => ({
      ...prev,
      milestones: prev.milestones.map(m =>
        m.id === id ? { ...m, status: 'skipped' as const } : m
      ),
    }));
  }

  qaStart(milestoneId: string): void {
    this.update(prev => ({ ...prev, phase: 'qa' }));
  }

  qaComplete(passed: boolean): void {
    this.update(prev => ({ ...prev, phase: 'executing' }));
  }

  qaIssue(severity: string, description: string): void {
    this.output(`  [${severity}] ${description}\n`);
  }

  output(text: string): void {
    // Add to output buffer for display
    this.update(prev => {
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length === 0) return prev;
      return {
        ...prev,
        output: [...prev.output.slice(-100), ...lines],
      };
    });
  }

  progress(cost: number, maxCost: number, prompts: number): void {
    this.update(prev => ({
      ...prev,
      cost,
      maxCost,
      prompts,
    }));
  }

  async confirm(question: string): Promise<boolean> {
    // Set confirm question in state and wait for response
    this.update(prev => ({ ...prev, confirmQuestion: question }));

    return new Promise((resolve) => {
      this.confirmResolve = resolve;
    });
  }

  securityStatus(vibesafuActive: boolean): void {
    this.update(prev => ({ ...prev, vibesafuActive }));
  }

  gitBranch(branch: string): void {
    this.update(prev => ({ ...prev, gitBranch: branch }));
  }

  gitComplete(summary: string): void {
    this.output(summary + '\n');
  }

  showBlockers(blockers: Array<{ description: string; checkInstruction: string }>): void {
    this.output('\nPlease complete these tasks first:\n');
    for (const b of blockers) {
      this.output(`  - ${b.description}\n`);
      this.output(`    Check: ${b.checkInstruction}\n`);
    }
  }
}
