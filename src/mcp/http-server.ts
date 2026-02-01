import type { FileSystem } from '../adapters/fs/memory-fs.js';
import type { ContextData } from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import type {
  ContextSummary,
  SegmentOptions,
  TranscriptSegment,
} from '../services/remote-context-service.js';
import { createSerializerService } from '../services/serializer-service.js';

/** Directory structure for server storage */
const CONTEXTS_DIR = 'contexts';
const CONTEXT_FILE = 'context.ctx';
const METADATA_FILE = 'metadata.json';

/**
 * Metadata stored alongside context for quick access.
 */
export interface StoredMetadata {
  projectHash: string;
  sessionId: string;
  updatedAt: number;
  createdAt: number;
  summaryPreview: string;
}

/**
 * Server-side context storage service.
 */
export interface HttpServerStorage {
  /**
   * Check if context exists for a project.
   */
  hasContext(projectHash: string): Promise<boolean>;

  /**
   * Load context for a project.
   */
  loadContext(projectHash: string): Promise<Result<ContextData, BenTenError>>;

  /**
   * Save context for a project.
   */
  saveContext(
    projectHash: string,
    context: ContextData,
  ): Promise<Result<void, BenTenError>>;

  /**
   * Delete context for a project.
   */
  deleteContext(projectHash: string): Promise<Result<void, BenTenError>>;

  /**
   * Get context summary without loading full content.
   */
  getContextSummary(
    projectHash: string,
  ): Promise<Result<ContextSummary, BenTenError>>;

  /**
   * Get transcript segments.
   */
  getTranscriptSegments(
    projectHash: string,
    opts: SegmentOptions,
  ): Promise<Result<TranscriptSegment[], BenTenError>>;

  /**
   * List all stored project contexts.
   */
  listProjects(): Promise<
    Result<Array<{ projectHash: string; updatedAt: number }>, BenTenError>
  >;
}

export interface HttpServerStorageDeps {
  fs: FileSystem;
  logger: Logger;
  storagePath: string;
}

/**
 * Creates server-side storage for HTTP context server.
 *
 * @param deps - Dependencies including file system, logger, and storage path
 * @returns A HttpServerStorage instance
 */
