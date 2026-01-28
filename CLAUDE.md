# Ben-Ten

Context persistence for Claude Code. Named after Ben Tennyson's photographic memory.

Ben-Ten automatically saves and restores Claude Code's context window state across sessions, eliminating the "cold start" problem where developers spend 5-15 minutes re-establishing context.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20+ LTS | Stable, matches Claude Code |
| Language | TypeScript 5.x strict | Type safety, no `any` |
| Package Manager | pnpm | Workspace support, fast |
| Build | tsup | Zero-config, fast ESM/CJS |
| Test | Vitest | Native ESM, TypeScript-first |
| Lint/Format | Biome | Fast, unified tooling |
| Serialization | JSON + LZ4 | Fast compression, ~90% size reduction |
| Future | MessagePack + LZ4 | Even faster binary serialization |

## Architecture

```
src/
├── core/           # Pure domain logic
│   └── types.ts    # Zod schemas, ContextData, HookInput
├── adapters/       # External world (ports)
│   └── fs/         # File system operations (memory + node)
├── cli/            # Command handlers
│   ├── hook-command.ts  # Hook CLI entry
│   └── index.ts         # CLI exports
├── infrastructure/ # Cross-cutting concerns
│   ├── logger.ts   # Structured logging
│   ├── errors.ts   # Error codes and types
│   └── result.ts   # Result<T, E> type utilities
├── mcp/            # MCP server
│   ├── server.ts   # Tool and resource handlers
│   └── transport.ts # stdio transport
├── services/       # Business logic
│   ├── context-service.ts      # Context persistence
│   ├── compression-service.ts  # LZ4 wrapper
│   ├── serializer-service.ts   # Binary format (JSON + LZ4)
│   ├── hook-handler.ts         # Hook event handling
│   └── transcript-service.ts   # Transcript parsing
├── types/          # External type declarations
│   └── lz4js.d.ts  # lz4js types
└── index.ts        # Public API exports
```

**Patterns:**
- Hexagonal architecture (ports & adapters)
- Dependency injection via factory functions
- Result types for errors (`Result<T, E>`)
- Functional core, imperative shell

## Coding Standards

### File Naming
- `kebab-case.ts` for files
- `PascalCase` for types/interfaces
- `camelCase` for functions/variables
- `*.test.ts` co-located with source

### Exports
```typescript
// Named exports only
export { serialize, deserialize } from './serializer.ts';
export type { ContextState } from './types.ts';

// Barrel files ONLY for public API (src/index.ts)
// Internal modules import directly
```

### Error Handling
```typescript
// Use Result type for expected errors
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Factory functions
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Usage - never throw for expected errors
function loadContext(path: string): Result<ContextState, LoadError> {
  if (!exists(path)) return err({ code: 'NOT_FOUND', path });
  // ...
}
```

### Logging
```typescript
// Inject logger, never use console directly
interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// Usage
function save(ctx: ContextState, deps: { logger: Logger; fs: FileSystem }) {
  deps.logger.info('Saving context', { size: ctx.messages.length });
}
```

### JSDoc
```typescript
/**
 * Serializes context state to binary format.
 *
 * @param state - The context state to serialize
 * @returns Compressed binary buffer
 * @example
 * const buffer = serialize(contextState);
 * await fs.writeFile('context.ctx', buffer);
 */
export function serialize(state: ContextState): Buffer { }
```

## Commands

```bash
# Development
pnpm dev              # Watch mode
pnpm build            # Production build
pnpm typecheck        # tsc --noEmit

# Testing
pnpm test             # Run all tests
pnpm test:unit        # Unit tests only
pnpm test:int         # Integration tests
pnpm test:cov         # With coverage
pnpm test src/core    # Specific directory

# Quality
pnpm lint             # Biome check
pnpm lint:fix         # Biome fix
pnpm check            # lint + typecheck + test
```

## Critical Constraints

| Rule | Enforcement |
|------|-------------|
| No `any` types | `tsconfig: "noImplicitAny": true` + Biome |
| No floating promises | `@typescript-eslint/no-floating-promises` |
| No default exports | Biome rule |
| No `console.*` | Biome rule (except CLI entry) |
| All public functions have JSDoc | Code review |
| Tests for all public API | Coverage gate >90% |
| No secrets in logs | Secret detection in CI |

## Key Types

```typescript
interface ContextState {
  version: string;
  directoryPath: string;
  directoryHash: string;
  createdAt: number;
  updatedAt: number;
  sessionCount: number;
  conversation: ConversationHistory;
  files: FileRegistry;
  tools: ToolExecutionHistory;
  tasks: TaskState;
  preferences: LearnedPreferences;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokenCount: number;
  metadata: MessageMetadata;
}

interface CompactionSnapshot {
  id: string;
  createdAt: number;
  sessionId: string;
  preCompaction: CompactionMetrics;
  postCompaction: CompactionMetrics;
  trigger: 'threshold' | 'manual' | 'memory_pressure';
  contentHash: string;
  compressedSize: number;
  pinned: boolean;
}
```

## Storage Layout

```
.ben-ten/
├── context.ctx               # Active context (JSON + LZ4 compressed)
├── context.json              # Legacy format (auto-migrated to .ctx)
├── metadata.json             # Session metadata (JSON)
└── config.yaml               # Project-specific Ben-Ten settings (future)
```

### Binary Format (context.ctx)

```
[4 bytes: "BT10" magic header]
[1 byte: FORMAT_VERSION (0x01)]
[1 byte: COMPRESSION_TYPE (0x01 = LZ4)]
[4 bytes: UNCOMPRESSED_SIZE (uint32 LE)]
[N bytes: LZ4-compressed JSON data]
```

Achieves ~90% compression on typical context data.

## Do Not

- **Import from `node:` without adapter** — All I/O through injected dependencies
- **Throw for expected errors** — Use `Result<T, E>` types
- **Use `any` or `as unknown as T`** — Write proper type guards
- **Log sensitive data** — Check for secrets, tokens, keys
- **Block the event loop** — Use async file operations
- **Mutate shared state** — Functional core, copy-on-write
- **Skip error handling** — Every Result must be checked
- **Write tests after code** — TDD: red-green-refactor
- **Create circular dependencies** — Core never imports from adapters
- **Use relative imports across boundaries** — Use path aliases

## Performance Targets

| Operation | Target | Method |
|-----------|--------|--------|
| Save (exit) | <500ms | Async, non-blocking |
| Restore | <1s for <10MB | Lazy loading |
| Checkpoint | <200ms | Incremental |
| Status query | <50ms | Cached metadata |

## Testing Strategy

```
tests/
├── unit/           # Pure functions, mocked deps
├── integration/    # Real FS (memfs), real serialization
├── e2e/            # Full CLI scenarios
└── fixtures/       # Sample context files
```

- Unit: Fast, isolated, mock all adapters
- Integration: memfs for file system, real serialization
- E2E: Actual CLI invocation, temp directories
