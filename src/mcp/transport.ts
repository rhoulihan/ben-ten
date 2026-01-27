import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { FileSystem } from '../adapters/fs/memory-fs.js';
import type { ContextData } from '../core/types.js';
import type { Logger } from '../infrastructure/logger.js';
import { createContextService } from '../services/context-service.js';

export interface McpTransportDeps {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

/**
 * Creates and starts a Ben10 MCP server with stdio transport.
 * This is the main entry point for running Ben10 as an MCP server.
 */
export const startMcpServer = async (deps: McpTransportDeps): Promise<void> => {
  const { fs, logger, projectDir } = deps;
  const contextService = createContextService({ fs, logger, projectDir });

  // Create the MCP server
  const server = new McpServer({
    name: 'ben10',
    version: '0.1.0',
  });

  // Register ben10_status tool
  server.registerTool(
    'ben10_status',
    {
      description: 'Get the status of Ben10 context for this project',
      inputSchema: {},
    },
    async () => {
      const hasContext = await contextService.hasContext();
      const result: Record<string, unknown> = {
        hasContext,
        contextPath: contextService.getContextPath(),
        projectDir,
      };

      if (hasContext) {
        const loadResult = await contextService.loadContext();
        if (loadResult.ok) {
          result.sessionId = loadResult.value.sessionId;
          result.summaryLength = loadResult.value.summary.length;
          result.createdAt = new Date(loadResult.value.createdAt).toISOString();
          result.updatedAt = new Date(loadResult.value.updatedAt).toISOString();
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // Register ben10_save tool
  server.registerTool(
    'ben10_save',
    {
      description: 'Save context data to .ben10/context.json',
      inputSchema: {
        sessionId: z.string().describe('Current session ID'),
        summary: z.string().describe('Summary of the session context'),
        keyFiles: z.array(z.string()).optional().describe('List of key files'),
        activeTasks: z
          .array(z.string())
          .optional()
          .describe('List of active tasks'),
      },
    },
    async ({ sessionId, summary, keyFiles, activeTasks }) => {
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
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error saving context: ${saveResult.error.message}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                saved: true,
                path: contextService.getContextPath(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Register ben10_load tool
  server.registerTool(
    'ben10_load',
    {
      description: 'Load context data from .ben10/context.json',
      inputSchema: {},
    },
    async () => {
      const loadResult = await contextService.loadContext();
      if (!loadResult.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error loading context: ${loadResult.error.message}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(loadResult.value, null, 2),
          },
        ],
      };
    },
  );

  // Register ben10_clear tool
  server.registerTool(
    'ben10_clear',
    {
      description: 'Delete the context file',
      inputSchema: {},
    },
    async () => {
      const deleteResult = await contextService.deleteContext();
      if (!deleteResult.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error clearing context: ${deleteResult.error.message}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ cleared: true }, null, 2),
          },
        ],
      };
    },
  );

  // Register ben10://context resource
  server.resource('Project Context', 'ben10://context', async () => {
    const hasContext = await contextService.hasContext();

    if (!hasContext) {
      return {
        contents: [
          {
            uri: 'ben10://context',
            mimeType: 'text/plain',
            text: 'No context found for this project.',
          },
        ],
      };
    }

    const loadResult = await contextService.loadContext();
    if (!loadResult.ok) {
      return {
        contents: [
          {
            uri: 'ben10://context',
            mimeType: 'text/plain',
            text: `Error loading context: ${loadResult.error.message}`,
          },
        ],
      };
    }

    const ctx = loadResult.value;
    const lines = [
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
      lines.push('', '## Key Files');
      for (const file of ctx.keyFiles) {
        lines.push(`- ${file}`);
      }
    }

    if (ctx.activeTasks && ctx.activeTasks.length > 0) {
      lines.push('', '## Active Tasks');
      for (const task of ctx.activeTasks) {
        lines.push(`- ${task}`);
      }
    }

    return {
      contents: [
        {
          uri: 'ben10://context',
          mimeType: 'text/markdown',
          text: lines.join('\n'),
        },
      ],
    };
  });

  // Create stdio transport and connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Ben10 MCP server started', { projectDir });
};
