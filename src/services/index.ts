export {
  createContextService,
  type ContextService,
  type ContextServiceDeps,
  BEN10_DIR,
  CONTEXT_FILE,
  CONTEXT_FILE_LEGACY,
  METADATA_FILE,
} from './context-service.js';

export {
  createHookHandler,
  type HookHandler,
  type HookHandlerDeps,
  type SessionStartResult,
  type PreCompactResult,
  type HookResult,
} from './hook-handler.js';

export {
  createCompressionService,
  type CompressionService,
} from './compression-service.js';

export {
  createSerializerService,
  type SerializerService,
  type FormatType,
  MAGIC_HEADER,
  FORMAT_VERSION,
  COMPRESSION_TYPE,
} from './serializer-service.js';

export {
  createConfigService,
  type ConfigService,
  type ConfigServiceDeps,
  type BenTenConfig,
  CONFIG_FILE,
  DEFAULT_CONFIG,
} from './config-service.js';

export {
  createReplayService,
  findAllStoppingPoints,
  type ReplayService,
  type ReplayServiceDeps,
  type ReplayOptions,
  type ReplayResult,
  type StoppingPoint,
  type StoppingPointType,
  estimateTokens,
  isGitCommit,
  isTaskCompletion,
  isSemanticMarker,
} from './replay-service.js';
