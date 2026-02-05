import { describe, it, expect } from 'vitest';
import {
  BEGINNER_SYSTEM_PROMPT,
  EXPERT_SYSTEM_PROMPT,
  getInterviewPrompt,
} from './prompts';

describe('BEGINNER_SYSTEM_PROMPT', () => {
  it('should mention learning what they want to build', () => {
    expect(BEGINNER_SYSTEM_PROMPT).toContain('What & Why');
    expect(BEGINNER_SYSTEM_PROMPT).toContain('Core Features');
    expect(BEGINNER_SYSTEM_PROMPT).toContain('Platform');
  });

  it('should instruct making decisions for the user', () => {
    expect(BEGINNER_SYSTEM_PROMPT).toContain('Make technical decisions FOR them');
  });

  it('should include the READY_TO_GENERATE marker', () => {
    expect(BEGINNER_SYSTEM_PROMPT).toContain('[READY_TO_GENERATE]');
  });

  it('should never recommend external tools', () => {
    expect(BEGINNER_SYSTEM_PROMPT).toContain('NEVER recommend external tools');
  });
});

describe('EXPERT_SYSTEM_PROMPT', () => {
  it('should be direct and minimal', () => {
    expect(EXPERT_SYSTEM_PROMPT).toContain('experienced');
    expect(EXPERT_SYSTEM_PROMPT).toContain('skip explanations');
  });

  it('should allow 1-2 clarifications at most', () => {
    expect(EXPERT_SYSTEM_PROMPT).toContain('1-2 clarifications');
  });

  it('should include the READY_TO_GENERATE marker', () => {
    expect(EXPERT_SYSTEM_PROMPT).toContain('[READY_TO_GENERATE]');
  });

  it('should not suggest alternatives unless asked', () => {
    expect(EXPERT_SYSTEM_PROMPT).toContain("Don't suggest alternatives unless they ask");
  });
});

describe('getInterviewPrompt', () => {
  it('should return beginner prompt for beginner level', () => {
    expect(getInterviewPrompt('beginner')).toBe(BEGINNER_SYSTEM_PROMPT);
  });

  it('should return expert prompt for expert level', () => {
    expect(getInterviewPrompt('expert')).toBe(EXPERT_SYSTEM_PROMPT);
  });
});
