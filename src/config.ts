import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config as loadDotenv } from 'dotenv';
import type { ModelTier } from './api-types.js';
import type { BillingMode } from './core/types.js';

const CONFIG_DIR = path.join(os.homedir(), '.autotunez');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

let _configCache: Config | null = null;

// Load .env from current directory if exists
loadDotenv();

interface Config {
  apiKey?: string;        // Anthropic API key (sk-ant-xxx)
  autotunezKey?: string;  // autotunez API key (atk_xxx) - for usage tracking
  serverUrl?: string;
  hasSeenWelcome?: boolean;
  modelPreference?: ModelTier;  // User's preferred model tier
}

export function loadConfig(): Config {
  if (_configCache) return _configCache;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      _configCache = JSON.parse(data);
      return _configCache!;
    }
  } catch {
    // Ignore errors, return empty config
  }
  _configCache = {};
  return _configCache;
}

export function _clearConfigCache(): void {
  _configCache = null;
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  _configCache = config;
}

export function validateApiKey(key: string): boolean {
  // Anthropic API keys start with 'sk-ant-' and are reasonably long
  return key.startsWith('sk-ant-') && key.length > 20;
}

export function validateAutotunezKey(key: string): boolean {
  // autotunez API keys start with 'atk_' and are 68 characters long (atk_ + 64 hex chars)
  return key.startsWith('atk_') && key.length === 68;
}

export function getApiKey(): string | undefined {
  // Priority: env var > config file
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && validateApiKey(envKey)) {
    return envKey;
  }
  return loadConfig().apiKey;
}

export function setApiKey(key: string): void {
  const config = loadConfig();
  config.apiKey = key;
  saveConfig(config);
}

export function clearApiKey(): void {
  const config = loadConfig();
  delete config.apiKey;
  saveConfig(config);
}

export function getAutotunezKey(): string | undefined {
  // Priority: env var > config file
  const envKey = process.env.AUTOTUNEZ_API_KEY;
  if (envKey && validateAutotunezKey(envKey)) {
    return envKey;
  }
  return loadConfig().autotunezKey;
}

export function getAutotunezKeySource(): 'env' | 'config' | null {
  const envKey = process.env.AUTOTUNEZ_API_KEY;
  if (envKey && validateAutotunezKey(envKey)) {
    return 'env';
  }
  if (loadConfig().autotunezKey) {
    return 'config';
  }
  return null;
}

export function setAutotunezKey(key: string): void {
  const config = loadConfig();
  config.autotunezKey = key;
  saveConfig(config);
}

export function clearAutotunezKey(): void {
  const config = loadConfig();
  delete config.autotunezKey;
  saveConfig(config);
}

export function getServerUrl(): string | undefined {
  return loadConfig().serverUrl;
}

export function hasSeenWelcome(): boolean {
  return loadConfig().hasSeenWelcome === true;
}

export function markWelcomeSeen(): void {
  const config = loadConfig();
  config.hasSeenWelcome = true;
  saveConfig(config);
}

const VALID_MODEL_PREFERENCES: ModelTier[] = ['auto', 'haiku', 'sonnet', 'opus'];

export function validateModelPreference(value: string): value is ModelTier {
  return VALID_MODEL_PREFERENCES.includes(value as ModelTier);
}

export function getModelPreference(): ModelTier {
  const config = loadConfig();
  return config.modelPreference || 'auto';
}

export function setModelPreference(tier: ModelTier): void {
  const config = loadConfig();
  config.modelPreference = tier;
  saveConfig(config);
}

/**
 * Determine billing mode based on API key availability.
 * - BYOK: user has their own Anthropic API key → platform fee only (15%)
 * - Managed: no own key → full markup (100%)
 */
export function getBillingMode(): BillingMode {
  return getApiKey() ? 'byok' : 'managed';
}
