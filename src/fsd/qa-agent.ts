import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { FSDMilestone, FSDQAResult, FSDQAIssue } from '../types.js';

/**
 * Generate QA prompt for autonomous verification.
 *
 * Key principle: Don't tell Claude Code HOW to test - just give the goal
 * and let it figure out the appropriate tools and approach.
 *
 * Claude Code already has access to: bash, filesystem, network, etc.
 * It can install playwright, curl, jq, or whatever it needs.
 */
export function generateQAPrompt(milestone: FSDMilestone): string {
  return `You are a QA engineer verifying a completed milestone.

## What was built
${milestone.title}

${milestone.description}

## Verification goal
${milestone.qaGoal}

## Your job
Figure out how to verify this goal is achieved. Think like a REAL USER.

You have FULL access to:
- bash (run any command)
- filesystem (read/write/check files)
- network (curl, fetch, etc.)
- Install any tools you need (playwright, puppeteer, jq, etc.)

## Testing approach
1. First, understand what was built
2. Figure out HOW to verify it works
3. Try normal use cases
4. Try edge cases and weird inputs
5. Try to break it

## CRITICAL
- Don't just check if code exists - actually RUN and TEST it
- Think: "What would a confused user do?"
- Try unexpected inputs: empty, very long, special characters
- Look for error messages, crashes, silent failures

## Output
Create qa-report.md with this structure:

\`\`\`markdown
# QA Report: ${milestone.title}

## Result: PASS | FAIL

## How I Tested
- [Describe your testing approach - what tools/commands you used]

## What I Tested
- [List each test scenario]

## Issues Found
- [severity: critical|major|minor] Description
  - Evidence: What you observed
  - Steps to reproduce

## Console/Error Output
- [Any errors or warnings observed]

## Recommendations
- [Suggestions for improvement]
\`\`\`
`;
}

/**
 * Parse QA report markdown into structured result
 */
