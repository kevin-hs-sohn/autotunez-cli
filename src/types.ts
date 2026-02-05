// Core types for autotunez CLI

export interface ProjectRequirements {
  name: string;
  description: string;
  platform: 'web' | 'mobile' | 'cli';
  features: string[];
  stack?: StackPreferences;
}

export interface StackPreferences {
  framework?: string;
  styling?: string;
  database?: string;
  auth?: string;
}

export interface InterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeneratedProject {
  name: string;
  files: ProjectFile[];
}

export interface ProjectFile {
  path: string;
  content: string;
}

export class VibeError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'VibeError';
  }
}

// --- Project Config types (used by templates + extraction) ---

export interface TechStack {
  platform: string;
  framework: string;
  styling: string;
  database: string;
  auth: string;
  reasoning: string;
}

export interface DataModelEntity {
  name: string;
  fields: string[];
  description: string;
}

export interface Features {
  mvp: string[];
  future: string[];
}

export interface Implementation {
  coreComponents: string[];
  steps: string[];
  firstStep: string;
}

export interface ProjectConfig {
  name: string;
  description: string;
  problem: string;
  techStack: TechStack;
  dataModel: DataModelEntity[];
  features: Features;
  implementation: Implementation;
}

// --- FSD (Full Self-Driving) Mode Types ---

export interface FSDPlanRequest {
  goal: string;
  claudeMd?: string;
  scratchpad?: string;
  codebaseContext?: string;
}

export interface FSDPlanResponse {
  milestones: FSDMilestone[];
  userBlockers: FSDUserBlocker[];
  estimatedCost: number;
  estimatedTimeMinutes: number;
  risks: string[];
}

export interface FSDMilestone {
  id: string;
  title: string;
  description: string;
  successCriteria: string;
  size: 'small' | 'medium' | 'large';
  dependsOn: string[];
  qaGoal: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface FSDUserBlocker {
  id: string;
  description: string;
  checkInstruction: string;
  requiredFor: string[];
  completed: boolean;
}

export interface FSDQAResult {
  status: 'PASS' | 'FAIL';
  summary: {
    totalFlows: number;
    passed: number;
    failed: number;
  };
  testApproach: string[];
  issues: FSDQAIssue[];
  consoleErrors: string[];
  networkFailures: string[];
  recommendations: string[];
}

export interface FSDQAIssue {
  severity: 'critical' | 'major' | 'minor';
  description: string;
  evidence?: string;
  suggestion?: string;
}

export interface FSDAutomatedChecks {
  build: { passed: boolean; output?: string };
  typecheck: { passed: boolean; output?: string };
  test: { passed: boolean; output?: string };
  lint: { passed: boolean; output?: string };
}

export interface FSDExecutionState {
  mode: 'planning' | 'executing' | 'reviewing' | 'waiting_user' | 'paused' | 'completed';
  currentMilestoneId: string | null;
  completedMilestones: string[];
  failedAttempts: number;
  totalCost: number;
  totalPrompts: number;
  learnings: string[];
  startTime: number;
}

export interface FSDConfig {
  maxCost: number;
  maxIterationsPerMilestone: number;
  maxTotalPrompts: number;
  checkpointInterval: number;
  sensitiveApproval: boolean;
  autoResume: boolean;
}
