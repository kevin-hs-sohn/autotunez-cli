import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist all mocks
const {
  mockGetAutotunezKey,
  mockGetAutotunezKeySource,
  mockSetAutotunezKey,
  mockValidateAutotunezKey,
  mockGetApiKey,
  mockApiClientInstance,
  mockCheckClaudeCodeInstalled,
  mockCheckClaudeCodeAuth,
  mockRunClaudeLogin,
  mockGetVibesafuStatus,
  mockSetupVibesafu,
} = vi.hoisted(() => ({
  mockGetAutotunezKey: vi.fn(),
  mockGetAutotunezKeySource: vi.fn(),
  mockSetAutotunezKey: vi.fn(),
  mockValidateAutotunezKey: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockApiClientInstance: { getUsage: vi.fn() },
  mockCheckClaudeCodeInstalled: vi.fn(),
  mockCheckClaudeCodeAuth: vi.fn(),
  mockRunClaudeLogin: vi.fn(),
  mockGetVibesafuStatus: vi.fn(),
  mockSetupVibesafu: vi.fn(),
}));

vi.mock('../config.js', () => ({
  getAutotunezKey: mockGetAutotunezKey,
  getAutotunezKeySource: mockGetAutotunezKeySource,
  setAutotunezKey: mockSetAutotunezKey,
  validateAutotunezKey: mockValidateAutotunezKey,
  getApiKey: mockGetApiKey,
}));

vi.mock('../api-client.js', () => {
  return {
    ApiClient: class {
      getUsage = mockApiClientInstance.getUsage;
    },
  };
});

vi.mock('../executor.js', () => ({
  checkClaudeCodeInstalled: mockCheckClaudeCodeInstalled,
  checkClaudeCodeAuth: mockCheckClaudeCodeAuth,
  runClaudeLogin: mockRunClaudeLogin,
}));

vi.mock('../vibesafu.js', () => ({
  getVibesafuStatus: mockGetVibesafuStatus,
  setupVibesafu: mockSetupVibesafu,
}));

import {
  checkAutotunezKey,
  fetchCreditInfo,
  refreshCredits,
  checkClaudeCodePrerequisites,
  checkVibesafuSecurity,
  checkBYOK,
} from './startup-checks.js';

describe('startup-checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('checkAutotunezKey', () => {
    it('should return existing key when configured', async () => {
      mockGetAutotunezKey.mockReturnValue('atk_test123');
      mockGetAutotunezKeySource.mockReturnValue('config');

      const result = await checkAutotunezKey({ skipPrompt: true });
      expect(result).toEqual({ key: 'atk_test123', source: 'config' });
    });

    it('should return null when no key and skipPrompt', async () => {
      mockGetAutotunezKey.mockReturnValue(undefined);
      mockGetAutotunezKeySource.mockReturnValue(undefined);

      const result = await checkAutotunezKey({ skipPrompt: true });
      expect(result).toBeNull();
    });
  });

  describe('fetchCreditInfo', () => {
    it('should return credit info on success', async () => {
      mockApiClientInstance.getUsage.mockResolvedValue({
        totalCredits: 5000,
        usedCredits: 1000,
      });

      const result = await fetchCreditInfo('atk_test');
      expect(result).toEqual({ balance: 4, usedToday: 1 });
    });

    it('should return null on failure', async () => {
      mockApiClientInstance.getUsage.mockRejectedValue(new Error('network'));

      const result = await fetchCreditInfo('atk_test');
      expect(result).toBeNull();
    });

    it('should throw on invalid API key', async () => {
      mockApiClientInstance.getUsage.mockRejectedValue(new Error('Invalid API key'));

      await expect(fetchCreditInfo('atk_bad')).rejects.toThrow('Invalid API key');
    });
  });

  describe('refreshCredits', () => {
    it('should return refreshed credit info', async () => {
      mockApiClientInstance.getUsage.mockResolvedValue({
        totalCredits: 3000,
        usedCredits: 500,
      });

      const result = await refreshCredits('atk_test');
      expect(result).toEqual({ balance: 2.5, usedToday: 0.5 });
    });

    it('should return null on failure', async () => {
      mockApiClientInstance.getUsage.mockRejectedValue(new Error('timeout'));

      const result = await refreshCredits('atk_test');
      expect(result).toBeNull();
    });
  });

  describe('checkClaudeCodePrerequisites', () => {
    it('should return installed info when Claude Code is found', async () => {
      mockCheckClaudeCodeInstalled.mockResolvedValue({ installed: true, version: '1.0.0' });

      const result = await checkClaudeCodePrerequisites();
      expect(result).toEqual({ installed: true, version: '1.0.0' });
    });

    it('should return not installed when Claude Code is missing', async () => {
      mockCheckClaudeCodeInstalled.mockResolvedValue({ installed: false });

      const result = await checkClaudeCodePrerequisites();
      expect(result).toEqual({ installed: false, version: undefined });
    });
  });

  describe('checkVibesafuSecurity', () => {
    it('should return active when vibesafu is installed', () => {
      mockGetVibesafuStatus.mockReturnValue({
        cliInstalled: true,
        hookInstalled: true,
        version: '1.2.0',
      });

      const result = checkVibesafuSecurity();
      expect(result).toEqual({ active: true, version: '1.2.0' });
    });

    it('should return inactive when vibesafu is not installed', () => {
      mockGetVibesafuStatus.mockReturnValue({
        cliInstalled: false,
        hookInstalled: false,
      });

      const result = checkVibesafuSecurity();
      expect(result).toEqual({ active: false, version: undefined });
    });
  });

  describe('checkBYOK', () => {
    it('should return byok with key when API key exists (no side effect)', () => {
      mockGetApiKey.mockReturnValue('sk-ant-test');

      const result = checkBYOK();
      expect(result.mode).toBe('byok');
      expect(result.anthropicKey).toBe('sk-ant-test');
      // Should NOT mutate process.env (caller's responsibility)
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('should return managed when no API key', () => {
      mockGetApiKey.mockReturnValue(undefined);

      const result = checkBYOK();
      expect(result.mode).toBe('managed');
      expect(result.anthropicKey).toBeUndefined();
    });
  });
});