export function parseQAReport(markdown: string): FSDQAResult {
  const result: FSDQAResult = {
    status: 'PASS',
    summary: { totalFlows: 0, passed: 0, failed: 0 },
    testApproach: [],
    issues: [],
    consoleErrors: [],
    networkFailures: [],
    recommendations: [],
  };

  // Check for FAIL status
  if (markdown.includes('## Result: FAIL') || markdown.includes('Result: FAIL')) {
    result.status = 'FAIL';
  }

  // Extract "How I Tested" or "What I Tested" section
  const howTestedMatch = markdown.match(/## How I Tested\n([\s\S]*?)(?=\n##|$)/);
  const whatTestedMatch = markdown.match(/## What I Tested\n([\s\S]*?)(?=\n##|$)/);

  const testedContent = howTestedMatch?.[1] || whatTestedMatch?.[1] || '';
  if (testedContent) {
    const lines = testedContent.split('\n').filter(l => l.trim().startsWith('-'));
    result.testApproach = lines.map(l => l.replace(/^-\s*/, '').trim());
    result.summary.totalFlows = result.testApproach.length;
  }

  // Extract issues
  const issuesMatch = markdown.match(/## Issues Found\n([\s\S]*?)(?=\n##|$)/);
  if (issuesMatch) {
    const issueRegex = /-\s*\[(critical|major|minor)\]\s*(.+)/gi;
    let match;
    while ((match = issueRegex.exec(issuesMatch[1])) !== null) {
      const severity = match[1].toLowerCase() as FSDQAIssue['severity'];
      const description = match[2].trim();

      const evidenceMatch = issuesMatch[1].slice(match.index).match(/Evidence:\s*(.+)/i);
      const evidence = evidenceMatch?.[1]?.trim();

      if (description && !description.toLowerCase().includes('no issues')) {
        result.issues.push({ severity, description, evidence });
        result.summary.failed++;
      }
    }
  }

  // Extract console/error output
  const consoleMatch = markdown.match(/## Console.*(?:Errors?|Output)\n([\s\S]*?)(?=\n##|$)/i);
  if (consoleMatch) {
    const lines = consoleMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
    result.consoleErrors = lines.map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  }

  // Extract network failures (if present)
  const networkMatch = markdown.match(/## Network Failures\n([\s\S]*?)(?=\n##|$)/);
  if (networkMatch) {
    const lines = networkMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
    result.networkFailures = lines.map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  }

  // Extract recommendations
  const recsMatch = markdown.match(/## Recommendations\n([\s\S]*?)(?=\n##|$)/);
  if (recsMatch) {
    const lines = recsMatch[1].split('\n').filter(l => l.trim().startsWith('-'));
    result.recommendations = lines.map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  }

  // Calculate passed
  result.summary.passed = result.summary.totalFlows - result.summary.failed;
  if (result.summary.passed < 0) result.summary.passed = 0;

  // Set status based on issues
  if (result.issues.some((i: FSDQAIssue) => i.severity === 'critical')) {
    result.status = 'FAIL';
  }

  return result;
}

/**
 * Spawn QA Agent as Claude Code subprocess.
 *
 * The agent autonomously decides how to verify the milestone.
 * No hardcoded project type detection - Claude Code figures it out.
 */
export async function spawnQAAgent(
  milestone: FSDMilestone,
  projectPath: string,
  onLog: (message: string) => void
): Promise<FSDQAResult> {
  const qaPrompt = generateQAPrompt(milestone);

  onLog('Spawning QA Agent...');

  return new Promise((resolve) => {
    const qaProcess = spawn('claude', ['--print', '-p', qaPrompt], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let output = '';

    qaProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      onLog(chunk);
    });

    qaProcess.stderr.on('data', (data) => {
      onLog(data.toString());
    });

    qaProcess.on('close', async (code) => {
      onLog(`QA Agent finished with code ${code}`);

      // Try to read qa-report.md
      try {
        const { readFile } = await import('fs/promises');
        const reportPath = join(projectPath, 'qa-report.md');
        const reportContent = await readFile(reportPath, 'utf-8');
        const result = parseQAReport(reportContent);
        resolve(result);
      } catch {
        // No report file, try to parse from output
        if (output.includes('# QA Report')) {
          const result = parseQAReport(output);
          resolve(result);
        } else {
          // Return empty result
          resolve({
            status: code === 0 ? 'PASS' : 'FAIL',
            summary: { totalFlows: 0, passed: 0, failed: 0 },
            testApproach: [],
            issues: [],
            consoleErrors: [],
            networkFailures: [],
            recommendations: [],
          });
        }
      }
    });

    qaProcess.on('error', (err) => {
      onLog(`QA Agent error: ${err.message}`);
      resolve({
        status: 'FAIL',
        summary: { totalFlows: 0, passed: 0, failed: 0 },
        testApproach: [],
        issues: [{ severity: 'critical', description: `QA Agent failed: ${err.message}` }],
        consoleErrors: [],
        networkFailures: [],
        recommendations: [],
      });
    });
  });
}

/**
 * Save QA report to file
 */
export async function saveQAReport(
  result: FSDQAResult,
  milestone: FSDMilestone,
  projectPath: string
): Promise<string> {
  const reportDir = join(projectPath, '.claude');
  await mkdir(reportDir, { recursive: true });

  const reportPath = join(reportDir, `qa-report-${milestone.id}.md`);

  const markdown = `# QA Report: ${milestone.title}

## Result: ${result.status}

## Summary
- Total Flows Tested: ${result.summary.totalFlows}
- Passed: ${result.summary.passed}
- Failed: ${result.summary.failed}

## What Was Tested
${result.testApproach.map((t: string) => `- ${t}`).join('\n') || '- No test scenarios recorded'}

## Issues Found
${result.issues.length > 0
    ? result.issues.map((i: FSDQAIssue) => `- [${i.severity}] ${i.description}${i.evidence ? `\n  - Evidence: ${i.evidence}` : ''}`).join('\n')
    : '- No issues found'}

## Console Errors
${result.consoleErrors.length > 0
    ? result.consoleErrors.map((e: string) => `- ${e}`).join('\n')
    : '- None'}

## Network Failures
${result.networkFailures.length > 0
    ? result.networkFailures.map((f: string) => `- ${f}`).join('\n')
    : '- None'}

## Recommendations
${result.recommendations.length > 0
    ? result.recommendations.map((r: string) => `- ${r}`).join('\n')
    : '- None'}
`;

  await writeFile(reportPath, markdown, 'utf-8');
  return reportPath;
}
