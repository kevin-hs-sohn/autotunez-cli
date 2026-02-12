import * as path from 'path';
import * as readline from 'readline';

/**
 * FSD Safety Module
 *
 * Multi-layer security checks (not LLM-dependent):
 * 1. Shell string normalization (strips evasion tricks)
 * 2. Dangerous command pattern detection
 * 3. File system scope protection
 * 4. Forbidden path detection
 *
 * NOTE: This is defense-in-depth. E2B sandbox is the primary security boundary.
 * These checks catch accidental mistakes and obvious malicious patterns,
 * but determined attackers could bypass regex-based detection.
 */

/**
 * Normalize shell strings to defeat common evasion techniques:
 * - Remove empty quotes: cu""rl → curl
 * - Remove backslash-newline continuations
 * - Expand simple $'...' ANSI-C quoting
 * - Remove backtick wrapping
 * - Collapse whitespace
 */
export function normalizeShellString(input: string): string {
  let normalized = input;

  // Remove empty quotes: cu""rl → curl, cu''rl → curl
  normalized = normalized.replace(/""/g, '');
  normalized = normalized.replace(/''/g, '');

  // Remove backslash-newline (line continuation)
  normalized = normalized.replace(/\\\n/g, '');

  // Remove backslash before regular characters (e.g., \c\u\r\l → curl)
  // But preserve meaningful escapes like \n, \t, \\
  normalized = normalized.replace(/\\([^ntr\\])/g, '$1');

  // Collapse multiple spaces/tabs to single space
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// Dangerous command patterns that require user approval
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Remote code execution
  { pattern: /curl\s+[^|]*\|\s*(bash|sh|zsh)/i, label: 'curl piped to shell' },
  { pattern: /wget\s+[^|]*\|\s*(bash|sh|zsh)/i, label: 'wget piped to shell' },
  { pattern: /curl\s+.*-o\s*-\s*\|/i, label: 'curl output piped' },

  // Destructive file operations
  { pattern: /rm\s+-rf?\s+[\/~]/i, label: 'recursive delete with absolute path' },
  { pattern: /rm\s+-rf?\s+\.\./i, label: 'recursive delete with parent path' },
  { pattern: /rmdir\s+[\/~]/i, label: 'rmdir with absolute path' },
  { pattern: /find\s+.*-delete/i, label: 'find with -delete' },
  { pattern: /find\s+.*-exec\s+rm/i, label: 'find with exec rm' },

  // Privilege escalation
  { pattern: /sudo\s+/i, label: 'sudo usage' },
  { pattern: /chmod\s+777/i, label: 'chmod 777' },
  { pattern: /chown\s+-R/i, label: 'recursive chown' },

  // Sensitive file access
  { pattern: /cat\s+.*\/(\.ssh|\.aws|\.env)/i, label: 'reading sensitive file' },
  { pattern: /cp\s+.*\/(\.ssh|\.aws|\.env)/i, label: 'copying sensitive file' },

  // Network exfiltration
  { pattern: /curl\s+.*-d\s+.*@/i, label: 'curl with file upload' },
  { pattern: /nc\s+-e/i, label: 'netcat reverse shell' },
  { pattern: /bash\s+-i\s+>&/i, label: 'bash reverse shell' },

  // Git dangerous operations
  { pattern: /git\s+push\s+.*--force/i, label: 'git force push' },
  { pattern: /git\s+push\s+-f/i, label: 'git force push (-f)' },
  { pattern: /git\s+reset\s+--hard/i, label: 'git hard reset' },

  // Database destruction
  { pattern: /drop\s+database/i, label: 'DROP DATABASE' },
  { pattern: /drop\s+table/i, label: 'DROP TABLE' },
  { pattern: /truncate\s+table/i, label: 'TRUNCATE TABLE' },

  // Shell expansion / eval patterns that may hide commands
  { pattern: /\beval\s+/i, label: 'eval execution' },
  { pattern: /\bexec\s+\d*[<>]/i, label: 'exec redirection' },
  { pattern: /\$\(\s*echo\s.*\|\s*(bash|sh)\s*\)/i, label: 'echo-pipe-to-shell expansion' },
  { pattern: /base64\s+(--)?d(ecode)?\s*.*\|\s*(bash|sh)/i, label: 'base64 decode piped to shell' },
];

// Paths that should never be accessed
const FORBIDDEN_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.gnupg',
  '~/.config/gh',
  '~/.autotunez/config.json',
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
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
 * Check if a command contains dangerous patterns.
 * Applies normalization first to defeat basic evasion tricks.
 */
export function isDangerousCommand(command: string): { dangerous: boolean; pattern?: string } {
  // Normalize to defeat evasion tricks before pattern matching
  const normalized = normalizeShellString(command);

  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    // Check both original and normalized forms
    if (pattern.test(command) || pattern.test(normalized)) {
      return { dangerous: true, pattern: label };
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
  // Check for dangerous commands (includes normalization)
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
- eval, exec with redirection
- base64 decode piped to shell
- Any command that could delete/modify system files

If you need to run a restricted command, explain WHY and ask permission first.

NETWORK RESTRICTIONS:
- Do not send files to external URLs
- Do not download and execute scripts from the internet
- If you need to fetch external resources, describe what and why
`;
}
