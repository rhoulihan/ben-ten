import type { FileSystem } from '../adapters/fs/memory-fs.js';
import {
  CONTEXT_VERSION,
  type ContextData,
  type FileMetadata,
} from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { createContextService } from '../services/context-service.js';
import { createTranscriptService } from '../services/transcript-service.js';

/** MCP Tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP Resource definition */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** Resource read result */
export interface ResourceContent {
  uri: string;
  mimeType: string;
  contents: string;
}

/** Server info */
export interface ServerInfo {
  name: string;
  version: string;
}

/** Status tool result */
export interface StatusResult {
  hasContext: boolean;
  contextPath: string;
  sessionId?: string;
  summaryLength?: number;
  createdAt?: number;
  updatedAt?: number;
}

/** Save tool result */
export interface SaveResult {
  saved: boolean;
  path: string;
}

/** Clear tool result */
export interface ClearResult {
  cleared: boolean;
}

/**
 * Ben-Ten MCP Server interface.
 * Provides tools and resources for context management.
 */
export interface BenTenServer {
  /** Get server information */
  getServerInfo(): ServerInfo;

  /** List available tools */
  listTools(): ToolDefinition[];

  /** Call a tool by name */
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Result<unknown, BenTenError>>;

  /** List available resources */
  listResources(): ResourceDefinition[];

  /** Read a resource by URI */
  readResource(uri: string): Promise<Result<ResourceContent, BenTenError>>;
}

