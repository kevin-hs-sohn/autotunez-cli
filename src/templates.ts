// Project templates for autotunez generated projects
// Focus: Create project design documents for Claude Code, not boilerplate

import type { ProjectConfig, TechStack, DataModelEntity } from './types.js';

// --- Dynamic section generators based on project config ---

function generateCodeStyle(techStack: TechStack, dataModel: DataModelEntity[]): string {
  const fw = techStack.framework.toLowerCase();
  const db = techStack.database.toLowerCase();
  const lines: string[] = [];

  // Derive example names from data model
  const entity = dataModel[0];
  const entityName = entity?.name || 'Item';
  const entityNameLower = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  // Pick up to 2 display fields (skip id-like fields)
  // Fields may be "name: string" format — extract just the name part
  const parseFieldName = (f: string): string => f.split(':')[0].trim();
  const displayFields = entity?.fields
    .map(parseFieldName)
    .filter(f => !f.toLowerCase().includes('id') && !f.toLowerCase().includes('createdat'))
    .slice(0, 2) || ['name', 'status'];
  const tableName = entityNameLower + 's';

  // Naming conventions (always included)
  lines.push(`### Naming`);
  lines.push(`- Variables/functions: camelCase`);
  if (fw.includes('react') || fw.includes('next')) {
    lines.push(`- Components: PascalCase (one component per file)`);
  }
  lines.push(`- Constants: UPPER_SNAKE_CASE`);
  lines.push(`- Files: kebab-case${fw.includes('react') || fw.includes('next') ? ' (React components: PascalCase)' : ''}`);

  // Patterns based on framework, using actual data model
  lines.push('');
  lines.push(`### Patterns`);

  if (fw.includes('react') || fw.includes('next')) {
    const propsFields = displayFields.map(f => `  ${f}: string;`).join('\n');
    const propsDestructure = displayFields.join(', ');
    const jsxFields = displayFields.map(f => `      <span>{${f}}</span>`).join('\n');

    lines.push(`\`\`\`typescript
// ✅ Good — typed props, explicit return
interface ${entityName}CardProps {
${propsFields}
  onSelect: () => void;
}

const ${entityName}Card = ({ ${propsDestructure}, onSelect }: ${entityName}CardProps) => {
  return (
    <div onClick={onSelect}>
${jsxFields}
    </div>
  );
};

// ❌ Bad — implicit any, no type safety
const ${entityName}Card = (props) => {
  return <div onClick={props.onSelect}>{props.${displayFields[0]}}</div>;
};
\`\`\``);
  } else {
    lines.push(`\`\`\`typescript
// ✅ Good — explicit types and error handling
const get${entityName} = async (id: string): Promise<${entityName}> => {
  const result = await findById(id);
  if (!result) {
    throw new Error(\`${entityName} not found: \${id}\`);
  }
  return result;
};

// ❌ Bad — no types, no validation
const get${entityName} = async (id) => {
  return findById(id);
};
\`\`\``);
  }

  // Data access patterns based on database, using actual entity names
  if (db.includes('localstorage')) {
    lines.push('');
    lines.push(`### Data Access`);
    lines.push(`\`\`\`typescript
// ✅ Good — typed storage helper with error handling
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// Usage
const ${tableName} = loadFromStorage<${entityName}[]>('${tableName}', []);
saveToStorage('${tableName}', updated${entityName}s);

// ❌ Bad — raw access, no error handling
const data = JSON.parse(localStorage.getItem('${tableName}'));
\`\`\``);
  } else if (db.includes('supabase')) {
    lines.push('');
    lines.push(`### Data Access`);
    lines.push(`\`\`\`typescript
// ✅ Good — typed query with error handling
const { data, error } = await supabase
  .from('${tableName}')
  .select('*')
  .eq('user_id', userId);

if (error) throw new Error(\`Failed to load ${tableName}: \${error.message}\`);
const ${tableName}: ${entityName}[] = data;

// ❌ Bad — no error check, untyped
const { data } = await supabase.from('${tableName}').select('*');
\`\`\``);
  } else if (db.includes('firebase')) {
    lines.push('');
    lines.push(`### Data Access`);
    lines.push(`\`\`\`typescript
// ✅ Good — typed reference with error handling
const ${tableName}Ref = collection(db, '${tableName}');
const snapshot = await getDocs(query(${tableName}Ref, where('userId', '==', uid)));
const ${tableName}: ${entityName}[] = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
} as ${entityName}));

// ❌ Bad — untyped, no error handling
const snapshot = await getDocs(collection(db, '${tableName}'));
\`\`\``);
  }

  return lines.join('\n');
}

