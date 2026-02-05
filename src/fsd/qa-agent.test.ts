import { describe, it, expect } from 'vitest';
import { generateQAPrompt, parseQAReport } from './qa-agent';
import { FSDMilestone } from '../types.js';

describe('QA Agent', () => {
  describe('generateQAPrompt', () => {
    const milestone: FSDMilestone = {
      id: 'm1',
      title: 'Login Feature',
      description: 'Implement user authentication',
      estimatedPrompts: 5,
      dependencies: [],
      qaGoal: 'Test login with valid/invalid credentials, empty fields, special chars',
      status: 'in_progress',
    };

    it('should generate autonomous QA prompt with milestone info', () => {
      const prompt = generateQAPrompt(milestone);

      expect(prompt).toContain('Login Feature');
      expect(prompt).toContain('Implement user authentication');
      expect(prompt).toContain('qa-report.md');
    });

    it('should include qaGoal in prompt', () => {
      const prompt = generateQAPrompt(milestone);

      expect(prompt).toContain('valid/invalid credentials');
      expect(prompt).toContain('empty fields');
    });

    it('should tell agent it has full access to tools', () => {
      const prompt = generateQAPrompt(milestone);

      expect(prompt).toContain('bash');
      expect(prompt).toContain('filesystem');
      expect(prompt).toContain('network');
      expect(prompt).toContain('Install any tools');
    });

    it('should encourage exploratory testing approach', () => {
      const prompt = generateQAPrompt(milestone);

      expect(prompt).toContain('Figure out how to verify');
      expect(prompt).toContain('REAL USER');
      expect(prompt).toContain('Try to break it');
      expect(prompt).toContain('edge cases');
    });

    it('should request structured report format', () => {
      const prompt = generateQAPrompt(milestone);

      expect(prompt).toContain('# QA Report');
      expect(prompt).toContain('## Result: PASS | FAIL');
      expect(prompt).toContain('## Issues Found');
      expect(prompt).toContain('[severity: critical|major|minor]');
    });
  });

  describe('parseQAReport', () => {
    it('should parse PASS result', () => {
      const markdown = `# QA Report: Login

## Result: PASS

## How I Tested
- Used curl to test API endpoints
- Started dev server and tested UI

## What I Tested
- Login with valid credentials
- Login with invalid credentials
- Empty form submission

## Issues Found
- No issues found

## Console Errors
- None

## Network Failures
- None

## Recommendations
- Add rate limiting for login attempts
`;

      const result = parseQAReport(markdown);

      expect(result.status).toBe('PASS');
      expect(result.summary.totalFlows).toBe(2); // From "How I Tested" section
      expect(result.testApproach).toContain('Used curl to test API endpoints');
      expect(result.issues).toHaveLength(0);
      expect(result.recommendations).toContain('Add rate limiting for login attempts');
    });

    it('should parse FAIL result with issues', () => {
      const markdown = `# QA Report: Login

## Result: FAIL

## How I Tested
- Login flow
- Error handling

## Issues Found
- [critical] Login fails silently when server returns 500
  - Evidence: No error message shown to user
- [major] Password field accepts empty value
  - Evidence: Form submits without validation

## Console Errors
- TypeError: Cannot read property 'user' of undefined

## Network Failures
- POST /api/login returned 500

## Recommendations
- Add error boundary
- Add client-side validation
`;

      const result = parseQAReport(markdown);

      expect(result.status).toBe('FAIL');
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].severity).toBe('critical');
      expect(result.issues[0].description).toContain('Login fails silently');
      expect(result.issues[1].severity).toBe('major');
      expect(result.consoleErrors).toContain("TypeError: Cannot read property 'user' of undefined");
      expect(result.networkFailures).toContain('POST /api/login returned 500');
    });

    it('should set FAIL status for critical issues', () => {
      const markdown = `# QA Report: Test

## Result: PASS

## How I Tested
- Test

## Issues Found
- [critical] Critical bug found

## Console Errors
- None
`;

      const result = parseQAReport(markdown);

      // Should be FAIL because of critical issue, even if marked PASS
      expect(result.status).toBe('FAIL');
    });

    it('should handle empty sections', () => {
      const markdown = `# QA Report: Minimal

## Result: PASS

## How I Tested

## Issues Found

## Console Errors

## Network Failures

## Recommendations
`;

      const result = parseQAReport(markdown);

      expect(result.status).toBe('PASS');
      expect(result.testApproach).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.consoleErrors).toEqual([]);
    });
  });
});
