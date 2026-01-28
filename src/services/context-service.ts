import type { FileSystem } from '../adapters/fs/memory-fs.js';
import {
  type ContextData,
  type ContextMetadata,
  parseContextData,
  parseContextMetadata,
} from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { createSerializerService } from './serializer-service.js';

/** Directory name for Ben-Ten storage */
export const BEN10_DIR = '.ben-ten';

/** Context data file name (compressed binary format) */
export const CONTEXT_FILE = 'context.ctx';

/** Legacy context file name (JSON format) */
export const CONTEXT_FILE_LEGACY = 'context.json';

/** Metadata file name */
export const METADATA_FILE = 'metadata.json';

/**
 * Service for managing context persistence.
 */
export interface ContextService {
  /** Check if context exists for this project */
  hasContext(): Promise<boolean>;

  /** Load context from disk */
  loadContext(): Promise<Result<ContextData, BenTenError>>;

  /** Save context to disk */
  saveContext(context: ContextData): Promise<Result<void, BenTenError>>;

  /** Delete context file */
  deleteContext(): Promise<Result<void, BenTenError>>;

  /** Get full path to context file */
  getContextPath(): string;

  /** Get full path to .ben-ten directory */
  getBenTenDir(): string;

  /** Check if metadata exists for this project */
  hasMetadata(): Promise<boolean>;

  /** Load metadata from disk */
  loadMetadata(): Promise<Result<ContextMetadata, BenTenError>>;

  /** Save metadata to disk */
  saveMetadata(metadata: ContextMetadata): Promise<Result<void, BenTenError>>;
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
  const serializer = createSerializerService();

  const ben10Dir = `${projectDir}/${BEN10_DIR}`;
  const contextPath = `${ben10Dir}/${CONTEXT_FILE}`;
  const legacyContextPath = `${ben10Dir}/${CONTEXT_FILE_LEGACY}`;
  const metadataPath = `${ben10Dir}/${METADATA_FILE}`;

  const service: ContextService = {
    async hasContext() {
      // Check for new compressed format first, then legacy JSON
      if (await fs.exists(contextPath)) {
        return true;
      }
      return fs.exists(legacyContextPath);
    },

    async loadContext() {
      logger.debug('Loading context', { path: contextPath });

      // Try new compressed format first
      if (await fs.exists(contextPath)) {
        const readResult = await fs.readFileBuffer(contextPath);
        if (!readResult.ok) {
          return err(
            createError(
              ErrorCode.CONTEXT_CORRUPTED,
              'Failed to read context file',
              { path: contextPath, originalError: readResult.error.message },
            ),
          );
        }

        const deserializeResult = serializer.deserialize(readResult.value);
        if (!deserializeResult.ok) {
          logger.warn('Failed to deserialize context', {
            path: contextPath,
            error: deserializeResult.error.message,
          });
          return err(
            createError(
              ErrorCode.CONTEXT_CORRUPTED,
              'Context file is corrupted',
              {
                path: contextPath,
                originalError: deserializeResult.error.message,
              },
            ),
          );
        }

        logger.info('Context loaded successfully', {
          sessionId: deserializeResult.value.sessionId,
          summaryLength: deserializeResult.value.summary.length,
        });

        return ok(deserializeResult.value);
      }

      // Try legacy JSON format
      if (await fs.exists(legacyContextPath)) {
        logger.debug('Loading legacy JSON context', {
          path: legacyContextPath,
        });

        const readResult = await fs.readFile(legacyContextPath);
        if (!readResult.ok) {
          return err(
            createError(
              ErrorCode.CONTEXT_CORRUPTED,
              'Failed to read legacy context file',
              {
                path: legacyContextPath,
                originalError: readResult.error.message,
              },
            ),
          );
        }

        // Parse JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(readResult.value);
        } catch (e) {
          logger.warn('Failed to parse legacy context JSON', {
            path: legacyContextPath,
            error: e instanceof Error ? e.message : String(e),
          });
          return err(
            createError(
              ErrorCode.CONTEXT_CORRUPTED,
              'Legacy context file contains invalid JSON',
              { path: legacyContextPath },
            ),
          );
        }

        // Validate structure
        const validateResult = parseContextData(parsed);
        if (!validateResult.ok) {
          logger.warn('Legacy context file has invalid structure', {
            path: legacyContextPath,
            errors: validateResult.error.details,
          });
          return err(
            createError(
              ErrorCode.CONTEXT_CORRUPTED,
              'Legacy context file has invalid structure',
              {
                path: legacyContextPath,
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
      }

      // No context file found
      return err(
        createError(ErrorCode.CONTEXT_NOT_FOUND, 'No context file found', {
          path: contextPath,
        }),
      );
    },

    async saveContext(context) {
      logger.debug('Saving context', {
        path: contextPath,
        sessionId: context.sessionId,
      });

      // Ensure .ben-ten directory exists
      const mkdirResult = await fs.mkdir(ben10Dir, { recursive: true });
      if (!mkdirResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to create .ben-ten directory',
            { path: ben10Dir, originalError: mkdirResult.error.message },
          ),
        );
      }

      // Serialize to compressed format
      const serializeResult = serializer.serialize(context);
      if (!serializeResult.ok) {
        return err(
          createError(ErrorCode.FS_WRITE_ERROR, 'Failed to serialize context', {
            originalError: serializeResult.error.message,
          }),
        );
      }

      // Write compressed context file
      const writeResult = await fs.writeFileBuffer(
        contextPath,
        serializeResult.value,
      );
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
        size: serializeResult.value.length,
      });

      return ok(undefined);
    },

