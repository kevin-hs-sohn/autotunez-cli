# autotunez

CLI for vibe coding with Claude - turn rough ideas into well-structured prompts.

## Installation

```bash
npm install -g autotunez
```

## Quick Start

```bash
autotunez
```

That's it! autotunez starts an interactive session where you can describe what you want in plain language. It automatically:

1. Transforms your messy input into optimized prompts
2. Sends them to Claude Code
3. Shows you the results

## How It Works

```
You type:  "make the button blue and add a hover effect"
           ↓
autotunez: Transforms into structured prompt with context
           ↓
Claude Code: Executes the optimized prompt
           ↓
You see:   Results in real-time
```

## Features

### Interactive Mode (default)
Just run `autotunez` and start describing what you want:

```bash
$ autotunez
✓ API key configured
✓ Claude Code detected
✓ Found CLAUDE.md

What would you like to build?

You: add dark mode to the settings page
# autotunez transforms this and Claude Code executes it
```

### FSD Mode (Full Self-Driving)
For larger tasks, FSD mode breaks down your goal into milestones and executes them autonomously:

```bash
autotunez fsd "build a todo app with React"
```

**Options:**
- `--max-cost <dollars>` - Set maximum cost limit (default: $10)
- `--checkpoint` - Require approval after each milestone
- `--dry-run` - Show plan only, don't execute
- `--resume` - Resume from saved state
- `--skip-qa` - Skip QA testing
- `--no-ink` - Disable Ink UI (use plain console)

### Config
Manage API keys and settings:

```bash
autotunez config --set-autotunez-key  # Set autotunez API key
autotunez config --show               # Show current config
```

## Requirements

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- autotunez API key (get at https://autotunez.vercel.app)

## Project Setup

When you run `autotunez` in a project directory, it looks for:

- `CLAUDE.md` - Project guidelines for Claude
- `SCRATCHPAD.md` - Development notes
- `plan.md` - Implementation plan

If these don't exist, autotunez will offer to set them up interactively.

## Security

For enhanced security in FSD mode, install [vibesafu](https://github.com/kevin-hs-sohn/vibesafu):

```bash
npm install -g vibesafu
vibesafu install
```

This adds pre-execution hooks that review commands before they run.

## License

MIT
