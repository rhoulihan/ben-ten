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
   * Discover the most recent transcript file for a project.
   * Looks in ~/.claude/projects/<project-path>/ for .jsonl files.
   *
   * @param projectDir - The project directory path
   * @returns Result with transcript path or null if not found
   */
  discoverTranscriptPath(
    projectDir: string,
  ): Promise<Result<string | null, BenTenError>>;

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

  /**
   * Convert a project directory path to Claude Code's project path format.
   * Example: /mnt/c/Users/rickh/GitHub/Ben10 -> -mnt-c-Users-rickh-GitHub-Ben10
   */
  const toClaudeProjectPath = (projectDir: string): string => {
    // Replace all path separators with dashes, remove leading slash
    return projectDir.replace(/^\//, '').replace(/\//g, '-');
  };

  /**
   * Get the Claude Code projects directory.
   * Returns ~/.claude/projects on Unix-like systems.
   */
  const getClaudeProjectsDir = (): string => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return `${home}/.claude/projects`;
  };

  const service: TranscriptService = {
    async discoverTranscriptPath(projectDir) {
      const claudeProjectPath = toClaudeProjectPath(projectDir);
      const projectsDir = getClaudeProjectsDir();
      const transcriptDir = `${projectsDir}/${claudeProjectPath}`;

      logger.debug('Discovering transcript', { projectDir, transcriptDir });

      // Check if directory exists
      if (!(await fs.exists(transcriptDir))) {
        logger.debug('Claude projects directory not found', { transcriptDir });
        return ok(null);
      }

      // List all .jsonl files in the directory
      const readdirResult = await fs.readdir(transcriptDir);
      if (!readdirResult.ok) {
        logger.warn('Failed to read Claude projects directory', {
          transcriptDir,
          error: readdirResult.error.message,
        });
        return ok(null);
      }

      const jsonlFiles = readdirResult.value.filter((f) =>
        f.endsWith('.jsonl'),
      );
      if (jsonlFiles.length === 0) {
        logger.debug('No transcript files found', { transcriptDir });
        return ok(null);
      }

      // Find the most recently modified transcript file
      let latestFile: string | null = null;
      let latestMtime = 0;

      for (const file of jsonlFiles) {
        const filePath = `${transcriptDir}/${file}`;
        const statResult = await fs.stat(filePath);
        if (statResult.ok) {
          const mtime = statResult.value.mtime.getTime();
          if (mtime > latestMtime) {
            latestMtime = mtime;
            latestFile = filePath;
          }
        }
      }

      if (latestFile) {
        logger.info('Discovered transcript', { path: latestFile });
      }

      return ok(latestFile);
    },

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
