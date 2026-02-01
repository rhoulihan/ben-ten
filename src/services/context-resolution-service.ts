import type { ContextData } from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import type { ContextService } from './context-service.js';
import type { ProjectIdentifierService } from './project-identifier-service.js';
import type { RemoteContextService } from './remote-context-service.js';

/**
 * Information about a context's location.
 */
export interface ContextLocation {
  /** Where the context is stored */
  source: 'local' | 'remote';
  /** When the context was last updated */
  updatedAt: number;
  /** Session ID of the context */
  sessionId: string;
  /** Preview of the summary (first 200 chars) */
  summaryPreview: string;
}

/**
 * Result of context resolution.
 */
export interface ContextResolutionResult {
  /** Which source was selected */
  selected: 'local' | 'remote' | 'none';
  /** The resolved context (if auto-loaded) */
  context?: ContextData;
  /** Available context locations (when needsChoice is true) */
  locations?: {
    local?: ContextLocation;
    remote?: ContextLocation;
  };
  /** Whether user needs to choose between sources */
  needsChoice: boolean;
  /** Project hash used for remote lookups */
  projectHash?: string;
}

/**
 * Options for context resolution.
 */
export interface ContextResolutionOptions {
  /** Directory to resolve context for */
  projectDir: string;
  /** Preferred source when both exist */
  preferredSource?: 'local' | 'remote';
  /** Force loading from specific source */
  forceSource?: 'local' | 'remote';
}

/**
 * Options for saving context.
 */
export interface ContextSaveOptions {
  /** Directory to save context for */
  projectDir: string;
  /** Save to local storage */
  saveLocal?: boolean;
  /** Save to remote storage */
  saveRemote?: boolean;
}

/**
 * Service for resolving context from local or remote sources.
 */
export interface ContextResolutionService {
  /**
   * Resolve context from available sources.
   * Returns needsChoice=true if both local and remote exist with different timestamps.
   *
   * @param opts - Resolution options
   * @returns Result with resolution result or error
   */
  resolveContext(
    opts: ContextResolutionOptions,
  ): Promise<Result<ContextResolutionResult, BenTenError>>;

  /**
   * Save context to specified destinations.
   *
   * @param context - The context data to save
   * @param opts - Save options
   * @returns Result indicating success or error
   */
  saveContext(
    context: ContextData,
    opts: ContextSaveOptions,
  ): Promise<Result<void, BenTenError>>;

  /**
   * Get locations of available contexts.
   *
   * @param projectDir - The project directory
   * @returns Result with available locations or error
   */
  getAvailableLocations(projectDir: string): Promise<
    Result<
      {
        local?: ContextLocation;
        remote?: ContextLocation;
        projectHash?: string;
      },
      BenTenError
    >
  >;
}

export interface ContextResolutionServiceDeps {
  logger: Logger;
  localContextService: ContextService;
  remoteContextService?: RemoteContextService;
  projectIdentifierService: ProjectIdentifierService;
}

/**
 * Creates a context resolution service.
 *
 * @param deps - Dependencies including local/remote services and project identifier
 * @returns A ContextResolutionService instance
 * @example
 * const service = createContextResolutionService({
 *   logger,
 *   localContextService,
 *   remoteContextService,
 *   projectIdentifierService,
 * });
 * const result = await service.resolveContext({ projectDir: '/path/to/project' });
 */
