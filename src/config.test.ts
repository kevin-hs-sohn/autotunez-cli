import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create temp dir before mock setup
const TEST_HOME = path.join(os.tmpdir(), `autotunez-test-${Date.now()}`);
const TEST_CONFIG_DIR = path.join(TEST_HOME, '.autotunez');
const TEST_CONFIG_FILE = path.join(TEST_CONFIG_DIR, 'config.json');

// Mock os.homedir — vi.hoisted ensures TEST_HOME is available
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => TEST_HOME,
  };
});

describe('config', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_CONFIG_DIR)) {
      fs.rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_HOME)) {
      fs.rmSync(TEST_HOME, { recursive: true });
    }
  });

  describe('loadConfig', () => {
    it('should return empty object when no config file exists', async () => {
      const { loadConfig } = await import('./config');
      const config = loadConfig();
      expect(config).toEqual({});
    });

    it('should return saved config when file exists', async () => {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(
        TEST_CONFIG_FILE,
        JSON.stringify({ apiKey: 'sk-ant-test-key' })
      );

      const { loadConfig } = await import('./config');
      const config = loadConfig();
      expect(config.apiKey).toBe('sk-ant-test-key');
    });

    it('should return empty object on corrupt JSON', async () => {
      fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(TEST_CONFIG_FILE, 'not-json');

      const { loadConfig } = await import('./config');
      const config = loadConfig();
      expect(config).toEqual({});
    });
  });

  describe('saveConfig', () => {
    it('should create config directory and file', async () => {
      const { saveConfig } = await import('./config');
      saveConfig({ apiKey: 'sk-ant-test-key' });

      expect(fs.existsSync(TEST_CONFIG_FILE)).toBe(true);
      const content = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, 'utf-8'));
      expect(content.apiKey).toBe('sk-ant-test-key');
    });

    it('should set secure file permissions (0o600)', async () => {
      const { saveConfig } = await import('./config');
      saveConfig({ apiKey: 'sk-ant-test-key' });

      const stats = fs.statSync(TEST_CONFIG_FILE);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('validateApiKey', () => {
    it('should return true for valid Anthropic API keys', async () => {
      const { validateApiKey } = await import('./config');
      expect(validateApiKey('sk-ant-api03-validkeywithenoughlength')).toBe(true);
    });

    it('should return false for keys not starting with sk-ant-', async () => {
      const { validateApiKey } = await import('./config');
      expect(validateApiKey('invalid-key-format')).toBe(false);
    });

    it('should return false for keys that are too short', async () => {
      const { validateApiKey } = await import('./config');
      expect(validateApiKey('sk-ant-short')).toBe(false);
    });
  });

  describe('getApiKey / setApiKey / clearApiKey', () => {
    it('should return undefined when no API key is set', async () => {
      const { getApiKey } = await import('./config');
      expect(getApiKey()).toBeUndefined();
    });

    it('should set and get API key', async () => {
      const { setApiKey, getApiKey } = await import('./config');
      setApiKey('sk-ant-test-key-xyz');
      expect(getApiKey()).toBe('sk-ant-test-key-xyz');
    });

    it('should clear API key', async () => {
      const { setApiKey, clearApiKey, getApiKey } = await import('./config');
      setApiKey('sk-ant-test-key-xyz');
      clearApiKey();
      expect(getApiKey()).toBeUndefined();
    });
  });

  describe('getServerUrl', () => {
    it('should return undefined when no server URL is set', async () => {
      const { getServerUrl } = await import('./config');
      expect(getServerUrl()).toBeUndefined();
    });

    it('should return server URL when configured', async () => {
      const { saveConfig, getServerUrl } = await import('./config');
      saveConfig({ serverUrl: 'http://localhost:3000' });
      expect(getServerUrl()).toBe('http://localhost:3000');
    });
  });

  describe('getModelPreference / setModelPreference / validateModelPreference', () => {
    it('should return "auto" when no model preference is set', async () => {
      const { getModelPreference } = await import('./config');
      expect(getModelPreference()).toBe('auto');
    });

    it('should set and get model preference', async () => {
      const { setModelPreference, getModelPreference } = await import('./config');
      setModelPreference('haiku');
      expect(getModelPreference()).toBe('haiku');
    });

    it('should accept all valid model tiers', async () => {
      const { setModelPreference, getModelPreference, validateModelPreference } = await import('./config');
      for (const tier of ['auto', 'haiku', 'sonnet', 'opus'] as const) {
        expect(validateModelPreference(tier)).toBe(true);
        setModelPreference(tier);
        expect(getModelPreference()).toBe(tier);
      }
    });

    it('should reject invalid model preferences', async () => {
      const { validateModelPreference } = await import('./config');
      expect(validateModelPreference('gpt4')).toBe(false);
      expect(validateModelPreference('')).toBe(false);
      expect(validateModelPreference('HAIKU')).toBe(false);
    });
  });

  describe('hasSeenWelcome / markWelcomeSeen', () => {
    it('should return false when welcome not seen', async () => {
      const { hasSeenWelcome } = await import('./config');
      expect(hasSeenWelcome()).toBe(false);
    });

    it('should return true after marking welcome as seen', async () => {
      const { hasSeenWelcome, markWelcomeSeen } = await import('./config');
      markWelcomeSeen();
      expect(hasSeenWelcome()).toBe(true);
    });
  });
});