export const createHttpServerStorage = (
  deps: HttpServerStorageDeps,
): HttpServerStorage => {
  const { fs, logger, storagePath } = deps;
  const serializer = createSerializerService();

  const getProjectDir = (projectHash: string): string =>
    `${storagePath}/${CONTEXTS_DIR}/${projectHash}`;

  const getContextPath = (projectHash: string): string =>
    `${getProjectDir(projectHash)}/${CONTEXT_FILE}`;

  const getMetadataPath = (projectHash: string): string =>
    `${getProjectDir(projectHash)}/${METADATA_FILE}`;

  const storage: HttpServerStorage = {
    async hasContext(projectHash) {
      const contextPath = getContextPath(projectHash);
      return fs.exists(contextPath);
    },

    async loadContext(projectHash) {
      const contextPath = getContextPath(projectHash);
      logger.debug('Loading context from storage', {
        projectHash,
        contextPath,
      });

      if (!(await fs.exists(contextPath))) {
        return err(
          createError(ErrorCode.REMOTE_CONTEXT_NOT_FOUND, 'Context not found', {
            projectHash,
          }),
        );
      }

      const readResult = await fs.readFileBuffer(contextPath);
      if (!readResult.ok) {
        return err(
          createError(ErrorCode.FS_READ_ERROR, 'Failed to read context file', {
            projectHash,
            error: readResult.error.message,
          }),
        );
      }

      const deserializeResult = serializer.deserialize(readResult.value);
      if (!deserializeResult.ok) {
        return err(
          createError(
            ErrorCode.DESERIALIZE_FAILED,
            'Failed to deserialize context',
            { projectHash, error: deserializeResult.error.message },
          ),
        );
      }

      logger.info('Context loaded from storage', {
        projectHash,
        sessionId: deserializeResult.value.sessionId,
      });

      return ok(deserializeResult.value);
    },

    async saveContext(projectHash, context) {
      const projectDir = getProjectDir(projectHash);
      const contextPath = getContextPath(projectHash);
      const metadataPath = getMetadataPath(projectHash);

      logger.debug('Saving context to storage', {
        projectHash,
        sessionId: context.sessionId,
      });

      // Ensure project directory exists
      const mkdirResult = await fs.mkdir(projectDir, { recursive: true });
      if (!mkdirResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to create project directory',
            { projectHash, error: mkdirResult.error.message },
          ),
        );
      }

      // Serialize context
      const serializeResult = serializer.serialize(context);
      if (!serializeResult.ok) {
        return err(
          createError(
            ErrorCode.SERIALIZE_FAILED,
            'Failed to serialize context',
            { projectHash, error: serializeResult.error.message },
          ),
        );
      }

      // Write context file
      const writeResult = await fs.writeFileBuffer(
        contextPath,
        serializeResult.value,
      );
      if (!writeResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to write context file',
            { projectHash, error: writeResult.error.message },
          ),
        );
      }

      // Write metadata for quick access
      const metadata: StoredMetadata = {
        projectHash,
        sessionId: context.sessionId,
        updatedAt: context.updatedAt,
        createdAt: context.createdAt,
        summaryPreview: context.summary.slice(0, 200),
      };

      const metadataWriteResult = await fs.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2),
      );
      if (!metadataWriteResult.ok) {
        logger.warn('Failed to write metadata', {
          projectHash,
          error: metadataWriteResult.error.message,
        });
        // Continue anyway - metadata is optional
      }

      logger.info('Context saved to storage', {
        projectHash,
        size: serializeResult.value.length,
      });

      return ok(undefined);
    },

    async deleteContext(projectHash) {
      const projectDir = getProjectDir(projectHash);
      logger.debug('Deleting context from storage', { projectHash });

      if (!(await fs.exists(projectDir))) {
        return ok(undefined); // Already doesn't exist
      }

      const rmResult = await fs.rm(projectDir, { recursive: true });
      if (!rmResult.ok) {
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            'Failed to delete context directory',
            { projectHash, error: rmResult.error.message },
          ),
        );
      }

      logger.info('Context deleted from storage', { projectHash });
      return ok(undefined);
    },

    async getContextSummary(projectHash) {
      const metadataPath = getMetadataPath(projectHash);

      // Try to load from metadata first (fast path)
      if (await fs.exists(metadataPath)) {
        const readResult = await fs.readFile(metadataPath);
        if (readResult.ok) {
          try {
            // Parse metadata to verify it's valid JSON
            JSON.parse(readResult.value) as StoredMetadata;

            // Load full context to get additional info
            const contextResult = await storage.loadContext(projectHash);
            if (contextResult.ok) {
              const ctx = contextResult.value;
              return ok({
                projectHash,
                sessionId: ctx.sessionId,
                summary: ctx.summary,
                updatedAt: ctx.updatedAt,
                createdAt: ctx.createdAt,
                hasConversation: !!ctx.conversation,
                messageCount: ctx.conversation?.messages?.length,
                keyFiles: ctx.keyFiles,
                activeTasks: ctx.activeTasks,
              });
            }
          } catch {
            // Fall through to load full context
          }
        }
      }

      // Fallback: load full context
      const loadResult = await storage.loadContext(projectHash);
      if (!loadResult.ok) {
        return loadResult;
      }

      const ctx = loadResult.value;
      return ok({
        projectHash,
        sessionId: ctx.sessionId,
        summary: ctx.summary,
        updatedAt: ctx.updatedAt,
        createdAt: ctx.createdAt,
        hasConversation: !!ctx.conversation,
        messageCount: ctx.conversation?.messages?.length,
        keyFiles: ctx.keyFiles,
        activeTasks: ctx.activeTasks,
      });
    },

    async getTranscriptSegments(projectHash, opts) {
      const loadResult = await storage.loadContext(projectHash);
      if (!loadResult.ok) {
        return loadResult;
      }

      const ctx = loadResult.value;
      if (!ctx.conversation?.messages) {
        return ok([]);
      }

      const messages = ctx.conversation.messages;
      const startIndex = opts.startIndex ?? 0;
      const limit = opts.limit ?? messages.length;

      const segments: TranscriptSegment[] = [];
      let count = 0;

      for (let i = startIndex; i < messages.length && count < limit; i++) {
        const msg = messages[i];
        if (!msg) continue;

        // Filter by message type if specified
        if (opts.messageType && opts.messageType !== 'all') {
          if (msg.type !== opts.messageType) {
            continue;
          }
        }

        let content = '';
        if (msg.type === 'user') {
          const userMsg = msg as {
            type: 'user';
            message?: { content: unknown };
          };
          if (userMsg.message) {
            content =
              typeof userMsg.message.content === 'string'
                ? userMsg.message.content
                : JSON.stringify(userMsg.message.content);
          }
        } else if (msg.type === 'assistant') {
          const assistantMsg = msg as {
            type: 'assistant';
            message?: { content?: Array<{ type: string; text?: string }> };
          };
          if (assistantMsg.message) {
            // Extract text content from assistant message
            const contentBlocks = assistantMsg.message.content || [];
            content = contentBlocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text || '')
              .join('\n');
          }
        } else if (msg.type === 'summary') {
          const summaryMsg = msg as { type: 'summary'; summary?: string };
          content = summaryMsg.summary || '';
        }

        segments.push({
          index: i,
          type: msg.type,
          content,
        });
        count++;
      }

      return ok(segments);
    },

    async listProjects() {
      const contextsDir = `${storagePath}/${CONTEXTS_DIR}`;
      logger.debug('Listing projects', { contextsDir });

      if (!(await fs.exists(contextsDir))) {
        return ok([]);
      }

      const readdirResult = await fs.readdir(contextsDir);
      if (!readdirResult.ok) {
        return err(
          createError(
            ErrorCode.FS_READ_ERROR,
            'Failed to read contexts directory',
            {
              error: readdirResult.error.message,
            },
          ),
        );
      }

      const projects: Array<{ projectHash: string; updatedAt: number }> = [];

      for (const projectHash of readdirResult.value) {
        const metadataPath = getMetadataPath(projectHash);

        if (await fs.exists(metadataPath)) {
          const readResult = await fs.readFile(metadataPath);
          if (readResult.ok) {
            try {
              const metadata = JSON.parse(readResult.value) as StoredMetadata;
              projects.push({
                projectHash,
                updatedAt: metadata.updatedAt,
              });
              continue;
            } catch {
              // Fall through to get from context
            }
          }
        }

        // Fallback: try to load context to get updatedAt
        const contextResult = await storage.loadContext(projectHash);
        if (contextResult.ok) {
          projects.push({
            projectHash,
            updatedAt: contextResult.value.updatedAt,
          });
        }
      }

      // Sort by most recently updated
      projects.sort((a, b) => b.updatedAt - a.updatedAt);

      return ok(projects);
    },
  };

  return storage;
};
