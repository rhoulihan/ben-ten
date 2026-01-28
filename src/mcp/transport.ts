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
import {
  DEFAULT_CONFIG,
  createConfigService,
} from '../services/config-service.js';
import { createContextService } from '../services/context-service.js';
import { createReplayService } from '../services/replay-service.js';
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
  const configService = createConfigService({ fs, logger, projectDir });
  const replayService = createReplayService({ logger });

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

          // Generate conversation replay
          const configResult = await configService.loadConfig();
          const config = configResult.ok ? configResult.value : DEFAULT_CONFIG;
          const maxTokens = Math.floor(
            (config.contextWindowSize * config.maxReplayPercent) / 100,
          );

          const replayResult = replayService.generateReplay(
            conversation.messages,
            { maxTokens },
          );

          if (replayResult.ok) {
            contextData.conversationReplay = replayResult.value.replay;
            contextData.replayMetadata = {
              tokenCount: replayResult.value.tokenCount,
              messageCount: replayResult.value.messageCount,
              stoppingPointType: replayResult.value.stoppingPointType,
              generatedAt: Date.now(),
              allStoppingPoints: replayResult.value.allStoppingPoints,
              currentStopIndex: replayResult.value.currentStopIndex,
              startMessageIndex: replayResult.value.startMessageIndex,
            };
            logger.info('Generated conversation replay', {
              tokenCount: replayResult.value.tokenCount,
              messageCount: replayResult.value.messageCount,
              stoppingPointType: replayResult.value.stoppingPointType,
              totalStoppingPoints: replayResult.value.allStoppingPoints.length,
            });
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

  // Register ben_ten_config tool
  server.registerTool(
    'ben_ten_config',
    {
      description:
        'Get or set Ben-Ten configuration. Use action "get" to retrieve current config, or "set" to update a config value.',
      inputSchema: {
        action: z
          .enum(['get', 'set'])
          .describe('Action to perform: "get" or "set"'),
        key: z
          .enum(['maxReplayPercent', 'contextWindowSize'])
          .optional()
          .describe('Config key to set (required for "set" action)'),
        value: z
          .number()
          .optional()
          .describe('Config value to set (required for "set" action)'),
      },
    },
    async ({ action, key, value }) => {
      if (action === 'get') {
        const loadResult = await configService.loadConfig();
        if (!loadResult.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error loading config: ${loadResult.error.message}`,
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
      }

      // action === 'set'
      if (!key || value === undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: "key" and "value" are required for "set" action',
            },
          ],
          isError: true,
        };
      }

      const saveResult = await configService.saveConfig({ [key]: value });
      if (!saveResult.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error saving config: ${saveResult.error.message}`,
            },
          ],
          isError: true,
        };
      }

      // Return updated config
      const updatedConfig = await configService.loadConfig();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                config: updatedConfig.ok ? updatedConfig.value : DEFAULT_CONFIG,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Register ben_ten_loadMore tool
  server.registerTool(
    'ben_ten_loadMore',
    {
      description:
        'Load more conversation context by going back to the previous stopping point. Call repeatedly to load progressively more context.',
      inputSchema: {},
    },
    async () => {
      // Load existing context
      const loadResult = await contextService.loadContext();
      if (!loadResult.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No context found. Save context first with ben_ten_save.',
            },
          ],
          isError: true,
        };
      }

      const context = loadResult.value;

      // Check if we have replay metadata with stopping points
      if (
        !context.replayMetadata?.allStoppingPoints ||
        context.replayMetadata.allStoppingPoints.length === 0
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No stopping points available. The conversation has been fully loaded.',
            },
          ],
        };
      }

      const currentIndex = context.replayMetadata.currentStopIndex ?? -1;
      const nextIndex = currentIndex + 1;

      if (nextIndex >= context.replayMetadata.allStoppingPoints.length) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Already at the earliest stopping point (${context.replayMetadata.allStoppingPoints.length} total). No more context available.`,
            },
          ],
        };
      }

      // We need the conversation to regenerate the replay
      if (!context.conversation?.messages) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No conversation history found. Cannot load more context.',
            },
          ],
          isError: true,
        };
      }

      // Get config for token budget
      const configResult = await configService.loadConfig();
      const config = configResult.ok ? configResult.value : DEFAULT_CONFIG;
      const maxTokens = Math.floor(
        (config.contextWindowSize * config.maxReplayPercent) / 100,
      );

      // Generate new replay with next stopping point
      const replayResult = replayService.generateReplay(
        context.conversation.messages,
        {
          maxTokens,
          stopPointIndex: nextIndex,
          stoppingPoints: context.replayMetadata.allStoppingPoints,
        },
      );

      if (!replayResult.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error generating replay: ${replayResult.error.message}`,
            },
          ],
          isError: true,
        };
      }

      // Update context with new replay
      const updatedContext: ContextData = {
        ...context,
        updatedAt: Date.now(),
        conversationReplay: replayResult.value.replay,
        replayMetadata: {
          tokenCount: replayResult.value.tokenCount,
          messageCount: replayResult.value.messageCount,
          stoppingPointType: replayResult.value.stoppingPointType,
          generatedAt: Date.now(),
          allStoppingPoints: replayResult.value.allStoppingPoints,
          currentStopIndex: replayResult.value.currentStopIndex,
          startMessageIndex: replayResult.value.startMessageIndex,
        },
      };

      const saveResult = await contextService.saveContext(updatedContext);
      if (!saveResult.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error saving updated context: ${saveResult.error.message}`,
            },
          ],
          isError: true,
        };
      }

      const remainingStops =
        replayResult.value.allStoppingPoints.length -
        replayResult.value.currentStopIndex -
        1;

      // Return the additional context
      return {
        content: [
          {
            type: 'text' as const,
            text: [
              '# Additional Context Loaded',
              '',
              `**Stopping Point:** ${replayResult.value.currentStopIndex + 1} of ${replayResult.value.allStoppingPoints.length}`,
              `**Type:** ${replayResult.value.stoppingPointType || 'none'}`,
              `**Messages:** ${replayResult.value.messageCount}`,
              `**Tokens:** ~${replayResult.value.tokenCount}`,
              '',
              remainingStops > 0
                ? `*${remainingStops} more stopping point${remainingStops > 1 ? 's' : ''} available. Call ben_ten_loadMore again to load more.*`
                : '*This is the earliest stopping point.*',
              '',
              replayResult.value.replay,
            ].join('\n'),
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