function generateFolderStructure(techStack: TechStack, coreComponents: string[]): string {
  const fw = techStack.framework.toLowerCase();
  const db = techStack.database.toLowerCase();
  const lines: string[] = [];

  // Keywords that indicate a utility/service, not a UI component
  const utilKeywords = ['storage', 'database', 'db', 'api', 'service', 'util', 'helper', 'auth', 'client', 'manager', 'provider', 'context'];
  const isUtil = (name: string) => utilKeywords.some(k => name.toLowerCase().includes(k));

  if (fw.includes('next')) {
    lines.push('```');
    lines.push('app/');
    lines.push('  layout.tsx        # Root layout (shell, global styles)');
    lines.push('  page.tsx          # Main page');
    lines.push('components/');
    // Only UI components go here
    for (const comp of coreComponents) {
      const name = comp.split(' - ')[0].trim();
      if (!isUtil(name)) {
        lines.push(`  ${name}.tsx`);
      }
    }
    lines.push('lib/');
    if (db.includes('localstorage')) {
      lines.push('  storage.ts       # localStorage typed helpers');
    } else if (db.includes('supabase')) {
      lines.push('  supabase.ts      # Supabase client + typed queries');
    } else if (db.includes('firebase')) {
      lines.push('  firebase.ts      # Firebase config + helpers');
    }
    lines.push('  types.ts         # Shared TypeScript interfaces');
    lines.push('```');
  } else if (fw.includes('express') || fw.includes('node')) {
    lines.push('```');
    lines.push('src/');
    lines.push('  index.ts         # Entry point');
    lines.push('  routes/          # API route handlers');
    lines.push('  services/        # Business logic');
    lines.push('  models/          # Data models');
    if (db.includes('supabase') || db.includes('postgres')) {
      lines.push('  db.ts            # Database connection');
    }
    lines.push('  types.ts         # Shared TypeScript interfaces');
    lines.push('```');
  } else {
    lines.push('```');
    lines.push('src/');
    lines.push('  index.ts         # Entry point');
    for (const comp of coreComponents) {
      const name = comp.split(' - ')[0].trim();
      const fileName = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      lines.push(`  ${fileName}.ts`);
    }
    lines.push('  types.ts         # Shared TypeScript interfaces');
    lines.push('```');
  }

  return lines.join('\n');
}

