import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FSDMilestone } from '../types.js';

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockExecute, mockReadFile, mockGetApiKey } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockReadFile: vi.fn(),
  mockGetApiKey: vi.fn(),
}));

vi.mock('../core/agent-executor.js', () => ({
  execute: mockExecute,
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    readFile: mockReadFile,
  };
});

vi.mock('../config.js', () => ({
  getApiKey: mockGetApiKey,
}));

import { generateQAPrompt, parseQAReport, spawnQAAgent } from './qa-agent';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSuccessResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    output: 'QA checks completed.',
    sessionId: 'sess-qa',
    cost: { totalCostUsd: 0.03, inputTokens: 300, outputTokens: 200, modelUsage: {} },
    numTurns: 2,
    durationMs: 800,
    ...overrides,
  };
}

const sampleMilestone: FSDMilestone = {
  id: 'm1',
  title: 'Login Feature',
  description: 'Implement user authentication',
  dependencies: [],
  qaGoal: 'Test login with valid/invalid credentials, empty fields, special chars',
  status: 'in_progress',
};

const sampleQAReport = `# QA Report: Login Feature

## Result: PASS

## How I Tested
- Used curl to test API endpoints
- Started dev server and tested UI

## Issues Found
- No issues found

## Console Errors
- None

## Recommendations
- Add rate limiting
`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('QA Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Pure function tests (existing) ──────────────────────────────────────

  describe('generateQAPrompt', () => {
    it('should generate autonomous QA prompt with milestone info', () => {
      const prompt = generateQAPrompt(sampleMilestone);

      expect(prompt).toContain('Login Feature');
      expect(prompt).toContain('Implement user authentication');
      expect(prompt).toContain('qa-report.md');
    });

    it('should include qaGoal in prompt', () => {
      const prompt = generateQAPrompt(sampleMilestone);

      expect(prompt).toContain('valid/invalid credentials');
      expect(prompt).toContain('empty fields');
    });

    it('should tell agent it has full access to tools', () => {
      const prompt = generateQAPrompt(sampleMilestone);

      expect(prompt).toContain('bash');
      expect(prompt).toContain('filesystem');
      expect(prompt).toContain('network');
      expect(prompt).toContain('Install any tools');
    });

    it('should encourage exploratory testing approach', () => {
      const prompt = generateQAPrompt(sampleMilestone);

      expect(prompt).toContain('Figure out how to verify');
      expect(prompt).toContain('REAL USER');
      expect(prompt).toContain('Try to break it');
      expect(prompt).toContain('edge cases');
    });

    it('should request structured report format', () => {
      const prompt = generateQAPrompt(sampleMilestone);

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

  // ── spawnQAAgent (SDK delegation) ───────────────────────────────────────

  describe('spawnQAAgent', () => {
    it('should call execute() with QA prompt and project path', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());
      mockReadFile.mockResolvedValue(sampleQAReport);
      const onLog = vi.fn();

      await spawnQAAgent(sampleMilestone, '/project', onLog);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('Login Feature'),
        expect.objectContaining({ cwd: '/project' }),
      );
    });

    it('should read qa-report.md from project path', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());
      mockReadFile.mockResolvedValue(sampleQAReport);
      const onLog = vi.fn();

      const result = await spawnQAAgent(sampleMilestone, '/project', onLog);

      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('qa-report.md'),
        'utf-8',
      );
      expect(result.qaResult.status).toBe('PASS');
      expect(result.costUsd).toBeGreaterThanOrEqual(0);
    });

    it('should fall back to output parsing when qa-report.md not found', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult({
        output: `# QA Report: Login Feature\n\n## Result: FAIL\n\n## How I Tested\n- Manual test\n\n## Issues Found\n- [critical] Broken login\n\n## Console Errors\n- None\n`,
      }));
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const onLog = vi.fn();

      const result = await spawnQAAgent(sampleMilestone, '/project', onLog);

      expect(result.qaResult.status).toBe('FAIL');
    });

    it('should return FAIL result when execution fails and no report available', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult({ success: false, output: 'Error occurred' }));
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const onLog = vi.fn();

      const result = await spawnQAAgent(sampleMilestone, '/project', onLog);

      // No qa-report.md, output doesn't contain QA Report, success=false → FAIL
      expect(result.qaResult.status).toBe('FAIL');
    });

    it('should forward stream events to onLog', async () => {
      mockExecute.mockImplementation(async (_prompt: string, opts: { onStreamEvent?: (e: { type: string; content: string }) => void }) => {
        opts.onStreamEvent?.({ type: 'text', content: 'Testing login...' });
        return makeSuccessResult();
      });
      mockReadFile.mockResolvedValue(sampleQAReport);
      const onLog = vi.fn();

      await spawnQAAgent(sampleMilestone, '/project', onLog);

      expect(onLog).toHaveBeenCalledWith('Testing login...');
    });

    it('should log start and finish messages', async () => {
      mockExecute.mockResolvedValue(makeSuccessResult());
      mockReadFile.mockResolvedValue(sampleQAReport);
      const onLog = vi.fn();

      await spawnQAAgent(sampleMilestone, '/project', onLog);

      expect(onLog).toHaveBeenCalledWith('Spawning QA Agent...');
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('QA Agent finished'));
    });

    it('should inject BYOK API key as env when available', async () => {
      mockGetApiKey.mockReturnValue('sk-ant-byok-qa-key');
      mockExecute.mockResolvedValue(makeSuccessResult());
      mockReadFile.mockResolvedValue(sampleQAReport);
      const onLog = vi.fn();

      await spawnQAAgent(sampleMilestone, '/project', onLog);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          env: { ANTHROPIC_API_KEY: 'sk-ant-byok-qa-key' },
        }),
      );
    });

    it('should not set env when no BYOK key', async () => {
      mockGetApiKey.mockReturnValue(undefined);
      mockExecute.mockResolvedValue(makeSuccessResult());
      mockReadFile.mockResolvedValue(sampleQAReport);
      const onLog = vi.fn();

      await spawnQAAgent(sampleMilestone, '/project', onLog);

      const callArgs = mockExecute.mock.calls[0][1];
      expect(callArgs.env).toBeUndefined();
    });
  });
});
