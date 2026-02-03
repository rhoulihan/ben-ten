import type { FileSystem } from '../adapters/fs/memory-fs.js';
import type { ContextData, ContextMetadata, HookInput } from '../core/types.js';
import type { BenTenError } from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { createContextService } from './context-service.js';

/** Simple hash function for directory paths */
const hashDirectory = (path: string): string => {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
};

/** Result of handling a SessionStart event */
export interface SessionStartResult {
  contextLoaded: boolean;
  contextSaved: boolean;
  contextCleared: boolean;
  context?: ContextData;
  /** Source where context was loaded from */
  source?: 'local' | 'remote';
}

/** Result of handling a PreCompact event */
export interface PreCompactResult {
  contextSaved: boolean;
  sessionId?: string;
  error?: string;
}

/** Union of all hook results */
export type HookResult = SessionStartResult | PreCompactResult;

/**
 * Handler for Claude Code lifecycle hooks.
 */
export interface HookHandler {
  /** Handle a SessionStart event */
  handleSessionStart(
    input: HookInput,
  ): Promise<Result<SessionStartResult, BenTenError>>;

  /** Handle a PreCompact event */
  handlePreCompact(
    input: HookInput,
  ): Promise<Result<PreCompactResult, BenTenError>>;

  /** Dispatch to appropriate handler based on hook_event_name */
  handle(input: HookInput): Promise<Result<HookResult, BenTenError>>;
}

export interface HookHandlerDeps {
  fs: FileSystem;
  logger: Logger;
}

/**
 * Creates a hook handler for Claude Code lifecycle events.
 *
 * @param deps - Dependencies including file system and logger
 * @returns A HookHandler instance
 */
export const createHookHandler = (deps: HookHandlerDeps): HookHandler => {
  const { fs, logger } = deps;

  const handler: HookHandler = {
    async handleSessionStart(input) {
      const projectDir = input.cwd;
      const contextService = createContextService({ fs, logger, projectDir });

      logger.debug('Handling SessionStart', {
        sessionId: input.session_id,
        source: input.source,
        projectDir,
      });

      // Save metadata with transcript path for later use by ben_ten_save
      const saveMetadata = async () => {
        // Load existing metadata to preserve session count
        let sessionCount = 1;
        if (await contextService.hasMetadata()) {
          const existingMeta = await contextService.loadMetadata();
          if (existingMeta.ok) {
            sessionCount = existingMeta.value.sessionCount + 1;
          }
        }

        const metadata: ContextMetadata = {
          directory: projectDir,
          directoryHash: hashDirectory(projectDir),
          lastSessionId: input.session_id,
          sessionCount,
          lastSavedAt: Date.now(),
          transcriptPath: input.transcript_path,
        };
        await contextService.saveMetadata(metadata);
      };

      // Handle based on source
      switch (input.source) {
        case 'startup':
        case 'resume': {
          // Save metadata with transcript path
          await saveMetadata();

          // Load existing context if available
          if (await contextService.hasContext()) {
            const loadResult = await contextService.loadContext();
            if (loadResult.ok) {
              logger.info('Context loaded from local storage', {
                sessionId: loadResult.value.sessionId,
              });
              return ok({
                contextLoaded: true,
                contextSaved: false,
                contextCleared: false,
                context: loadResult.value,
                source: 'local',
              });
            }
            // Log warning but don't fail - context may be corrupted
            logger.warn('Failed to load existing context', {
              error: loadResult.error.message,
            });
          }
          return ok({
            contextLoaded: false,
            contextSaved: false,
            contextCleared: false,
          });
        }

        case 'compact': {
          // After compaction, just load existing context if available
          // Saving is handled by ben_ten_save MCP tool
          logger.debug('Compaction occurred, loading existing context');
          if (await contextService.hasContext()) {
            const loadResult = await contextService.loadContext();
            if (loadResult.ok) {
              logger.info(
                'Context loaded from local storage after compaction',
                {
                  sessionId: loadResult.value.sessionId,
                },
              );
              return ok({
                contextLoaded: true,
                contextSaved: false,
                contextCleared: false,
                context: loadResult.value,
                source: 'local',
              });
            }
          }
          return ok({
            contextLoaded: false,
            contextSaved: false,
            contextCleared: false,
          });
        }

        case 'clear': {
          // Delete existing context
          const deleteResult = await contextService.deleteContext();
          if (!deleteResult.ok) {
            return err(deleteResult.error);
          }

          logger.info('Context cleared', { projectDir });

          return ok({
            contextLoaded: false,
            contextSaved: false,
            contextCleared: true,
          });
        }

        default: {
          // Unknown source - treat as startup
          logger.debug('Unknown source, treating as startup', {
            source: input.source,
          });
          if (await contextService.hasContext()) {
            const loadResult = await contextService.loadContext();
            if (loadResult.ok) {
              return ok({
                contextLoaded: true,
                contextSaved: false,
                contextCleared: false,
                context: loadResult.value,
                source: 'local',
              });
            }
          }
          return ok({
            contextLoaded: false,
            contextSaved: false,
            contextCleared: false,
          });
        }
      }
    },

    async handlePreCompact(input) {
      const projectDir = input.cwd;
      const contextService = createContextService({ fs, logger, projectDir });

      logger.debug(
        'Handling PreCompact - auto-saving context before compaction',
        {
          sessionId: input.session_id,
          trigger: input.trigger,
          projectDir,
        },
      );

      // Load existing context to preserve it
      let existingContext: ContextData | undefined;
      if (await contextService.hasContext()) {
        const loadResult = await contextService.loadContext();
        if (loadResult.ok) {
          existingContext = loadResult.value;
        }
      }

      // Create or update context with pre-compaction marker
      const now = Date.now();
      const contextToSave: ContextData = existingContext
        ? {
            ...existingContext,
            updatedAt: now,
            sessionId: input.session_id,
            isPreCompactionSnapshot: true,
            compactionTrigger: input.trigger ?? 'auto',
          }
        : {
            version: '2.0.0',
            createdAt: now,
            updatedAt: now,
            sessionId: input.session_id,
            summary: 'Auto-saved before compaction',
            isPreCompactionSnapshot: true,
            compactionTrigger: input.trigger ?? 'auto',
          };

      const saveResult = await contextService.saveContext(contextToSave);
      if (!saveResult.ok) {
        logger.warn('Failed to auto-save context before compaction', {
          error: saveResult.error.message,
        });
        return ok({
          contextSaved: false,
          sessionId: input.session_id,
          error: saveResult.error.message,
        });
      }

      logger.info('Context auto-saved before compaction', {
        sessionId: input.session_id,
        trigger: input.trigger,
      });

      return ok({
        contextSaved: true,
        sessionId: input.session_id,
      });
    },

    async handle(input) {
      switch (input.hook_event_name) {
        case 'SessionStart':
          return handler.handleSessionStart(input);
        case 'PreCompact':
          return handler.handlePreCompact(input);
        default:
          // SessionEnd and other events are no-ops
          // Saving is handled by ben_ten_save MCP tool
          logger.debug('Ignoring hook event', {
            hookEventName: input.hook_event_name,
          });
          return ok({
            contextLoaded: false,
            contextSaved: false,
            contextCleared: false,
          });
      }
    },
  };

  return handler;
};
