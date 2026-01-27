import type { FileSystem } from '../adapters/fs/memory-fs.js';
import type { ContextData } from '../core/types.js';
import {
  type Ben10Error,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { createContextService } from '../services/context-service.js';

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
 * Ben10 MCP Server interface.
 * Provides tools and resources for context management.
 */
export interface Ben10Server {
  /** Get server information */
  getServerInfo(): ServerInfo;

  /** List available tools */
  listTools(): ToolDefinition[];

  /** Call a tool by name */
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Result<unknown, Ben10Error>>;

  /** List available resources */
  listResources(): ResourceDefinition[];

  /** Read a resource by URI */
  readResource(uri: string): Promise<Result<ResourceContent, Ben10Error>>;
}

export interface Ben10ServerDeps {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

/**
 * Creates a Ben10 MCP server instance.
 *
 * @param deps - Dependencies including file system, logger, and project directory
 * @returns A Ben10Server instance
 */
export const createBen10Server = (deps: Ben10ServerDeps): Ben10Server => {
  const { fs, logger, projectDir } = deps;
  const contextService = createContextService({ fs, logger, projectDir });

  const tools: ToolDefinition[] = [
    {
      name: 'ben10_status',
      description: 'Get the status of Ben10 context for this project',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ben10_save',
      description: 'Save context data to .ben10/context.json',
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
      name: 'ben10_load',
      description: 'Load context data from .ben10/context.json',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ben10_clear',
      description: 'Delete the context file',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  const resources: ResourceDefinition[] = [
    {
      uri: 'ben10://context',
      name: 'Project Context',
      description: 'The persisted context for this project',
      mimeType: 'text/plain',
    },
  ];

  const server: Ben10Server = {
    getServerInfo() {
      return {
        name: 'ben10',
        version: '1.0.0',
      };
    },

    listTools() {
      return tools;
    },

    async callTool(name, args) {
      logger.debug('Calling tool', { name, args });

      switch (name) {
        case 'ben10_status': {
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

        case 'ben10_save': {
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

          const contextData: ContextData = {
            version: '1.0.0',
            createdAt,
            updatedAt: Date.now(),
            sessionId,
            summary,
            keyFiles,
            activeTasks,
          };

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

        case 'ben10_load': {
          const loadResult = await contextService.loadContext();
          if (!loadResult.ok) {
            return err(loadResult.error);
          }
          return ok(loadResult.value);
        }

        case 'ben10_clear': {
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

      if (uri === 'ben10://context') {
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
          '# Ben10 Project Context',
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
