# autotunez

CLI for vibe coding with Claude - transform messy prompts into optimized Claude Code instructions.

## Installation

```bash
npm install -g autotunez
```

## Features

### FSD Mode (Full Self-Driving)
Autonomous coding mode that breaks down your goal into milestones and executes them with QA verification.

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

### Transform Mode
Transform messy prompts into optimized Claude Code instructions.

```bash
autotunez transform "make the button blue"
```

### Setup Mode
Interactive project setup that generates CLAUDE.md, SCRATCHPAD.md, and plan.md.

```bash
autotunez setup
```

### Config
Manage API keys and settings.

```bash
autotunez config --set-key          # Set Anthropic API key
autotunez config --set-autotunez-key  # Set autotunez API key
autotunez config --show             # Show current config
```

## Requirements

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- Anthropic API key
- autotunez API key (get at https://autotunez.vercel.app)

## Security

For enhanced security in FSD mode, install [vibesafu](https://github.com/kevin-hs-sohn/vibesafu):

```bash
npm install -g vibesafu
vibesafu install
```

This adds pre-execution hooks that review commands before they run.

## License

MIT