export interface BenTenServerDeps {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

/**
 * Creates a Ben-Ten MCP server instance.
 *
 * @param deps - Dependencies including file system, logger, and project directory
 * @returns A BenTenServer instance
 */
export const createBenTenServer = (deps: BenTenServerDeps): BenTenServer => {
  const { fs, logger, projectDir } = deps;
  const contextService = createContextService({ fs, logger, projectDir });
  const transcriptService = createTranscriptService({ fs, logger });

  const tools: ToolDefinition[] = [
    {
      name: 'ben_ten_status',
      description: 'Get the status of Ben-Ten context for this project',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ben_ten_save',
      description: 'Save context data to .ben-ten/context.json',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Current session ID',
          },
          summary: {
            type: 'string',
            description: 'Summary of the session context',
          },
          keyFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of key files in the project',
          },
          activeTasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of active tasks',
          },
        },
        required: ['sessionId', 'summary'],
      },
    },
    {
      name: 'ben_ten_load',
      description: 'Load context data from .ben-ten/context.json',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ben_ten_clear',
      description: 'Delete the context file',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  const resources: ResourceDefinition[] = [
    {
      uri: 'ben-ten://context',
      name: 'Project Context',
      description: 'The persisted context for this project',
      mimeType: 'text/plain',
    },
  ];

  const server: BenTenServer = {
    getServerInfo() {
      return {
        name: 'ben-ten',
        version: '1.0.0',
      };
    },

    listTools() {
      return tools;
    },

    async callTool(name, args) {
      logger.debug('Calling tool', { name, args });

      switch (name) {
        case 'ben_ten_status': {
          const hasContext = await contextService.hasContext();
          const result: StatusResult = {
            hasContext,
            contextPath: contextService.getContextPath(),
          };

          if (hasContext) {
            const loadResult = await contextService.loadContext();
            if (loadResult.ok) {
              result.sessionId = loadResult.value.sessionId;
              result.summaryLength = loadResult.value.summary.length;
              result.createdAt = loadResult.value.createdAt;
              result.updatedAt = loadResult.value.updatedAt;
            }
          }

          return ok(result);
        }

        case 'ben_ten_save': {
          const sessionId = args.sessionId as string;
          const summary = args.summary as string;
          const keyFiles = args.keyFiles as string[] | undefined;
          const activeTasks = args.activeTasks as string[] | undefined;

          // Preserve createdAt if updating
          let createdAt = Date.now();
          if (await contextService.hasContext()) {
            const existingResult = await contextService.loadContext();
            if (existingResult.ok) {
              createdAt = existingResult.value.createdAt;
            }
          }

          // Build enriched v2.0.0 context
          const contextData: ContextData = {
            version: CONTEXT_VERSION,
            createdAt,
            updatedAt: Date.now(),
            sessionId,
            summary,
            keyFiles,
            activeTasks,
          };

          // Try to enrich context from transcript
          if (await contextService.hasMetadata()) {
            const metadataResult = await contextService.loadMetadata();
            if (metadataResult.ok && metadataResult.value.transcriptPath) {
              const transcriptPath = metadataResult.value.transcriptPath;
              const transcriptResult =
                await transcriptService.parseTranscript(transcriptPath);

              if (transcriptResult.ok) {
                const conversation = transcriptResult.value;
                contextData.conversation = conversation;

                // Extract file references
                const extractedFiles =
                  transcriptService.extractFileReferences(conversation);
                if (extractedFiles.length > 0) {
                  const now = Date.now();
                  contextData.files = extractedFiles.map(
                    (path): FileMetadata => ({
                      path,
                      lastAccessed: now,
                      accessCount: 1,
                    }),
                  );
                }

                // Extract tool history
                const toolCalls =
                  transcriptService.extractToolCalls(conversation);
                if (toolCalls.length > 0) {
                  contextData.toolHistory = toolCalls;
                }
              } else {
                // Log warning but continue without enrichment
                logger.warn('Failed to parse transcript for enrichment', {
                  path: transcriptPath,
                  error: transcriptResult.error.message,
                });
              }
            }
          }

          const saveResult = await contextService.saveContext(contextData);
          if (!saveResult.ok) {
            return err(saveResult.error);
          }

          const result: SaveResult = {
            saved: true,
            path: contextService.getContextPath(),
          };
          return ok(result);
        }

        case 'ben_ten_load': {
          const loadResult = await contextService.loadContext();
          if (!loadResult.ok) {
            return err(loadResult.error);
          }
          return ok(loadResult.value);
        }

        case 'ben_ten_clear': {
          const deleteResult = await contextService.deleteContext();
          if (!deleteResult.ok) {
            return err(deleteResult.error);
          }
          const result: ClearResult = {
            cleared: true,
          };
          return ok(result);
        }

        default:
          return err(
            createError(ErrorCode.MCP_TOOL_ERROR, `Unknown tool: ${name}`, {
              toolName: name,
            }),
          );
      }
    },

    listResources() {
      return resources;
    },

    async readResource(uri) {
      logger.debug('Reading resource', { uri });

      if (uri === 'ben-ten://context') {
        const hasContext = await contextService.hasContext();

        if (!hasContext) {
          return ok({
            uri,
            mimeType: 'text/plain',
            contents: 'No context found for this project.',
          });
        }

        const loadResult = await contextService.loadContext();
        if (!loadResult.ok) {
          return ok({
            uri,
            mimeType: 'text/plain',
            contents: `Error loading context: ${loadResult.error.message}`,
          });
        }

        const ctx = loadResult.value;
        const contents = [
          '# Ben-Ten Project Context',
          '',
          `**Session ID:** ${ctx.sessionId}`,
          `**Created:** ${new Date(ctx.createdAt).toISOString()}`,
          `**Updated:** ${new Date(ctx.updatedAt).toISOString()}`,
          '',
          '## Summary',
          ctx.summary,
        ];

        if (ctx.keyFiles && ctx.keyFiles.length > 0) {
          contents.push('', '## Key Files');
          for (const file of ctx.keyFiles) {
            contents.push(`- ${file}`);
          }
        }

        if (ctx.activeTasks && ctx.activeTasks.length > 0) {
          contents.push('', '## Active Tasks');
          for (const task of ctx.activeTasks) {
            contents.push(`- ${task}`);
          }
        }

        return ok({
          uri,
          mimeType: 'text/plain',
          contents: contents.join('\n'),
        });
      }

      return err(
        createError(ErrorCode.MCP_RESOURCE_ERROR, `Unknown resource: ${uri}`, {
          uri,
        }),
      );
    },
  };

  return server;
};
