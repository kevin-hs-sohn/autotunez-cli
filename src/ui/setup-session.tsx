import React from 'react';
import { render, type Instance } from 'ink';
import { SetupApp, type SkillLevel } from './SetupApp.js';

interface SetupSessionOptions {
  onInterview: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    level: SkillLevel
  ) => Promise<{ message: string; readyToGenerate: boolean }>;
  onExtract: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<{ name: string }>;
  onComplete: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ) => Promise<void>;
  /** Initial project description to start interview with (skips skill selection) */
  initialInput?: string;
}

export async function startSetupSession(options: SetupSessionOptions): Promise<boolean> {
  let instance: Instance | null = null;
  let exitPromiseResolve: ((success: boolean) => void) | null = null;
  let setupSuccess = false;

  const wrappedOnComplete = async (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    await options.onComplete(messages);
    setupSuccess = true;
  };

  instance = render(
    <SetupApp
      onInterview={options.onInterview}
      onExtract={options.onExtract}
      onComplete={wrappedOnComplete}
      initialInput={options.initialInput}
      onExit={() => {
        if (instance) {
          instance.unmount();
        }
        if (exitPromiseResolve) {
          exitPromiseResolve(setupSuccess);
        }
      }}
    />
  );

  return new Promise<boolean>((resolve) => {
    exitPromiseResolve = resolve;
  });
}
