import {
  type ContentBlock,
  type TranscriptEntry,
  getTranscriptEntryContent,
} from '../core/types.js';
import type { BenTenError } from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, ok } from '../infrastructure/result.js';

/** Maximum characters for user message truncation */
const MAX_USER_MESSAGE_LENGTH = 500;

/** Maximum characters for tool command truncation */
const MAX_TOOL_COMMAND_LENGTH = 50;

/** Patterns for detecting semantic completion markers */
const COMPLETION_PATTERNS = [
  /\b(?:done|complete|finished|completed)\b/i,
  /\b(?:moving on|let's work on|next up|now let's)\b/i,
];

/**
 * Stopping point types in priority order.
 */
export type StoppingPointType =
  | 'git_commit'
  | 'task_completion'
  | 'semantic_marker'
  | 'token_budget';

/**
 * Options for replay generation.
 */
export interface ReplayOptions {
  /** Maximum tokens to include in replay */
  maxTokens?: number;
}

/**
 * Result of replay generation.
 */
export interface ReplayResult {
  /** The formatted replay markdown */
  replay: string;
  /** Estimated token count of the replay */
  tokenCount: number;
  /** Number of messages included */
  messageCount: number;
  /** Type of stopping point that was detected */
  stoppingPointType: StoppingPointType | null;
}

/**
 * Service for generating conversation replays from transcripts.
 */
export interface ReplayService {
  /**
   * Generate a condensed conversation replay from transcript messages.
   *
   * @param messages - Transcript entries to process
   * @param options - Replay generation options
   * @returns Result with ReplayResult or error
   */
  generateReplay(
    messages: TranscriptEntry[],
    options?: ReplayOptions,
  ): Result<ReplayResult, BenTenError>;
}

export interface ReplayServiceDeps {
  logger: Logger;
}

/**
 * Estimates token count using 4 characters per token heuristic.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export const estimateTokens = (text: string): number => {
  return Math.floor(text.length / 4);
};

/**
 * Checks if a transcript entry contains a git commit command.
 *
 * @param entry - Transcript entry to check
 * @returns true if entry contains a git commit
 */
