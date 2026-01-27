import type { FileSystem } from '../adapters/fs/memory-fs.js';
import type { ContextData, HookInput } from '../core/types.js';
import type { Ben10Error } from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { createContextService } from './context-service.js';

/** Result of handling a SessionStart event */
export interface SessionStartResult {
  contextLoaded: boolean;
  contextSaved: boolean;
  contextCleared: boolean;
  context?: ContextData;
}

/** Result of handling a PreCompact event */
export type PreCompactResult = Record<string, never>;

/** Union of all hook results */
export type HookResult = SessionStartResult | PreCompactResult;

/**
 * Handler for Claude Code lifecycle hooks.
 */
export interface HookHandler {
  /** Handle a SessionStart event */
  handleSessionStart(
    input: HookInput,
  ): Promise<Result<SessionStartResult, Ben10Error>>;

  /** Handle a PreCompact event */
  handlePreCompact(
    input: HookInput,
  ): Promise<Result<PreCompactResult, Ben10Error>>;

  /** Dispatch to appropriate handler based on hook_event_name */
  handle(input: HookInput): Promise<Result<HookResult, Ben10Error>>;
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

      // Handle based on source
      switch (input.source) {
        case 'startup':
        case 'resume': {
          // Load existing context if available
          if (await contextService.hasContext()) {
            const loadResult = await contextService.loadContext();
            if (loadResult.ok) {
              logger.info('Context loaded', {
                sessionId: loadResult.value.sessionId,
              });
              return ok({
                contextLoaded: true,
                contextSaved: false,
                contextCleared: false,
                context: loadResult.value,
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
          // Saving is handled by ben10_save MCP tool
          logger.debug('Compaction occurred, loading existing context');
          if (await contextService.hasContext()) {
            const loadResult = await contextService.loadContext();
            if (loadResult.ok) {
              logger.info('Context loaded after compaction', {
                sessionId: loadResult.value.sessionId,
              });
              return ok({
                contextLoaded: true,
                contextSaved: false,
                contextCleared: false,
                context: loadResult.value,
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

    async handlePreCompact(_input) {
      // PreCompact is a no-op - we use SessionStart with source="compact" instead
      logger.debug('PreCompact is a no-op');
      return ok({});
    },

    async handle(input) {
      switch (input.hook_event_name) {
        case 'SessionStart':
          return handler.handleSessionStart(input);
        case 'PreCompact':
          return handler.handlePreCompact(input);
        default:
          // SessionEnd and other events are no-ops
          // Saving is handled by ben10_save MCP tool
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
