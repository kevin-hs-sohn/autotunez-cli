import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { FSDMilestone, FSDPlanResponse } from '../../types.js';

// Components
import { MilestoneList } from './MilestoneList.js';
import { OutputBox } from './OutputBox.js';
import { StatusBar } from './StatusBar.js';
import { ConfirmPrompt } from './ConfirmPrompt.js';

export type FSDPhase = 'planning' | 'confirming' | 'executing' | 'qa' | 'completed' | 'error';

export interface FSDState {
  phase: FSDPhase;
  goal: string;
  plan: FSDPlanResponse | null;
  currentMilestoneId: string | null;
  completedMilestones: string[];
  totalCost: number;
  totalPrompts: number;
  startTime: number;
  output: string[];
  error: string | null;
}

export interface ConfirmRequest {
  question: string;
  resolve: (answer: boolean) => void;
}

interface FSDAppProps {
  goal: string;
  maxCost: number;
  onPlan: () => Promise<FSDPlanResponse>;
  onExecute: (
    plan: FSDPlanResponse,
    callbacks: {
      onMilestoneStart: (milestone: FSDMilestone) => void;
      onMilestoneComplete: (milestoneId: string) => void;
      onOutput: (text: string) => void;
      onProgress: (cost: number, prompts: number) => void;
      onConfirm: (question: string) => Promise<boolean>;
      onQAStart: (milestoneId: string) => void;
      onQAComplete: (milestoneId: string, passed: boolean) => void;
    }
  ) => Promise<void>;
  onComplete: (state: FSDState) => void;
  onAbort: () => void;
  checkpoint?: boolean;
  skipQa?: boolean;
  vibesafuActive: boolean;
}

export function FSDApp({
  goal,
  maxCost,
  onPlan,
  onExecute,
  onComplete,
  onAbort,
  checkpoint = false,
  skipQa = false,
  vibesafuActive,
}: FSDAppProps) {
  const { exit } = useApp();

  const [state, setState] = useState<FSDState>({
    phase: 'planning',
    goal,
    plan: null,
    currentMilestoneId: null,
    completedMilestones: [],
    totalCost: 0,
    totalPrompts: 0,
    startTime: Date.now(),
    output: [],
    error: null,
  });

  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [isAborted, setIsAborted] = useState(false);

  // Handle ESC to abort
  useInput((input, key) => {
    if (key.escape && !isAborted) {
      setIsAborted(true);
      onAbort();
      setState(prev => ({ ...prev, phase: 'error', error: 'Aborted by user' }));
    }

    // Handle Y/N for confirm prompts
    if (confirmRequest) {
      if (input.toLowerCase() === 'y' || key.return) {
        confirmRequest.resolve(true);
        setConfirmRequest(null);
      } else if (input.toLowerCase() === 'n') {
        confirmRequest.resolve(false);
        setConfirmRequest(null);
      }
    }
  });

  // Add output line
  const addOutput = useCallback((text: string) => {
    setState(prev => ({
      ...prev,
      output: [...prev.output.slice(-100), text], // Keep last 100 lines
    }));
  }, []);

  // Confirm handler that returns a promise
  const handleConfirm = useCallback((question: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmRequest({ question, resolve });
    });
  }, []);

  // Main execution flow
  useEffect(() => {
    if (isAborted) return;

    const run = async () => {
      try {
        // Planning phase
        addOutput('Generating plan...');
        const plan = await onPlan();

        setState(prev => ({
          ...prev,
          phase: 'confirming',
          plan,
        }));

        // Wait for user confirmation
        const proceed = await handleConfirm('Proceed with execution?');
        if (!proceed) {
          setState(prev => ({ ...prev, phase: 'error', error: 'Aborted by user' }));
          return;
        }

        setState(prev => ({ ...prev, phase: 'executing' }));

        // Execute plan
        await onExecute(plan, {
          onMilestoneStart: (milestone) => {
            setState(prev => ({
              ...prev,
              currentMilestoneId: milestone.id,
            }));
            addOutput(`\n> ${milestone.id}: ${milestone.title}`);
          },
          onMilestoneComplete: (milestoneId) => {
            setState(prev => ({
              ...prev,
              completedMilestones: [...prev.completedMilestones, milestoneId],
              currentMilestoneId: null,
            }));
          },
          onOutput: addOutput,
          onProgress: (cost, prompts) => {
            setState(prev => ({
              ...prev,
              totalCost: cost,
              totalPrompts: prompts,
            }));
          },
          onConfirm: handleConfirm,
          onQAStart: (milestoneId) => {
            setState(prev => ({ ...prev, phase: 'qa' }));
            addOutput(`Running QA for ${milestoneId}...`);
          },
          onQAComplete: (milestoneId, passed) => {
            setState(prev => ({ ...prev, phase: 'executing' }));
            addOutput(passed ? `QA passed for ${milestoneId}` : `QA issues found for ${milestoneId}`);
          },
        });

        setState(prev => ({ ...prev, phase: 'completed' }));

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setState(prev => ({ ...prev, phase: 'error', error: errorMessage }));
        addOutput(`Error: ${errorMessage}`);
      }
    };

    run();
  }, []); // Run once on mount

  // Notify completion
  useEffect(() => {
    if (state.phase === 'completed' || state.phase === 'error') {
      onComplete(state);
      setTimeout(() => exit(), 100);
    }
  }, [state.phase, onComplete, exit, state]);

  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">FSD Mode</Text>
        <Text color="gray"> - {goal.slice(0, 50)}{goal.length > 50 ? '...' : ''}</Text>
      </Box>

      {/* Status Bar */}
      <StatusBar
        phase={state.phase}
        cost={state.totalCost}
        maxCost={maxCost}
        prompts={state.totalPrompts}
        elapsed={`${minutes}m ${seconds}s`}
        vibesafuActive={vibesafuActive}
      />

      {/* Milestones */}
      {state.plan && (
        <MilestoneList
          milestones={state.plan.milestones}
          currentId={state.currentMilestoneId}
          completedIds={state.completedMilestones}
        />
      )}

      {/* Output */}
      <OutputBox lines={state.output} maxLines={15} />

      {/* Confirm Prompt */}
      {confirmRequest && (
        <ConfirmPrompt question={confirmRequest.question} />
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
          {confirmRequest ? 'Press Y to confirm, N to cancel' : 'Press ESC to abort'}
        </Text>
      </Box>
    </Box>
  );
}
