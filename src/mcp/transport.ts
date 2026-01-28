import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { FileSystem } from '../adapters/fs/memory-fs.js';
import {
  CONTEXT_VERSION,
  type ContextData,
  type FileMetadata,
} from '../core/types.js';
import type { Logger } from '../infrastructure/logger.js';
import { createContextService } from '../services/context-service.js';
import { createTranscriptService } from '../services/transcript-service.js';

export interface McpTransportDeps {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

/**
 * Creates and starts a Ben-Ten MCP server with stdio transport.
 * This is the main entry point for running Ben-Ten as an MCP server.
 */
export const startMcpServer = async (deps: McpTransportDeps): Promise<void> => {
  const { fs, logger, projectDir } = deps;
  const contextService = createContextService({ fs, logger, projectDir });
  const transcriptService = createTranscriptService({ fs, logger });

  // Create the MCP server
  const server = new McpServer({
    name: 'ben-ten',
    version: '0.1.0',
  });

  // Register ben_ten_status tool
  server.registerTool(
    'ben_ten_status',
    {
      description: 'Get the status of Ben-Ten context for this project',
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

  // Register ben_ten_save tool
  server.registerTool(
    'ben_ten_save',
    {
      description: 'Save context data to .ben-ten/context.json',
      inputSchema: {
        sessionId: z.string().describe('Current session ID'),
        summary: z.string().describe('Summary of the session context'),
        keyFiles: z.array(z.string()).optional().describe('List of key files'),
        activeTasks: z
          .array(z.string())
          .optional()
          .describe('List of active tasks'),
        transcriptPath: z
          .string()
          .optional()
          .describe(
            'Path to the transcript JSONL file for extracting conversation history, file references, and tool calls',
          ),
      },
    },
    async ({
      sessionId,
      summary,
      keyFiles,
      activeTasks,
      transcriptPath: providedTranscriptPath,
    }) => {
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

      // Determine transcript path: prefer provided param, then metadata, then auto-discover
      let transcriptPath = providedTranscriptPath;
      if (!transcriptPath && (await contextService.hasMetadata())) {
        const metadataResult = await contextService.loadMetadata();
        if (metadataResult.ok && metadataResult.value.transcriptPath) {
          transcriptPath = metadataResult.value.transcriptPath;
        }
      }
      if (!transcriptPath) {
        const discoverResult =
          await transcriptService.discoverTranscriptPath(projectDir);
        if (discoverResult.ok && discoverResult.value) {
          transcriptPath = discoverResult.value;
        }
      }

      // Enrich context from transcript if available
      if (transcriptPath) {
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
          const toolCalls = transcriptService.extractToolCalls(conversation);
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

  // Register ben_ten_load tool
  server.registerTool(
    'ben_ten_load',
    {
      description: 'Load context data from .ben-ten/context.json',
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

  // Register ben_ten_clear tool
  server.registerTool(
    'ben_ten_clear',
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

  // Register ben-ten://context resource
  server.resource('Project Context', 'ben-ten://context', async () => {
    const hasContext = await contextService.hasContext();

    if (!hasContext) {
      return {
        contents: [
          {
            uri: 'ben-ten://context',
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
            uri: 'ben-ten://context',
            mimeType: 'text/plain',
            text: `Error loading context: ${loadResult.error.message}`,
          },
        ],
      };
    }

    const ctx = loadResult.value;
    const lines = [
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
          uri: 'ben-ten://context',
          mimeType: 'text/markdown',
          text: lines.join('\n'),
        },
      ],
    };
  });

  // Create stdio transport and connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Ben-Ten MCP server started', { projectDir });
};
