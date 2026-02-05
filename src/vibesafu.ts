/**
 * Vibesafu Integration Module
 *
 * Checks and installs vibesafu for pre-execution security.
 * Vibesafu provides a PreToolUse hook that blocks dangerous commands
 * before Claude Code executes them.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface VibesafuStatus {
  cliInstalled: boolean;
  hookInstalled: boolean;
  version?: string;
}

// ============================================================================
// Check Functions
// ============================================================================

/**
 * Check if vibesafu CLI is installed (directly or via npx)
 */
export function isVibesafuCLIInstalled(): { installed: boolean; version?: string } {
  // First, try direct command
  try {
    const result = spawnSync('vibesafu', [], {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // ENOENT error means command not found
    if (!(result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT')) {
      // Command exists if we got any output (stdout or stderr)
      if (result.stdout || result.stderr) {
        return { installed: true };
      }
    }
  } catch {
    // Fall through to npx check
  }

  // If direct command not found, try npx (for npx-only installations)
  try {
    const npxResult = spawnSync('npx', ['vibesafu'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    // npx vibesafu shows usage on stderr (not stdout)
    const output = npxResult.stdout || npxResult.stderr || '';
    if (output.includes('vibesafu') || output.includes('VibeSafu')) {
      return { installed: true };
    }
  } catch {
    // npx also failed
  }

  return { installed: false };
}

/**
 * Check if vibesafu hook is installed in Claude Code settings
 */
export function isVibesafuHookInstalled(): boolean {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const hooks = settings.hooks;

    if (!hooks || typeof hooks !== 'object') {
      return false;
    }

    // hooks structure: { "PermissionRequest": [...], "PreToolUse": [...], ... }
    // Check all hook types for vibesafu
    for (const hookType of Object.values(hooks)) {
      if (!Array.isArray(hookType)) continue;

      for (const hookConfig of hookType) {
        const innerHooks = (hookConfig as { hooks?: Array<{ command?: string }> }).hooks;
        if (innerHooks) {
          if (innerHooks.some((h) => h.command?.includes('vibesafu'))) {
            return true;
          }
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get full vibesafu status
 */
export function getVibesafuStatus(): VibesafuStatus {
  const cli = isVibesafuCLIInstalled();
  return {
    cliInstalled: cli.installed,
    hookInstalled: isVibesafuHookInstalled(),
    version: cli.version,
  };
}

// ============================================================================
// Install Functions
// ============================================================================

/**
 * Install vibesafu CLI globally
 */
export function installVibesafuCLI(): { success: boolean; error?: string } {
  try {
    const result = spawnSync('npm', ['install', '-g', 'vibesafu'], {
      encoding: 'utf-8',
      timeout: 60000, // 1 minute timeout
      stdio: 'pipe',
    });

    if (result.status === 0) {
      return { success: true };
    }

    return {
      success: false,
      error: result.stderr || 'Failed to install vibesafu',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Install vibesafu hook into Claude Code
 */
export function installVibesafuHook(): { success: boolean; error?: string } {
  try {
    const result = spawnSync('vibesafu', ['install'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    });

    if (result.status === 0) {
      return { success: true };
    }

    return {
      success: false,
      error: result.stderr || 'Failed to install vibesafu hook',
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Full vibesafu setup (install CLI if needed, then install hook)
 */
export function setupVibesafu(): { success: boolean; error?: string } {
  // Check CLI
  if (!isVibesafuCLIInstalled().installed) {
    const cliResult = installVibesafuCLI();
    if (!cliResult.success) {
      return cliResult;
    }
  }

  // Install hook
  if (!isVibesafuHookInstalled()) {
    return installVibesafuHook();
  }

  return { success: true };
}
