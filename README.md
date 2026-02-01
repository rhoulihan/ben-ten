# Ben-Ten

[![CI](https://github.com/rhoulihan/ben-ten/actions/workflows/ci.yml/badge.svg)](https://github.com/rhoulihan/ben-ten/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-381%20passing-brightgreen)](https://github.com/rhoulihan/ben-ten)

**Photographic memory for Claude Code** - Named after Ben Tennyson's legendary photographic memory.

Ben-Ten persists context across Claude Code sessions, allowing Claude to remember what you were working on even after compaction or session restarts.

## Features

- **Automatic Context Persistence** - Hooks into Claude Code lifecycle events to save context automatically
- **Post-Compaction Recovery** - Captures compacted summaries so context survives memory limits
- **Conversation Replay** - Generates condensed conversation replays from transcripts with intelligent stopping points
- **LZ4 Compression** - Context files are compressed with LZ4 for ~90% size reduction
- **MCP Server** - Exposes tools and resources for programmatic context management
- **Remote Storage** - Optional HTTP server for syncing context across machines
- **Configurable Token Budget** - Control replay size via `maxReplayPercent` and `contextWindowSize` settings
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

### Step 2: Configure MCP Server (Required)

The MCP server provides the Ben-Ten tools that Claude uses to save and load context.

**Global configuration** (recommended - works across all projects):

```bash
# Add ben-ten MCP server with user scope
claude mcp add ben-ten --scope user -- ben-ten serve
```

Or manually add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "ben-ten": {
      "type": "stdio",
      "command": "ben-ten",
      "args": ["serve"]
    }
  }
}
```

**Project-level configuration** (`.mcp.json` in project root):

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

Verify the MCP server is configured:

```bash
claude mcp list
```

### Step 3: Configure Hooks (Optional)

Hooks enable automatic context detection on session start. They are **optional** — you can use Ben-Ten with just the MCP server if you prefer manual context management.

**Global hooks** (`~/.claude/settings.local.json`):

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

#### Hook Behavior

When hooks are configured, Ben-Ten prompts you when context is found:

```
# Ben-Ten Context Found

**Session:** previous-session
**Last Updated:** 2 hours ago (2026-01-28T14:30:00.000Z)
**Source:** Local

## Summary Preview
Working on feature X with files A, B, C...

---

To load this context, call `ben_ten_load`.
```

This gives you control over whether to load previous context in each session.

| Hook | When It Fires | Ben-Ten Action |
|------|---------------|--------------|
| `SessionStart` | When Claude Code starts or resumes | Detects context and prompts to load |
| `SessionStart` | After compaction (`source: "compact"`) | Loads existing context |
| `SessionStart` | With `source: "clear"` | Deletes existing context |

### Step 4: Initialize Your Project (Optional)

```bash
cd your-project
ben-ten init
```

This creates a `.ben-ten/` directory in your project. This step is optional—Ben-Ten will create the directory automatically when first saving context.

### Verifying Installation

1. Start a new Claude Code session in your project
2. If hooks are configured and context exists, you'll see the "Context Found" prompt
3. Check context status anytime:
   ```bash
   ben-ten status
   ```

## Quick Start

Once installed, Ben-Ten works like this:

1. **Start Claude Code** - Hook detects if context exists and prompts you
2. **Load context** - Call `ben_ten_load` to restore previous session
3. **Work with Claude** - Claude can call `ben_ten_save` to save context at any time
4. **End session** - Saved context persists for next time
5. **Resume later** - Previous context is offered automatically

## MCP Tools

Ben-Ten exposes these tools to Claude:

| Tool | Description |
|------|-------------|
| `ben_ten_status` | Get context status for the current project |
| `ben_ten_save` | Save context with summary, keyFiles, activeTasks. Supports local and remote storage. |
| `ben_ten_load` | Load existing context from local or remote storage |
| `ben_ten_clear` | Delete context |
| `ben_ten_config` | Get or set configuration (maxReplayPercent, contextWindowSize) |
| `ben_ten_loadMore` | Load more conversation context by going back to the previous stopping point |
| `ben_ten_list_contexts` | List available contexts from local and remote storage |
| `ben_ten_remote_summary` | Get context summary from remote server without full load |
| `ben_ten_remote_segments` | Get transcript segments from remote server on demand |

### ben_ten_save Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sessionId` | Yes | Unique session identifier |
| `summary` | Yes | Summary of the current session/context |
| `keyFiles` | No | Array of important file paths |
| `activeTasks` | No | Array of current tasks/objectives |
| `transcriptPath` | No | Path to transcript file (auto-discovered if not provided) |
| `scope` | No | Where to save: `"local"` (default), `"remote"`, or `"both"` |

### ben_ten_load Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `scope` | No | Where to load from: `"local"`, `"remote"`, or `"auto"` (default) |

**Transcript Auto-Discovery:** The `ben_ten_save` tool automatically discovers and parses Claude Code's transcript to extract conversation history, file references, and tool calls. No hooks required — it finds the most recent transcript in `~/.claude/projects/`.

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

# Start MCP server (usually started by Claude Code)
ben-ten serve

# Start HTTP server for remote storage
ben-ten serve-http --port 3456

# Process Claude Code hooks (used by hooks, not typically run manually)
ben-ten hook

