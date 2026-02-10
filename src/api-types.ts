// API contract types for v1 server endpoints
// Used by both server (apps/web) and client (packages/cli)

import type { ProjectConfig } from './types.js';

// --- Auth ---

export interface AuthRegisterRequest {
  email: string;
  password: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string; // ISO date
}

// --- Interview ---

export interface InterviewRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode: 'beginner' | 'expert';
}

export interface InterviewResponse {
  message: string;
  readyToGenerate: boolean;
}

// --- Extract ---

export interface ExtractRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ExtractResponse {
  config: ProjectConfig;
}

// --- Scaffold ---

export interface ScaffoldRequest {
  config: ProjectConfig;
}

export interface ScaffoldResponse {
  files: Record<string, string>;
}

// --- Transform ---

export interface TransformRequest {
  input: string;
  claudeMd: string;
  scratchpad?: string;
  plan?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastClaudeOutput?: string; // Last output from Claude Code for context
}

export interface TransformResponse {
  type: 'prompt' | 'clarification';
  content: string;
  modelUsed?: string;
}

// --- Fix ---

export interface FixRequest {
  error: string;
  errorType: 'typecheck' | 'build' | 'test' | 'lint';
  claudeMd: string;
}

export interface FixResponse {
  prompt: string;
}

// --- Compact ---

export interface CompactRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  keepRecent?: number;
}

export interface CompactResponse {
  summary: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  originalCount: number;
  summarizedCount: number;
}

// --- Learn (CLAUDE.md Self-Learning) ---

export interface LearnRequest {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  claudeMd: string;
}

export interface LearnResponse {
  rule: string; // Generated rule to add to CLAUDE.md
  category: 'always' | 'ask_first' | 'never';
  explanation: string;
}

// --- Settings ---

export type ModelTier = 'auto' | 'haiku' | 'sonnet' | 'opus';

export interface UserSettingsResponse {
  modelPreference: ModelTier;
}

export interface UpdateSettingsRequest {
  modelPreference?: ModelTier;
}

// --- Common ---

export interface ApiError {
  code: string;
  message: string;
}
