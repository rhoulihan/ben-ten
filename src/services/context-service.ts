import type { FileSystem } from '../adapters/fs/memory-fs.js';
import { type ContextData, parseContextData } from '../core/types.js';
import {
  type Ben10Error,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';

/** Directory name for Ben10 storage */
export const BEN10_DIR = '.ben10';

/** Context data file name */
export const CONTEXT_FILE = 'context.json';

/** Metadata file name */
export const METADATA_FILE = 'metadata.json';

/**
 * Service for managing context persistence.
 */
export interface ContextService {
  /** Check if context exists for this project */
  hasContext(): Promise<boolean>;

  /** Load context from disk */
  loadContext(): Promise<Result<ContextData, Ben10Error>>;

  /** Save context to disk */
  saveContext(context: ContextData): Promise<Result<void, Ben10Error>>;

  /** Delete context file */
  deleteContext(): Promise<Result<void, Ben10Error>>;

  /** Get full path to context file */
  getContextPath(): string;

  /** Get full path to .ben10 directory */
  getBen10Dir(): string;
}

export interface ContextServiceDeps {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

/**
 * Creates a context service for managing context persistence.
 *
 * @param deps - Dependencies including file system and logger
 * @returns A ContextService instance
 */
export const createContextService = (
  deps: ContextServiceDeps,
): ContextService => {
  const { fs, logger, projectDir } = deps;

  const ben10Dir = `${projectDir}/${BEN10_DIR}`;
  const contextPath = `${ben10Dir}/${CONTEXT_FILE}`;

  const service: ContextService = {
    async hasContext() {
      return fs.exists(contextPath);
    },

    async loadContext() {
      logger.debug('Loading context', { path: contextPath });

      // Check if file exists
      if (!(await fs.exists(contextPath))) {
        return err(
          createError(ErrorCode.CONTEXT_NOT_FOUND, 'No context file found', {
            path: contextPath,
          }),
        );
      }

      // Read file
      const readResult = await fs.readFile(contextPath);
      if (!readResult.ok) {
        return err(
          createError(
            ErrorCode.CONTEXT_CORRUPTED,
            'Failed to read context file',
            { path: contextPath, originalError: readResult.error.message },
          ),
        );
      }

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(readResult.value);
      } catch (e) {
        logger.warn('Failed to parse context JSON', {
          path: contextPath,
          error: e instanceof Error ? e.message : String(e),
        });
        return err(
          createError(
            ErrorCode.CONTEXT_CORRUPTED,
            'Context file contains invalid JSON',
            { path: contextPath },
          ),
        );
      }

      // Validate structure
      const validateResult = parseContextData(parsed);
      if (!validateResult.ok) {
        logger.warn('Context file has invalid structure', {
          path: contextPath,
          errors: validateResult.error.details,
        });
        return err(
          createError(
            ErrorCode.CONTEXT_CORRUPTED,
            'Context file has invalid structure',
            {
              path: contextPath,
              validationErrors: validateResult.error.details,
            },
          ),
        );
      }

      logger.info('Context loaded successfully', {
        sessionId: validateResult.value.sessionId,
        summaryLength: validateResult.value.summary.length,
      });

      return ok(validateResult.value);
    },

    async saveContext(context) {
      logger.debug('Saving context', {
        path: contextPath,
        sessionId: context.sessionId,
      });

      // Ensure .ben10 directory exists
      const mkdirResult = await fs.mkdir(ben10Dir, { recursive: true });
      if (!mkdirResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to create .ben10 directory',
            { path: ben10Dir, originalError: mkdirResult.error.message },
          ),
        );
      }

      // Write context file
      const content = JSON.stringify(context, null, 2);
      const writeResult = await fs.writeFile(contextPath, content);
      if (!writeResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to write context file',
            { path: contextPath, originalError: writeResult.error.message },
          ),
        );
      }

      logger.info('Context saved successfully', {
        path: contextPath,
        sessionId: context.sessionId,
        size: content.length,
      });

      return ok(undefined);
    },

    async deleteContext() {
      logger.debug('Deleting context', { path: contextPath });

      if (!(await fs.exists(contextPath))) {
        logger.debug('No context to delete');
        return ok(undefined);
      }

      const rmResult = await fs.rm(contextPath);
      if (!rmResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to delete context file',
            { path: contextPath, originalError: rmResult.error.message },
          ),
        );
      }

      logger.info('Context deleted', { path: contextPath });
      return ok(undefined);
    },

    getContextPath() {
      return contextPath;
    },

    getBen10Dir() {
      return ben10Dir;
    },
  };

  return service;
};