export const createContextResolutionService = (
  deps: ContextResolutionServiceDeps,
): ContextResolutionService => {
  const {
    logger,
    localContextService,
    remoteContextService,
    projectIdentifierService,
  } = deps;

  const service: ContextResolutionService = {
    async resolveContext(opts) {
      const { projectDir, preferredSource, forceSource } = opts;
      logger.debug('Resolving context', {
        projectDir,
        preferredSource,
        forceSource,
      });

      // Get project identifier for remote lookup
      const identifierResult =
        await projectIdentifierService.getProjectIdentifier(projectDir);
      if (!identifierResult.ok) {
        return err(identifierResult.error);
      }
      const { projectHash } = identifierResult.value;

      // Check local context
      const hasLocal = await localContextService.hasContext();
      let localContext: ContextData | undefined;
      let localLocation: ContextLocation | undefined;

      if (hasLocal) {
        const loadResult = await localContextService.loadContext();
        if (loadResult.ok) {
          localContext = loadResult.value;
          localLocation = {
            source: 'local',
            updatedAt: localContext.updatedAt,
            sessionId: localContext.sessionId,
            summaryPreview: localContext.summary.slice(0, 200),
          };
        }
      }

      // Check remote context if service is available
      let hasRemote = false;
      let remoteContext: ContextData | undefined;
      let remoteLocation: ContextLocation | undefined;

      if (remoteContextService) {
        const healthResult = await remoteContextService.healthCheck();
        if (healthResult.ok && healthResult.value) {
          const existsResult =
            await remoteContextService.hasContext(projectHash);
          if (existsResult.ok && existsResult.value) {
            hasRemote = true;

            // Load remote context for comparison
            const loadResult =
              await remoteContextService.loadContext(projectHash);
            if (loadResult.ok) {
              remoteContext = loadResult.value;
              remoteLocation = {
                source: 'remote',
                updatedAt: remoteContext.updatedAt,
                sessionId: remoteContext.sessionId,
                summaryPreview: remoteContext.summary.slice(0, 200),
              };
            }
          }
        }
      }

      // Handle forced source
      if (forceSource === 'local') {
        if (!localContext) {
          return ok({
            selected: 'none',
            needsChoice: false,
            projectHash,
          });
        }
        return ok({
          selected: 'local',
          context: localContext,
          needsChoice: false,
          projectHash,
        });
      }

      if (forceSource === 'remote') {
        if (!remoteContext) {
          return ok({
            selected: 'none',
            needsChoice: false,
            projectHash,
          });
        }
        return ok({
          selected: 'remote',
          context: remoteContext,
          needsChoice: false,
          projectHash,
        });
      }

      // No context available
      if (!hasLocal && !hasRemote) {
        logger.debug('No context found in any source');
        return ok({
          selected: 'none',
          needsChoice: false,
          projectHash,
        });
      }

      // Only local exists
      if (hasLocal && !hasRemote) {
        logger.debug('Using local context (only source)', {
          sessionId: localContext?.sessionId,
        });
        return ok({
          selected: 'local',
          context: localContext,
          needsChoice: false,
          projectHash,
        });
      }

      // Only remote exists
      if (!hasLocal && hasRemote) {
        logger.debug('Using remote context (only source)', {
          sessionId: remoteContext?.sessionId,
        });
        return ok({
          selected: 'remote',
          context: remoteContext,
          needsChoice: false,
          projectHash,
        });
      }

      // Both exist - check if same session or need choice
      if (localContext && remoteContext) {
        // If same session ID and similar timestamps, use local (faster)
        if (
          localContext.sessionId === remoteContext.sessionId &&
          Math.abs(localContext.updatedAt - remoteContext.updatedAt) < 60000 // within 1 minute
        ) {
          logger.debug('Using local context (same session)', {
            sessionId: localContext.sessionId,
          });
          return ok({
            selected: 'local',
            context: localContext,
            needsChoice: false,
            projectHash,
          });
        }

        // If preferred source is specified, use it
        if (preferredSource === 'local') {
          return ok({
            selected: 'local',
            context: localContext,
            needsChoice: false,
            projectHash,
          });
        }

        if (preferredSource === 'remote') {
          return ok({
            selected: 'remote',
            context: remoteContext,
            needsChoice: false,
            projectHash,
          });
        }

        // User needs to choose
        logger.debug('Multiple contexts found, user needs to choose', {
          localUpdatedAt: localContext.updatedAt,
          remoteUpdatedAt: remoteContext.updatedAt,
        });

        return ok({
          selected: 'none',
          locations: {
            local: localLocation,
            remote: remoteLocation,
          },
          needsChoice: true,
          projectHash,
        });
      }

      // Fallback (shouldn't reach here)
      return ok({
        selected: 'none',
        needsChoice: false,
        projectHash,
      });
    },

    async saveContext(context, opts) {
      const { projectDir, saveLocal = true, saveRemote = false } = opts;
      logger.debug('Saving context', { projectDir, saveLocal, saveRemote });

      const errors: string[] = [];

      // Save locally
      if (saveLocal) {
        const saveResult = await localContextService.saveContext(context);
        if (!saveResult.ok) {
          errors.push(`Local: ${saveResult.error.message}`);
          logger.error('Failed to save context locally', {
            error: saveResult.error.message,
          });
        }
      }

      // Save remotely
      if (saveRemote) {
        if (!remoteContextService) {
          errors.push('Remote: Remote storage is not configured');
          logger.error('Failed to save context remotely', {
            error: 'Remote storage is not configured',
          });
        } else {
          const identifierResult =
            await projectIdentifierService.getProjectIdentifier(projectDir);

          if (identifierResult.ok) {
            const { projectHash } = identifierResult.value;
            const saveResult = await remoteContextService.saveContext(
              projectHash,
              context,
            );
            if (!saveResult.ok) {
              errors.push(`Remote: ${saveResult.error.message}`);
              logger.error('Failed to save context remotely', {
                error: saveResult.error.message,
              });
            }
          } else {
            errors.push(
              `Project identification: ${identifierResult.error.message}`,
            );
          }
        }
      }

      if (errors.length > 0) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            `Failed to save context: ${errors.join('; ')}`,
            { errors },
          ),
        );
      }

      return ok(undefined);
    },

    async getAvailableLocations(projectDir) {
      logger.debug('Getting available locations', { projectDir });

      // Get project identifier
      const identifierResult =
        await projectIdentifierService.getProjectIdentifier(projectDir);
      if (!identifierResult.ok) {
        return err(identifierResult.error);
      }
      const { projectHash } = identifierResult.value;

      const locations: {
        local?: ContextLocation;
        remote?: ContextLocation;
        projectHash?: string;
      } = { projectHash };

      // Check local
      if (await localContextService.hasContext()) {
        const loadResult = await localContextService.loadContext();
        if (loadResult.ok) {
          const ctx = loadResult.value;
          locations.local = {
            source: 'local',
            updatedAt: ctx.updatedAt,
            sessionId: ctx.sessionId,
            summaryPreview: ctx.summary.slice(0, 200),
          };
        }
      }

      // Check remote
      if (remoteContextService) {
        const healthResult = await remoteContextService.healthCheck();
        if (healthResult.ok && healthResult.value) {
          const summaryResult =
            await remoteContextService.getContextSummary(projectHash);
          if (summaryResult.ok) {
            const summary = summaryResult.value;
            locations.remote = {
              source: 'remote',
              updatedAt: summary.updatedAt,
              sessionId: summary.sessionId,
              summaryPreview: summary.summary.slice(0, 200),
            };
          }
        }
      }

      return ok(locations);
    },
  };

  return service;
};