function generateBoundaries(techStack: TechStack): string {
  const db = techStack.database.toLowerCase();
  const auth = techStack.auth.toLowerCase();
  const styling = techStack.styling.toLowerCase();

  // ✅ Always
  const always: string[] = [
    'Write a failing test BEFORE writing implementation code (TDD)',
    'Run verification before commits (`pnpm typecheck && pnpm lint && pnpm test`)',
    'Start with MVP features only',
    'One feature/fix = one commit (use format: `type(scope): subject`)',
    'Keep it simple — this is a prototype',
  ];

  if (db.includes('localstorage')) {
    always.push('Use typed helper functions for localStorage (never raw JSON.parse)');
  }
  if (db.includes('supabase') || db.includes('postgres') || db.includes('firebase')) {
    always.push('Run database migrations before deploying schema changes');
    always.push('Validate all user inputs before database writes');
  }

  // ⚠️ Ask first
  const askFirst: string[] = [
    'Adding new dependencies',
    'Changing data model structure',
    'Adding features not in MVP list',
  ];

  if (auth === 'none') {
    askFirst.push('Adding authentication (changes architecture significantly)');
  }
  if (db.includes('localstorage')) {
    askFirst.push('Changing localStorage key schema (existing user data at risk)');
  }
  if (styling.includes('tailwind')) {
    askFirst.push('Customizing Tailwind theme (use default utilities first)');
  }

  // 🚫 Never
  const never: string[] = [
    'Commit .env or API keys',
    'Write production code without a failing test first',
    'Over-engineer or add unnecessary abstractions',
    'Skip verification steps',
    'Batch multiple features in one commit',
  ];

  if (db.includes('localstorage')) {
    never.push('Store sensitive data in localStorage (not encrypted, accessible via DevTools)');
  }
  if (db.includes('supabase') || db.includes('postgres')) {
    never.push('Expose database credentials to the client');
    never.push('Write raw SQL without parameterized queries');
  }

  return `### ✅ Always
${always.map(r => `- ${r}`).join('\n')}

### ⚠️ Ask first
${askFirst.map(r => `- ${r}`).join('\n')}

### 🚫 Never
${never.map(r => `- ${r}`).join('\n')}`;
}

function generateResourcesSection(techStack: TechStack): string {
  const fw = techStack.framework.toLowerCase();
  const db = techStack.database.toLowerCase();
  const platform = techStack.platform.toLowerCase();

  const resources: string[] = [];

  // Always recommend TDD/debugging skill
  resources.push('- **obra/superpowers** — TDD, systematic debugging, planning → `npx skills add obra/superpowers`');

  // Frontend skills
  if (fw.includes('react') || fw.includes('next') || platform === 'web') {
    resources.push('- **ui-ux-pro-max-skill** — 57 UI styles, 95 color palettes, design system → `npx skills add nextlevelbuilder/ui-ux-pro-max-skill`');
    resources.push('- **vercel-react-best-practices** — 40+ React/Next.js optimization rules → `npx skills add vercel-labs/agent-skills`');
  }

  // Database skills
  if (db.includes('supabase') || db.includes('postgres')) {
    resources.push('- **postgres-best-practices** — Query optimization, RLS, connection management → `npx skills add supabase/agent-skills`');
  }

  // Mobile skills
  if (platform === 'mobile' || fw.includes('react native') || fw.includes('expo')) {
    resources.push('- **expo/skills** — React Native + Expo patterns → `npx skills add expo/skills`');
    resources.push('- **react-native-best-practices** — RN optimization → `npx skills add callstackincubator/agent-skills`');
  }

  // Document manipulation
  resources.push('- **anthropics/skills** — PDF, Excel, Word, PowerPoint manipulation → `/install-skill anthropics/skills`');

  return resources.join('\n');
}

function generateProjectNotes(techStack: TechStack): string {
  const db = techStack.database.toLowerCase();
  const fw = techStack.framework.toLowerCase();
  const styling = techStack.styling.toLowerCase();
  const auth = techStack.auth.toLowerCase();

  const notes: string[] = [
    'Use `SCRATCHPAD.md` to track progress and decisions',
  ];

  // Database-specific notes
  if (db.includes('localstorage')) {
    notes.push('**localStorage:** Data is per-browser, per-device — no cross-device sync');
    notes.push('**localStorage:** ~5MB limit per origin — sufficient for most MVPs');
    notes.push('**localStorage:** Store dates as ISO strings (YYYY-MM-DD) for consistency');
  }
  if (db.includes('supabase')) {
    notes.push('**Supabase:** Use Row Level Security (RLS) for all tables');
    notes.push('**Supabase:** Generate TypeScript types with `supabase gen types`');
  }
  if (db.includes('firebase')) {
    notes.push('**Firebase:** Configure security rules before deploying');
  }

  // Framework-specific notes
  if (fw.includes('next')) {
    notes.push('**Next.js:** Use App Router conventions (`app/` directory)');
    notes.push("**Next.js:** Server Components by default — add `'use client'` only when needed");
  }

  // Styling-specific notes
  if (styling.includes('tailwind')) {
    notes.push('**Tailwind:** Mobile-first — use `sm:`, `md:`, `lg:` for responsive breakpoints');
  }

  // Auth-specific notes
  if (auth === 'none') {
    notes.push('**Auth:** Not included in MVP — design data model so auth can be added later');
  }

  return notes.map(n => `- ${n}`).join('\n');
}

