import * as path from 'path';
import * as readline from 'readline';

/**
 * FSD Safety Module
 *
 * Rule-based security checks (not LLM-dependent):
 * - File system scope protection
 * - Dangerous command detection
 */

// Dangerous command patterns that require user approval
const DANGEROUS_PATTERNS = [
  // Remote code execution
  /curl\s+[^|]*\|\s*(bash|sh|zsh)/i,
  /wget\s+[^|]*\|\s*(bash|sh|zsh)/i,
  /curl\s+.*-o\s*-\s*\|/i,

  // Destructive file operations
  /rm\s+-rf?\s+[\/~]/i,
  /rm\s+-rf?\s+\.\./i,
  /rmdir\s+[\/~]/i,
  /find\s+.*-delete/i,
  /find\s+.*-exec\s+rm/i,

  // Privilege escalation
  /sudo\s+/i,
  /chmod\s+777/i,
  /chown\s+-R/i,

  // Sensitive file access
  /cat\s+.*\/(\.ssh|\.aws|\.env)/i,
  /cp\s+.*\/(\.ssh|\.aws|\.env)/i,

  // Network exfiltration
  /curl\s+.*-d\s+.*@/i,  // curl with file upload
  /nc\s+-e/i,            // netcat reverse shell
  /bash\s+-i\s+>&/i,     // bash reverse shell

  // Git dangerous operations
  /git\s+push\s+.*--force/i,
  /git\s+push\s+-f/i,
  /git\s+reset\s+--hard/i,

  // Database destruction
  /drop\s+database/i,
  /drop\s+table/i,
  /truncate\s+table/i,
];

// Paths that should never be accessed
const FORBIDDEN_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.gnupg',
  '~/.config/gh',
  '/etc/passwd',
  '/etc/shadow',
];

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
  requiresApproval?: boolean;
}

/**
 * Check if a path is within the project root
 */
export function isPathWithinProject(filePath: string, projectRoot: string): boolean {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);

  const normalizedPath = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(projectRoot);

  return normalizedPath.startsWith(normalizedRoot);
}

/**
 * Check if a path is in the forbidden list
 */
export function isForbiddenPath(filePath: string): boolean {
  const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
  const normalizedPath = path.normalize(expandedPath);

  for (const forbidden of FORBIDDEN_PATHS) {
    const expandedForbidden = forbidden.replace(/^~/, process.env.HOME || '');
    if (normalizedPath.startsWith(expandedForbidden)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a command contains dangerous patterns
 */
export function isDangerousCommand(command: string): { dangerous: boolean; pattern?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { dangerous: true, pattern: pattern.source };
    }
  }
  return { dangerous: false };
}

/**
 * Extract file paths from a command or text
 */
export function extractPaths(text: string): string[] {
  const pathPatterns = [
    /(?:^|\s)(\/[^\s"']+)/g,           // Absolute paths
    /(?:^|\s)(~\/[^\s"']+)/g,          // Home-relative paths
    /(?:^|\s)(\.\.\/[^\s"']+)/g,       // Parent-relative paths
    /"([^"]+\.[a-z]+)"/gi,             // Quoted paths with extension
    /'([^']+\.[a-z]+)'/gi,             // Single-quoted paths
  ];

  const paths: string[] = [];
  for (const pattern of pathPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      paths.push(match[1]);
    }
  }

  return [...new Set(paths)];
}

/**
 * Analyze text/command for safety issues
 */
export function analyzeSafety(
  text: string,
  projectRoot: string
): SafetyCheckResult {
  // Check for dangerous commands
  const dangerCheck = isDangerousCommand(text);
  if (dangerCheck.dangerous) {
    return {
      safe: false,
      reason: `Dangerous command pattern detected: ${dangerCheck.pattern}`,
      requiresApproval: true,
    };
  }

  // Check for paths outside project
  const paths = extractPaths(text);
  for (const p of paths) {
    if (isForbiddenPath(p)) {
      return {
        safe: false,
        reason: `Access to sensitive path: ${p}`,
        requiresApproval: true,
      };
    }

    if (!isPathWithinProject(p, projectRoot) && !p.startsWith('/tmp')) {
      return {
        safe: false,
        reason: `Path outside project root: ${p}`,
        requiresApproval: true,
      };
    }
  }

  return { safe: true };
}

/**
 * Ask user for approval (blocking)
 */
export async function askUserApproval(
  message: string,
  details?: string
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\n⚠️  SAFETY WARNING');
    console.log('─'.repeat(50));
    console.log(message);
    if (details) {
      console.log('\nDetails:');
      console.log(details);
    }
    console.log('─'.repeat(50));

    rl.question('Allow this action? (y/N): ', (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

/**
 * Get safety rules to inject into prompts
 */
export function getSafetyRules(projectRoot: string): string {
  return `
## SAFETY RULES (MANDATORY)

Project root: ${projectRoot}

FILE SYSTEM RESTRICTIONS:
- You may ONLY access files within the project root
- Access to ~/.ssh, ~/.aws, ~/.gnupg, /etc is FORBIDDEN
- Parent directory traversal (../) outside project is FORBIDDEN
- If you need to access files outside project, STOP and ask the user

COMMAND RESTRICTIONS:
The following commands require EXPLICIT user approval:
- curl/wget piped to bash/sh (remote code execution)
- rm -rf with absolute paths or ..
- sudo anything
- git push --force, git reset --hard
- Any command that could delete/modify system files

If you need to run a restricted command, explain WHY and ask permission first.

NETWORK RESTRICTIONS:
- Do not send files to external URLs
- Do not download and execute scripts from the internet
- If you need to fetch external resources, describe what and why
`;
}
