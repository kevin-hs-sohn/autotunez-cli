# autotunez

A meta-layer CLI that sits on top of [Claude Code](https://docs.anthropic.com/en/docs/claude-code). You describe what you want in plain language — autotunez transforms your input into optimized prompts, manages project context, and executes them through Claude Code. For bigger tasks, FSD (Full Self-Driving) mode plans milestones, executes them autonomously, runs QA, and self-corrects.

**In short:** you talk like a human, autotunez makes Claude Code work like a senior engineer.

## Why autotunez?

Using Claude Code directly works, but:

- **Vague prompts produce vague results.** autotunez rewrites your input into structured, context-aware prompts that consistently produce better code.
- **Large tasks need planning.** FSD mode breaks a goal like "build a todo app" into milestones, executes them sequentially, runs automated QA after each one, and retries on failure — all without you touching the keyboard.
- **Context matters.** autotunez reads your `CLAUDE.md`, `SCRATCHPAD.md`, and `plan.md` so every prompt includes your project's conventions, progress, and architecture.
- **Cost control.** Built-in credit tracking, per-prompt cost monitoring, and hard spending limits so you don't burn through your budget.

## Installation

```bash
npm install -g autotunez
```

### Requirements

- **Node.js 18+**
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated
- **autotunez API key** — sign up at [autotunez.vercel.app](https://autotunez.vercel.app) (free tier: $5/month)

## Quick Start

```bash
# 1. Set your API key
autotunez config --set-autotunez-key

# 2. Start coding
autotunez
```

That's it. autotunez checks your environment, loads project context, and drops you into an interactive session.

## How It Works

```
You type:   "make the button blue and add a hover effect"
               |
autotunez:  Reads CLAUDE.md + project context
            Transforms input into structured prompt
            Selects optimal model (Haiku/Sonnet/Opus)
               |
Claude Code: Executes the optimized prompt
               |
You see:    Real-time streaming results
```

autotunez isn't just a prompt wrapper — it understands whether your input is a direct instruction, a question, or a vague idea, and handles each differently.

## Features

### Interactive Mode (default)

Run `autotunez` and start describing what you want:

```bash
$ autotunez
  API key configured
  Claude Code v1.x detected
  Found CLAUDE.md

  What would you like to build?

> add dark mode to the settings page
  # autotunez transforms this into a detailed prompt and streams Claude Code's execution
```

**What happens under the hood:**
1. Your input goes to the autotunez server for prompt transformation
2. The server classifies intent (prompt vs. question vs. clarification)
3. Transformed prompt is sent to Claude Code with full project context
4. Results stream back in real-time

**Built-in commands** during a session:
- `/compact` — Summarize conversation history to free up context
- `/learn` — Analyze the session and generate rules for your `CLAUDE.md`
- `/fsd` — Switch to FSD mode mid-session
- `/apply-rule` — Apply a learned rule to your project

Auto-compact kicks in automatically when conversation context exceeds ~8,000 characters.

### FSD Mode (Full Self-Driving)

For tasks bigger than a single prompt, FSD mode handles the full lifecycle:

```bash
autotunez fsd "build a user authentication system with OAuth"
```

**The FSD pipeline:**

```
1. PLANNING     Goal -> milestones with success criteria, dependencies, QA goals
2. EXECUTION    For each milestone:
                  a. Generate prompt from milestone spec
                  b. Execute via Claude Code
                  c. Run automated QA (spawns Claude Code as QA agent)
                  d. If critical issues found -> generate fix prompt -> retry (up to 3x)
                  e. Save state + take file snapshots
3. COMPLETION   Summary with stats, costs, and git diff
```

**FSD options:**

| Flag | Description |
|------|-------------|
| `--max-cost <dollars>` | Spending cap (default: $10). Warns at 80%, stops at 100%. |
| `--checkpoint` | Pause for approval after each milestone |
| `--dry-run` | Show the plan only, don't execute |
| `--resume` | Resume from last saved state |
| `--skip-qa` | Skip QA verification (faster, less safe) |
| `--clear` | Clear saved state and start fresh |
| `--no-ink` | Use plain console output instead of the React-based UI |

**Pause/Resume:** Press `ESC` during execution to pause. While paused, you can interact with Claude Code directly (e.g., inspect files, run commands), then resume where you left off.

**Git protection:** FSD mode auto-creates an isolated branch (`fsd-<timestamp>`) so your main branch stays clean. On resume, it reuses the same branch.

**State persistence:** FSD state saves to `.claude/fsd-state.json`. If the process crashes or you quit, `--resume` picks up from the last completed milestone.

### Smart Model Selection

autotunez automatically selects the right Claude model based on task complexity:

| Model | Best for | Relative cost |
|-------|----------|---------------|
| **Haiku** | Simple edits, typos, small changes | ~3x cheaper |
| **Sonnet** | Most coding tasks (default) | Baseline |
| **Opus** | Complex architecture, multi-file refactors | ~5x more |
| **Auto** | Let autotunez decide per-request | Varies |

Set your preference:

```bash
autotunez config --model auto    # recommended
autotunez config --model haiku   # budget mode
autotunez config --model opus    # maximum quality
```

Or configure it in the [dashboard](https://autotunez.vercel.app/dashboard).

### Project Setup

When you run `autotunez` in a new project, it detects missing project files and offers an interactive setup interview:

```bash
$ autotunez
  No CLAUDE.md found. Would you like to set up your project?

  # Guided interview: What are you building? What's the tech stack?
  # Generates: CLAUDE.md, SCRATCHPAD.md, plan.md
  # Installs default Claude Code skills
```

**Generated files:**

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project conventions, tech stack, boundaries — Claude reads this on every prompt |
| `SCRATCHPAD.md` | Session-to-session progress tracking |
| `plan.md` | Implementation plan (design before code) |

**Two interview modes:**
- **Beginner** — Full guided walkthrough, auto-selects tech stack
- **Expert** — Minimal questions, respects your decisions

### Credit System

autotunez uses a credit-based system for API calls:

```bash
# Check your balance
autotunez config --show
```

- **Free tier:** $5/month (auto-refills when balance drops below $1)
- **Top up:** Buy credits with USDC on Base via the [dashboard](https://autotunez.vercel.app/dashboard)
- **Cost tracking:** Each prompt shows estimated cost. FSD mode enforces hard spending limits.
- **1 credit = $0.001** — a typical Sonnet prompt costs ~20-50 credits ($0.02-$0.05)

Balance is displayed in the interactive UI and refreshes automatically.

### Skills

autotunez auto-installs a curated set of Claude Code skills during project setup:

- **UI/UX design** (ui-ux-pro-max-skill)
- **Vercel/Next.js patterns** (vercel-labs/agent-skills)
- **Supabase integration** (supabase/agent-skills)
- **Expo/React Native** (expo/skills)
- **Security review** (security-review, backend-patterns)
- **Ethical hacking methodology** (pentest, aws-pentest)

Skills extend Claude Code's capabilities without changing autotunez itself.

## Configuration

```bash
autotunez config [options]
```

| Option | Description |
|--------|-------------|
| `--set-key` | Set Anthropic API key (`sk-ant-xxx`) |
| `--set-autotunez-key` | Set autotunez API key (`atk_xxx`) |
| `--show` | Display current configuration |
| `--clear` | Clear Anthropic API key |
| `--clear-autotunez-key` | Clear autotunez API key |
| `--model <tier>` | Set model preference (`auto`\|`haiku`\|`sonnet`\|`opus`) |

**Config file location:** `~/.autotunez/config.json` (permissions: `0600`)

**Environment variables** (take priority over config file):
- `ANTHROPIC_API_KEY` — Anthropic API key
- `AUTOTUNEZ_KEY` — autotunez API key
- `AUTOTUNEZ_SERVER_URL` — Custom server URL

## Security

### vibesafu Integration

For enhanced security in FSD mode, install [vibesafu](https://github.com/kevin-hs-sohn/vibesafu):

```bash
npm install -g vibesafu
vibesafu install
```

This registers a pre-execution hook in Claude Code that reviews every command before it runs — blocking destructive operations, secret exfiltration, and unsafe network calls.

autotunez checks for vibesafu on startup and prompts you to install it if missing.

### Secret Redaction

All Claude Code output is passed through a secret redaction filter before display. Detected patterns include:
- API keys (OpenAI, Anthropic, Stripe, GitHub, GitLab, Slack, AWS)
- JWTs
- Environment variable assignments with secret-looking values
- Password assignments

### API Key Storage

- Keys are stored locally at `~/.autotunez/config.json` with `0600` permissions
- Keys are only sent to the autotunez server and Anthropic API — never logged, never persisted on server

## Architecture

```
src/
  index.ts               CLI entry point (commander)
  config.ts              Configuration management (~/.autotunez/config.json)
  agent.ts               Prompt transformation + conversation management
  executor.ts            Claude Code process spawning + stream parsing
  api-client.ts          autotunez server API client
  setup.ts               First-run project setup interview
  prompts.ts             System prompts for interview modes
  skill-installer.ts     Claude Code skill installation
  output-parser.ts       Stream-JSON output parsing
  vibesafu.ts            Security hook integration

  ui/                    React/Ink terminal UI
    App.tsx              Main app shell
    session.tsx          Interactive session orchestration
    setup-session.tsx    Setup interview UI
    InputField.tsx       Text input with history
    MessageArea.tsx      Streaming message display
    TaskList.tsx         Progress tracking

  fsd/                   Full Self-Driving mode
    command.ts           FSD entry point + lifecycle
    executor.ts          Milestone execution + cost tracking
    qa-agent.ts          Autonomous QA verification
    pause-controller.ts  ESC-to-pause + interactive break
    git-protection.ts    Branch isolation for safe execution
    state.ts             State persistence (.claude/fsd-state.json)
    post-execution.ts    File snapshot + change analysis
    safety.ts            Safety rules injection
```

## License

MIT
