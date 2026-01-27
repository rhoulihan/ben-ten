import type { FileSystem } from '../adapters/fs/memory-fs.js';
import type { ContextData, HookInput } from '../core/types.js';
import {
  type Ben10Error,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
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

/** Result of handling a SessionEnd event */
export interface SessionEndResult {
  contextSaved: boolean;
}

/** Result of handling a PreCompact event */
export type PreCompactResult = Record<string, never>;

/** Union of all hook results */
export type HookResult =
  | SessionStartResult
  | SessionEndResult
  | PreCompactResult;

/**
 * Handler for Claude Code lifecycle hooks.
 */
export interface HookHandler {
  /** Handle a SessionStart event */
  handleSessionStart(
    input: HookInput,
  ): Promise<Result<SessionStartResult, Ben10Error>>;

  /** Handle a SessionEnd event */
  handleSessionEnd(
    input: HookInput,
  ): Promise<Result<SessionEndResult, Ben10Error>>;

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
 * Extract summary from a Claude Code transcript file.
 * The transcript is a JSONL file with various message types.
 * We look for the 'summary' type which contains the compaction output.
 */
const extractSummaryFromTranscript = async (
  fs: FileSystem,
  transcriptPath: string,
  logger: Logger,
): Promise<Result<string, Ben10Error>> => {
  const readResult = await fs.readFile(transcriptPath);
  if (!readResult.ok) {
    return err(readResult.error);
  }

  const lines = readResult.value.trim().split('\n');

  // Look for summary entries in the transcript
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'summary' && typeof entry.summary === 'string') {
        return ok(entry.summary);
      }
    } catch {
      // Skip malformed lines
      logger.debug('Skipping malformed transcript line');
    }
  }

  // If no summary found, concatenate all assistant messages as fallback
  const messages: string[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'assistant' && typeof entry.content === 'string') {
        messages.push(entry.content);
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (messages.length > 0) {
    return ok(messages.join('\n'));
  }

  // Return empty summary if nothing found
  return ok('');
};

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
          // Read the freshly compacted transcript and save it
          const summaryResult = await extractSummaryFromTranscript(
            fs,
            input.transcript_path,
            logger,
          );
          if (!summaryResult.ok) {
            return err(summaryResult.error);
          }

          // Load existing context to preserve createdAt
          let createdAt = Date.now();
          if (await contextService.hasContext()) {
            const existingResult = await contextService.loadContext();
            if (existingResult.ok) {
              createdAt = existingResult.value.createdAt;
            }
          }

          const contextData: ContextData = {
            version: '1.0.0',
            createdAt,
            updatedAt: Date.now(),
            sessionId: input.session_id,
            summary: summaryResult.value,
          };

          const saveResult = await contextService.saveContext(contextData);
          if (!saveResult.ok) {
            return err(saveResult.error);
          }

          logger.info('Context saved after compaction', {
            sessionId: input.session_id,
          });

          return ok({
            contextLoaded: false,
            contextSaved: true,
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

    async handleSessionEnd(input) {
      const projectDir = input.cwd;
      const contextService = createContextService({ fs, logger, projectDir });

      logger.debug('Handling SessionEnd', {
        sessionId: input.session_id,
        projectDir,
      });

      // Read the transcript
      const summaryResult = await extractSummaryFromTranscript(
        fs,
        input.transcript_path,
        logger,
      );
      if (!summaryResult.ok) {
        return err(summaryResult.error);
      }

      // Load existing context to preserve createdAt
      let createdAt = Date.now();
      if (await contextService.hasContext()) {
        const existingResult = await contextService.loadContext();
        if (existingResult.ok) {
          createdAt = existingResult.value.createdAt;
        }
      }

      const contextData: ContextData = {
        version: '1.0.0',
        createdAt,
        updatedAt: Date.now(),
        sessionId: input.session_id,
        summary: summaryResult.value,
      };

      const saveResult = await contextService.saveContext(contextData);
      if (!saveResult.ok) {
        return err(saveResult.error);
      }

      logger.info('Context saved on session end', {
        sessionId: input.session_id,
      });

      return ok({
        contextSaved: true,
      });
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
        case 'SessionEnd':
          return handler.handleSessionEnd(input);
        case 'PreCompact':
          return handler.handlePreCompact(input);
        default:
          return err(
            createError(
              ErrorCode.HOOK_INVALID_INPUT,
              `Unknown hook event: ${input.hook_event_name}`,
              { hookEventName: input.hook_event_name },
            ),
          );
      }
    },
  };

  return handler;
};