export function generateClaudeMd(config: ProjectConfig): string {
  // Safely handle potentially undefined arrays
  const dataModel = config.dataModel || [];
  const coreComponents = config.implementation?.coreComponents || [];
  const steps = config.implementation?.steps || [];
  const mvpFeatures = config.features?.mvp || [];
  const futureFeatures = config.features?.future || [];

  const dataModelSection =
    dataModel.length > 0
      ? `## Data Model

${dataModel
    .map(
      (entity) => `### ${entity.name}
${entity.description}

\`\`\`typescript
interface ${entity.name} {
  ${entity.fields.join(';\n  ')};
}
\`\`\``
    )
    .join('\n\n')}`
      : '';

  const coreComponentsSection =
    coreComponents.length > 0
      ? `### Core Components
${coreComponents.map((c) => `- ${c}`).join('\n')}`
      : '';

  const stepsSection =
    steps.length > 0
      ? `### Implementation Steps
${steps.map((s) => `${s}`).join('\n')}`
      : '';

  const techStack = config.techStack || {
    platform: 'web',
    framework: 'Next.js',
    styling: 'Tailwind CSS',
    database: 'localStorage',
    auth: 'none',
    reasoning: 'Simple web app for MVP',
  };

  // vibe-guide Section 10: CLAUDE.md Authoring - 6 Core Areas
  return `# Project: ${config.name}

## Overview
${config.description}

**Problem:** ${config.problem || config.description}

## Tech Stack
- **Platform:** ${techStack.platform}
- **Framework:** ${techStack.framework}
- **Styling:** ${techStack.styling}
- **Database:** ${techStack.database}
- **Auth:** ${techStack.auth}

**Why this stack:** ${techStack.reasoning}

## Git Workflow
- **Branches:** \`feature/\`, \`fix/\`, \`refactor/\`
- **Commits:** Conventional format (\`type(scope): subject\`)
- **Commit messages:** < 50 chars, imperative mood
- **Before commit:** Tests must pass (\`pnpm test\`)
- **Rule:** One logical change per commit

## Commands
\`\`\`bash
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm test       # Run tests
pnpm lint       # Check for issues
pnpm typecheck  # Type check
\`\`\`

## Code Style

${generateCodeStyle(techStack, dataModel)}

## TDD (Test-Driven Development)

**TDD is mandatory.** Write failing tests before implementation code.

### The Rule
\`\`\`
1. RED    — Write a failing test first
2. GREEN  — Write minimal code to pass
3. REFACTOR — Clean up, tests still pass
\`\`\`

### Setup
- **Test runner:** Vitest (\`pnpm test\`)
- **Test files:** \`<module>.test.ts\` next to source
- **Pattern:** Arrange-Act-Assert

### Example
\`\`\`typescript
describe('calculateTotal', () => {
  it('should sum item prices', () => {
    // Arrange
    const items = [{ price: 10 }, { price: 20 }];
    // Act
    const result = calculateTotal(items);
    // Assert
    expect(result).toBe(30);
  });
});
\`\`\`

### Rules
1. Never write production code without a failing test
2. Run \`pnpm test\` after every change
3. Mock external dependencies (APIs, databases)

## Boundaries

${generateBoundaries(techStack)}

${dataModelSection}

## Features

### MVP (Build These First)
${mvpFeatures.map((f) => `- [ ] ${f}`).join('\n') || '- [ ] Define MVP features'}

### Future (After MVP Works)
${futureFeatures.map((f) => `- [ ] ${f}`).join('\n') || '- [ ] To be defined after MVP'}

## Project Structure

${generateFolderStructure(techStack, coreComponents)}

## Implementation Guide

${coreComponentsSection}

${stepsSection}

### First Step
> ${config.implementation?.firstStep || 'Set up the project and start with the first MVP feature'}

## Resources (Skills & Tools)

When you need additional capabilities, install relevant skills:

${generateResourcesSection(techStack)}

**Skill Discovery:** https://skills.sh

## Core Principles (Karpathy-inspired)

### Think Before Coding
- State assumptions explicitly before starting
- If uncertain, ask rather than guess
- Present tradeoffs when multiple approaches exist

### Simplicity First
- No features beyond what was asked
- If 200 lines could be 50, make it 50
- Avoid premature abstractions — three similar lines > one "clever" function

### Surgical Changes
- Touch only what you must
- Don't "improve" adjacent code while fixing something else
- Don't add comments to code you didn't change

### Goal-Driven Execution
- Transform tasks into verifiable success criteria
- Loop until criteria met, verify frequently
- If stuck after 3 attempts, stop and explain what's blocking

## Critical Instructions

1. **BEFORE writing code** → Create/update \`plan.md\` with your approach
2. **BEFORE starting work** → Read \`SCRATCHPAD.md\` for current progress
3. **AFTER completing work** → Update \`SCRATCHPAD.md\` with what was done
4. **Each conversation** → Focus on ONE task only
5. **Write failing test FIRST** → Then implement (TDD)
6. **Commit format** → \`type(scope): subject\` (e.g., \`feat(auth): add login button\`)
7. **One feature/fix = one commit** → Don't batch multiple changes

### Error Messages
Always include: **what failed** + **why** + **how to fix**
\`\`\`typescript
// ✅ Good
throw new Error('API key invalid: key expired on 2024-01-01. Generate a new key at console.anthropic.com');

// ❌ Bad
throw new Error('Invalid key');
\`\`\`

## Project Notes

${generateProjectNotes(techStack)}
`;
}

