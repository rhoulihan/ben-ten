import type { FileSystem } from '../adapters/fs/memory-fs.js';
import {
  type ContentBlock,
  type ConversationHistory,
  type ToolExecution,
  type TranscriptEntry,
  TranscriptEntrySchema,
  getTranscriptEntryContent,
} from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';

/**
 * Service for parsing and extracting information from Claude Code transcripts.
 */
export interface TranscriptService {
  /**
   * Parse a transcript JSONL file into conversation history.
   *
   * @param path - Path to the transcript file
   * @returns Result with ConversationHistory or error
   */
  parseTranscript(
    path: string,
  ): Promise<Result<ConversationHistory, BenTenError>>;

  /**
   * Extract file references from conversation history.
   * Looks for file paths in backticks and tool mentions.
   *
   * @param history - Parsed conversation history
   * @returns Array of unique file paths
   */
  extractFileReferences(history: ConversationHistory): string[];

  /**
   * Extract tool calls from conversation history.
   * Parses tool execution patterns from assistant messages.
   *
   * @param history - Parsed conversation history
   * @returns Array of tool execution records
   */
  extractToolCalls(history: ConversationHistory): ToolExecution[];

  /**
   * Get the latest summary from a transcript.
   *
   * @param path - Path to the transcript file
   * @returns Result with the latest summary string or null if none
   */
  getLatestSummary(path: string): Promise<Result<string | null, BenTenError>>;
}

export interface TranscriptServiceDeps {
  fs: FileSystem;
  logger: Logger;
}

/**
 * Creates a transcript service for parsing Claude Code transcripts.
 *
 * @param deps - Dependencies including file system and logger
 * @returns A TranscriptService instance
 */
export const createTranscriptService = (
  deps: TranscriptServiceDeps,
): TranscriptService => {
  const { fs, logger } = deps;

  /**
   * Parse a single line of JSONL into a TranscriptEntry.
   * Returns null for invalid or unparseable lines.
   */
  const parseLine = (line: string): TranscriptEntry | null => {
    if (!line.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(line);
      const result = TranscriptEntrySchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  };

  const service: TranscriptService = {
    async parseTranscript(path) {
      logger.debug('Parsing transcript', { path });

      // Check if file exists
      if (!(await fs.exists(path))) {
        return err(
          createError(
            ErrorCode.TRANSCRIPT_NOT_FOUND,
            'Transcript file not found',
            {
              path,
            },
          ),
        );
      }

      // Read file
      const readResult = await fs.readFile(path);
      if (!readResult.ok) {
        return err(
          createError(
            ErrorCode.TRANSCRIPT_PARSE_ERROR,
            'Failed to read transcript',
            {
              path,
              originalError: readResult.error.message,
            },
          ),
        );
      }

      const content = readResult.value;
      const lines = content.split('\n');
      const messages: TranscriptEntry[] = [];

      for (const line of lines) {
        const entry = parseLine(line);
        if (entry) {
          messages.push(entry);
        } else if (line.trim()) {
          logger.warn('Skipping malformed transcript line', {
            line: line.substring(0, 100),
          });
        }
      }

      const history: ConversationHistory = {
        messages,
        messageCount: messages.length,
      };

      logger.info('Parsed transcript', {
        path,
        messageCount: messages.length,
      });

      return ok(history);
    },

    extractFileReferences(history) {
      const fileSet = new Set<string>();

      // Pattern to match file paths in backticks
      // Matches: `path/to/file.ts`, `./relative/file.js`, `/absolute/file.py`
      const backtickPattern = /`([^`]+\.[a-zA-Z0-9]+)`/g;

      for (const entry of history.messages) {
        const content = getTranscriptEntryContent(entry);
        if (!content) continue;

        let match = backtickPattern.exec(content);
        while (match) {
          const filePath = match[1];
          // Filter out things that don't look like file paths
          if (
            filePath &&
            (filePath.includes('/') ||
              (filePath.includes('.') && !filePath.includes(' ')))
          ) {
            fileSet.add(filePath);
          }
          match = backtickPattern.exec(content);
        }
        // Reset regex lastIndex for next iteration
        backtickPattern.lastIndex = 0;
      }

      return Array.from(fileSet);
    },

    extractToolCalls(history) {
      const tools: ToolExecution[] = [];
      const now = Date.now();

      for (const entry of history.messages) {
        if (entry.type !== 'assistant') {
          continue;
        }

        // Extract tool_use blocks directly from content
        for (const block of entry.message.content) {
          if (block.type === 'tool_use') {
            const toolBlock = block as Extract<
              ContentBlock,
              { type: 'tool_use' }
            >;
            tools.push({
              toolName: toolBlock.name,
              timestamp: now,
              success: true, // Assume success; could check for tool_result later
            });
          }
        }
      }

      return tools;
    },

    async getLatestSummary(path) {
      const parseResult = await service.parseTranscript(path);
      if (!parseResult.ok) {
        return err(parseResult.error);
      }

      const { messages } = parseResult.value;
      let latestSummary: string | null = null;

      for (const entry of messages) {
        if (entry.type === 'summary') {
          latestSummary = entry.summary;
        }
      }

      return ok(latestSummary);
    },
  };

  return service;
};
