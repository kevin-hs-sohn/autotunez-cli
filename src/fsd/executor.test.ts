import { describe, it, expect } from 'vitest';
import {
  generateMilestonePrompt,
  generateFixPrompt,
  createInitialState,
  createDefaultConfig,
} from './executor';
import { FSDMilestone, FSDAutomatedChecks } from '../types.js';

describe('FSD Executor', () => {
  describe('generateMilestonePrompt', () => {
    it('should generate basic milestone prompt', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Setup Project',
        description: 'Initialize the project with dependencies',
        estimatedPrompts: 3,
        dependencies: [],
        qaGoal: 'Verify project runs',
        status: 'pending',
      };

      const prompt = generateMilestonePrompt(milestone, [], false);

      expect(prompt).toContain('Setup Project');
      expect(prompt).toContain('Initialize the project');
      expect(prompt).not.toContain('retry');
    });

    it('should include learnings in prompt', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Test',
        description: 'Test milestone',
        estimatedPrompts: 2,
        dependencies: [],
        qaGoal: 'Test QA',
        status: 'pending',
      };

      const learnings = ['Always mock external APIs', 'Check types before assignment'];
      const prompt = generateMilestonePrompt(milestone, learnings, false);

      expect(prompt).toContain('Learned Rules');
      expect(prompt).toContain('Always mock external APIs');
      expect(prompt).toContain('Check types before assignment');
    });

    it('should indicate retry attempt', () => {
      const milestone: FSDMilestone = {
        id: 'm1',
        title: 'Test',
        description: 'Test',
        estimatedPrompts: 2,
        dependencies: [],
        qaGoal: 'Test',
        status: 'pending',
      };

      const prompt = generateMilestonePrompt(milestone, [], true);

      expect(prompt).toContain('retry');
      expect(prompt).toContain('Previous attempt failed');
    });
  });

  describe('generateFixPrompt', () => {
    it('should generate fix prompt for typecheck failure', () => {
      const checks: FSDAutomatedChecks = {
        build: { passed: true },
        typecheck: { passed: false, output: 'Cannot find module "foo"' },
        test: { passed: true },
        lint: { passed: true },
      };

      const prompt = generateFixPrompt(checks, []);

      expect(prompt).toContain('Fix Required');
      expect(prompt).toContain('Type errors');
      expect(prompt).toContain('Cannot find module "foo"');
    });

    it('should include multiple failures', () => {
      const checks: FSDAutomatedChecks = {
        build: { passed: false, output: 'Build error' },
        typecheck: { passed: false, output: 'Type error' },
        test: { passed: true },
        lint: { passed: false, output: 'Lint error' },
      };

      const prompt = generateFixPrompt(checks, []);

      expect(prompt).toContain('Build failed');
      expect(prompt).toContain('Type errors');
      expect(prompt).toContain('Lint errors');
    });

    it('should include learnings in fix prompt', () => {
      const checks: FSDAutomatedChecks = {
        build: { passed: false, output: 'Error' },
        typecheck: { passed: true },
        test: { passed: true },
        lint: { passed: true },
      };

      const learnings = ['Always verify imports'];
      const prompt = generateFixPrompt(checks, learnings);

      expect(prompt).toContain('Learned Rules');
      expect(prompt).toContain('Always verify imports');
    });
  });

  describe('createInitialState', () => {
    it('should create initial state with correct defaults', () => {
      const state = createInitialState();

      expect(state.mode).toBe('planning');
      expect(state.currentMilestoneId).toBeNull();
      expect(state.completedMilestones).toEqual([]);
      expect(state.failedAttempts).toBe(0);
      expect(state.totalCost).toBe(0);
      expect(state.totalPrompts).toBe(0);
      expect(state.learnings).toEqual([]);
      expect(state.startTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config with defaults', () => {
      const config = createDefaultConfig();

      expect(config.maxCost).toBe(10);
      expect(config.maxIterationsPerMilestone).toBe(5);
      expect(config.maxTotalPrompts).toBe(100);
      expect(config.checkpointInterval).toBe(3);
      expect(config.sensitiveApproval).toBe(true);
      expect(config.autoResume).toBe(false);
    });

    it('should allow overrides', () => {
      const config = createDefaultConfig({
        maxCost: 20,
        autoResume: true,
      });

      expect(config.maxCost).toBe(20);
      expect(config.autoResume).toBe(true);
      expect(config.maxIterationsPerMilestone).toBe(5); // Default preserved
    });
  });
});
