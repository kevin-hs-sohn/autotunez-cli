import React from 'react';
import { render } from 'ink';
import { FSDApp, FSDState } from './FSDApp.js';
import { FSDPlanResponse, FSDMilestone } from '../../types.js';

export interface FSDSessionCallbacks {
  onMilestoneStart: (milestone: FSDMilestone) => void;
  onMilestoneComplete: (milestoneId: string) => void;
  onOutput: (text: string) => void;
  onProgress: (cost: number, prompts: number) => void;
  onConfirm: (question: string) => Promise<boolean>;
  onQAStart: (milestoneId: string) => void;
  onQAComplete: (milestoneId: string, passed: boolean) => void;
}

export interface FSDSessionOptions {
  goal: string;
  maxCost: number;
  checkpoint?: boolean;
  skipQa?: boolean;
  vibesafuActive: boolean;
  onPlan: () => Promise<FSDPlanResponse>;
  onExecute: (plan: FSDPlanResponse, callbacks: FSDSessionCallbacks) => Promise<void>;
}

export interface FSDSessionResult {
  success: boolean;
  state: FSDState;
}

export async function startFSDSession(options: FSDSessionOptions): Promise<FSDSessionResult> {
  return new Promise((resolve) => {
    let aborted = false;
    let finalState: FSDState | null = null;

    const instance = render(
      <FSDApp
        goal={options.goal}
        maxCost={options.maxCost}
        checkpoint={options.checkpoint}
        skipQa={options.skipQa}
        vibesafuActive={options.vibesafuActive}
        onPlan={options.onPlan}
        onExecute={options.onExecute}
        onComplete={(state) => {
          finalState = state;
        }}
        onAbort={() => {
          aborted = true;
        }}
      />
    );

    instance.waitUntilExit().then(() => {
      resolve({
        success: !aborted && finalState?.phase === 'completed',
        state: finalState || {
          phase: 'error',
          goal: options.goal,
          plan: null,
          currentMilestoneId: null,
          completedMilestones: [],
          totalCost: 0,
          totalPrompts: 0,
          startTime: Date.now(),
          output: [],
          error: 'Session ended unexpectedly',
        },
      });
    });
  });
}