export const isGitCommit = (entry: TranscriptEntry): boolean => {
  if (entry.type !== 'assistant') {
    return false;
  }

  for (const block of entry.message.content) {
    if (block.type === 'tool_use' && block.name === 'Bash') {
      const input = block.input as { command?: string };
      if (input.command && /git\s+commit\b/.test(input.command)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Checks if a transcript entry contains a task completion.
 *
 * @param entry - Transcript entry to check
 * @returns true if entry contains task completion
 */
export const isTaskCompletion = (entry: TranscriptEntry): boolean => {
  if (entry.type !== 'assistant') {
    return false;
  }

  for (const block of entry.message.content) {
    if (block.type === 'tool_use' && block.name === 'TaskUpdate') {
      const input = block.input as { status?: string };
      if (input.status === 'completed') {
        return true;
      }
    }
  }

  return false;
};

/**
 * Checks if a transcript entry contains semantic completion markers.
 *
 * @param entry - Transcript entry to check
 * @returns true if entry contains semantic markers
 */
export const isSemanticMarker = (entry: TranscriptEntry): boolean => {
  if (entry.type !== 'assistant') {
    return false;
  }

  const content = getTranscriptEntryContent(entry);
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(content));
};

/**
 * Truncates text to a maximum length, adding ellipsis if truncated.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.substring(0, maxLength - 3)}...`;
};

/**
 * Formats a tool use block into a condensed string.
 *
 * @param block - Tool use content block
 * @returns Formatted tool string
 */
const formatToolUse = (
  block: Extract<ContentBlock, { type: 'tool_use' }>,
): string => {
  const input = block.input as Record<string, unknown>;

  switch (block.name) {
    case 'Bash': {
      const command = String(input.command || '');
      return `[Bash: ${truncateText(command, MAX_TOOL_COMMAND_LENGTH)}]`;
    }
    case 'Read': {
      const filePath = String(input.file_path || '');
      return `[Read: ${filePath}]`;
    }
    case 'Edit': {
      const filePath = String(input.file_path || '');
      return `[Edit: ${filePath}]`;
    }
    case 'Write': {
      const filePath = String(input.file_path || '');
      return `[Write: ${filePath}]`;
    }
    case 'Glob': {
      const pattern = String(input.pattern || '');
      return `[Glob: ${pattern}]`;
    }
    case 'Grep': {
      const pattern = String(input.pattern || '');
      return `[Grep: ${pattern}]`;
    }
    case 'Task': {
      const description = String(input.description || '');
      return `[Task: ${description}]`;
    }
    default:
      return `[${block.name}]`;
  }
};

/**
 * Formats a single transcript entry for the replay.
 *
 * @param entry - Entry to format
 * @returns Formatted entry string
 */
const formatEntry = (entry: TranscriptEntry): string => {
  if (entry.type === 'user') {
    const content =
      typeof entry.message.content === 'string'
        ? entry.message.content
        : '[tool results]';
    return `**User:** ${truncateText(content, MAX_USER_MESSAGE_LENGTH)}`;
  }

  if (entry.type === 'assistant') {
    const textParts: string[] = [];
    const toolParts: string[] = [];

    for (const block of entry.message.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolParts.push(
          formatToolUse(block as Extract<ContentBlock, { type: 'tool_use' }>),
        );
      }
      // Omit thinking blocks
    }

    let formatted = '**Assistant:**';
    if (textParts.length > 0) {
      formatted += ` ${truncateText(textParts.join('\n'), MAX_USER_MESSAGE_LENGTH)}`;
    }
    if (toolParts.length > 0) {
      formatted += `\n- ${toolParts.join('\n- ')}`;
    }

    return formatted;
  }

  // Skip other entry types
  return '';
};

/**
 * Creates a replay service for generating conversation replays.
 *
 * @param deps - Dependencies including logger
 * @returns A ReplayService instance
 * @example
 * const replayService = createReplayService({ logger });
 * const result = replayService.generateReplay(messages, { maxTokens: 50000 });
 */
export const createReplayService = (deps: ReplayServiceDeps): ReplayService => {
  const { logger } = deps;

  return {
    generateReplay(messages, options = {}) {
      const maxTokens = options.maxTokens ?? 50000;

      logger.debug('Generating replay', {
        messageCount: messages.length,
        maxTokens,
      });

      // Handle empty messages
      if (messages.length === 0) {
        return ok({
          replay: '',
          tokenCount: 0,
          messageCount: 0,
          stoppingPointType: null,
        });
      }

      // Find stopping point by iterating backwards
      let stoppingIndex = -1;
      let stoppingPointType: StoppingPointType | null = null;
      let weakStoppingIndex = -1;

      for (let i = messages.length - 1; i >= 0; i--) {
        const entry = messages[i];
        if (!entry) continue;

        // Git commit is highest priority - stop immediately
        if (isGitCommit(entry)) {
          stoppingIndex = i;
          stoppingPointType = 'git_commit';
          logger.debug('Found git commit stopping point', { index: i });
          break;
        }

        // Task completion is second priority - stop immediately
        if (isTaskCompletion(entry)) {
          stoppingIndex = i;
          stoppingPointType = 'task_completion';
          logger.debug('Found task completion stopping point', { index: i });
          break;
        }

        // Semantic marker is weak - remember but continue looking
        if (weakStoppingIndex === -1 && isSemanticMarker(entry)) {
          weakStoppingIndex = i;
          logger.debug('Found semantic marker', { index: i });
        }
      }

      // Use weak stopping point if no strong one found
      if (stoppingIndex === -1 && weakStoppingIndex !== -1) {
        stoppingIndex = weakStoppingIndex;
        stoppingPointType = 'semantic_marker';
      }

      // Collect messages after stopping point
      const startIndex = stoppingIndex !== -1 ? stoppingIndex + 1 : 0;
      const replayMessages: TranscriptEntry[] = [];
      let totalTokens = 0;
      let budgetExceeded = false;

      // If we have a stopping point, include messages after it
      // Otherwise, iterate backwards from end until budget exceeded
      if (stoppingIndex !== -1) {
        for (let i = startIndex; i < messages.length; i++) {
          const entry = messages[i];
          if (!entry) continue;
          const formatted = formatEntry(entry);
          const entryTokens = estimateTokens(formatted);

          if (totalTokens + entryTokens > maxTokens) {
            budgetExceeded = true;
            break;
          }

          replayMessages.push(entry);
          totalTokens += entryTokens;
        }
      } else {
        // No stopping point - work backwards from end within budget
        for (let i = messages.length - 1; i >= 0; i--) {
          const entry = messages[i];
          if (!entry) continue;
          const formatted = formatEntry(entry);
          const entryTokens = estimateTokens(formatted);

          if (totalTokens + entryTokens > maxTokens) {
            stoppingPointType = 'token_budget';
            budgetExceeded = true;
            break;
          }

          replayMessages.unshift(entry);
          totalTokens += entryTokens;
        }
      }

      // If budget was exceeded while processing, update type
      if (budgetExceeded && stoppingIndex !== -1) {
        // We had a stopping point but also hit budget
        // Keep the stopping point type
      } else if (budgetExceeded) {
        stoppingPointType = 'token_budget';
      }

      // Format replay
      const formattedLines = replayMessages
        .map(formatEntry)
        .filter((line) => line.length > 0);

      let replay = '';
      if (formattedLines.length > 0) {
        replay = `## Recent Conversation\n\n${formattedLines.join('\n\n')}`;
      }

      const result: ReplayResult = {
        replay,
        tokenCount: estimateTokens(replay),
        messageCount: replayMessages.length,
        stoppingPointType,
      };

      logger.debug('Generated replay', {
        tokenCount: result.tokenCount,
        messageCount: result.messageCount,
        stoppingPointType: result.stoppingPointType,
      });

      return ok(result);
    },
  };
};
