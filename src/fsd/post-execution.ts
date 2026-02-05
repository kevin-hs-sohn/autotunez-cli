/**
 * Post-Execution Detection Module
 *
 * Detects file system changes after Claude Code execution.
 * Used in FSD mode to warn about sensitive file modifications.
 *
 * Note: Pre-execution security is handled by vibesafe.
 * Install with: npm install -g vibesafe && vibesafe install
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface PostExecutionCheck {
  modifiedFiles: string[];
  newFiles: string[];
  deletedFiles: string[];
  envModified: boolean;
  claudeMdModified: boolean;
  sensitiveFilesAccessed: string[];
}

export interface FileSnapshot {
  files: Map<string, string>; // path -> hash
  timestamp: number;
}

// ============================================================================
// File Snapshot Functions
// ============================================================================

/**
 * Take a snapshot of file hashes in the project directory
 */
export async function takeFileSnapshot(projectPath: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  const walkDir = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules, .git, and other large directories
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache'].includes(entry.name)) {
            walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(fullPath);
            const hash = crypto.createHash('md5').update(content).digest('hex');
            snapshot.set(fullPath, hash);
          } catch {
            // File might be locked or inaccessible
          }
        }
      }
    } catch {
      // Directory might not exist or be inaccessible
    }
  };

  walkDir(projectPath);
  return snapshot;
}

// ============================================================================
// Post-Execution Analysis
// ============================================================================

const SENSITIVE_PATTERNS = ['.env', '.ssh', '.aws', 'credentials', 'secret', 'token', 'password'];

/**
 * Analyze file changes after execution
 */
export function analyzePostExecution(
  beforeFiles: Map<string, string>,
  afterFiles: Map<string, string>
): PostExecutionCheck {
  const modifiedFiles: string[] = [];
  const newFiles: string[] = [];
  const deletedFiles: string[] = [];
  const sensitiveFilesAccessed: string[] = [];

  // Check for modified/deleted files
  for (const [filePath, hash] of beforeFiles) {
    const afterHash = afterFiles.get(filePath);
    if (!afterHash) {
      deletedFiles.push(filePath);
    } else if (afterHash !== hash) {
      modifiedFiles.push(filePath);
    }

    if (SENSITIVE_PATTERNS.some(p => filePath.toLowerCase().includes(p))) {
      sensitiveFilesAccessed.push(filePath);
    }
  }

  // Check for new files
  for (const filePath of afterFiles.keys()) {
    if (!beforeFiles.has(filePath)) {
      newFiles.push(filePath);

      if (SENSITIVE_PATTERNS.some(p => filePath.toLowerCase().includes(p))) {
        sensitiveFilesAccessed.push(filePath);
      }
    }
  }

  return {
    modifiedFiles,
    newFiles,
    deletedFiles,
    envModified: [...modifiedFiles, ...newFiles].some(f => f.includes('.env')),
    claudeMdModified: modifiedFiles.some(f => f.includes('CLAUDE.md')),
    sensitiveFilesAccessed,
  };
}

/**
 * Format post-execution warnings for display
 */
export function formatPostExecutionWarnings(check: PostExecutionCheck): string[] {
  const warnings: string[] = [];

  if (check.envModified) {
    warnings.push('⚠️  Environment files were modified (.env)');
  }

  if (check.claudeMdModified) {
    warnings.push('⚠️  CLAUDE.md was modified - please review changes');
  }

  if (check.sensitiveFilesAccessed.length > 0) {
    warnings.push(`⚠️  Sensitive files accessed: ${check.sensitiveFilesAccessed.slice(0, 3).join(', ')}`);
  }

  if (check.deletedFiles.length > 0) {
    warnings.push(`⚠️  Files deleted: ${check.deletedFiles.slice(0, 5).join(', ')}`);
  }

  return warnings;
}
