import {
  getApiKey,
  getAutotunezKey,
  getAutotunezKeySource,
} from '../config.js';
import { ApiClient } from '../api-client.js';
import {
  checkClaudeCodeInstalled,
  checkClaudeCodeAuth,
  runClaudeLogin,
} from '../executor.js';
import { getVibesafuStatus, setupVibesafu } from '../vibesafu.js';

export interface CreditInfo {
  balance: number;
  usedToday: number;
}

// --- autotunez API key ---

export async function checkAutotunezKey(
  opts: { skipPrompt?: boolean } = {}
): Promise<{ key: string; source: string } | null> {
  const key = getAutotunezKey();
  const source = getAutotunezKeySource();

  if (key) {
    return { key, source: source || 'config' };
  }

  if (opts.skipPrompt) {
    return null;
  }

  // Interactive prompt is handled by the caller (start.ts)
  return null;
}

// --- Credit info ---

export async function fetchCreditInfo(autotunezKey: string): Promise<CreditInfo | null> {
  const apiClient = new ApiClient({ autotunezKey });
  try {
    const usage = await apiClient.getUsage();
    return {
      balance: (usage.totalCredits - usage.usedCredits) * 0.001,
      usedToday: usage.usedCredits * 0.001,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid API key')) {
      throw error;
    }
    return null;
  }
}

export async function refreshCredits(autotunezKey: string): Promise<CreditInfo | null> {
  try {
    return await fetchCreditInfo(autotunezKey);
  } catch {
    return null;
  }
}

// --- Claude Code prerequisites ---

export async function checkClaudeCodePrerequisites(): Promise<{
  installed: boolean;
  version?: string;
}> {
  const result = await checkClaudeCodeInstalled();
  return {
    installed: result.installed,
    version: result.version,
  };
}

// --- Vibesafu ---

export function checkVibesafuSecurity(): { active: boolean; version?: string } {
  const status = getVibesafuStatus();
  return {
    active: !!(status.cliInstalled && status.hookInstalled),
    version: status.version,
  };
}

export function installVibesafu(): { success: boolean; error?: string } {
  return setupVibesafu();
}

// --- BYOK ---

export function checkBYOK(): { mode: 'byok' | 'managed'; anthropicKey?: string } {
  const byokKey = getApiKey();
  if (byokKey) {
    return { mode: 'byok', anthropicKey: byokKey };
  }
  return { mode: 'managed' };
}

// --- Auth flow (managed mode) ---

export async function ensureClaudeCodeAuth(): Promise<boolean> {
  let authCheck = await checkClaudeCodeAuth();

  while (!authCheck.authenticated) {
    const loginResult = await runClaudeLogin();
    if (loginResult.success) {
      return true;
    }
    authCheck = await checkClaudeCodeAuth();
  }

  return authCheck.authenticated;
}
