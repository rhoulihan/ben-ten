// Infrastructure
export {
  type Result,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  flatMap,
} from './infrastructure/result.js';

export {
  ErrorCode,
  createError,
  isErrorCode,
  type BenTenError,
} from './infrastructure/errors.js';

export {
  createLogger,
  LogLevel,
  type Logger,
  type LoggerOptions,
} from './infrastructure/logger.js';

// Core types
export {
  HookInputSchema,
  ContextDataSchema,
  ContextMetadataSchema,
  parseHookInput,
  parseContextData,
  parseContextMetadata,
  createEmptyContext,
  updateContext,
  type HookInput,
  type ContextData,
  type ContextMetadata,
} from './core/types.js';

// File system adapters
export {
  createMemoryFs,
  createNodeFs,
  type FileSystem,
  type FileStats,
  type MkdirOptions,
  type RmOptions,
} from './adapters/fs/index.js';

// Services
export {
  createContextService,
  createHookHandler,
  BEN10_DIR,
  CONTEXT_FILE,
  METADATA_FILE,
  type ContextService,
  type ContextServiceDeps,
  type HookHandler,
  type HookHandlerDeps,
  type SessionStartResult,
  type PreCompactResult,
  type HookResult,
} from './services/index.js';

// MCP Server
export {
  createBenTenServer,
  startMcpServer,
  type BenTenServer,
  type BenTenServerDeps,
  type McpTransportDeps,
  type ToolDefinition,
  type ResourceDefinition,
  type ResourceContent,
  type ServerInfo,
  type StatusResult,
  type SaveResult,
  type ClearResult,
} from './mcp/index.js';

// CLI
export {
  runHookCommand,
  main as hookMain,
  type HookCommandResult,
  type HookCommandOptions,
} from './cli/index.js';
