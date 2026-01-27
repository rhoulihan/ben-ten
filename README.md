# Ben10

[![CI](https://github.com/rhoulihan/Ben10/actions/workflows/ci.yml/badge.svg)](https://github.com/rhoulihan/Ben10/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-139%20passing-brightgreen)](https://github.com/rhoulihan/Ben10)

**Photographic memory for Claude Code** - Named after Ben Tennyson's legendary photographic memory.

Ben10 persists context across Claude Code sessions, allowing Claude to remember what you were working on even after compaction or session restarts.

## Features

- **Automatic Context Persistence** - Hooks into Claude Code lifecycle events to save context automatically
- **Post-Compaction Recovery** - Captures compacted summaries so context survives memory limits
- **MCP Server** - Exposes tools and resources for programmatic context management
- **Zero Configuration** - Works out of the box with sensible defaults

## Installation

### Prerequisites

- Node.js 20.0.0 or higher
- [Claude Code](https://claude.ai/claude-code) CLI installed and configured

### Step 1: Install Ben10 Globally

```bash
npm install -g ben10
```

Verify the installation:

```bash
ben10 --version
```

### Step 2: Configure Claude Code Hooks

Add hook configuration to your Claude Code settings. You can configure hooks at the user level (applies to all projects) or project level.

**User-level configuration** (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "ben10 hook"
      }
    ]
  }
}
```

**Project-level configuration** (`.claude/settings.json` in your project root):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "ben10 hook"
      }
    ]
  }
}
```

#### Hook Events Explained

| Hook | When It Fires | Ben10 Action |
|------|---------------|--------------|
| `SessionStart` | When Claude Code starts or resumes | Loads saved context into the conversation |
| `SessionStart` | After compaction (`source: "compact"`) | Saves the compacted summary |
| `SessionEnd` | When the session terminates | Saves final context |

Context is primarily saved when compaction occurs (triggered automatically by Claude Code when the context window fills up). The compacted summary is captured and persisted for the next session.

### Step 3: Configure MCP Server (Optional)

For programmatic access to context (e.g., having Claude call `ben10_save` directly), add the MCP server configuration.

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ben10": {
      "command": "ben10",
      "args": ["serve"]
    }
  }
}
```

Or add to your user-level MCP configuration (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "ben10": {
      "command": "ben10",
      "args": ["serve"]
    }
  }
}
```

The MCP server exposes these tools to Claude:

- `ben10_status` - Check if context exists
- `ben10_save` - Save context with custom summary, keyFiles, and activeTasks
- `ben10_load` - Load existing context
- `ben10_clear` - Delete context

### Step 4: Initialize Your Project (Optional)

```bash
cd your-project
ben10 init
```

This creates a `.ben10/` directory in your project. This step is optional—Ben10 will create the directory automatically when first saving context.

### Verifying Installation

1. Start a new Claude Code session in your project
2. You should see "Ben10 Context Loaded" in the startup output (if context exists)
3. Check context status anytime:
   ```bash
   ben10 status
   ```

## Quick Start

Once installed, Ben10 works automatically:

1. **Start Claude Code** - Context is loaded from `.ben10/context.json` if it exists
2. **Work with Claude** - When compaction occurs, the summary is saved automatically
3. **End session** - Context persists for next time
4. **Resume later** - Previous context is restored automatically

## How It Works

Ben10 integrates with Claude Code through lifecycle hooks:

| Event | Source | Action |
|-------|--------|--------|
| SessionStart | `startup` | Load existing context from `.ben10/context.json` |
| SessionStart | `compact` | Save freshly-compacted summary to context |
| SessionStart | `resume` | Load existing context |
| SessionStart | `clear` | Delete existing context |
| SessionEnd | - | Save current session summary to context |

Context is stored in `.ben10/context.json` at your project root.

## CLI Commands

```bash
# Initialize Ben10 for a project
ben10 init

# Check context status
ben10 status

# Display full context summary
ben10 show

# Delete context
ben10 clear

# Process Claude Code hooks (used by hooks, not typically run manually)
ben10 hook
```

## MCP Server

Ben10 can also run as an MCP (Model Context Protocol) server, exposing tools for context management:

### Tools

- `ben10_status` - Get context status for the current project
- `ben10_save` - Save context data
- `ben10_load` - Load existing context
- `ben10_clear` - Delete context

### Resources

- `ben10://context` - Read the current project context

## Context Data Structure

Ben10 stores context in the following format:

```typescript
interface ContextData {
  version: string;        // Schema version
  createdAt: number;      // Timestamp of first creation
  updatedAt: number;      // Timestamp of last update
  sessionId: string;      // Last session ID
  summary: string;        // Compacted/session summary
  keyFiles?: string[];    // Important files in the project
  activeTasks?: string[]; // Current tasks/objectives
}
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# Lint
npm run lint

# Type check
npm run typecheck
```

## Architecture

Ben10 follows a clean architecture with clear separation of concerns:

```
src/
├── adapters/        # External system adapters (filesystem)
├── bin/             # CLI entry point
├── cli/             # CLI commands
├── core/            # Core types and schemas
├── infrastructure/  # Cross-cutting concerns (errors, logging, Result type)
├── mcp/             # MCP server implementation
└── services/        # Business logic (context, hooks)
```

### Key Design Decisions

- **Result<T, E> Type** - Explicit error handling without exceptions
- **Dependency Injection** - All services accept dependencies for testability
- **In-Memory FS** - Tests use memory filesystem for isolation and speed
- **Zod Schemas** - Runtime validation of all external data

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Named after Ben Tennyson from Ben 10, known for his photographic memory
- Built for use with [Claude Code](https://claude.ai/claude-code) by Anthropic
