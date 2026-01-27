# Ben-Ten

[![CI](https://github.com/rhoulihan/ben-ten/actions/workflows/ci.yml/badge.svg)](https://github.com/rhoulihan/ben-ten/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-180%20passing-brightgreen)](https://github.com/rhoulihan/ben-ten)

**Photographic memory for Claude Code** - Named after Ben Tennyson's legendary photographic memory.

Ben-Ten persists context across Claude Code sessions, allowing Claude to remember what you were working on even after compaction or session restarts.

## Features

- **Automatic Context Persistence** - Hooks into Claude Code lifecycle events to save context automatically
- **Post-Compaction Recovery** - Captures compacted summaries so context survives memory limits
- **MCP Server** - Exposes tools and resources for programmatic context management
- **Zero Configuration** - Works out of the box with sensible defaults

## Installation

### Prerequisites

- Node.js 20.0.0 or higher
- [Claude Code](https://claude.ai/claude-code) CLI installed and configured

### Step 1: Install Ben-Ten Globally

```bash
npm install -g ben-ten
```

Verify the installation:

```bash
ben-ten --version
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
        "command": "ben-ten hook"
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
        "command": "ben-ten hook"
      }
    ]
  }
}
```

#### Hook Events Explained

| Hook | When It Fires | Ben-Ten Action |
|------|---------------|--------------|
| `SessionStart` | When Claude Code starts or resumes | Loads saved context into the conversation |
| `SessionStart` | After compaction (`source: "compact"`) | Loads existing context (no auto-save) |
| `SessionStart` | With `source: "clear"` | Deletes existing context |

**Note:** Context is saved only via the `ben-ten_save` MCP tool. This gives Claude control over when and what to save.

### Step 3: Configure MCP Server (Required for Saving)

The MCP server provides the `ben-ten_save` tool that Claude uses to save context.

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "ben-ten": {
      "command": "ben-ten",
      "args": ["serve"]
    }
  }
}
```

Or add to your user-level MCP configuration (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "ben-ten": {
      "command": "ben-ten",
      "args": ["serve"]
    }
  }
}
```

The MCP server exposes these tools to Claude:

- `ben-ten_status` - Check if context exists
- `ben-ten_save` - Save context with custom summary, keyFiles, and activeTasks
- `ben-ten_load` - Load existing context
- `ben-ten_clear` - Delete context

### Step 4: Initialize Your Project (Optional)

```bash
cd your-project
ben-ten init
```

This creates a `.ben-ten/` directory in your project. This step is optional—Ben-Ten will create the directory automatically when first saving context.

### Verifying Installation

1. Start a new Claude Code session in your project
2. You should see "Ben-Ten Context Loaded" in the startup output (if context exists)
3. Check context status anytime:
   ```bash
   ben-ten status
   ```

## Quick Start

Once installed, Ben-Ten works like this:

1. **Start Claude Code** - Context is loaded from `.ben-ten/context.json` if it exists
2. **Work with Claude** - Claude can call `ben-ten_save` to save context at any time
3. **End session** - Saved context persists for next time
4. **Resume later** - Previous context is restored automatically

## How It Works

Ben-Ten integrates with Claude Code through hooks and MCP:

| Component | Action |
|-----------|--------|
| `SessionStart` hook | Loads existing context from `.ben-ten/context.json` |
| `ben-ten_save` MCP tool | Saves context (summary, keyFiles, activeTasks) |
| `ben-ten_load` MCP tool | Loads context programmatically |
| `ben-ten_clear` MCP tool | Deletes context |

Context is stored in `.ben-ten/context.json` at your project root.

## CLI Commands

```bash
# Initialize Ben-Ten for a project
ben-ten init

# Check context status
ben-ten status

# Display full context summary
ben-ten show

# Delete context
ben-ten clear

# Process Claude Code hooks (used by hooks, not typically run manually)
ben-ten hook
```

## MCP Server

Ben-Ten can also run as an MCP (Model Context Protocol) server, exposing tools for context management:

### Tools

- `ben-ten_status` - Get context status for the current project
- `ben-ten_save` - Save context data
- `ben-ten_load` - Load existing context
- `ben-ten_clear` - Delete context

### Resources

- `ben-ten://context` - Read the current project context

## Context Data Structure

Ben-Ten stores context in the following format:

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

Ben-Ten follows a clean architecture with clear separation of concerns:

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