export function generateScratchpad(config: ProjectConfig): string {
  const techStack = config.techStack || { framework: 'TBD', styling: 'TBD', database: 'TBD' };
  const implementation = config.implementation || { firstStep: 'Set up the project' };
  const mvpFeatures = config.features?.mvp || [];

  return `# ${config.name} - Development Log

## Project Status
**Phase:** Not Started
**Last Updated:** ${new Date().toISOString().split('T')[0]}

## Quick Reference

**What we're building:** ${config.description}

**Tech Stack:** ${techStack.framework} + ${techStack.styling} + ${techStack.database}

## Current Focus

> ${implementation.firstStep}

## MVP Checklist
${mvpFeatures.map((f) => `- [ ] ${f}`).join('\n') || '- [ ] Define MVP features'}

## Session Notes

### ${new Date().toISOString().split('T')[0]} - Project Created
- Project initialized via autotunez
- Ready to start development
- First step: ${implementation.firstStep}

---

*Use this file to track progress, decisions, and notes during development.*
`;
}

export function generatePlanMd(config: ProjectConfig): string {
  const techStack = config.techStack || {
    platform: 'web',
    framework: 'Next.js',
    styling: 'Tailwind CSS',
    database: 'localStorage',
    auth: 'none',
    reasoning: 'Simple web app for MVP',
  };
  const mvpFeatures = config.features?.mvp || [];
  const steps = config.implementation?.steps || [];

  return `# ${config.name} — Implementation Plan

## Overview
${config.description}

**Problem:** ${config.problem || config.description}

## Tech Stack
- **Platform:** ${techStack.platform}
- **Framework:** ${techStack.framework}
- **Styling:** ${techStack.styling}
- **Database:** ${techStack.database}
- **Auth:** ${techStack.auth}

## MVP Features
${mvpFeatures.map((f) => `- [ ] ${f}`).join('\n') || '- [ ] Define MVP features'}

## Implementation Steps
${steps.map((s) => `${s}`).join('\n') || '1. Set up the project\n2. Implement first MVP feature\n3. Iterate on remaining features'}

## Open Decisions
- [ ] Project structure finalization
- [ ] Testing strategy details
`;
}