    async deleteContext() {
      logger.debug('Deleting context', { path: contextPath });

      // Delete new format if exists
      if (await fs.exists(contextPath)) {
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
      }

      // Delete legacy format if exists
      if (await fs.exists(legacyContextPath)) {
        const rmResult = await fs.rm(legacyContextPath);
        if (!rmResult.ok) {
          return err(
            createError(
              ErrorCode.FS_WRITE_ERROR,
              'Failed to delete legacy context file',
              {
                path: legacyContextPath,
                originalError: rmResult.error.message,
              },
            ),
          );
        }
        logger.info('Legacy context deleted', { path: legacyContextPath });
      }

      return ok(undefined);
    },

    getContextPath() {
      return contextPath;
    },

    getBenTenDir() {
      return ben10Dir;
    },

    async hasMetadata() {
      return fs.exists(metadataPath);
    },

    async loadMetadata() {
      logger.debug('Loading metadata', { path: metadataPath });

      // Check if file exists
      if (!(await fs.exists(metadataPath))) {
        return err(
          createError(ErrorCode.CONTEXT_NOT_FOUND, 'No metadata file found', {
            path: metadataPath,
          }),
        );
      }

      // Read file
      const readResult = await fs.readFile(metadataPath);
      if (!readResult.ok) {
        return err(
          createError(
            ErrorCode.CONTEXT_CORRUPTED,
            'Failed to read metadata file',
            { path: metadataPath, originalError: readResult.error.message },
          ),
        );
      }

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(readResult.value);
      } catch (e) {
        logger.warn('Failed to parse metadata JSON', {
          path: metadataPath,
          error: e instanceof Error ? e.message : String(e),
        });
        return err(
          createError(
            ErrorCode.CONTEXT_CORRUPTED,
            'Metadata file contains invalid JSON',
            { path: metadataPath },
          ),
        );
      }

      // Validate structure
      const validateResult = parseContextMetadata(parsed);
      if (!validateResult.ok) {
        logger.warn('Metadata file has invalid structure', {
          path: metadataPath,
          errors: validateResult.error.details,
        });
        return err(
          createError(
            ErrorCode.CONTEXT_CORRUPTED,
            'Metadata file has invalid structure',
            {
              path: metadataPath,
              validationErrors: validateResult.error.details,
            },
          ),
        );
      }

      logger.debug('Metadata loaded successfully', {
        sessionId: validateResult.value.lastSessionId,
      });

      return ok(validateResult.value);
    },

    async saveMetadata(metadata) {
      logger.debug('Saving metadata', {
        path: metadataPath,
        sessionId: metadata.lastSessionId,
      });

      // Ensure .ben-ten directory exists
      const mkdirResult = await fs.mkdir(ben10Dir, { recursive: true });
      if (!mkdirResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to create .ben-ten directory',
            { path: ben10Dir, originalError: mkdirResult.error.message },
          ),
        );
      }

      // Write metadata file
      const content = JSON.stringify(metadata, null, 2);
      const writeResult = await fs.writeFile(metadataPath, content);
      if (!writeResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to write metadata file',
            { path: metadataPath, originalError: writeResult.error.message },
          ),
        );
      }

      logger.debug('Metadata saved successfully', {
        path: metadataPath,
        sessionId: metadata.lastSessionId,
      });

      return ok(undefined);
    },
  };

  return service;
};