# Remote storage commands
ben-ten remote status    # Check remote server connection
ben-ten remote push      # Push local context to remote
ben-ten remote pull      # Pull context from remote to local

# Configuration
ben-ten config remote.serverUrl http://localhost:3456
ben-ten config remote.enabled true
ben-ten config remote.autoSync true
```

## Remote Storage

Ben-Ten supports syncing context to a remote HTTP server, allowing you to share context across machines.

### Starting the Remote Server

```bash
# Start with default settings (port 3456)
ben-ten serve-http

# Start with custom options
ben-ten serve-http --port 8080 --storage ~/.ben-ten-server --api-key your-secret-key
```

### Using Docker

```bash
# Build and start with Docker Compose
docker compose up -d

# Check server health
curl http://localhost:3456/api/health
```

### Configuring Remote Storage

Configure your project to use remote storage:

```bash
# Set remote server URL
ben-ten config remote.serverUrl http://localhost:3456

# Enable remote storage
ben-ten config remote.enabled true

# Enable auto-sync (save to both local and remote)
ben-ten config remote.autoSync true

# Set API key if required
ben-ten config remote.apiKey your-secret-key
```

Or create `.ben-ten/config.json`:

```json
{
  "remote": {
    "serverUrl": "http://localhost:3456",
    "enabled": true,
    "autoSync": true,
    "apiKey": "your-secret-key"
  }
}
```

### Remote API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/context/:projectHash` | GET | Get context for project |
| `/api/context/:projectHash` | PUT | Save context for project |
| `/api/context/:projectHash` | DELETE | Delete context for project |
| `/api/context/:projectHash/summary` | GET | Get context summary only |
| `/api/context/:projectHash/segments` | GET | Get transcript segments |

## Context Data Structure

Ben-Ten stores context in the following format:

```typescript
interface ContextData {
  version: string;              // Schema version (currently "2.0.0")
  createdAt: number;            // Timestamp of first creation
  updatedAt: number;            // Timestamp of last update
  sessionId: string;            // Last session ID
  summary: string;              // Compacted/session summary
  keyFiles?: string[];          // Important files in the project
  activeTasks?: string[];       // Current tasks/objectives
  conversation?: {              // Extracted from transcript
    messages: TranscriptEntry[];
    messageCount: number;
  };
  conversationReplay?: string;  // Condensed markdown replay of recent conversation
  replayMetadata?: {            // Metadata about the generated replay
    tokenCount: number;
    messageCount: number;
    stoppingPointType: string | null;
    generatedAt: number;
    allStoppingPoints: StoppingPoint[];
    currentStopIndex: number;
  };
  files?: FileMetadata[];       // File references extracted from conversation
  toolHistory?: ToolExecution[]; // Tool calls extracted from conversation
}
```

### Conversation Replay

Ben-Ten generates a condensed conversation replay that fits within a configurable token budget. The replay:

- Parses the transcript backwards to find logical stopping points (git commits, task completions, semantic markers)
- Formats recent messages as markdown for easy reading
- Respects the configured `maxReplayPercent` of `contextWindowSize`

Configure replay settings via the `ben_ten_config` tool:

```bash
# Get current config
ben_ten_config action=get

# Set max replay percentage (default: 10%)
ben_ten_config action=set key=maxReplayPercent value=15

# Set context window size (default: 200000 tokens)
ben_ten_config action=set key=contextWindowSize value=128000
```

### Loading More Context

If the initial replay doesn't provide enough context, use `ben_ten_loadMore` to load back to the previous stopping point:

```
> Need more context? Call `ben_ten_loadMore` to load back to the previous stopping point (2 more available).
```

Call `ben_ten_loadMore` repeatedly to progressively load more conversation history. Each call moves to an earlier stopping point, giving you more context about the previous session.

### Binary File Format

Context files (`.ctx`) use a custom binary format with LZ4 compression:

```
[4 bytes: "BT10" magic header]
[1 byte: format version]
[1 byte: compression type (1 = LZ4)]
[4 bytes: uncompressed size]
[N bytes: LZ4-compressed JSON data]
```

This achieves ~90% compression on typical context data while maintaining fast read/write speeds.

## MCP Resources

- `ben-ten://context` - Read the current project context as markdown

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
│   ├── server.ts    # Tool and resource handlers
│   ├── transport.ts # stdio transport
│   ├── http-server.ts    # HTTP server for remote storage
│   └── http-transport.ts # HTTP transport implementation
├── services/        # Business logic
│   ├── context-service.ts           # Context persistence
│   ├── context-resolution-service.ts # Multi-source context resolution
│   ├── compression-service.ts       # LZ4 compression wrapper
│   ├── config-service.ts            # Configuration management
│   ├── project-identifier-service.ts # Project hash generation
│   ├── remote-context-service.ts    # Remote storage client
│   ├── replay-service.ts            # Conversation replay generation
│   ├── serializer-service.ts        # Binary format serialization
│   ├── hook-handler.ts              # Claude Code hook handling
│   └── transcript-service.ts        # Transcript parsing
└── types/           # External type declarations
```

### Key Design Decisions

- **Result<T, E> Type** - Explicit error handling without exceptions
- **Dependency Injection** - All services accept dependencies for testability
- **In-Memory FS** - Tests use memory filesystem for isolation and speed
- **Zod Schemas** - Runtime validation of all external data
- **Multi-Source Resolution** - Context can come from local or remote storage

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
